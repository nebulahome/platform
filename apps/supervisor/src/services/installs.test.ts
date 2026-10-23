/**
 * The owner's installs around a restore: recorded in the data directory once they run, so a
 * restore that brings the folder back makes again the ones Docker no longer has, and stopped and
 * started again around the swap of their folders - against an engine the test holds.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContainerInstallRequest } from '@nebulahome/contracts';
import { createLogger } from '@nebulahome/logging';

import type { DockerEngine } from '../docker/engine.js';
import type { PlatformContext } from '../domain/managed.js';

import { Installs } from './installs.js';

const CONTEXT: PlatformContext = {
  network: 'bridge',
  installationId: 'test',
  networkName: 'nebulahome',
  platformAlias: 'nebulahome',
  mqtt: null,
  timezone: 'Europe/Rome',
  dataMount: { kind: 'volume', volume: 'nebulahome_nebula-data' },
};

const REQUEST: ContainerInstallRequest = {
  name: 'whoami',
  image: 'traefik/whoami',
  tag: 'v1.10',
  ports: [],
  env: [{ name: 'WHOAMI_NAME', value: 'lab' }],
  volumes: [{ kind: 'data', name: 'config', target: '/config', isReadOnly: false }],
  devices: [],
  restartPolicy: 'unless-stopped',
  network: 'bridge',
};

let dataRoot = '';

beforeEach(async () => {
  dataRoot = await mkdtemp(path.join(os.tmpdir(), 'nebula-installs-'));
});

afterEach(async () => {
  await rm(dataRoot, { recursive: true, force: true });
});

/**
 * An engine that does what it is asked.
 *
 * @returns Its methods, each a mock.
 */
function fakeEngine(): {
  pull: ReturnType<typeof vi.fn>;
  createContainer: ReturnType<typeof vi.fn>;
  control: ReturnType<typeof vi.fn>;
  removeContainer: ReturnType<typeof vi.fn>;
} {
  return {
    pull: vi.fn(() => Promise.resolve()),
    createContainer: vi.fn(() => Promise.resolve('new-id')),
    control: vi.fn(() => Promise.resolve()),
    removeContainer: vi.fn(() => Promise.resolve()),
  };
}

/**
 * The installs over the test's data directory.
 *
 * @param engine - The engine.
 * @returns Them.
 */
function installsOver(engine: ReturnType<typeof fakeEngine>): Installs {
  return new Installs({
    engine: engine as unknown as DockerEngine,
    logger: createLogger({ service: 'supervisor', version: '0.0.0', level: 'fatal' }),
    dataRoot,
    ensureNetwork: () => Promise.resolve(),
    onChange: () => undefined,
  });
}

/**
 * Installs the request and waits until it is recorded.
 *
 * @returns The engine it ran on.
 */
async function installed(): Promise<ReturnType<typeof fakeEngine>> {
  const engine = fakeEngine();
  const installs = installsOver(engine);

  installs.start(REQUEST, CONTEXT);
  await vi.waitFor(async () => {
    const restored = installsOver(fakeEngine());

    await restored.load();
    expect(restored.recorded()).toEqual(['whoami']);
  });

  return engine;
}

describe('the installs around a restore', () => {
  it('makes again a recorded container Docker no longer has', async () => {
    await installed();

    const engine = fakeEngine();
    const installs = installsOver(engine);

    await installs.resume(new Set(), CONTEXT);

    await vi.waitFor(() => {
      expect(engine.control).toHaveBeenCalledWith('new-id', 'start');
    });
    expect(engine.pull).toHaveBeenCalledWith('traefik/whoami', 'v1.10', expect.any(Function));
    expect(engine.createContainer).toHaveBeenCalledWith('whoami', expect.any(Object));
  });

  it('leaves alone a recorded container Docker still has', async () => {
    await installed();

    const engine = fakeEngine();
    const installs = installsOver(engine);

    await installs.resume(new Set(['whoami']), CONTEXT);

    expect(engine.pull).not.toHaveBeenCalled();
    expect(installs.list()).toEqual([]);
  });

  it('stops the running ones for the swap and starts them again after it', async () => {
    const engine = fakeEngine();
    const installs = installsOver(engine);

    await installs.suspend(['whoami']);
    expect(engine.control).toHaveBeenCalledWith('whoami', 'stop');

    await installs.resume(new Set(['whoami']), CONTEXT);
    expect(engine.control).toHaveBeenCalledWith('whoami', 'start');
  });

  it('makes nothing again of a container the owner removed', async () => {
    const engine = await installed();
    const installs = installsOver(engine);

    await installs.load();
    await installs.forget('whoami');

    const restored = installsOver(fakeEngine());

    await restored.load();
    expect(restored.recorded()).toEqual([]);
  });

  it('makes a container updated since on the tag it was updated to', async () => {
    await installed();

    const installs = installsOver(fakeEngine());

    await installs.load();
    await installs.retag('whoami', 'v1.11');

    const engine = fakeEngine();
    const restored = installsOver(engine);

    await restored.resume(new Set(), CONTEXT);
    await vi.waitFor(() => {
      expect(engine.pull).toHaveBeenCalledWith('traefik/whoami', 'v1.11', expect.any(Function));
    });
  });
});
