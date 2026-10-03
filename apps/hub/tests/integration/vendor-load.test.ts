/**
 * A vendor installed, updated and removed while the hub runs (`svc.hub.vendor_load`).
 *
 * The packet-manager unpacks each build into a folder of its own under the data directory's
 * `hub/integrations/<vendor>/`, asks the hub to load it, and marks it current only once the hub
 * says it loaded. These tests stand in for the packet-manager: they write the builds and ask over
 * the bus, and read the catalogue back as the interface does.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BusClient, connectBus, type BusConnection } from '@nebulahome/bus';
import {
  busSubjects,
  catalogueReplySchema,
  HUB_CATALOGUE_METHOD,
  HUB_SERVICE,
  HUB_VENDOR_LOAD_METHOD,
  vendorLoadReplySchema,
  type CatalogueReply,
  type IntegrationInstall,
  type VendorLoadReply,
} from '@nebulahome/contracts';
import { createDatabase, type DatabaseHandle } from '@nebulahome/db';
import { createLogger, type PlatformLogger } from '@nebulahome/logging';

import { hubEnvSchema } from '@/config.js';
import { HubService } from '@/service.js';

const DATABASE_URL = 'postgres://nebula:nebula@localhost:5432/nebula';
const NATS_URL = 'nats://localhost:4222';

/** The vendor the tests install: one declarative driver over the platform's HTTP. */
const MANIFEST = { id: 'acme-test', version: '1.0.0', sdk: '^1.0.0', name: 'Acme' };

/** Its driver. */
const DRIVER = {
  id: 'relay',
  name: 'Relay',
  transport: 'http',
  kind: 'declarative',
  profile: './profile.json',
  setup: './setup.json',
};

/** What adding one asks. */
const SETUP = { transport: { fields: [{ key: 'host', type: 'text', label: 'Address' }] } };

/** Its profile. */
const PROFILE = {
  discovery: {
    probe: { op: 'get', args: { path: '/status' } },
    claim: [{ path: 'relay', exists: true }],
    identity: { externalId: 'id' },
  },
  entities: [
    {
      domain: 'switch',
      capabilities: { on_off: {} },
      state: { on_off: { isOn: 'relay.on' } },
      commands: { 'on_off.turn_on': { op: 'get', args: { path: '/on' } } },
    },
  ],
};

/**
 * A transport module of the vendor's own, whose `probe` says which build it is: two builds of
 * one module, each read from its own folder.
 *
 * @param build - What it says.
 * @returns The module's source.
 */
function transportSaying(build: string): string {
  return `
import { said } from './said.js';
export default (sdk) => sdk.defineTransport({
  id: 'acme-test/wire',
  configSchema: sdk.z.object({}),
  connectionKey: () => 'one',
  connect: () => Promise.reject(new Error('unused')),
  scan: async function* scan() {},
  probe: () => Promise.resolve(said),
});
export const build = ${JSON.stringify(build)};
`;
}

let root = '';
let integrations = '';
let database: DatabaseHandle;
let bus: BusConnection;
let own: BusConnection;
let client: BusClient;
let service: HubService;

/**
 * A logger that keeps its output out of the test report.
 *
 * @returns The logger.
 */
function silent(): PlatformLogger {
  return createLogger(
    { service: 'hub-integration', version: '0.0.0', level: 'fatal' },
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
 * Writes one build of the vendor, as the packet-manager unpacks it.
 *
 * @param build - The build's folder.
 * @param manifest - Its manifest.
 * @param files - Extra files at the vendor's top.
 * @returns The marker naming it.
 */
async function writeBuild(
  build: string,
  manifest: Record<string, unknown>,
  files: Record<string, string> = {},
): Promise<IntegrationInstall> {
  const directory = path.join(integrations, MANIFEST.id, build);

  await mkdir(path.join(directory, 'relay'), { recursive: true });
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(path.join(directory, 'relay', 'driver.json'), JSON.stringify(DRIVER));
  await writeFile(path.join(directory, 'relay', 'setup.json'), JSON.stringify(SETUP));
  await writeFile(path.join(directory, 'relay', 'profile.json'), JSON.stringify(PROFILE));

  for (const [file, content] of Object.entries(files)) {
    await writeFile(path.join(directory, file), content);
  }

  return {
    build,
    version: String(manifest['version']),
    source: 'local',
    artifactSha256: 'c'.repeat(64),
    installedAt: new Date().toISOString(),
    installedBy: null,
  };
}

/**
 * Asks the hub to load the vendor, over the bus.
 *
 * @param install - The build, unpacked and not marked; the folder as it stands when absent.
 * @returns What runs of it.
 */
async function load(install?: IntegrationInstall): Promise<VendorLoadReply> {
  return client.request(
    busSubjects.service(HUB_SERVICE, HUB_VENDOR_LOAD_METHOD),
    { vendorId: MANIFEST.id, ...(install === undefined ? {} : { install }) },
    vendorLoadReplySchema,
    { timeoutMs: 20_000 },
  );
}

/**
 * Reads the catalogue, as the interface does.
 *
 * @returns The catalogue.
 */
async function catalogue(): Promise<CatalogueReply> {
  return client.request(
    busSubjects.service(HUB_SERVICE, HUB_CATALOGUE_METHOD),
    {},
    catalogueReplySchema,
    { timeoutMs: 10_000 },
  );
}

beforeAll(async () => {
  const logger = silent();

  root = await mkdtemp(path.join(tmpdir(), 'nebula-hub-vendor-load-'));
  integrations = path.join(root, 'data', 'hub', 'integrations');
  await mkdir(integrations, { recursive: true });
  await mkdir(path.join(root, 'development'), { recursive: true });

  database = createDatabase({ connectionString: DATABASE_URL, applicationName: 'hub-vendor-load' });
  bus = await connectBus({
    url: NATS_URL,
    name: 'vendor-load-test',
    logger,
    signal: AbortSignal.timeout(20_000),
  });
  own = await connectBus({
    url: NATS_URL,
    name: 'hub-under-test',
    logger,
    signal: AbortSignal.timeout(20_000),
  });
  client = new BusClient({ transport: bus.transport, source: 'api', logger });
  service = new HubService({
    config: hubEnvSchema.parse({
      DATABASE_URL,
      NATS_URL,
      NEBULA_DATA_DIR: path.join(root, 'data'),
      HUB_DEV_BUNDLE_DIR: path.join(root, 'development'),
      HUB_DISCOVERY_ENABLED: 'false',
      NEBULA_SECRETS_KEY: 'ab'.repeat(32),
    }),
    db: database.db,
    bus: own,
    logger,
  });

  await service.start();
});

afterAll(async () => {
  await service.stop();
  await own.close();
  await bus.close();
  await database.close();
  await rm(root, { recursive: true, force: true });
});

describe('vendor_load', () => {
  it('loads a build the packet-manager unpacked, and lists it as installed', async () => {
    const install = await writeBuild('1.0.0-aaaa0001', MANIFEST);

    const reply = await load(install);
    const found = (await catalogue()).vendors.find((vendor) => vendor.id === MANIFEST.id);

    expect(reply).toEqual({
      isLoaded: true,
      version: '1.0.0',
      origin: 'installed',
      failures: [],
      isRestartNeeded: false,
    });
    expect([found?.origin, found?.install?.build, found?.hasCode]).toEqual([
      'installed',
      '1.0.0-aaaa0001',
      false,
    ]);
  });

  it('keeps the build that runs when the next one does not load, and says why', async () => {
    const install = await writeBuild('1.1.0-bbbb0002', {
      ...MANIFEST,
      version: '1.1.0',
      sdk: '^9.0.0',
    });

    const reply = await load(install);

    expect([reply.isLoaded, reply.version]).toEqual([true, '1.0.0']);
    expect(reply.failures.join(' ')).toMatch(/\^9\.0\.0/u);
  });

  it('swaps in a build with code of its own, read from its own folder', async () => {
    const manifest = { ...MANIFEST, version: '1.2.0', transports: { wire: './wire.js' } };
    const first = await writeBuild('1.2.0-cccc0003', manifest, {
      'wire.js': transportSaying('first'),
      'said.js': 'export const said = "first";',
    });

    expect((await load(first)).version).toBe('1.2.0');

    // The same version rebuilt: the helper module beside the transport changed too, and is read
    // from the new folder rather than from the module cache.
    const second = await writeBuild('1.2.0-dddd0004', manifest, {
      'wire.js': transportSaying('second'),
      'said.js': 'export const said = "second";',
    });
    const reply = await load(second);
    const found = (await catalogue()).vendors.find((vendor) => vendor.id === MANIFEST.id);

    expect(reply.isLoaded).toBe(true);
    expect([found?.install?.build, found?.hasCode, found?.transports]).toEqual([
      '1.2.0-dddd0004',
      true,
      ['http'],
    ]);
  });

  it('lets go of a vendor whose folder is gone', async () => {
    await rm(path.join(integrations, MANIFEST.id), { recursive: true, force: true });

    const reply = await load();
    const found = (await catalogue()).vendors.find((vendor) => vendor.id === MANIFEST.id);

    expect(reply).toEqual({
      isLoaded: false,
      version: null,
      origin: null,
      failures: [],
      isRestartNeeded: false,
    });
    expect(found).toBeUndefined();
  });
});
