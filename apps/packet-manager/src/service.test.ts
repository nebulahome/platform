/**
 * The packet-manager against a bus in memory, a store in memory and packages written here: the
 * house's MQTT broker installed by itself from the local folder, packages installed from the index
 * and from the folder with what they need, a package waiting for another and following it down and
 * up, and removals refused and made.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { BusClient } from '@nebulahome/bus';
import { FakeTransport } from '@nebulahome/bus/testing';
import {
  busSubjects,
  CORE_SERVICE,
  CORE_SYNC_PACKAGE_METHOD,
  HUB_CATALOGUE_METHOD,
  HUB_SERVICE,
  MQTT_BROKER_SERVICE,
  SUPERVISOR_METHODS,
  SUPERVISOR_SERVICE,
  syncPackageRequestSchema,
  type JsonObject,
  type SyncPackageRequest,
} from '@nebulahome/contracts';
import { sealSecret } from '@nebulahome/db';
import { createLogger } from '@nebulahome/logging';

import { packetManagerEnvSchema } from './config.js';
import { PacketManager } from './service.js';
import { CommunityHubClient } from './services/hub-client.js';
import { PackageIndexClient } from './services/index-client.js';
import { LocalReleases } from './services/local-releases.js';
import {
  archiveOf,
  fakeRunner,
  manifest,
  memoryStore,
  scratch,
  writePackage,
} from './testing/fixtures.js';

const logger = createLogger({ service: 'packet-manager', version: '0.0.0', level: 'fatal' });
const managers: PacketManager[] = [];
const folders: string[] = [];

afterEach(async () => {
  await Promise.all(managers.map(async (manager) => manager.stop()));
  managers.length = 0;
  await Promise.all(folders.map(async (folder) => rm(folder, { recursive: true, force: true })));
  folders.length = 0;
});

/** The index's one release, of `zigbee-tools`, which needs a broker. */
const TOOLS = manifest({
  id: 'zigbee-tools',
  version: '2.1.0',
  requires: { packages: {}, services: [MQTT_BROKER_SERVICE] },
});

/** The house's broker: a process that provides `mqtt-broker`. */
const BROKER = manifest({
  id: 'mqtt',
  runtime: 'node',
  server: { entry: './server/index.js' },
  provides: [MQTT_BROKER_SERVICE],
});

/**
 * Puts a package's release in the local folder.
 *
 * @param work - The test's folder.
 * @param written - Its manifest.
 * @param setup - Its `setup.json`, when it has settings.
 * @param extra - What else it writes into the package's folder before it is packed.
 * @returns The package's folder, packed into `local/<id>-<version>.tgz`.
 */
async function putLocal(
  work: string,
  written: JsonObject,
  setup?: JsonObject,
  extra?: (root: string) => Promise<void>,
): Promise<string> {
  const { id, version } = z.object({ id: z.string(), version: z.string() }).parse(written);
  const source = await writePackage(path.join(work, 'sources', `${id}-${version}`), written, setup);

  await extra?.(source);
  await archiveOf(source, path.join(work, 'local', `${id}-${version}.tgz`));

  return source;
}

/** What a test sets up differently. */
type SetUpOptions = {
  /** Whether the local folder holds the broker; it does when not said. */
  readonly hasBroker?: boolean;

  /** The services something outside stands in for. */
  readonly externalServices?: ReadonlySet<string>;

  /** Whether the Community Hub can be reached; it can when not said. */
  readonly isHubDown?: boolean;
};

/** A logo the Hub serves, as a PNG's first bytes are enough for. */
const HUB_LOGO = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

/** Its digest, how the Hub addresses it. */
const HUB_LOGO_SHA = createHash('sha256').update(HUB_LOGO).digest('hex');

/**
 * What the Community Hub lists: the index's two packages, one it has no release of in the index
 * yet, and one whose name is no package id.
 */
const HUB_ITEMS = [
  {
    kind: 'package',
    slug: 'zigbee-tools',
    name: 'Zigbee tools',
    description: 'Tools.',
    category: 'protocol',
    official: true,
    color: '#3F6FD8',
    logoUrl: `https://hub.example/v1/assets/${HUB_LOGO_SHA}`,
    latestVersion: '2.1.0',
    publishedAt: '2026-09-28T08:00:00.000Z',
    downloads: 1200,
    stars: 30,
  },
  {
    kind: 'package',
    slug: 'watcher',
    name: 'Watcher',
    description: 'Needs a detector nobody has.',
    category: 'security',
    official: false,
    color: 'url(javascript:alert(1))',
    logoUrl: null,
    latestVersion: '1.0.0',
    publishedAt: '2026-09-28T08:00:00.000Z',
    downloads: 4,
    stars: 0,
  },
  {
    kind: 'package',
    slug: 'newcomer',
    name: 'Newcomer',
    description: '',
    category: 'media',
    official: false,
    color: null,
    logoUrl: null,
    latestVersion: '0.3.0',
    publishedAt: '2026-10-03T08:00:00.000Z',
    downloads: 0,
    stars: 0,
  },
  { kind: 'package', slug: 'Not An Id', name: 'Odd', description: '', category: null },
];

/**
 * A packet-manager whose local folder holds the house's broker, and whose index offers one more
 * package - and one that cannot be installed.
 *
 * @param options - See {@link SetUpOptions}.
 * @returns The manager, its store, the bus, what `core` was asked and the folder it works in.
 */
async function setUp(options: SetUpOptions = {}): Promise<{
  manager: PacketManager;
  store: ReturnType<typeof memoryStore>;
  transport: FakeTransport;
  synced: SyncPackageRequest[];
  work: string;
  again: () => PacketManager;
  reconciled: unknown[];
  hubAsked: string[];
}> {
  const work = await scratch();

  folders.push(work);
  await mkdir(path.join(work, 'local'));

  if (options.hasBroker !== false) {
    await putLocal(work, BROKER);
  }

  const source = await writePackage(path.join(work, 'source'), TOOLS);
  const archive = await archiveOf(source, path.join(work, 'tools.tgz'));
  const url = 'https://github.com/nebulahome/pkg-zigbee-tools/releases/download/v2.1.0/t.tgz';
  const index = {
    generatedAt: '2026-09-29T08:00:00Z',
    packages: [
      {
        id: 'zigbee-tools',
        name: 'Zigbee tools',
        description: 'Tools.',
        repository: 'nebulahome/pkg-zigbee-tools',
        category: 'protocol',
        versions: [
          {
            version: '2.1.0',
            platform: '^1.0.0',
            sdk: '^1.0.0',
            requires: { packages: {}, services: [MQTT_BROKER_SERVICE] },
            artifact: { url, size: archive.size, sha256: archive.sha256 },
            publishedAt: '2026-09-28T08:00:00Z',
          },
        ],
      },
      {
        id: 'watcher',
        name: 'Watcher',
        description: 'Needs a detector nobody has.',
        repository: 'nebulahome/pkg-watcher',
        category: 'security',
        versions: [
          {
            version: '1.0.0',
            platform: '^1.0.0',
            sdk: '^1.0.0',
            requires: { packages: {}, services: ['object-detection'] },
            artifact: { url, size: archive.size, sha256: archive.sha256 },
            publishedAt: '2026-09-28T08:00:00Z',
          },
        ],
      },
    ],
  };

  /**
   * The index and the archive, as GitHub and the index's server answer them.
   *
   * @param input - What is asked.
   * @returns The response.
   */
  const fetch: typeof globalThis.fetch = async (input) => {
    const asked = String(input instanceof Request ? input.url : input);

    if (asked.startsWith('https://hub.example/')) {
      hubAsked.push(asked);

      if (options.isHubDown === true) {
        throw new TypeError('fetch failed');
      }

      const q = new URL(asked).searchParams.get('q');

      return Promise.resolve(
        asked.startsWith('https://hub.example/v1/packages?')
          ? Response.json({
              items: HUB_ITEMS.filter((item) => q === null || item.slug.includes(q)),
              nextCursor: q === null ? 'page-2' : null,
            })
          : asked === `https://hub.example/v1/assets/${HUB_LOGO_SHA}`
            ? new Response(new Uint8Array(HUB_LOGO), { headers: { 'content-type': 'image/png' } })
            : Response.json(
                { error: { code: 'NOT_FOUND', message: 'No such item' } },
                { status: 404 },
              ),
      );
    }

    return Promise.resolve(
      asked === 'https://example.com/index.json'
        ? Response.json(index)
        : asked === url
          ? new Response(new Uint8Array(archive.bytes))
          : new Response('not found', { status: 404 }),
    );
  };
  const hubAsked: string[] = [];
  const transport = new FakeTransport();
  const platform = new BusClient({ transport, source: 'core', logger });
  const synced: SyncPackageRequest[] = [];

  platform.serve(
    busSubjects.service(CORE_SERVICE, CORE_SYNC_PACKAGE_METHOD),
    syncPackageRequestSchema,
    (request) => {
      synced.push(request);

      return { devices: [], refused: [], kept: [] };
    },
  );
  const reconciled: unknown[] = [];

  platform.serve(
    busSubjects.service(SUPERVISOR_SERVICE, SUPERVISOR_METHODS.reconcile),
    z.unknown(),
    (request) => {
      reconciled.push(request);

      return { containers: [] };
    },
  );
  platform.serve(busSubjects.service(HUB_SERVICE, HUB_CATALOGUE_METHOD), z.unknown(), () => ({
    vendors: [],
  }));

  const config = packetManagerEnvSchema.parse({
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    DATABASE_URL: 'postgres://nebula:nebula@localhost:5432/nebula',
    NATS_URL: 'nats://localhost:4222',
    NEBULA_SECRETS_KEY: 'a'.repeat(64),
    NEBULA_DATA_DIR: path.join(work, 'data'),
    PACKET_MANAGER_ANNOUNCE_TIMEOUT_MS: '60000',
  });
  const store = memoryStore();
  const runner = await fakeRunner(work);
  const local = new LocalReleases(path.join(work, 'local'), logger);

  /**
   * A packet-manager over this store, bus and folders: the one set up, or one started after it.
   *
   * @returns The manager, stopped after the test.
   */
  const again = (): PacketManager => {
    const made = new PacketManager({
      config,
      store,
      client: new BusClient({ transport, source: 'packet-manager', logger, requestTimeoutMs: 500 }),
      logger,
      index: new PackageIndexClient({
        url: 'https://example.com/index.json',
        ttlMs: 60_000,
        logger,
        fetch,

        /**
         * The local folder's releases.
         *
         * @returns Them.
         */
        local: async () => local.entries(),
      }),
      hub: new CommunityHubClient({ url: 'https://hub.example', logger, fetch }),
      secretsKey: Buffer.alloc(32, 1),
      runner,
      packagesDir: path.join(work, 'data', 'packages'),
      cacheDir: path.join(work, 'data', 'cache', 'packages'),
      fetch,
      serviceRetryMs: 50,
      ...(options.externalServices === undefined
        ? {}
        : { externalServices: options.externalServices }),
    });

    managers.push(made);

    return made;
  };

  return { manager: again(), store, transport, synced, work, again, reconciled, hubAsked };
}

/**
 * The states of the installed packages, by id.
 *
 * @param manager - The manager.
 * @returns Each one's state.
 */
async function states(manager: PacketManager): Promise<Record<string, string>> {
  return Object.fromEntries((await manager.list()).map((item) => [item.id, item.state]));
}

describe('the packet-manager', () => {
  it('installs the house’s MQTT broker by itself, and runs it once it announces itself', async () => {
    const { manager, store, work } = await setUp();

    await manager.start();

    expect(await states(manager)).toEqual({ mqtt: 'starting' });
    // Its folders are there before it runs: what it opens in them - a SQLite file - makes none.
    expect((await stat(path.join(work, 'data', 'packages', 'mqtt', 'data'))).isDirectory()).toBe(
      true,
    );
    expect((await stat(path.join(work, 'data', 'cache', 'packages', 'mqtt'))).isDirectory()).toBe(
      true,
    );
    expect(store.rows.get('mqtt')).toMatchObject({ source: 'local' });
    expect((await manager.get('mqtt')).isSystem).toBe(true);

    await manager.announce({
      packageId: 'mqtt',
      version: '1.0.0',
      rpcMethods: [{ name: 'clients', access: 'read' }],
    });

    expect(await states(manager)).toMatchObject({ mqtt: 'running' });
    expect((await manager.get('mqtt')).rpcMethods).toEqual([{ name: 'clients', access: 'read' }]);
    await vi.waitFor(() => {
      expect(manager.logs('mqtt', 10).lines.map((line) => line.text)).toContain(
        'something went wrong',
      );
    });
  });

  it('starts without a broker while none can be installed, and installs one once it is there', async () => {
    const { manager, work } = await setUp({ hasBroker: false });

    await manager.start();

    expect(await states(manager)).toEqual({});

    await putLocal(work, BROKER);
    await vi.waitFor(
      async () => {
        expect(await states(manager)).toEqual({ mqtt: 'starting' });
      },
      { timeout: 10_000 },
    );
  });

  it('installs no broker while one outside the platform stands in', async () => {
    const { manager } = await setUp({ externalServices: new Set([MQTT_BROKER_SERVICE]) });

    await manager.start();

    expect(await states(manager)).toEqual({});
  });

  it('refuses a release built against an SDK the platform does not implement', async () => {
    const { manager, work } = await setUp();

    await putLocal(work, manifest({ id: 'future', sdk: '^9.0.0' }));
    await manager.start();

    // The resolver leaves out what this platform cannot run: the release is not one to install.
    await expect(manager.install('future')).rejects.toThrow(
      'No release of FUTURE matches * and this NebulaHome',
    );
  });

  it('hands a package its settings’ defaults, and a live change without a restart', async () => {
    const { manager, transport, work } = await setUp();

    await putLocal(
      work,
      manifest({
        id: 'ticker',
        runtime: 'node',
        server: { entry: './server/index.js' },
        setup: './setup.json',
      }),
      {
        transport: {
          fields: [
            { key: 'interval', type: 'number', label: 'Interval', default: 10, isLive: true },
            { key: 'port', type: 'number', label: 'Port', default: 1883 },
          ],
        },
      },
    );

    const told: unknown[] = [];
    const ticker = new BusClient({ transport, source: 'ticker', logger });

    ticker.serve(busSubjects.service('ticker', 'settings'), z.unknown(), (request) => {
      told.push(request);

      return {};
    });
    await manager.start();
    await manager.install('ticker');
    await manager.announce({ packageId: 'ticker', version: '1.0.0', rpcMethods: [] });
    await vi.waitFor(() => {
      expect(manager.logs('ticker', 20).lines.map((line) => line.text)).toContain(
        'settings {"interval":10,"port":1883}',
      );
    });

    await manager.configure('ticker', { interval: 5 });

    expect(told).toEqual([{ values: { interval: 5, port: 1883 }, changed: ['interval'] }]);
    expect(await states(manager)).toMatchObject({ ticker: 'running' });

    await manager.configure('ticker', { interval: 5, port: 1884 });

    expect(told).toHaveLength(1);
    expect(await states(manager)).toMatchObject({ ticker: 'starting' });
  });

  it('hands the supervisor a package’s compose file, its settings as the file’s variables', async () => {
    const { manager, work, reconciled } = await setUp();
    const file = ['services:', '  server:', '    image: x:1', ''].join('\n');

    await putLocal(
      work,
      manifest({
        id: 'recorder',
        runtime: 'container',
        compose: { file: './compose.yaml' },
        setup: './setup.json',
      }),
      {
        transport: { fields: [{ key: 'apiToken', type: 'text', label: 'Token', default: 'abc' }] },
      },
      async (root) => writeFile(path.join(root, 'compose.yaml'), file),
    );
    await manager.start();
    await manager.install('recorder');

    expect(reconciled.at(-1)).toMatchObject({
      ownerKind: 'package',
      composeProjects: [
        {
          packageId: 'recorder',
          file,
          values: { NEBULA_SETUP_API_TOKEN: 'abc' },
        },
      ],
    });
  });

  it('keeps a sealed secret the owner left as it was', async () => {
    const { manager, store, work } = await setUp();
    const sealed = sealSecret('s3cret', Buffer.alloc(32, 1));

    await putLocal(work, manifest({ id: 'cards' }));
    await manager.start();
    await manager.install('cards');
    await manager.configure('cards', { password: sealed });
    await manager.configure('cards', { password: { $sealed: true }, port: 1884 });

    expect(store.rows.get('cards')?.config).toEqual({ password: sealed, port: 1884 });
  });

  it('installs from the index, and says what it needs and why another cannot be', async () => {
    const { manager } = await setUp();

    await manager.start();
    await manager.announce({ packageId: 'mqtt', version: '1.0.0', rpcMethods: [] });

    expect(await manager.plan('watcher')).toEqual({
      install: [],
      problems: ['Watcher needs a package that provides object-detection, and none does'],
    });
    await expect(manager.install('watcher')).rejects.toThrow(/object-detection/u);

    const installed = await manager.install('zigbee-tools');

    expect(installed.map((item) => [item.id, item.state, item.source])).toEqual([
      ['zigbee-tools', 'running', 'index'],
    ]);
    expect(
      (await manager.available()).items.find((item) => item.id === 'zigbee-tools'),
    ).toMatchObject({
      installedVersion: '2.1.0',
      hasUpdate: false,
      hasNewBuild: false,
      latest: { source: 'index' },
    });
    expect((await manager.get('mqtt')).usedBy).toEqual([
      { kind: 'package', id: 'zigbee-tools', name: 'ZIGBEE-TOOLS' },
    ]);
  });

  it('installs a local file, and another build of its version over it', async () => {
    const { manager, work } = await setUp();
    const source = await putLocal(work, manifest({ id: 'weather', version: '0.3.0' }));
    const file = path.join(work, 'local', 'weather-0.3.0.tgz');

    await manager.start();

    /**
     * What the store offers of the package.
     *
     * @returns Its item.
     */
    const offered = async () =>
      (await manager.available()).items.find((item) => item.id === 'weather');

    expect(await offered()).toMatchObject({
      latest: { version: '0.3.0', source: 'local' },
      hasNewBuild: false,
    });

    const [installed] = await manager.install('weather');

    expect(installed).toMatchObject({ source: 'local', state: 'running' });
    expect(installed?.build).toMatch(/^0\.3\.0\+[0-9a-f]{8}$/u);

    await writeFile(path.join(source, 'ui', 'index.js'), 'export default { rebuilt: true };\n');
    await archiveOf(source, file);

    expect(await offered()).toMatchObject({ hasUpdate: false, hasNewBuild: true });

    const rebuilt = await manager.update('weather');

    expect(rebuilt).toMatchObject({ version: '0.3.0', state: 'running' });
    expect(rebuilt.build).not.toBe(installed?.build);
    expect(
      await readFile(
        path.join(work, 'data', 'packages', 'weather', '0.3.0', 'ui', 'index.js'),
        'utf8',
      ),
    ).toContain('rebuilt');
    expect(await offered()).toMatchObject({ hasNewBuild: false });
    await expect(manager.update('weather')).rejects.toThrow(/is the newest release/u);
  });

  it('takes a package down with what it needs, and back up with it', async () => {
    const { manager, work } = await setUp();

    await putLocal(work, manifest({ id: 'detector', provides: ['object-detection'] }));
    await putLocal(
      work,
      manifest({ id: 'viewer', requires: { packages: {}, services: ['object-detection'] } }),
    );
    await manager.start();

    expect((await manager.install('viewer')).map((item) => item.id)).toEqual([
      'detector',
      'viewer',
    ]);

    await manager.stopPackage('detector');

    expect(await states(manager)).toMatchObject({
      detector: 'stopped',
      viewer: 'waiting-dependency',
    });
    expect((await manager.get('viewer')).problems).toEqual([
      'VIEWER needs the DETECTOR package, which is not running',
    ]);

    await manager.startPackage('detector');

    expect(await states(manager)).toMatchObject({ detector: 'running', viewer: 'running' });
  });

  it('keeps the house’s last broker, removes it once another provides the service, and removes the rest with their devices', async () => {
    const { manager, store, synced, work } = await setUp();

    await manager.start();
    await manager.announce({ packageId: 'mqtt', version: '1.0.0', rpcMethods: [] });
    await manager.install('zigbee-tools');

    await expect(manager.remove('mqtt', false)).rejects.toThrow(
      "MQTT is the house's MQTT broker: install another package that provides mqtt-broker before removing it",
    );
    await expect(manager.stopPackage('mqtt')).rejects.toThrow(/before stopping it/u);

    await putLocal(work, manifest({ id: 'mosquitto', provides: [MQTT_BROKER_SERVICE] }));
    await manager.install('mosquitto');

    expect((await manager.get('mqtt')).isSystem).toBe(false);

    await manager.remove('zigbee-tools', true);
    await manager.remove('mqtt', false);

    expect(store.rows.has('zigbee-tools')).toBe(false);
    expect(synced.map((each) => [each.packageId, each.devices])).toEqual([
      ['zigbee-tools', []],
      ['mqtt', []],
    ]);
    expect(await states(manager)).toEqual({ mosquitto: 'running' });
    expect((await manager.get('mosquitto')).isSystem).toBe(true);
  });

  it('searches the Hub, each package with what installing it here takes, the local folder’s first', async () => {
    const { manager, hubAsked } = await setUp();

    await manager.start();

    const found = await manager.search({});

    expect(found.hubError).toBeNull();
    expect(found.nextCursor).toBe('page-2');
    expect(found.items.map((item) => [item.id, item.origin])).toEqual([
      ['mqtt', 'local'],
      ['zigbee-tools', 'hub'],
      ['watcher', 'hub'],
      ['newcomer', 'hub'],
    ]);
    expect(found.items[0]).toMatchObject({ installedVersion: '1.0.0', unavailableReason: null });
    expect(found.items[1]).toMatchObject({
      isOfficial: true,
      color: '#3F6FD8',
      logo: HUB_LOGO_SHA,
      downloads: 1200,
      repository: 'nebulahome/pkg-zigbee-tools',
      latest: { version: '2.1.0', source: 'index' },
      unavailableReason: null,
    });
    // The Hub's word is checked before it reaches a style.
    expect(found.items[2]?.color).toBeNull();
    expect(found.items[3]).toMatchObject({
      latest: null,
      newestVersion: '0.3.0',
      repository: null,
      unavailableReason: 'No release of it is in the package index yet',
    });

    const narrowed = await manager.search({ q: 'zig' });

    expect(narrowed.items.map((item) => item.id)).toEqual(['zigbee-tools']);
    expect(hubAsked.at(-1)).toBe('https://hub.example/v1/packages?limit=30&q=zig');
  });

  it('lists the local folder’s files when the Hub cannot be asked, and says why', async () => {
    const { manager } = await setUp({ isHubDown: true });

    await manager.start();

    const found = await manager.search({ q: 'mqtt' });

    expect(found.hubError).toMatch(/could not be reached at https:\/\/hub\.example/u);
    expect(found.items.map((item) => item.id)).toEqual(['mqtt']);
  });

  it('relays a logo a search showed, checked against its digest, and no other', async () => {
    const { manager, hubAsked } = await setUp();

    await expect(manager.hubLogo(HUB_LOGO_SHA)).rejects.toThrow(/No search showed/u);

    await manager.search({});

    const logo = await manager.hubLogo(HUB_LOGO_SHA);

    expect(logo).toEqual({ contentType: 'image/png', data: HUB_LOGO.toString('base64') });

    const asked = hubAsked.length;

    await manager.hubLogo(HUB_LOGO_SHA);

    // The second time from what it kept.
    expect(hubAsked.length).toBe(asked);
  });
});
