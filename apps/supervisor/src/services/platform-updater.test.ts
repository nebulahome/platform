import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { PlatformLogger } from '@nebulahome/logging';

import type { InspectedContainer } from '../docker/engine-schemas.js';

import { updatePlatform, type PlatformUpdateOptions } from './platform-updater.js';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
} as unknown as PlatformLogger;

const OLD = {
  Id: 'old-id',
  Name: '/nebulahome-nebulahome-1',
  Created: '2026-10-01T00:00:00Z',
  Image: 'sha256:old',
  State: { Status: 'running', Running: true },
  Config: { Image: 'nebulahome/platform:latest', Env: [], Labels: {}, Cmd: [], Entrypoint: [] },
  HostConfig: {},
  Mounts: [
    { Type: 'volume', Name: 'nebulahome_nebula-data', Destination: '/data' },
    { Type: 'volume', Name: 'nebulahome_nebula-postgres', Destination: '/var/lib/postgresql/data' },
    { Type: 'bind', Source: '/var/run/docker.sock', Destination: '/var/run/docker.sock' },
  ],
  NetworkSettings: { Networks: {}, Ports: {} },
} as unknown as InspectedContainer;

/**
 * A Docker that records what it is asked, whose new container ends up as said.
 *
 * @param health - The new container's health.
 * @param says - The version the new container is of, as its image sets it.
 * @returns The engine and the calls.
 */
function engineWith(
  health: 'healthy' | 'unhealthy',
  says = '2026.11.0',
): {
  engine: PlatformUpdateOptions['engine'];
  calls: string[];
} {
  const calls: string[] = [];
  let made = 0;
  const engine = {
    inspectContainer: vi.fn(async (id: string) =>
      Promise.resolve(
        id === 'old-id'
          ? OLD
          : {
              ...OLD,
              Id: id,
              Config: { ...OLD.Config, Env: [`NEBULA_VERSION=${says}`] },
              State: { Status: 'running', Health: { Status: health } },
            },
      ),
    ),
    inspectImage: vi.fn(async () =>
      Promise.resolve({ Config: { Env: [], Labels: {}, Cmd: [], Entrypoint: [] } }),
    ),
    tagImage: vi.fn(async (source: string, reference: string) => {
      calls.push(`tag ${source} ${reference}`);

      return Promise.resolve();
    }),
    control: vi.fn(async (id: string, action: string) => {
      calls.push(`${action} ${id}`);

      return Promise.resolve();
    }),
    createVolume: vi.fn(async (name: string) => {
      calls.push(`volume ${name}`);

      return Promise.resolve();
    }),
    removeVolume: vi.fn(async (name: string) => {
      calls.push(`drop ${name}`);

      return Promise.resolve();
    }),
    createContainer: vi.fn(async (name: string, body: { HostConfig?: { Binds?: string[] } }) => {
      made += 1;
      calls.push(
        name.startsWith('nebulahome-copy')
          ? `copy ${(body.HostConfig?.Binds ?? []).join(' > ')}`
          : `create ${name}`,
      );

      return Promise.resolve(
        name.startsWith('nebulahome-copy') ? `copy-${String(made)}` : 'new-id',
      );
    }),
    connectNetwork: vi.fn(async () => Promise.resolve()),
    renameContainer: vi.fn(async (id: string, name: string) => {
      calls.push(`rename ${id} ${name.replace(/-nebula-old-\w+$/, '-nebula-old')}`);

      return Promise.resolve();
    }),
    removeContainer: vi.fn(async (id: string) => {
      if (!id.startsWith('copy')) {
        calls.push(`remove ${id}`);
      }

      return Promise.resolve();
    }),
    wait: vi.fn(async () => Promise.resolve(0)),
    // One stdout frame, as Docker multiplexes it: stream, three zeros, the length, the text.
    logs: vi.fn(async () =>
      Promise.resolve(Buffer.from([1, 0, 0, 0, 0, 0, 0, 17, ...Buffer.from('migration failed\n')])),
    ),
  } as unknown as PlatformUpdateOptions['engine'];

  return { engine, calls };
}

/**
 * Runs an update against a Docker whose new container ends up as said.
 *
 * @param health - The new container's health.
 * @param says - The version the new container is of.
 * @returns How it ended, what Docker was asked, and the outcome written.
 */
async function run(health: 'healthy' | 'unhealthy', says?: string) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'nebula-update-'));
  const { engine, calls } = engineWith(health, says);
  const outcome = await updatePlatform({
    engine,
    logger,
    targetId: 'old-id',
    image: 'nebulahome/platform:2026.11.0',
    fromVersion: '2026.10.1',
    toVersion: '2026.11.0',
    dataDir,
    pollMs: 1,
    now: () => new Date('2026-11-14T03:00:00Z'),
  });
  const written: unknown = JSON.parse(
    await readFile(path.join(dataDir, 'updates', 'last.json'), 'utf8'),
  );
  const isMarked = await readFile(path.join(dataDir, 'updates', 'current.json'), 'utf8').then(
    () => true,
    () => false,
  );

  return { outcome, calls, written, isMarked };
}

describe('updatePlatform', () => {
  it('copies the volumes aside, makes the new container and cleans up once it is healthy', async () => {
    const { outcome, calls, written, isMarked } = await run('healthy');

    expect(isMarked).toBe(false);

    expect(outcome.error).toBeNull();
    expect(outcome.status).toBe('success');
    expect(outcome.restoredInMs).toBeNull();
    expect(outcome.log.at(-1)).toMatch(/2026\.11\.0 is healthy$/u);
    expect(written).toMatchObject({ status: 'success', toVersion: '2026.11.0' });
    expect(calls).toEqual([
      'tag nebulahome/platform:2026.11.0 nebulahome/platform:latest',
      'stop old-id',
      'volume nebulahome-pre-2026.10.1-data',
      'copy nebulahome_nebula-data:/from:ro > nebulahome-pre-2026.10.1-data:/to',
      'start copy-1',
      'volume nebulahome-pre-2026.10.1-postgres',
      'copy nebulahome_nebula-postgres:/from:ro > nebulahome-pre-2026.10.1-postgres:/to',
      'start copy-2',
      'rename old-id nebulahome-nebulahome-1-nebula-old',
      'create nebulahome-nebulahome-1',
      'start new-id',
      'remove old-id',
      'drop nebulahome-pre-2026.10.1-data',
      'drop nebulahome-pre-2026.10.1-postgres',
    ]);
  });

  it('puts the old version and its volumes back when the new one is unhealthy', async () => {
    const { outcome, calls, written } = await run('unhealthy');

    expect(outcome.status).toBe('rolled_back');
    expect(written).toMatchObject({ status: 'rolled_back' });
    expect(outcome.restoredInMs).toBeGreaterThanOrEqual(0);
    expect(outcome.log).toContain('› migration failed');
    expect(calls.slice(calls.indexOf('start new-id') + 1)).toEqual([
      'remove new-id',
      'copy nebulahome-pre-2026.10.1-data:/from:ro > nebulahome_nebula-data:/to',
      'start copy-4',
      'copy nebulahome-pre-2026.10.1-postgres:/from:ro > nebulahome_nebula-postgres:/to',
      'start copy-5',
      'tag sha256:old nebulahome/platform:latest',
      'rename old-id nebulahome-nebulahome-1',
      'start old-id',
      'drop nebulahome-pre-2026.10.1-data',
      'drop nebulahome-pre-2026.10.1-postgres',
    ]);
  });

  it('never starts a new container that is still the old version, and puts the old one back', async () => {
    const { outcome, calls } = await run('healthy', '2026.10.1');

    expect(outcome.status).toBe('rolled_back');
    expect(outcome.error).toBe('The new container is 2026.10.1, not 2026.11.0');
    expect(calls).not.toContain('start new-id');
    expect(calls).toContain('start old-id');
  });

  it('changes nothing and says so when the platform cannot be read', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'nebula-update-'));
    const { engine, calls } = engineWith('healthy');

    vi.mocked(engine.inspectContainer).mockRejectedValueOnce(new Error('socket hung up'));

    const outcome = await updatePlatform({
      engine,
      logger,
      targetId: 'old-id',
      image: 'nebulahome/platform:2026.11.0',
      fromVersion: '2026.10.1',
      toVersion: '2026.11.0',
      dataDir,
    });

    expect(outcome).toMatchObject({ status: 'failed', toVersion: '2026.11.0' });
    expect(outcome.error).toMatch(/socket hung up/u);
    expect(calls).toEqual([]);
    expect(
      JSON.parse(await readFile(path.join(dataDir, 'updates', 'last.json'), 'utf8')),
    ).toMatchObject({ status: 'failed' });
  });
});
