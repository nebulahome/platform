/**
 * Replacing a container against an engine the test holds: a new one that does not stay up is
 * undone, the old one put back.
 */
import { describe, expect, it } from 'vitest';

import { createLogger } from '@nebulahome/logging';

import type { DockerEngine } from '../docker/engine.js';

import { replaceContainer } from './replace.js';

/**
 * An engine whose new containers exit at once, recording each call.
 *
 * @param calls - Where each call goes.
 * @returns It.
 */
function crashingEngine(calls: string[]): DockerEngine {
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
    inspectContainer: async () => Promise.resolve({ State: { Status: 'exited' }, RestartCount: 0 }),
    removeContainer: async (id: string) => {
      calls.push(`remove ${id}`);

      return Promise.resolve();
    },
  } as unknown as DockerEngine;
}

describe('replacing a container', () => {
  it('puts the old container back when the new one does not stay running', async () => {
    const calls: string[] = [];

    await expect(
      replaceContainer({
        engine: crashingEngine(calls),
        logger: createLogger({ service: 'supervisor', version: '0.0.0', level: 'fatal' }),
        id: 'old',
        name: 'nvr',
        wasRunning: true,
        body: {},
        settleMs: 0,
      }),
    ).rejects.toThrow(/nvr on its new image did not start: it did not stay running \(exited/u);
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
});
