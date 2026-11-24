/**
 * Replacing a container against an engine the test holds: a new one that does not stay up is
 * undone, the old one put back; one that does replaces the old, whose image then goes.
 */
import { describe, expect, it } from 'vitest';

import { createLogger } from '@nebulahome/logging';

import type { DockerEngine } from '../docker/engine.js';

import { replaceContainer } from './replace.js';

/**
 * An engine whose new containers end up as said, recording each call.
 *
 * @param calls - Where each call goes.
 * @param status - What a new container is, once started.
 * @returns It.
 */
function engineWith(calls: string[], status: 'exited' | 'running'): DockerEngine {
  return {
    renameContainer: async (id: string, name: string) => {
      calls.push(`rename ${id} ${name.replace(/-nebula-old-.*$/u, '-old')}`);

      return Promise.resolve();
    },
    control: async (id: string, action: string) => {
      calls.push(`${action} ${id}`);

      return Promise.resolve();
    },
    createContainer: async () => {
      calls.push('create');

      return Promise.resolve('new');
    },
    connectNetwork: async () => Promise.resolve(),
    inspectContainer: async (id: string) =>
      Promise.resolve({
        Image: id === 'old' ? 'sha256:old' : 'sha256:new',
        State: { Status: status },
        RestartCount: 0,
      }),
    removeContainer: async (id: string) => {
      calls.push(`remove ${id}`);

      return Promise.resolve();
    },
    listContainers: async () => Promise.resolve([{ Id: 'new', ImageID: 'sha256:new' }]),
    inspectImage: async (id: string) => Promise.resolve({ Id: id, RepoTags: ['nvr:1.0'] }),
    removeImage: async (reference: string) => {
      calls.push(`remove image ${reference}`);

      return Promise.resolve();
    },
  } as unknown as DockerEngine;
}

/**
 * Replaces the old container against an engine whose new one ends up as said.
 *
 * @param calls - Where each call goes.
 * @param status - What the new container is, once started.
 * @returns The new container's id.
 */
async function replace(calls: string[], status: 'exited' | 'running'): Promise<string> {
  return replaceContainer({
    engine: engineWith(calls, status),
    logger: createLogger({ service: 'supervisor', version: '0.0.0', level: 'fatal' }),
    id: 'old',
    name: 'nvr',
    wasRunning: true,
    body: {},
    settleMs: 0,
  });
}

describe('replacing a container', () => {
  it('puts the old container back when the new one does not stay running', async () => {
    const calls: string[] = [];

    await expect(replace(calls, 'exited')).rejects.toThrow(
      /nvr on its new image did not start: it did not stay running \(exited/u,
    );
    expect(calls).toEqual([
      'rename old nvr-old',
      'stop old',
      'create',
      'start new',
      'remove new',
      'rename old nvr',
      'start old',
    ]);
  });

  it('removes the old container, then its image, once the new one stays running', async () => {
    const calls: string[] = [];

    await expect(replace(calls, 'running')).resolves.toBe('new');
    expect(calls).toEqual([
      'rename old nvr-old',
      'stop old',
      'create',
      'start new',
      'remove old',
      'remove image nvr:1.0',
    ]);
  });
});
