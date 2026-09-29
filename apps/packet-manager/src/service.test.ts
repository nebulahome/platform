/**
 * The packet-manager against a bus in memory, a store in memory and packages written here: the
 * image's packages started in order, one installed from the index with what it needs, a package
 * waiting for another and following it down and up, and removals refused and made.
 */
import { rm } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { BusClient } from '@nebula-home/bus';
import { FakeTransport } from '@nebula-home/bus/testing';
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
} from '@nebula-home/contracts';
import { createLogger } from '@nebula-home/logging';

import { packetManagerEnvSchema } from './config.js';
import { PacketManager } from './service.js';
import { PackageIndexClient } from './services/index-client.js';
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
 * @returns The manager, its store, the bus and what `core` was asked.
 */
async function setUp(): Promise<{
  manager: PacketManager;
  store: ReturnType<typeof memoryStore>;
  transport: FakeTransport;
  synced: SyncPackageRequest[];
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
  platform.serve(
    busSubjects.service(SUPERVISOR_SERVICE, SUPERVISOR_METHODS.reconcile),
    z.unknown(),
    () => ({
      containers: [],
    }),
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
  const manager = new PacketManager({
    config,
    store,
    client: new BusClient({ transport, source: 'packet-manager', logger, requestTimeoutMs: 500 }),
    logger,
    index: new PackageIndexClient({
      url: 'https://example.com/index.json',
      ttlMs: 60_000,
      logger,
      fetch,
    }),
    secretsKey: Buffer.alloc(32, 1),
    runner: await fakeRunner(work),
    packagesDir: path.join(work, 'data', 'packages'),
    cacheDir: path.join(work, 'data', 'cache', 'packages'),
    fetch,
  });

  managers.push(manager);

  return { manager, store, transport, synced };
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
    const { manager, store } = await setUp();

    await manager.start();

    expect(await states(manager)).toEqual({ cards: 'running', mqtt: 'starting' });
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
