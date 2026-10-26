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

import type { DiscoveredDevice, JsonObject, MatterIdentity } from '@nebulahome/contracts';
import { createLogger, type PlatformLogger } from '@nebulahome/logging';
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
  type MatterDeviceSnapshot,
  type MdnsAnnouncement,
  type Sighting,
  type Transport,
} from '@nebulahome/package-runtime';

import type { MdnsSource } from '../discovery/mdns-source.js';
import type { TakenDevices } from '../domain/taken.js';
import type { MatterSighting } from '../matter/broker.js';
import type { ModbusSighting } from '../modbus/broker.js';

import type { LoadedListenSource } from './bundles.js';
import { DiscoveryService, SCAN_DURATION_MS, type DiscoveryVendor } from './discovery.js';
import { platformMatterVendor, platformModbusVendor } from './platform-vendors.js';

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
    configSchema: z.object({
      host: z.string(),
      password: z.string().optional(),
      timeoutMs: z.int().optional(),
    }),
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
          transport: 'http',
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
 * @param options.now - The clock; the wall clock when not said.
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
    readonly now?: () => number;
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
    taken: {
      externalIds: new Set(),
      hosts: new Set(),
      locations: new Map(),
      matter: new Map(),
      mqtt: new Map(),
      modbus: new Map(),
    },
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
      ...(options.now === undefined ? {} : { now: options.now }),
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

  it('gives a slow device the time its vendor says, and tells the transport so', async () => {
    // A Shelly on a weak Wi-Fi link takes seconds to answer the first request after its radio
    // slept; the platform's four seconds would end the probe first.
    const { service, mdns, transport } = await start({
      vendor: acme({
        listen: [{ mdns: '_acme._tcp' }],
        probe: {
          transport: 'acme/rpc',
          op: 'call',
          args: { method: 'Device.Info' },
          timeoutMs: 10_000,
        },
        identity: { externalId: 'id', name: 'name', model: 'model' },
      }),
    });

    mdns.announce(heard('192.168.1.40'));
    await until(() => service.list().length > 0);

    expect(transport.scans[0]?.config).toEqual({ host: '192.168.1.40', timeoutMs: 10_000 });
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
    expect(service.hearingOf('acme').passedOver).toEqual([
      expect.objectContaining({ reason: expect.stringContaining('No driver') as unknown }),
    ]);
  });

  it("keeps what a vendor's module says of its listening, and what it passed over", async () => {
    const module: DiscoverySource = {
      listen: async function* listen(signal, context): AsyncGenerator<Sighting> {
        context.status?.({ level: 'warning', message: 'Connected, and nothing heard' });
        context.passedOver?.([
          { id: '0x01', name: 'Door', model: 'MCCGQ11LM', reason: 'Still pairing it' },
        ]);
        yield* [];
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => {
            resolve();
          });
        });
      },
    };
    const { service, published } = await start({
      vendor: acme(
        {
          listen: [{ module: './cloud/discovery.js', lan: false }],
          identity: { externalId: 'device', model: 'sku' },
        },
        [{ kind: 'module', file: './cloud/discovery.js', source: module, lan: false }],
      ),
    });

    await until(() => service.hearingOf('acme').passedOver.length > 0);

    const hearing = service.hearingOf('acme');

    expect(hearing.listener).toMatchObject({
      level: 'warning',
      message: 'Connected, and nothing heard',
    });
    expect(hearing.passedOver).toEqual([
      expect.objectContaining({ id: '0x01', name: 'Door', reason: 'Still pairing it' }),
    ]);
    expect(published.length).toBeGreaterThanOrEqual(2);
    expect(service.hearingOf('other')).toEqual({ listener: null, passedOver: [] });
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

    built.taken = {
      externalIds: new Set(['acme\nr1']),
      hosts: new Set(),
      locations: new Map(),
      matter: new Map(),
      mqtt: new Map(),
      modbus: new Map(),
    };
    await built.service.refresh();
    built.mdns.announce(heard('192.168.1.40'));
    await until(() => built.transport.scans.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(built.service.list()).toEqual([]);

    built.taken = {
      externalIds: new Set(),
      hosts: new Set(['acme\n192.168.1.40']),
      locations: new Map(),
      matter: new Map(),
      mqtt: new Map(),
      modbus: new Map(),
    };
    await built.service.refresh();

    expect(built.service.list()).toEqual([]);

    built.taken = {
      externalIds: new Set(),
      hosts: new Set(),
      locations: new Map(),
      matter: new Map(),
      mqtt: new Map(),
      modbus: new Map(),
    };
    await built.service.refresh();

    expect(built.service.list()).toHaveLength(1);
    expect(built.published.at(-1)).toBe(1);
  });

  it('shows a removed device again at once, probing its address again and asking mDNS', async () => {
    const built = await start();

    // Adopted at .40: heard, proposed, then taken.
    built.mdns.announce(heard('192.168.1.40'));
    await until(() => built.service.list().length === 1);
    built.taken = {
      externalIds: new Set(['acme\nr1']),
      hosts: new Set(['acme\n192.168.1.40']),
      locations: new Map(),
      matter: new Map(),
      mqtt: new Map(),
      modbus: new Map(),
    };
    await built.service.refresh();

    expect(built.service.list()).toEqual([]);

    const scansBefore = built.transport.scans.length;
    const queriesBefore = built.mdns.queries;

    // Removed: the rows are gone, and discovery is told.
    built.taken = {
      externalIds: new Set(),
      hosts: new Set(),
      locations: new Map(),
      matter: new Map(),
      mqtt: new Map(),
      modbus: new Map(),
    };
    await built.service.release('acme');

    expect(built.service.list()).toHaveLength(1);
    expect(built.mdns.queries).toBeGreaterThan(queriesBefore);

    // What the address answered before is not trusted any more: it is asked again.
    built.mdns.announce(heard('192.168.1.40'));
    await until(() => built.transport.scans.length > scansBefore);
  });

  it('proposes moving a device added at one address and heard answering at another', async () => {
    const built = await start();

    // r1 was added at .39; the lease changed and it now answers at .40.
    built.taken = {
      externalIds: new Set(['acme\nr1']),
      hosts: new Set(['acme\n192.168.1.39']),
      locations: new Map([['acme\nr1', { instanceId: 'relay-kitchen', host: '192.168.1.39' }]]),
      matter: new Map(),
      mqtt: new Map(),
      modbus: new Map(),
    };
    await built.service.refresh();
    built.mdns.announce(heard('192.168.1.40'));
    await until(() => built.service.list().length === 1);

    expect(built.service.list()[0]).toMatchObject({
      externalId: 'r1',
      address: '192.168.1.40',
      movedFrom: { deviceId: 'relay-kitchen', address: '192.168.1.39' },
    });

    // Moved: the instance reaches .40 now, and there is nothing left to propose.
    built.taken = {
      externalIds: new Set(['acme\nr1']),
      hosts: new Set(['acme\n192.168.1.40']),
      locations: new Map([['acme\nr1', { instanceId: 'relay-kitchen', host: '192.168.1.40' }]]),
      matter: new Map(),
      mqtt: new Map(),
      modbus: new Map(),
    };
    await built.service.refresh();

    expect(built.service.list()).toEqual([]);
  });

  it('keeps a device heard while it is added, so it is not forgotten before it is removed', async () => {
    let nowMs = 1_000_000;
    // Swept every 10 ms: the device must outlive the sweeps while it is added and still heard.
    const built = await start({ ttlMs: 20, now: () => nowMs });

    built.mdns.announce(heard('192.168.1.40'));
    await until(() => built.service.list().length === 1);
    built.taken = {
      externalIds: new Set(),
      hosts: new Set(['acme\n192.168.1.40']),
      locations: new Map(),
      matter: new Map(),
      mqtt: new Map(),
      modbus: new Map(),
    };
    await built.service.refresh();

    // Heard again at its address, well past the time a device is kept, while it is added.
    nowMs += 1000;
    built.mdns.announce(heard('192.168.1.40'));
    await new Promise((resolve) => setTimeout(resolve, 40));

    built.taken = {
      externalIds: new Set(),
      hosts: new Set(),
      locations: new Map(),
      matter: new Map(),
      mqtt: new Map(),
      modbus: new Map(),
    };
    await built.service.release('acme');

    expect(built.service.list()).toHaveLength(1);
  });

  it('does not probe an address already added, which the hub is already connected to', async () => {
    const built = await start();

    built.taken = {
      externalIds: new Set(),
      hosts: new Set(['acme\n192.168.1.40']),
      locations: new Map(),
      matter: new Map(),
      mqtt: new Map(),
      modbus: new Map(),
    };
    await built.service.refresh();
    built.mdns.announce(heard('192.168.1.40'));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(built.transport.scans).toEqual([]);
  });

  it('asks an address that did not answer again sooner than one that did', async () => {
    // Nothing answers at .43: it is asked again on the next announcement once the short retry
    // has passed, while the probe interval here is a minute.
    let nowMs = 1_000_000;
    const mdns = fakeMdns();
    const transport = fakeTransport();
    const transports = new Registry<Transport>('transport');
    const integrations = new Registry<Integration>('integration');

    transports.register(transport.transport);
    integrations.register(relayIntegration());

    const service = new DiscoveryService({
      vendors: [acme()],
      mdns,
      transports,
      integrations,
      logger: silent(),
      vendorSettings: () => Promise.resolve({}),
      taken: () =>
        Promise.resolve({
          externalIds: new Set(),
          hosts: new Set(),
          locations: new Map(),
          matter: new Map(),
          mqtt: new Map(),
          modbus: new Map(),
        }),
      publishChanged: () => undefined,
      queryIntervalMs: 60_000,
      ttlMs: 600_000,
      probeIntervalMs: 600_000,
      now: () => nowMs,
    });

    harness = {
      service,
      mdns,
      transport,
      published: [],
      taken: {
        externalIds: new Set(),
        hosts: new Set(),
        locations: new Map(),
        matter: new Map(),
        mqtt: new Map(),
        modbus: new Map(),
      },
    };
    await service.start();

    mdns.announce(heard('192.168.1.43'));
    await until(() => transport.scans.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 10));

    nowMs += 31_000;
    mdns.announce(heard('192.168.1.43'));
    await until(() => transport.scans.length === 2);
  });

  it('asks an address that did not answer again on its own, a few times, then waits', async () => {
    // A device that announced once and was busy when probed need not announce again to be found:
    // the timer asks it again, and stops after three misses in a row.
    const mdns = fakeMdns();
    const transport = fakeTransport();
    const transports = new Registry<Transport>('transport');
    const integrations = new Registry<Integration>('integration');

    transports.register(transport.transport);
    integrations.register(relayIntegration());

    const service = new DiscoveryService({
      vendors: [acme()],
      mdns,
      transports,
      integrations,
      logger: silent(),
      vendorSettings: () => Promise.resolve({}),
      taken: () =>
        Promise.resolve({
          externalIds: new Set(),
          hosts: new Set(),
          locations: new Map(),
          matter: new Map(),
          mqtt: new Map(),
          modbus: new Map(),
        }),
      publishChanged: () => undefined,
      queryIntervalMs: 60_000,
      ttlMs: 600_000,
      probeIntervalMs: 600_000,
      probeRetryMs: 20,
      now: () => 1_000_000,
    });

    harness = {
      service,
      mdns,
      transport,
      published: [],
      taken: {
        externalIds: new Set(),
        hosts: new Set(),
        locations: new Map(),
        matter: new Map(),
        mqtt: new Map(),
        modbus: new Map(),
      },
    };
    await service.start();

    mdns.announce(heard('192.168.1.43'));
    await until(() => transport.scans.length === 4);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(transport.scans).toHaveLength(4);
  });

  it('looks again at once when asked, repeating the mDNS question', async () => {
    const { service, mdns, transport } = await start();

    mdns.announce(heard('192.168.1.40'));
    await until(() => service.list().length > 0);

    const asked = mdns.queries;

    expect(service.rescan('acme')).toEqual({ vendors: ['acme'], lookingForMs: SCAN_DURATION_MS });
    expect(mdns.queries).toBe(asked + 1);

    // What the address answered before is forgotten, so it is asked again when heard.
    mdns.announce(heard('192.168.1.40'));
    await until(() => transport.scans.length === 2);
    await until(() => mdns.queries >= asked + 2, 3000);
  });

  it('looks for nothing when the vendor cannot be found on the network', async () => {
    const { service } = await start();

    expect(service.rescan('other')).toEqual({ vendors: [], lookingForMs: 0 });
  });

  it("asks a vendor's module to scan when asked to look", async () => {
    let scans = 0;
    const module: DiscoverySource = {
      listen: async function* listen(signal): AsyncGenerator<Sighting> {
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => {
            resolve();
          });
        });
        yield* [];
      },
      scan: () => {
        scans += 1;
      },
    };
    const { service } = await start({
      vendor: acme(
        {
          listen: [{ module: './lan/discovery.js' }],
          identity: { externalId: 'device', model: 'sku' },
        },
        [{ kind: 'module', file: './lan/discovery.js', source: module, lan: true }],
      ),
    });

    expect(service.rescan('acme').vendors).toEqual(['acme']);
    expect(scans).toBe(1);
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
        [{ kind: 'module', file: './lan/discovery.js', source: module, lan: true }],
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

  it("hands a vendor's module the vendor's settings, for a cloud it signs in to", async () => {
    let heard: unknown;
    const module: DiscoverySource = {
      listen: async function* listen(signal, context): AsyncGenerator<Sighting> {
        heard = await context.settings();
        yield* [];
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => {
            resolve();
          });
        });
      },
    };

    await start({
      settings: { email: 'owner@example.com', password: 'opened' },
      vendor: acme(
        {
          listen: [{ module: './cloud/discovery.js', lan: false }],
          identity: { externalId: 'device', model: 'sku' },
        },
        [{ kind: 'module', file: './cloud/discovery.js', source: module, lan: false }],
      ),
    });

    await until(() => heard !== undefined);

    expect(heard).toEqual({ email: 'owner@example.com', password: 'opened' });
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
        [{ kind: 'module', file: './lan/discovery.js', source: module, lan: true }],
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

describe('DiscoveryService and the Matter fabric', () => {
  /**
   * A Matter device, as the broker lists it.
   *
   * @param deviceKey - Its key.
   * @param identity - What it says of itself beyond its key.
   * @returns The sighting.
   */
  function sighting(deviceKey: string, identity: Partial<MatterIdentity>): MatterSighting {
    const [nodeId = deviceKey] = deviceKey.split(':');
    const device: MatterDeviceSnapshot = {
      nodeId,
      endpoint: null,
      endpoints: [0],
      isAvailable: true,
      attributes: {},
      identity: {
        nodeId,
        endpoint: null,
        vendorId: null,
        productId: null,
        vendorName: null,
        productName: null,
        productLabel: null,
        nodeLabel: null,
        serialNumber: null,
        uniqueId: null,
        hardwareVersion: null,
        hardwareVersionString: null,
        softwareVersion: null,
        softwareVersionString: null,
        macAddresses: [],
        deviceTypes: [],
        clusters: [],
        isBridge: false,
        isBridged: false,
        ...identity,
      },
    };

    return { deviceKey, device };
  }

  it('gives a device to the vendor whose rules take it, and the rest to the platform, at once', async () => {
    const acme: DiscoveryVendor = {
      id: 'acme',
      discovery: {
        plan: resolveDiscovery(
          'acme',
          vendorDiscoverySchema.parse({ matter: { match: [{ path: 'vendorId', equals: 4999 }] } }),
          [{ id: 'lamp', name: 'Lamp', transport: 'matter', models: [] }],
        ),
        sources: [],
      },
    };
    const platform = platformMatterVendor('1.0.0', '1.1.0');
    let devices = [
      sighting('1', { vendorId: 4999, nodeLabel: 'Desk lamp' }),
      sighting('2', { vendorId: 4107, productName: 'Hue color lamp' }),
      sighting('3', { vendorId: 4999 }),
    ];
    let changed: (() => void) | undefined;
    const taken: TakenDevices = {
      externalIds: new Set(),
      hosts: new Set(),
      locations: new Map(),
      matter: new Map([['3', { instanceId: 'other', kind: 'matter/generic' }]]),
      mqtt: new Map(),
      modbus: new Map(),
    };
    const service = new DiscoveryService({
      vendors: [acme],
      mdns: fakeMdns(),
      transports: new Registry<Transport>('transport'),
      integrations: new Registry<Integration>('integration'),
      logger: silent(),
      vendorSettings: () => Promise.resolve({}),
      taken: () => Promise.resolve(taken),
      publishChanged: () => undefined,
      queryIntervalMs: 60_000,
      ttlMs: 60_000,
      probeIntervalMs: 60_000,
      matter: {
        devices: () => devices,
        onChange: (listener) => {
          changed = listener;

          return () => undefined;
        },
        vendor: { id: 'matter', discovery: platform.discovery ?? acme.discovery },
      },
    });

    await service.start();

    try {
      expect(
        service
          .list()
          .map((device) => [device.externalId, device.kind, device.name, device.adoption]),
      ).toEqual([
        ['1', 'acme/lamp', 'Desk lamp', 'automatic'],
        ['2', 'matter/generic', 'Hue color lamp', 'automatic'],
      ]);

      // Removed from the house: the broker lists it no more, and it is not proposed again.
      devices = devices.filter((device) => device.deviceKey !== '1');
      changed?.();
      expect(service.list().map((device) => device.externalId)).toEqual(['2']);
    } finally {
      await service.stop();
    }
  });
});

describe('DiscoveryService and the Modbus broker', () => {
  it('adds each device as the driver its template is, without asking any rules', async () => {
    const acme: DiscoveryVendor = {
      id: 'acme',
      discovery: {
        plan: resolveDiscovery(
          'acme',
          vendorDiscoverySchema.parse({
            modbus: { match: [{ path: 'values.code', exists: true }] },
          }),
          [{ id: 'meter', name: 'Meter', transport: 'modbus', models: [] }],
        ),
        sources: [],
      },
    };
    const platform = platformModbusVendor('1.0.0', '1.4.0');
    const sighting = (deviceKey: string, kind: string): ModbusSighting => {
      const device = { deviceKey, kind, name: `Device ${deviceKey}` };

      return { deviceKey, device } as unknown as ModbusSighting;
    };
    const service = new DiscoveryService({
      vendors: [acme],
      mdns: fakeMdns(),
      transports: new Registry<Transport>('transport'),
      integrations: new Registry<Integration>('integration'),
      logger: silent(),
      vendorSettings: () => Promise.resolve({}),
      taken: () =>
        Promise.resolve({
          externalIds: new Set<string>(),
          hosts: new Set<string>(),
          locations: new Map(),
          matter: new Map(),
          mqtt: new Map(),
          modbus: new Map([['modbus-3', { instanceId: 'other', kind: 'modbus/generic' }]]),
        }),
      publishChanged: () => undefined,
      queryIntervalMs: 60_000,
      ttlMs: 60_000,
      probeIntervalMs: 60_000,
      modbus: {
        devices: () => [
          sighting('modbus-1', 'modbus/generic'),
          sighting('modbus-2', 'acme/meter'),
          sighting('modbus-3', 'modbus/generic'),
        ],
        onChange: () => () => undefined,
        vendor: { id: 'modbus', discovery: platform.discovery ?? acme.discovery },
      },
    });

    await service.start();

    try {
      expect(
        service
          .list()
          .map((device) => [device.externalId, device.kind, device.model, device.adoption]),
      ).toEqual([
        ['modbus-1', 'modbus/generic', 'Modbus device', 'automatic'],
        ['modbus-2', 'acme/meter', 'Meter', 'automatic'],
      ]);
    } finally {
      await service.stop();
    }
  });
});
