import { describe, expect, it, vi } from 'vitest';

import type { BusClient } from '@nebulahome/bus';
import type { UpdateRound } from '@nebulahome/contracts';
import type { Database } from '@nebulahome/db';
import type { PlatformLogger } from '@nebulahome/logging';

import type { UpdateSettings } from '../persistence/update-settings.js';

import { UpdateRunner, type UpdateRunnerOptions } from './update-runner.js';

const SETTINGS: UpdateSettings = {
  autoPackages: false,
  autoIntegrations: false,
  window: { mode: 'fixed', time: '03:00' },
  backupFirst: false,
  backupSections: ['configuration'],
  timezone: 'UTC',
};

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as PlatformLogger;

/**
 * A runner over fakes, recording what it updated in order.
 *
 * @param overrides - What differs.
 * @returns The runner and the order.
 */
function runnerWith(overrides: Partial<UpdateRunnerOptions> = {}): {
  runner: UpdateRunner;
  done: string[];
} {
  const done: string[] = [];
  const runner = new UpdateRunner({
    client: {
      request: vi.fn(async (subject: string, payload: { version: string }) => {
        expect(subject).toContain('update_platform');
        done.push(`core ${payload.version}`);

        return Promise.resolve({ ok: true });
      }),
    } as unknown as BusClient,
    db: undefined as unknown as Database,
    packages: {
      update: vi.fn(async (id: string) => {
        done.push(`package ${id}`);

        return id === 'broken' ? Promise.reject(new Error('no archive')) : Promise.resolve({});
      }),
      available: vi.fn(),
    } as unknown as UpdateRunnerOptions['packages'],
    integrations: {
      install: vi.fn(async (id: string) => {
        done.push(`integration ${id}`);

        return Promise.resolve({});
      }),
      available: vi.fn(),
    } as unknown as UpdateRunnerOptions['integrations'],
    logger,
    readSettings: async () => Promise.resolve(SETTINGS),
    ...overrides,
  });

  return { runner, done };
}

/**
 * Waits for a round to end.
 *
 * @param runner - The runner.
 * @returns The round.
 */
async function ended(runner: UpdateRunner): Promise<UpdateRound> {
  await vi.waitFor(() => {
    expect(runner.status()?.status).not.toBe('running');
  });

  const round = runner.status();

  if (round === null) {
    throw new Error('No round');
  }

  return round;
}

describe('UpdateRunner', () => {
  it('updates packages, then integrations, then Nebula Home, past a failure', async () => {
    const { runner, done } = runnerWith();

    runner.run(
      [
        { kind: 'core', version: '2026.11.0' },
        { kind: 'integration', id: 'shelly' },
        { kind: 'package', id: 'broken' },
        { kind: 'package', id: 'mqtt' },
      ],
      null,
    );

    const round = await ended(runner);

    expect(done).toEqual([
      'package broken',
      'package mqtt',
      'integration shelly',
      'core 2026.11.0',
    ]);
    expect(round.status).toBe('failed');
    expect(round.backup).toBe('off');
    expect(round.items.map((entry) => entry.status)).toEqual(['failed', 'done', 'done', 'done']);
    expect(round.items[0]?.error).toBe('no archive');
  });

  it('refuses a second round while one runs', () => {
    const { runner } = runnerWith();

    runner.run([{ kind: 'package', id: 'mqtt' }], null);

    expect(() => runner.run([{ kind: 'package', id: 'nvr' }], null)).toThrow(/already running/);
  });

  it('skips everything when the backup first fails', async () => {
    const { runner, done } = runnerWith({
      client: {
        request: vi.fn(async () => Promise.reject(new Error('backup is down'))),
      } as unknown as BusClient,
      readSettings: async () => Promise.resolve({ ...SETTINGS, backupFirst: true }),
    });

    runner.run([{ kind: 'package', id: 'mqtt' }], null);

    const round = await ended(runner);

    expect(done).toEqual([]);
    expect(round.backup).toBe('failed');
    expect(round.items[0]?.status).toBe('skipped');
  });
});
