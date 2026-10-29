/**
 * Which versions the Update button may ask for: every channel's, nothing else. And what the pages
 * are told while Nebula Home restarts or is being checked after an update.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { PlatformEvent } from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';

import type { InspectedContainer } from '../docker/engine-schemas.js';
import type { DockerEngine } from '../docker/engine.js';

import { PlatformUpdates, RELEASE_VERSION } from './platform-updates.js';

describe('a release version', () => {
  it('is a stable release, a beta or a dev build', () => {
    for (const version of ['2026.10.0', '2026.10.1-beta.2', '2026.10.0-alpha.2']) {
      expect(RELEASE_VERSION.test(version), version).toBe(true);
    }
  });

  it('is nothing else', () => {
    for (const version of ['v2026.10.0', '2026.10.0-rc.1', '1.2', 'latest', '2026.10.0-alpha']) {
      expect(RELEASE_VERSION.test(version), version).toBe(false);
    }
  });
});

/**
 * The service over a data folder, in a container whose restart does nothing.
 *
 * @param dataRoot - The data folder.
 * @returns It, and what it told the pages.
 */
function platformOver(dataRoot: string): { platform: PlatformUpdates; told: PlatformEvent[] } {
  const told: PlatformEvent[] = [];
  const platform = new PlatformUpdates({
    engine: { control: vi.fn(async () => Promise.resolve()) } as unknown as DockerEngine,
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } as unknown as PlatformLogger,
    version: '2026.10.1',
    dataRoot,
    socketPath: '/var/run/docker.sock',
    isDockerAvailable: () => true,
    self: () => ({ Id: 'self' }) as unknown as InspectedContainer,
    machine: () => 'PC-Roby',
    publish: (event) => {
      told.push(event);
    },
  });

  return { platform, told };
}

describe('PlatformUpdates', () => {
  it('tells every page a restart is stopping the services', async () => {
    const { platform, told } = platformOver(await mkdtemp(path.join(os.tmpdir(), 'nebula-')));

    platform.restart();

    expect(told).toMatchObject([{ operation: { kind: 'restart', phase: 'stopping' } }]);
    await expect(platform.state()).resolves.toMatchObject({
      version: '2026.10.1',
      machine: 'PC-Roby',
      operation: { kind: 'restart', fromVersion: '2026.10.1', toVersion: null },
    });
  });

  it('shows an update coming while its backup runs, and takes it back', async () => {
    const { platform, told } = platformOver(await mkdtemp(path.join(os.tmpdir(), 'nebula-')));

    platform.announce('2026.11.0');
    platform.announce('2026.11.0', 1200);
    platform.announce(null);

    expect(told).toMatchObject([
      { operation: { kind: 'update', phase: 'backingUp', backupBytes: null } },
      { operation: { phase: 'backingUp', backupBytes: 1200 } },
      { operation: null },
    ]);
    expect(told[1]?.operation?.startedAt).toBe(told[0]?.operation?.startedAt);

    // Nothing to take back: no event.
    platform.announce(null);

    expect(told).toHaveLength(3);
  });

  it('stops waiting, and says why, when the updater ends without having replaced it', async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'nebula-'));
    const told: PlatformEvent[] = [];
    let exit: (code: number) => void = () => undefined;
    const engine = {
      pull: vi.fn(async () => Promise.resolve()),
      inspectImage: vi.fn(async () =>
        Promise.resolve({
          Config: { Labels: { 'org.opencontainers.image.version': '2026.11.0' } },
        }),
      ),
      createContainer: vi.fn(async () => Promise.resolve('updater-id')),
      control: vi.fn(async () => Promise.resolve()),
      wait: vi.fn(
        async () =>
          new Promise<number>((resolve) => {
            exit = resolve;
          }),
      ),
    } as unknown as DockerEngine;
    const platform = new PlatformUpdates({
      engine,
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } as unknown as PlatformLogger,
      version: '2026.10.1',
      dataRoot,
      socketPath: '/var/run/docker.sock',
      isDockerAvailable: () => true,
      self: () =>
        ({
          Id: 'self',
          Config: { Image: 'nebulahome/platform:latest' },
          Mounts: [
            { Type: 'volume', Name: 'data', Destination: dataRoot },
            { Type: 'bind', Source: '/var/run/docker.sock', Destination: '/var/run/docker.sock' },
          ],
        }) as unknown as InspectedContainer,
      machine: () => null,
      publish: (event) => {
        told.push(event);
      },
      fetch: vi.fn(async () => Promise.reject(new Error('offline'))),
    });

    await platform.update('2026.11.0');

    expect(told.at(-1)?.operation?.phase).toBe('installing');
    await expect(platform.update('2026.11.0')).rejects.toThrow(/An update is running/u);

    exit(1);

    await vi.waitFor(() => {
      expect(told.at(-1)).toEqual({ operation: null });
    });
    await expect(platform.releases(false)).resolves.toMatchObject({
      refusal: null,
      lastUpdate: { status: 'failed', toVersion: '2026.11.0' },
    });
  });

  it("says an update is being checked while the updater's marker is there", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'nebula-'));
    const { platform } = platformOver(dataRoot);

    await expect(platform.state()).resolves.toMatchObject({ operation: null });

    await mkdir(path.join(dataRoot, 'updates'));
    await writeFile(
      path.join(dataRoot, 'updates', 'current.json'),
      JSON.stringify({
        fromVersion: '2026.10.1',
        toVersion: '2026.11.0',
        startedAt: '2026-11-14T03:00:00Z',
      }),
    );

    await expect(platform.state()).resolves.toMatchObject({
      operation: { kind: 'update', phase: 'checking', toVersion: '2026.11.0' },
    });
  });
});
