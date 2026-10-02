/**
 * The packet-manager against a bus in memory, a store in memory and packages written here: the
 * image's packages started in order, one installed from the index with what it needs, a package
 * waiting for another and following it down and up, and removals refused and made.
 */
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
  SUPERVISOR_METHODS,
  SUPERVISOR_SERVICE,
  syncPackageRequestSchema,
  type SyncPackageRequest,
} from '@nebulahome/contracts';
import { sealSecret } from '@nebulahome/db';
import { createLogger } from '@nebulahome/logging';

import { packetManagerEnvSchema } from './config.js';
import { PacketManager } from './service.js';
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
  requires: { packages: {}, services: ['mqtt-broker'] },
});

/**
 * A packet-manager with two packages in the image - the broker, a process, and a page of cards
 * - and an index offering one more.
 *
 * @returns The manager, its store, the bus, what `core` was asked and the folder it works in.
 */
async function setUp(): Promise<{
  manager: PacketManager;
  store: ReturnType<typeof memoryStore>;
  transport: FakeTransport;
  synced: SyncPackageRequest[];
  work: string;
  again: () => PacketManager;
  reconciled: unknown[];
}> {
  const work = await scratch();

  folders.push(work);

  const builtin = path.join(work, 'pkgs');

  await writePackage(
    path.join(builtin, 'mqtt'),
    manifest({
      id: 'mqtt',
      runtime: 'node',
      server: { entry: './server/index.js' },
      provides: ['mqtt-broker'],
    }),
  );
  await writePackage(path.join(builtin, 'cards'), manifest({ id: 'cards' }));

  const source = await writePackage(path.join(work, 'source'), TOOLS);
  const archive = await archiveOf(source, path.join(work, 'tools.tgz'));
  const url = 'https://github.com/nebula-home/pkg-zigbee-tools/releases/download/v2.1.0/t.tgz';
  const index = {
    generatedAt: '2026-09-29T08:00:00Z',
    packages: [
      {
        id: 'zigbee-tools',
        name: 'Zigbee tools',
        description: 'Tools.',
        repository: 'nebula-home/pkg-zigbee-tools',
        category: 'protocol',
        versions: [
          {
            version: '2.1.0',
            platform: '^1.0.0',
            sdk: '^1.0.0',
            requires: { packages: {}, services: ['mqtt-broker'] },
            artifact: { url, size: archive.size, sha256: archive.sha256 },
            publishedAt: '2026-09-28T08:00:00Z',
          },
        ],
      },
      {
        id: 'watcher',
        name: 'Watcher',
        description: 'Needs a detector nobody has.',
        repository: 'nebula-home/pkg-watcher',
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

    return Promise.resolve(
      asked === 'https://example.com/index.json'
        ? Response.json(index)
        : asked === url
          ? new Response(new Uint8Array(archive.bytes))
          : new Response('not found', { status: 404 }),
    );
  };
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
    PACKET_MANAGER_BUILTIN_DIR: builtin,
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
        local: async () => local.entries(),
      }),
      secretsKey: Buffer.alloc(32, 1),
      runner,
      packagesDir: path.join(work, 'data', 'packages'),
      cacheDir: path.join(work, 'data', 'cache', 'packages'),
      fetch,
    });

    managers.push(made);

    return made;
  };

  return { manager: again(), store, transport, synced, work, again, reconciled };
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
  it('installs the image’s packages as the system’s, and runs one once it announces itself', async () => {
    const { manager, store, work } = await setUp();

    await manager.start();

    expect(await states(manager)).toEqual({ cards: 'running', mqtt: 'starting' });
    // Its folders are there before it runs: what it opens in them - a SQLite file - makes none.
    expect((await stat(path.join(work, 'data', 'packages', 'mqtt', 'data'))).isDirectory()).toBe(
      true,
    );
    expect((await stat(path.join(work, 'data', 'cache', 'packages', 'mqtt'))).isDirectory()).toBe(
      true,
    );
    expect(store.rows.get('mqtt')).toMatchObject({ source: 'builtin', isSystem: true });

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

  it('leaves a system package the image no longer ships as it was, and does not run it', async () => {
    const { manager, store, work, again } = await setUp();

    await manager.start();
    await manager.stop();
    await rm(path.join(work, 'pkgs', 'mqtt'), { recursive: true, force: true });

    const next = again();

    await next.start();

    expect(await states(next)).toEqual({ cards: 'running' });
    expect(store.rows.get('mqtt')).toMatchObject({ source: 'builtin', version: '1.0.0' });
  });

  it('fails a package built against an SDK the platform does not implement', async () => {
    const { manager, work, again } = await setUp();

    await manager.start();
    await manager.stop();
    await writePackage(
      path.join(work, 'pkgs', 'future'),
      manifest({ id: 'future', sdk: '^9.0.0' }),
    );

    const next = again();

    await next.start();

    expect(await next.get('future')).toMatchObject({
      state: 'failed',
      lastError: `FUTURE needs the NebulaHome package SDK ^9.0.0; this platform implements ${next.sdkVersion}`,
    });
  });

  it('hands a package its settings’ defaults, and a live change without a restart', async () => {
    const { manager, transport, work, again } = await setUp();

    await manager.start();
    await manager.stop();
    await writePackage(
      path.join(work, 'pkgs', 'ticker'),
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

    const next = again();
    const told: unknown[] = [];
    const ticker = new BusClient({ transport, source: 'ticker', logger });

    ticker.serve(busSubjects.service('ticker', 'settings'), z.unknown(), (request) => {
      told.push(request);

      return {};
    });
    await next.start();
    await next.announce({ packageId: 'ticker', version: '1.0.0', rpcMethods: [] });
    await vi.waitFor(() => {
      expect(next.logs('ticker', 20).lines.map((line) => line.text)).toContain(
        'settings {"interval":10,"port":1883}',
      );
    });

    await next.configure('ticker', { interval: 5 });

    expect(told).toEqual([{ values: { interval: 5, port: 1883 }, changed: ['interval'] }]);
    expect(await states(next)).toMatchObject({ ticker: 'running' });

    await next.configure('ticker', { interval: 5, port: 1884 });

    expect(told).toHaveLength(1);
    expect(await states(next)).toMatchObject({ ticker: 'starting' });
  });

  it('hands the supervisor a package’s compose file, its settings as the file’s variables', async () => {
    const { manager, work, again, reconciled } = await setUp();

    await manager.start();
    await manager.stop();

    const root = await writePackage(
      path.join(work, 'pkgs', 'recorder'),
      manifest({
        id: 'recorder',
        runtime: 'container',
        compose: { file: './compose.yaml' },
        setup: './setup.json',
      }),
      {
        transport: { fields: [{ key: 'apiToken', type: 'text', label: 'Token', default: 'abc' }] },
      },
    );

    const file = ['services:', '  server:', '    image: x:1', ''].join('\n');

    await writeFile(path.join(root, 'compose.yaml'), file);

    const next = again();

    await next.start();

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
    const { manager, store } = await setUp();
    const sealed = sealSecret('s3cret', Buffer.alloc(32, 1));

    await manager.start();
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

    expect(installed.map((item) => [item.id, item.state])).toEqual([['zigbee-tools', 'running']]);
    expect(
      (await manager.available()).items.find((item) => item.id === 'zigbee-tools'),
    ).toMatchObject({
      installedVersion: '2.1.0',
      hasUpdate: false,
    });
    expect((await manager.get('mqtt')).usedBy).toEqual([
      { kind: 'package', id: 'zigbee-tools', name: 'ZIGBEE-TOOLS' },
    ]);
  });

  it('installs a local file, and another build of its version over it', async () => {
    const { manager, work } = await setUp();
    const source = await writePackage(
      path.join(work, 'weather'),
      manifest({ id: 'weather', version: '0.3.0' }),
    );
    const file = path.join(work, 'local', 'weather-0.3.0.tgz');

    await mkdir(path.join(work, 'local'));
    await archiveOf(source, file);
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
    const { manager } = await setUp();

    await manager.start();
    await manager.announce({ packageId: 'mqtt', version: '1.0.0', rpcMethods: [] });
    await manager.install('zigbee-tools');
    await manager.stopPackage('mqtt');

    expect(await states(manager)).toMatchObject({
      mqtt: 'stopped',
      'zigbee-tools': 'waiting-dependency',
    });
    expect((await manager.get('zigbee-tools')).problems).toEqual([
      'ZIGBEE-TOOLS needs the MQTT package, which is not running',
    ]);

    await manager.startPackage('mqtt');
    await manager.announce({ packageId: 'mqtt', version: '1.0.0', rpcMethods: [] });

    expect(await states(manager)).toMatchObject({ mqtt: 'running', 'zigbee-tools': 'running' });
  });

  it('refuses to remove a system package or one something needs, and removes the rest with its devices', async () => {
    const { manager, store, synced } = await setUp();

    await manager.start();
    await manager.announce({ packageId: 'mqtt', version: '1.0.0', rpcMethods: [] });
    await manager.install('zigbee-tools');

    await expect(manager.remove('mqtt', false)).rejects.toThrow(/part of the platform/u);
    await manager.remove('zigbee-tools', true);

    expect(store.rows.has('zigbee-tools')).toBe(false);
    expect(synced).toEqual([{ packageId: 'zigbee-tools', devices: [] }]);
    expect(await states(manager)).toEqual({ cards: 'running', mqtt: 'running' });
  });
});
