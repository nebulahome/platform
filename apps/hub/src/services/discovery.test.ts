/**
 * Discovery, against a fake mDNS source, a fake transport and a vendor built in the test.
 *
 * The browser and the network are the mDNS source's and the transport's own tests; what is
 * checked here is the part only this service does - the six steps from an announcement to a
 * candidate, and the bookkeeping around them: probing an address once in a while however often it
 * is heard, hiding what is already added, forgetting what went quiet.
 */
import { Writable } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { DiscoveredDevice, JsonObject } from '@nebula-home/contracts';
import { createLogger, type PlatformLogger } from '@nebula-home/logging';
import {
  bundleManifestSchema,
  createDeclarativeIntegration,
  defineTransport,
  integrationProfileSchema,
  Registry,
  resolveDiscovery,
  vendorDiscoverySchema,
  type Discovered,
  type DiscoverySource,
  type Integration,
  type MdnsAnnouncement,
  type Sighting,
  type Transport,
} from '@nebula-home/package-runtime';

import type { MdnsSource } from '../discovery/mdns-source.js';
import type { TakenDevices } from '../domain/taken.js';

import type { LoadedListenSource } from './bundles.js';
import { DiscoveryService, type DiscoveryVendor } from './discovery.js';

/**
 * A logger that writes nowhere.
 *
 * @returns A logger bound to a discarding stream.
 */
function silent(): PlatformLogger {
  return createLogger(
    { service: 'hub-discovery', version: '0.0.0', level: 'fatal' },
    new Writable({
      /**
       * Discards a chunk.
       *
       * @param chunk - Ignored.
       * @param encoding - Ignored.
       * @param done - Called to accept the write.
       */
      write(chunk, encoding, done): void {
        done();
      },
    }),
  );
}

/**
 * Waits until a condition holds, polling.
 *
 * @param condition - What to wait for.
 * @param timeoutMs - How long before giving up.
 */
async function until(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting');
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** What the fake devices answer a probe with, by the address they are asked at. */
const ANSWERS = new Map<string, JsonObject>([
  ['192.168.1.40', { id: 'r1', name: 'Kitchen', model: 'R-2', kind: 'relay' }],
  ['192.168.1.41:8081', { id: 'r2', name: null, model: 'R-9', kind: 'relay' }],
  ['192.168.1.42', { id: 'x1', model: 'X-1', kind: 'unknown' }],
]);

/** A fake transport of the vendor's own, and what it was asked. */
type FakeTransport = {
  readonly transport: Transport;
  readonly scans: { config: unknown; terms: JsonObject }[];
};

/**
 * A transport whose scan answers from {@link ANSWERS}.
 *
 * @returns The transport and the record of what it was asked.
 */
function fakeTransport(): FakeTransport {
  const scans: { config: unknown; terms: JsonObject }[] = [];
  const transport = defineTransport({
    id: 'acme/rpc',
    configSchema: z.object({ host: z.string(), password: z.string().optional() }),
    connectionKey: (config) => config.host,
    connect: () => Promise.reject(new Error('unused')),
    scan: async function* scan(config, terms): AsyncGenerator<Discovered> {
      scans.push({ config, terms });
      await Promise.resolve();

      const answer = ANSWERS.get(config.host);

      if (answer !== undefined) {
        yield { deviceKey: config.host, payload: answer };
      }
    },
    probe: () => Promise.resolve('ok'),
  });

  return { transport, scans };
}

/**
 * The acme relay driver, claiming what reports itself as a relay.
 *
 * @returns The integration, built as the loader builds a declarative one.
 */
function relayIntegration(): Integration {
  return createDeclarativeIntegration(
    bundleManifestSchema.parse({
      id: 'acme/relay',
      version: '1.0.0',
      sdk: '^1.0.0',
      name: 'Acme Relay',
      vendor: { id: 'acme', name: 'Acme' },
      transport: 'acme/rpc',
      models: ['Relay One', 'Relay Two'],
      kind: 'declarative',
      profile: './profile.json',
      setup: './setup.json',
    }),
    integrationProfileSchema.parse({
      discovery: {
        probe: { op: 'call', args: {} },
        claim: [{ path: 'kind', equals: 'relay' }],
        identity: { externalId: 'id' },
      },
      entities: [{ domain: 'switch', capabilities: { on_off: {} }, state: {} }],
    }),
  );
}

/** A fake mDNS source, driven by the test. */
type FakeMdns = MdnsSource & {
  readonly services: string[];
  queries: number;
  announce: (announcement: MdnsAnnouncement) => void;
};

/**
 * Makes a fake mDNS source.
 *
 * @returns The source, whose announcements the test makes.
 */
function fakeMdns(): FakeMdns {
  let report: (announcement: MdnsAnnouncement) => void = () => undefined;
  const fake: FakeMdns = {
    services: [],
    queries: 0,
    announce: (announcement) => {
      report(announcement);
    },
    start: (services, onAnnouncement) => {
      fake.services.push(...services);
      report = onAnnouncement;
    },
    query: () => {
      fake.queries += 1;
    },
    stop: () => Promise.resolve(),
  };

  return fake;
}

/**
 * An announcement of the acme service.
 *
 * @param address - Where the device is.
 * @param port - Its port.
 * @param txt - Its TXT record.
 * @returns The announcement, as the mDNS source reports it.
 */
function heard(address: string, port = 80, txt: Record<string, string> = {}): MdnsAnnouncement {
  return {
    service: '_acme._tcp',
    instance: `acme-${address}`,
    host: 'acme.local',
    address,
    port,
    txt,
  };
}

/**
 * The acme vendor's discovery, varied by the test.
 *
 * @param file - The `discovery.json`, parsed with the schema.
 * @param sources - What it listens to; its mDNS service when not said.
 * @returns The vendor, as the loader hands it over.
 */
function acme(
  file: Record<string, unknown> = {
    listen: [{ mdns: '_acme._tcp' }],
    probe: { transport: 'acme/rpc', op: 'call', args: { method: 'Device.Info' } },
    identity: { externalId: 'id', name: 'name', model: 'model' },
  },
  sources: readonly LoadedListenSource[] = [{ kind: 'mdns', service: '_acme._tcp' }],
): DiscoveryVendor {
  return {
    id: 'acme',
    discovery: {
      plan: resolveDiscovery('acme', vendorDiscoverySchema.parse(file), [
        {
          id: 'relay',
          name: 'Relay',
          models: ['Relay One', 'Relay Two'],
          modelCodes: { 'R-1': 'Relay One', 'R-2': 'Relay Two' },
        },
      ]),
      sources,
    },
  };
}

/** Everything one test drives. */
type Harness = {
  readonly service: DiscoveryService;
  readonly mdns: FakeMdns;
  readonly transport: FakeTransport;
  readonly published: number[];
  taken: TakenDevices;
};

let harness: Harness | undefined;

/**
 * Starts discovery over the fakes.
 *
 * @param options - What to vary.
 * @param options.vendor - The vendor; acme as it ships when not said.
 * @param options.settings - The vendor's saved settings.
 * @param options.ttlMs - How long a device stays proposed without being heard again.
 * @param options.queryIntervalMs - How often mDNS is asked again.
 * @param options.probeIntervalMs - How long an address's answer is trusted.
 * @param options.withTransport - Whether the vendor's transport is registered.
 * @returns The harness.
 */
async function start(
  options: {
    readonly vendor?: DiscoveryVendor;
    readonly settings?: JsonObject;
    readonly ttlMs?: number;
    readonly queryIntervalMs?: number;
    readonly probeIntervalMs?: number;
    readonly withTransport?: boolean;
  } = {},
): Promise<Harness> {
  const mdns = fakeMdns();
  const transport = fakeTransport();
  const transports = new Registry<Transport>('transport');
  const integrations = new Registry<Integration>('integration');
  const published: number[] = [];

  if (options.withTransport !== false) {
    transports.register(transport.transport);
  }

  integrations.register(relayIntegration());

  const built: Harness = {
    mdns,
    transport,
    published,
    taken: { externalIds: new Set(), hosts: new Set() },
    service: new DiscoveryService({
      vendors: [options.vendor ?? acme()],
      mdns,
      transports,
      integrations,
      logger: silent(),
      vendorSettings: () => Promise.resolve(options.settings ?? {}),
      taken: () => Promise.resolve(built.taken),
      publishChanged: (count) => {
        published.push(count);
      },
      queryIntervalMs: options.queryIntervalMs ?? 60_000,
      ttlMs: options.ttlMs ?? 60_000,
      probeIntervalMs: options.probeIntervalMs ?? 60_000,
    }),
  };

  harness = built;
  await built.service.start();

  return built;
}

afterEach(async () => {
  await harness?.service.stop();
  harness = undefined;
});

describe('DiscoveryService', () => {
  it('browses for the services the vendors declared', async () => {
    const { mdns } = await start();

    expect(mdns.services).toEqual(['_acme._tcp']);
    expect(mdns.queries).toBeGreaterThanOrEqual(1);
  });

  it('proposes a device it heard, probed, and matched to a driver by the model it reported', async () => {
    const { service, mdns, published } = await start();

    mdns.announce(heard('192.168.1.40'));
    await until(() => service.list().length > 0);

    expect(service.list()[0]).toMatchObject<Partial<DiscoveredDevice>>({
      vendorId: 'acme',
      driverId: 'relay',
      kind: 'acme/relay',
      source: 'mdns',
      address: '192.168.1.40',
      externalId: 'r1',
      name: 'Kitchen',
      model: 'Relay Two',
      modelChoices: ['Relay Two'],
      modelCode: 'R-2',
      transportConfig: { host: '192.168.1.40' },
    });
    expect(published).toEqual([1]);
  });

  it('asks the address in the terms the vendor gave, with its saved settings beneath', async () => {
    // The owner's vendor-wide answers - an account key - may be what the probe needs; the address
    // is the announcement's and wins over anything saved.
    const { service, mdns, transport } = await start({
      settings: { password: 'saved', host: 'stale' },
    });

    mdns.announce(heard('192.168.1.40'));
    await until(() => service.list().length > 0);

    expect(transport.scans[0]).toEqual({
      config: { host: '192.168.1.40', password: 'saved' },
      terms: { probe: { op: 'call', args: { method: 'Device.Info' } } },
    });
  });

  it('writes the port into the address when it is not the usual one', async () => {
    const { service, mdns } = await start();

    mdns.announce(heard('192.168.1.41', 8081));
    await until(() => service.list().length > 0);

    expect(service.list()[0]?.transportConfig).toEqual({ host: '192.168.1.41:8081' });
  });

  it("falls back on the drivers' own claims for a model no driver maps", async () => {
    const { service, mdns } = await start();

    mdns.announce(heard('192.168.1.41', 8081));
    await until(() => service.list().length > 0);

    expect(service.list()[0]).toMatchObject({
      driverId: 'relay',
      model: null,
      modelChoices: ['Relay One', 'Relay Two'],
      modelCode: 'R-9',
    });
  });

  it('proposes nothing for a device no driver of the vendor takes', async () => {
    const { service, mdns, transport } = await start();

    mdns.announce(heard('192.168.1.42'));
    await until(() => transport.scans.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(service.list()).toEqual([]);
  });

  it("does not probe what the vendor's match refuses", async () => {
    const { service, mdns, transport } = await start({
      vendor: acme({
        listen: [{ mdns: '_acme._tcp' }],
        match: [{ path: 'txt.type', equals: 'relay' }],
        probe: { transport: 'acme/rpc', op: 'call' },
        identity: { externalId: 'id', model: 'model' },
      }),
    });

    mdns.announce(heard('192.168.1.40', 80, { type: 'bulb' }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(transport.scans).toEqual([]);
    expect(service.list()).toEqual([]);
  });

  it('reads a device from its announcement when the vendor does not probe', async () => {
    // A Nanoleaf answers nothing without its token, but its TXT record says which model it is.
    const { service, mdns, transport } = await start({
      vendor: acme({
        listen: [{ mdns: '_acme._tcp' }],
        identity: { model: 'txt.md', name: 'instance' },
      }),
    });

    mdns.announce(heard('192.168.1.50', 16021, { md: 'R-1' }));
    await until(() => service.list().length > 0);

    expect(transport.scans).toEqual([]);
    expect(service.list()[0]).toMatchObject({
      externalId: null,
      name: 'acme-192.168.1.50',
      model: 'Relay One',
      address: '192.168.1.50:16021',
    });
  });

  it('probes an address once in a while, however often it is announced', async () => {
    const { service, mdns, transport } = await start();

    mdns.announce(heard('192.168.1.40'));
    await until(() => service.list().length > 0);
    const first = service.list()[0];

    mdns.announce(heard('192.168.1.40'));
    mdns.announce(heard('192.168.1.40'));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(transport.scans).toHaveLength(1);
    expect(service.list()[0]?.id).toBe(first?.id);
    expect(service.list()[0]?.firstSeenAt).toBe(first?.firstSeenAt);
  });

  it('hides a device already added, whether by its id or its address', async () => {
    const built = await start();

    built.taken = { externalIds: new Set(['acme\nr1']), hosts: new Set() };
    await built.service.refresh();
    built.mdns.announce(heard('192.168.1.40'));
    await until(() => built.transport.scans.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(built.service.list()).toEqual([]);

    built.taken = { externalIds: new Set(), hosts: new Set(['acme\n192.168.1.40']) };
    await built.service.refresh();

    expect(built.service.list()).toEqual([]);

    built.taken = { externalIds: new Set(), hosts: new Set() };
    await built.service.refresh();

    expect(built.service.list()).toHaveLength(1);
    expect(built.published.at(-1)).toBe(1);
  });

  it('forgets a device it has not heard from in the time a device is given', async () => {
    const { service, mdns, published } = await start({ ttlMs: 60 });

    mdns.announce(heard('192.168.1.40'));
    await until(() => service.list().length > 0);
    await until(() => service.list().length === 0);

    expect(published).toEqual([1, 0]);
  });

  it('asks mDNS again on its interval', async () => {
    const { mdns } = await start({ queryIntervalMs: 20 });

    await until(() => mdns.queries >= 3);
  });

  it('proposes nothing and throws nothing when the probe transport is not there', async () => {
    const { service, mdns } = await start({ withTransport: false });

    mdns.announce(heard('192.168.1.40'));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(service.list()).toEqual([]);
  });

  it("listens with a vendor's own module, reading what it reports without probing", async () => {
    const reported: Sighting[] = [
      { config: { host: '192.168.1.60' }, payload: { device: 'AA:BB', sku: 'R-1' } },
    ];
    const module: DiscoverySource = {
      listen: async function* listen(signal): AsyncGenerator<Sighting> {
        yield* reported;
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => {
            resolve();
          });
        });
      },
    };
    const { service, transport } = await start({
      vendor: acme(
        {
          listen: [{ module: './lan/discovery.js' }],
          identity: { externalId: 'device', model: 'sku' },
        },
        [{ kind: 'module', file: './lan/discovery.js', source: module }],
      ),
    });

    await until(() => service.list().length > 0);

    expect(transport.scans).toEqual([]);
    expect(service.list()[0]).toMatchObject({
      source: 'module',
      externalId: 'AA:BB',
      model: 'Relay One',
      address: '192.168.1.60',
    });
  });

  it("does not follow a vendor module's sighting to an address on the internet", async () => {
    // What a module reports came off the network unauthenticated, as an announcement does.
    const module: DiscoverySource = {
      listen: async function* listen(signal): AsyncGenerator<Sighting> {
        yield { config: { host: '8.8.8.8' }, payload: { device: 'CC:DD', sku: 'R-1' } };
        yield { config: { host: '192.168.1.61' }, payload: { device: 'EE:FF', sku: 'R-1' } };
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => {
            resolve();
          });
        });
      },
    };
    const { service } = await start({
      vendor: acme(
        {
          listen: [{ module: './lan/discovery.js' }],
          identity: { externalId: 'device', model: 'sku' },
        },
        [{ kind: 'module', file: './lan/discovery.js', source: module }],
      ),
    });

    await until(() => service.list().length > 0);

    expect(service.list().map((device) => device.address)).toEqual(['192.168.1.61']);
  });
});

describe('DiscoveryService.detect', () => {
  it('says which driver and model a configuration being tried reaches', async () => {
    // The Test button of the add form: the owner typed an address, and the form preselects
    // the model the device says it is.
    const { service } = await start();

    await expect(service.detect('acme/relay', { host: '192.168.1.40' })).resolves.toEqual({
      kind: 'acme/relay',
      model: 'Relay Two',
      modelChoices: ['Relay Two'],
    });
  });

  it('detects nothing for a vendor that does not probe, or a device nothing takes', async () => {
    const { service } = await start();

    await expect(service.detect('acme/relay', { host: '192.168.1.42' })).resolves.toBeUndefined();
    await expect(service.detect('other/thing', { host: '192.168.1.40' })).resolves.toBeUndefined();
  });
});
