import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { BusClient } from '@nebula-home/bus';
import { FakeTransport } from '@nebula-home/bus/testing';
import {
  busSubjects,
  CORE_REGISTER_METHOD,
  CORE_SERVICE,
  registerDeviceRequestSchema,
  type RegisterDeviceRequest,
} from '@nebula-home/contracts';
import { createLogger } from '@nebula-home/logging';
import {
  bundleManifestSchema,
  defineTransport,
  createDeclarativeIntegration,
  integrationProfileSchema,
  Registry,
  type Discovered,
  type Integration,
  type Transport,
} from '@nebula-home/package-runtime';

import { DeviceBook } from '../domain/devices.js';

import { DiscoveryService, type DiscoverableInstance } from './discovery.js';

/** Two relays sitting on the network, one of them not a relay at all. */
const FOUND: Discovered[] = [
  { deviceKey: '192.168.1.40', payload: { device: { id: 'relay-one' }, relay: {} } },
  { deviceKey: '192.168.1.41', payload: { device: { id: 'printer' } } },
];

/**
 * A declarative integration for a generic REST relay.
 *
 * @returns The integration.
 */
function relay(): Integration {
  return createDeclarativeIntegration(
    bundleManifestSchema.parse({
      id: 'generic/rest-relay',
      version: '1.0.0',
      sdk: '^1.0.0',
      name: 'Generic REST relay',
      vendor: { id: 'generic', name: 'Generic' },
      transport: 'fake',
      kind: 'declarative',
      profile: './profile.json',
      setup: './setup.json',
    }),
    integrationProfileSchema.parse({
      discovery: {
        scan: { mdns: '_http._tcp' },
        claim: [{ path: 'relay', exists: true }],
        identity: { externalId: 'device.id' },
      },
      entities: [
        {
          domain: 'switch',
          capabilities: { on_off: {} },
          state: { on_off: { isOn: 'relay.on' } },
          commands: { 'on_off.turn_on': { op: 'get', args: { path: '/relay/on' } } },
        },
      ],
    }),
  );
}

/**
 * A transport that finds the two devices above and nothing else.
 *
 * @param seen - Where to record the settings and search terms it was given.
 * @returns The transport.
 */
function fakeTransport(seen: { config: unknown; terms: unknown }[]): Transport {
  return defineTransport({
    id: 'fake',
    configSchema: z.object({}),
    connectionKey: (): string => 'fake:one',
    connect: (): never => {
      throw new Error('not used by discovery');
    },

    scan: async function* scan(config, terms): AsyncGenerator<Discovered> {
      // Both halves: the transport gets its own settings, and the terms the integration asked
      // it to look for.
      seen.push({ config, terms });

      yield* await Promise.resolve(FOUND);
    },

    probe: (): Promise<string> => Promise.resolve('not used by discovery'),
  });
}

/** Everything one test needs. */
type Harness = {
  readonly discovery: DiscoveryService;
  readonly book: DeviceBook;
  readonly registered: RegisterDeviceRequest[];
  readonly seen: { config: unknown; terms: unknown }[];
  readonly adopted: string[];
  readonly stop: () => void;
};

/**
 * Wires discovery against a fake transport and a fake `core`.
 *
 * @returns The harness.
 */
function harness(): Harness {
  const transport = new FakeTransport();
  const logger = createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' });
  const client = new BusClient({ transport, source: 'hub', logger, requestTimeoutMs: 500 });
  const core = new BusClient({ transport, source: 'core', logger, requestTimeoutMs: 500 });

  const registered: RegisterDeviceRequest[] = [];
  const serving = core.serve(
    busSubjects.service(CORE_SERVICE, CORE_REGISTER_METHOD),
    registerDeviceRequestSchema,
    (request) => {
      registered.push(request);

      return {
        deviceId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
        entityIds: request.entities.map((entity) => entity.entityId),
      };
    },
  );

  const seen: { config: unknown; terms: unknown }[] = [];
  const transports = new Registry<Transport>('transport');
  transports.register(fakeTransport(seen));

  const book = new DeviceBook();
  const instance: DiscoverableInstance = {
    instanceId: 'relay-lab',
    integration: relay(),
    options: {},
    transportId: 'fake',
    transportConfig: {},
    book,
  };

  const adopted: string[] = [];

  return {
    discovery: new DiscoveryService({
      client,
      transports,
      logger,
      instances: (): DiscoverableInstance[] => [instance],
      defaultTimeoutMs: 1000,
      onAdopted: (instanceId): Promise<void> => {
        adopted.push(instanceId);

        return Promise.resolve();
      },
    }),
    book,
    registered,
    seen,
    adopted,
    stop: (): void => {
      serving.unsubscribe();
    },
  };
}

/**
 * Waits until a scan has produced something, or gives up.
 *
 * @param discovery - The service to poll.
 * @returns A promise that settles once at least one candidate is held.
 */
async function settled(discovery: DiscoveryService): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (discovery.candidates().candidates.length > 0) {
      return;
    }

    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe('DiscoveryService', () => {
  it('offers a device its integration claims, and not the one it does not', async () => {
    const { discovery, stop } = harness();

    discovery.discover({ timeoutMs: 1000 });
    await settled(discovery);
    stop();

    expect(discovery.candidates().candidates.map((one) => one.externalId)).toEqual(['relay-one']);
  });

  it('shows what adopting would create, before the owner commits', async () => {
    const { discovery, stop } = harness();

    discovery.discover({ timeoutMs: 1000 });
    await settled(discovery);
    stop();

    expect(discovery.candidates().candidates[0]?.entities).toEqual([
      { entityId: 'switch.relay_one', name: 'relay-one', capabilities: ['on_off'] },
    ]);
  });

  it('passes the integration search terms to the transport', async () => {
    // A profile says what to look for; the transport is what knows how to look. Without this the
    // scan would be whatever the transport enumerates by default, which for MQTT is nothing.
    const { discovery, seen, stop } = harness();

    discovery.discover({ timeoutMs: 1000 });
    await settled(discovery);
    stop();

    expect(seen).toEqual([{ config: {}, terms: { mdns: '_http._tcp' } }]);
  });

  it('asks core to register the device rather than writing it', async () => {
    const { discovery, registered, stop } = harness();

    discovery.discover({ timeoutMs: 1000 });
    await settled(discovery);
    const candidateId = discovery.candidates().candidates[0]?.candidateId ?? '';

    await discovery.adopt({ candidateId });
    stop();

    expect(registered[0]).toMatchObject({
      integrationId: 'relay-lab',
      externalId: 'relay-one',
      entities: [{ entityId: 'switch.relay_one', capabilities: { on_off: {} } }],
    });
  });

  it('binds what core registered, so the device can be commanded straight away', async () => {
    const { discovery, book, stop } = harness();

    discovery.discover({ timeoutMs: 1000 });
    await settled(discovery);

    await discovery.adopt({ candidateId: discovery.candidates().candidates[0]?.candidateId ?? '' });
    stop();

    expect(book.claims().map((claim) => claim.externalId)).toEqual(['relay-one']);
  });

  it('stops offering a device once it has been adopted', async () => {
    // Adopting the same device twice would collide on `UNIQUE (integration_id, external_id)`,
    // which is a confusing way to learn that it was already there.
    const { discovery, stop } = harness();

    discovery.discover({ timeoutMs: 1000 });
    await settled(discovery);
    await discovery.adopt({ candidateId: discovery.candidates().candidates[0]?.candidateId ?? '' });

    discovery.discover({ timeoutMs: 1000 });
    await new Promise((resolve) => setImmediate(resolve));
    stop();

    expect(discovery.candidates().candidates).toEqual([]);
  });

  it('has the connection told what the new device needs carried', async () => {
    // Adoption changes what the transport has to poll or subscribe to. Without this the device
    // would sit in the registry reporting nothing until something else happened to trigger a
    // recomputation, which is the kind of bug that looks like a broken device.
    const { discovery, adopted, stop } = harness();

    discovery.discover({ timeoutMs: 1000 });
    await settled(discovery);
    await discovery.adopt({ candidateId: discovery.candidates().candidates[0]?.candidateId ?? '' });
    stop();

    expect(adopted).toEqual(['relay-lab']);
  });

  it('refuses a candidate from a scan that is over', async () => {
    // Candidate identifiers are scoped to their pass. Adopting a stale one would adopt whatever
    // now sits at that position, which is a different device.
    const { discovery, stop } = harness();

    await expect(discovery.adopt({ candidateId: 'gone:relay-lab:relay-one' })).rejects.toThrow(
      /candidate/i,
    );

    stop();
  });
});
