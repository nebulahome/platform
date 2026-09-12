import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { BusClient } from '@nebula-home/bus';
import { FakeTransport } from '@nebula-home/bus/testing';
import {
  busSubjects,
  catalogueReplySchema,
  HUB_CATALOGUE_METHOD,
  HUB_PROBE_METHOD,
  HUB_RELOAD_METHOD,
  HUB_SERVICE,
  integrationSetupSchema,
  NotFoundError,
  probeReplySchema,
  reloadReplySchema,
  type ReloadReply,
} from '@nebula-home/contracts';
import { sealSecrets, secretsKeyFrom } from '@nebula-home/db';
import { createLogger } from '@nebula-home/logging';
import {
  bundleManifestSchema,
  createDeclarativeIntegration,
  defineTransport,
  integrationProfileSchema,
  Registry,
  type Discovered,
  type Transport,
} from '@nebula-home/package-runtime';

import type { LoadedBundle, LoadedVendor } from './bundles.js';
import { ManagementService } from './management.js';

/** The sealing key the API and the hub would share. */
const KEY = secretsKeyFrom('ab'.repeat(32));

/**
 * A transport whose probe records what it was given and answers as told.
 *
 * @param probed - Where the configurations it saw are collected.
 * @param outcome - What the probe does: succeed with a sentence, or throw.
 * @returns The transport.
 */
function fakeTransport(probed: unknown[], outcome: () => Promise<string>): Transport {
  return defineTransport({
    id: 'fake',
    configSchema: z.object({ url: z.string().min(1), password: z.string().optional() }),
    connectionKey: (config): string => `fake:${config.url}`,
    connect: (): never => {
      throw new Error('not used by management');
    },
    scan: async function* scan(): AsyncGenerator<Discovered> {
      yield* await Promise.resolve([]);
    },
    probe: async (config): Promise<string> => {
      probed.push(config);

      return outcome();
    },
  });
}

/**
 * A loaded bundle on the fake transport, asking for an address and a password.
 *
 * @returns The bundle, as the loader would have produced it.
 */
function printerBundle(): LoadedBundle {
  const manifest = bundleManifestSchema.parse({
    id: 'acme/fake-printer',
    version: '1.2.0',
    sdk: '^1.0.0',
    name: 'ACME Fake printer',
    description: 'A printer that is not there',
    vendor: { id: 'acme', name: 'ACME' },
    transport: 'fake',
    models: ['P1'],
    kind: 'declarative',
    profile: './profile.json',
    setup: './setup.json',
  });
  const profile = integrationProfileSchema.parse({
    discovery: {
      scan: { filter: 'device/+/report' },
      claim: [{ path: 'print', exists: true }],
      identity: { externalId: 'serial' },
    },
    entities: [
      {
        domain: 'sensor',
        capabilities: { sensor_numeric: {} },
        state: { sensor_numeric: { value: 'print.nozzle' } },
      },
    ],
  });

  return {
    manifest,
    vendorId: 'acme',
    driverId: 'fake-printer',
    driverName: 'Fake printer',
    integration: createDeclarativeIntegration(manifest, profile),
    setup: integrationSetupSchema.parse({
      transport: {
        constants: { username: 'bblp' },
        fields: [
          { key: 'url', type: 'text', label: 'Address', isRequired: true },
          { key: 'password', type: 'secret', label: 'Access code', isRequired: true },
        ],
      },
    }),
    directory: '/bundles/acme/fake-printer',
  };
}

/**
 * The vendor that ships the fake printer, asking for an account key of its own.
 *
 * @returns The vendor, as the loader would have produced it.
 */
function printerVendor(): LoadedVendor {
  const driver = printerBundle();

  return {
    manifest: {
      id: 'acme',
      version: '1.2.0',
      sdk: '^1.0.0',
      name: 'ACME',
      description: 'A printer that is not there',
      url: 'https://acme.example',
      color: '#FF6A2B',
      internetRequired: true,
    },
    setup: integrationSetupSchema.parse({
      transport: {
        fields: [{ key: 'apiKey', type: 'secret', label: 'API key', isRequired: true }],
      },
    }),
    logo: 'data:image/svg+xml;base64,PHN2Zy8+',
    transports: ['fake'],
    drivers: [driver],
    directory: '/bundles/acme',
  };
}

/** Everything one test needs. */
type Harness = {
  readonly caller: BusClient;
  readonly probed: unknown[];
  readonly reloaded: string[];
  readonly stop: () => void;
};

/**
 * Serves management over a fake bus, with a fake transport and one bundle.
 *
 * @param outcome - What the transport's probe does.
 * @returns The harness.
 */
function harness(outcome: () => Promise<string> = () => Promise.resolve('fake answered')): Harness {
  const transport = new FakeTransport();
  const logger = createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' });
  const client = new BusClient({ transport, source: 'hub', logger, requestTimeoutMs: 500 });
  const caller = new BusClient({ transport, source: 'api', logger, requestTimeoutMs: 500 });

  const probed: unknown[] = [];
  const transports = new Registry<Transport>('transport');
  transports.register(fakeTransport(probed, outcome));

  const reloaded: string[] = [];
  const service = new ManagementService({
    client,
    transports,
    logger,
    secretsKey: KEY,
    vendors: (): readonly LoadedVendor[] => [printerVendor()],
    reload: (integrationId): Promise<ReloadReply> => {
      reloaded.push(integrationId);

      return Promise.resolve({ state: 'running', lastError: null });
    },
  });
  const subscriptions = service.serve();

  return {
    caller,
    probed,
    reloaded,
    stop: (): void => {
      for (const subscription of subscriptions) {
        subscription.unsubscribe();
      }
    },
  };
}

describe('the catalogue', () => {
  it('lists every loaded vendor with its drivers and what each form asks', async () => {
    const { caller, stop } = harness();

    const reply = await caller.request(
      busSubjects.service(HUB_SERVICE, HUB_CATALOGUE_METHOD),
      {},
      catalogueReplySchema,
    );

    expect(reply.vendors).toHaveLength(1);
    expect(reply.vendors[0]).toMatchObject({
      id: 'acme',
      version: '1.2.0',
      name: 'ACME',
      description: 'A printer that is not there',
      url: 'https://acme.example',
      color: '#FF6A2B',
      logo: 'data:image/svg+xml;base64,PHN2Zy8+',
      internetRequired: true,
      transports: ['fake'],
    });
    expect(reply.vendors[0]?.setup.transport.fields.map((field) => field.key)).toEqual(['apiKey']);
    expect(reply.vendors[0]?.drivers[0]).toMatchObject({
      id: 'acme/fake-printer',
      vendorId: 'acme',
      driverId: 'fake-printer',
      name: 'Fake printer',
      transport: 'fake',
      models: ['P1'],
    });
    expect(reply.vendors[0]?.drivers[0]?.setup.transport.constants).toEqual({ username: 'bblp' });
    expect(reply.vendors[0]?.drivers[0]?.setup.transport.fields.map((field) => field.key)).toEqual([
      'url',
      'password',
    ]);
    stop();
  });
});

describe('trying a configuration', () => {
  it('hands the configuration to the bundle transport and reports what it said', async () => {
    const { caller, probed, stop } = harness();

    const reply = await caller.request(
      busSubjects.service(HUB_SERVICE, HUB_PROBE_METHOD),
      { kind: 'acme/fake-printer', transportConfig: { url: 'fake://1', password: 'pw' } },
      probeReplySchema,
    );

    expect(reply).toEqual({ isReachable: true, detail: 'fake answered' });
    expect(probed).toEqual([{ url: 'fake://1', password: 'pw' }]);
    stop();
  });

  it('opens a sealed secret first, so an instance can be tested without retyping it', async () => {
    const { caller, probed, stop } = harness();
    const stored = sealSecrets({ url: 'fake://1', password: 'pw' }, ['password'], KEY);

    await caller.request(
      busSubjects.service(HUB_SERVICE, HUB_PROBE_METHOD),
      { kind: 'acme/fake-printer', transportConfig: stored },
      probeReplySchema,
    );

    expect(probed).toEqual([{ url: 'fake://1', password: 'pw' }]);
    stop();
  });

  it('reports a configuration that does not work as a verdict, not an error', async () => {
    const { caller, stop } = harness(() =>
      Promise.reject(new Error('fake://1 did not answer: ECONNREFUSED')),
    );

    const reply = await caller.request(
      busSubjects.service(HUB_SERVICE, HUB_PROBE_METHOD),
      { kind: 'acme/fake-printer', transportConfig: { url: 'fake://1' } },
      probeReplySchema,
    );

    expect(reply).toEqual({ isReachable: false, detail: 'fake://1 did not answer: ECONNREFUSED' });
    stop();
  });

  it('names the field when the transport refuses the shape of the configuration', async () => {
    const { caller, probed, stop } = harness();

    const reply = await caller.request(
      busSubjects.service(HUB_SERVICE, HUB_PROBE_METHOD),
      { kind: 'acme/fake-printer', transportConfig: { url: '' } },
      probeReplySchema,
    );

    expect(reply.isReachable).toBe(false);
    expect(reply.detail).toMatch(/url/u);
    expect(probed).toEqual([]);
    stop();
  });

  it('refuses a kind that is not loaded', async () => {
    const { caller, stop } = harness();

    await expect(
      caller.request(
        busSubjects.service(HUB_SERVICE, HUB_PROBE_METHOD),
        { kind: 'nothing/installed', transportConfig: {} },
        probeReplySchema,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    stop();
  });
});

describe('reloading an instance', () => {
  it('asks the service to match the registry and reports where it ended up', async () => {
    const { caller, reloaded, stop } = harness();

    const reply = await caller.request(
      busSubjects.service(HUB_SERVICE, HUB_RELOAD_METHOD),
      { integrationId: 'printer-lab' },
      reloadReplySchema,
    );

    expect(reply).toEqual({ state: 'running', lastError: null });
    expect(reloaded).toEqual(['printer-lab']);
    stop();
  });
});
