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
