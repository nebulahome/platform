import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BusClient } from '@nebulahome/bus';
import type { QuietTime, UpdateRound } from '@nebulahome/contracts';
import type { Database } from '@nebulahome/db';
import type { PlatformLogger } from '@nebulahome/logging';

import type { UpdateSettings } from '../persistence/update-settings.js';
import { scratch } from '../testing/fixtures.js';

import { UpdateRunner, type UpdateRunnerOptions } from './update-runner.js';

const SETTINGS: UpdateSettings = {
  auto: { package: false, integration: false },
  window: {
    package: { mode: 'fixed', time: '03:00' },
    integration: { mode: 'fixed', time: '03:00' },
  },
  backupFirst: { core: false, package: false, integration: false },
  backupSections: ['configuration'],
  timezone: 'UTC',
};

/** Packages updating by themselves at 03:00, UTC. */
const AUTO_PACKAGES: UpdateSettings = { ...SETTINGS, auto: { package: true, integration: false } };

const RUN_ID = '00000000-0000-4000-8000-0000000000b1';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as PlatformLogger;
const runners: UpdateRunner[] = [];
const folders: string[] = [];

afterEach(async () => {
  for (const runner of runners.splice(0)) {
    runner.stop();
  }

  await Promise.all(folders.splice(0).map(async (folder) => rm(folder, { recursive: true })));
});

/** What the backup service answers, in a test. */
type BackupFake = {
  /** What `status` answers. */
  readonly status?: unknown;

  /** How the run asked for ends, announced right after it is asked; none when not said. */
  readonly ends?: string;
};

/**
 * A runner over fakes, recording what it updated and asked in order.
 *
 * @param overrides - What differs.
 * @param backup - What the backup service answers.
 * @returns The runner, the order, the requests, and a clock to move.
 */
function runnerWith(
  overrides: Partial<UpdateRunnerOptions> = {},
  backup: BackupFake = {},
): {
  runner: UpdateRunner;
  done: string[];
  asked: { subject: string; payload: unknown }[];
  clock: { at: Date };
} {
  const done: string[] = [];
  const asked: { subject: string; payload: unknown }[] = [];
  const clock = { at: new Date('2026-11-06T12:00:00Z') };
  const listeners: ((event: unknown) => Promise<void>)[] = [];
  const client = {
    request: vi.fn(async (subject: string, payload: { version: string }) => {
      asked.push({ subject, payload });

      if (subject.endsWith('update_platform')) {
        done.push(`core ${payload.version}`);
      }

      if (subject.endsWith('backup.status')) {
        return Promise.resolve(backup.status ?? { lastBackup: null, active: null });
      }

      if (subject.endsWith('backup.run')) {
        if (backup.ends !== undefined) {
          const ended = { runId: RUN_ID, kind: 'backup', status: backup.ends };

          setTimeout(() => {
            for (const listener of listeners) {
              void listener(ended);
            }
          }, 5);
        }

        return Promise.resolve({ runId: RUN_ID });
      }

      return Promise.resolve({ ok: true });
    }),
    subscribe: vi.fn((...[, , handler]: [string, unknown, () => Promise<void>]) => {
      listeners.push(handler);

      return { unsubscribe: () => listeners.splice(listeners.indexOf(handler), 1) };
    }),
  };
  const runner = new UpdateRunner({
    client: client as unknown as BusClient,
    db: undefined as unknown as Database,
    packages: {
      update: vi.fn(async (id: string) => {
        done.push(`package ${id}`);

        return id === 'broken' ? Promise.reject(new Error('no archive')) : Promise.resolve({});
      }),
      available: vi.fn(async () =>
        Promise.resolve({
          items: [{ id: 'mqtt', hasUpdate: true }],
          checkedAt: null,
          error: null,
        }),
      ),
    } as unknown as UpdateRunnerOptions['packages'],
    integrations: {
      install: vi.fn(async (id: string) => {
        done.push(`integration ${id}`);

        return Promise.resolve({});
      }),
      available: vi.fn(async () =>
        Promise.resolve({ items: [{ vendorId: 'shelly', hasUpdate: true }], error: null }),
      ),
    } as unknown as UpdateRunnerOptions['integrations'],
    logger,
    now: () => clock.at,
    readSettings: async () => Promise.resolve(SETTINGS),
    readQuietTime: async () => Promise.resolve(null),
    ...overrides,
  });

  runners.push(runner);

  return { runner, done, asked, clock };
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

/**
 * Ticks the clock at a time, and lets what it started run.
 *
 * @param runner - The runner.
 * @param clock - Its clock.
 * @param clock.at - The time it says, moved to the one given.
 * @param iso - The time.
 */
async function tickAt(runner: UpdateRunner, clock: { at: Date }, iso: string): Promise<void> {
  clock.at = new Date(iso);
  runner.tick();
  await new Promise((resolve) => {
    setTimeout(resolve, 10);
  });
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

  it('reads each index again once a round, for its first item of the kind', async () => {
    const update = vi.fn(async () => Promise.resolve({}));
    const install = vi.fn(async () => Promise.resolve({}));
    const { runner: counted } = runnerWith({
      packages: { update, available: vi.fn() } as unknown as UpdateRunnerOptions['packages'],
      integrations: {
        install,
        available: vi.fn(),
      } as unknown as UpdateRunnerOptions['integrations'],
    });

    counted.run(
      [
        { kind: 'package', id: 'mqtt' },
        { kind: 'package', id: 'nvr' },
        { kind: 'integration', id: 'shelly' },
        { kind: 'integration', id: 'sonoff' },
      ],
      null,
    );
    await ended(counted);

    expect(update.mock.calls).toEqual([
      ['mqtt', true],
      ['nvr', false],
    ]);
    expect(install.mock.calls).toEqual([
      ['shelly', undefined, undefined, true],
      ['sonoff', undefined, undefined, false],
    ]);
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
      readSettings: async () =>
        Promise.resolve({
          ...SETTINGS,
          backupFirst: { core: false, package: true, integration: false },
        }),
    });

    runner.run([{ kind: 'package', id: 'mqtt' }], null);

    const round = await ended(runner);

    expect(done).toEqual([]);
    expect(round.backup).toBe('failed');
    expect(round.items[0]?.status).toBe('skipped');
  });

  it('backs up only when a kind in the round asks to', async () => {
    const { runner, done } = runnerWith({
      readSettings: async () =>
        Promise.resolve({
          ...SETTINGS,
          backupFirst: { core: false, package: true, integration: false },
        }),
    });

    runner.run([{ kind: 'integration', id: 'shelly' }], null);

    const round = await ended(runner);

    expect(round.backup).toBe('off');
    expect(done).toEqual(['integration shelly']);
  });

  it('updates after a backup some locations did not take: its archive was made', async () => {
    const { runner, done } = runnerWith(
      {
        readSettings: async () =>
          Promise.resolve({
            ...SETTINGS,
            backupFirst: { core: false, package: true, integration: false },
          }),
      },
      { ends: 'partial' },
    );

    runner.run([{ kind: 'package', id: 'mqtt' }], null);

    const round = await ended(runner);

    expect(round.backup).toBe('taken');
    expect(done).toEqual(['package mqtt']);
  });

  it('does not update a house being restored', async () => {
    const { runner, done, asked } = runnerWith(
      {
        readSettings: async () =>
          Promise.resolve({
            ...SETTINGS,
            backupFirst: { core: false, package: true, integration: false },
          }),
      },
      { status: { lastBackup: null, active: { runId: RUN_ID, kind: 'restore' } } },
    );

    runner.run([{ kind: 'package', id: 'mqtt' }], null);

    const round = await ended(runner);

    expect(round.backup).toBe('failed');
    expect(done).toEqual([]);
    expect(asked.some((each) => each.subject.endsWith('backup.run'))).toBe(false);
  });

  it('says why when the round stops before an item', async () => {
    const { runner } = runnerWith({
      readSettings: async () => Promise.reject(new Error('the database is gone')),
    });

    runner.run([{ kind: 'package', id: 'mqtt' }], null);

    const round = await ended(runner);

    expect(round.items[0]).toMatchObject({
      status: 'skipped',
      error: 'The round stopped: the database is gone',
    });
  });

  it('takes back, as it starts, an update of Nebula Home a round cut short left announced', async () => {
    const { runner, asked } = runnerWith();

    await runner.start();

    expect(asked[0]?.subject).toContain('announce_platform_update');
    expect(asked[0]?.payload).toEqual({ version: null, backupBytes: null });
  });
});

describe('UpdateRunner, by itself', () => {
  it('runs a kind at its time, once a day', async () => {
    const { runner, done, clock } = runnerWith({
      readSettings: async () => Promise.resolve(AUTO_PACKAGES),
    });

    clock.at = new Date('2026-11-06T01:00:00Z');
    await runner.start();
    await tickAt(runner, clock, '2026-11-06T02:59:00Z');
    expect(done).toEqual([]);

    await tickAt(runner, clock, '2026-11-06T03:00:00Z');
    await ended(runner);
    await tickAt(runner, clock, '2026-11-06T03:01:00Z');
    expect(done).toEqual(['package mqtt']);
  });

  it('runs a window the change to summer time skips, and one it repeats once', async () => {
    const { runner, done, clock } = runnerWith({
      readSettings: async () =>
        Promise.resolve({
          ...AUTO_PACKAGES,
          window: { ...AUTO_PACKAGES.window, package: { mode: 'fixed', time: '02:30' } },
          timezone: 'Europe/Rome',
        }),
    });

    // 29 March 2026: 02:00 in Rome is 03:00, and 02:30 never comes.
    clock.at = new Date('2026-03-28T23:30:00Z');
    await runner.start();
    await tickAt(runner, clock, '2026-03-29T00:59:00Z');
    expect(done).toEqual([]);
    await tickAt(runner, clock, '2026-03-29T01:00:00Z');
    await ended(runner);
    expect(done).toEqual(['package mqtt']);

    // 25 October 2026: 03:00 in Rome is 02:00 again, and 02:30 comes twice.
    clock.at = new Date('2026-10-24T22:30:00Z');
    await runner.reload();
    await tickAt(runner, clock, '2026-10-25T00:30:00Z');
    await ended(runner);
    await tickAt(runner, clock, '2026-10-25T01:30:00Z');
    expect(done).toEqual(['package mqtt', 'package mqtt']);
  });

  it('runs a kind whose time came while a round ran, once it ends', async () => {
    let finish: () => void = () => undefined;
    const update = vi.fn(
      async () =>
        new Promise((resolve) => {
          finish = () => {
            resolve({});
          };
        }),
    );
    const install = vi.fn(async () => Promise.resolve({}));
    const { runner, clock } = runnerWith({
      readSettings: async () =>
        Promise.resolve({
          ...SETTINGS,
          auto: { package: true, integration: true },
          window: {
            package: { mode: 'fixed', time: '03:00' },
            integration: { mode: 'fixed', time: '03:01' },
          },
        }),
      packages: {
        update,
        available: vi.fn(async () =>
          Promise.resolve({ items: [{ id: 'mqtt', hasUpdate: true }], error: null }),
        ),
      } as unknown as UpdateRunnerOptions['packages'],
      integrations: {
        install,
        available: vi.fn(async () =>
          Promise.resolve({ items: [{ vendorId: 'shelly', hasUpdate: true }], error: null }),
        ),
      } as unknown as UpdateRunnerOptions['integrations'],
    });

    clock.at = new Date('2026-11-06T01:00:00Z');
    await runner.start();
    await tickAt(runner, clock, '2026-11-06T03:00:00Z');
    await tickAt(runner, clock, '2026-11-06T03:01:00Z');
    expect(update).toHaveBeenCalledTimes(1);
    expect(install).not.toHaveBeenCalled();

    finish();
    await vi.waitFor(() => {
      expect(install).toHaveBeenCalledTimes(1);
    });
    expect(runner.status()?.items.map((entry) => entry.item)).toEqual([
      { kind: 'integration', id: 'shelly' },
    ]);
  });

  it('lets a window already behind wait for tomorrow, but not one a new day moved behind', async () => {
    let quiet = '00:30';
    const readQuiet = vi.fn(async () =>
      Promise.resolve({ time: quiet, timezone: 'UTC' } as unknown as QuietTime),
    );
    const { runner, done, clock } = runnerWith({
      readSettings: async () =>
        Promise.resolve({
          ...AUTO_PACKAGES,
          window: { ...AUTO_PACKAGES.window, package: { mode: 'quietest', time: '03:00' } },
        }),
      readQuietTime: readQuiet,
    });

    // Turned on in the afternoon: today's 00:30 is behind, and waits for tomorrow.
    clock.at = new Date('2026-11-06T15:00:00Z');
    await runner.start();
    await tickAt(runner, clock, '2026-11-06T15:01:00Z');
    expect(done).toEqual([]);

    // Just after midnight core learned 00:05: before the new plan, still run that day.
    quiet = '00:05';
    await tickAt(runner, clock, '2026-11-07T00:10:00Z');
    expect(readQuiet).toHaveBeenCalledTimes(2);
    await tickAt(runner, clock, '2026-11-07T00:11:00Z');
    await ended(runner);
    expect(done).toEqual(['package mqtt']);
  });

  it('keeps its plan when the settings cannot be read', async () => {
    let isDown = false;
    const { runner, done, clock } = runnerWith({
      readSettings: async () =>
        isDown ? Promise.reject(new Error('the database is gone')) : Promise.resolve(AUTO_PACKAGES),
    });

    clock.at = new Date('2026-11-06T01:00:00Z');
    await runner.start();
    isDown = true;
    await expect(runner.reload()).rejects.toThrow('the database is gone');
    isDown = false;
    await tickAt(runner, clock, '2026-11-06T03:00:00Z');
    await ended(runner);
    expect(done).toEqual(['package mqtt']);
  });

  it('plans by the settings read last when two reloads overlap', async () => {
    let calls = 0;
    const { runner, done, clock } = runnerWith({
      readSettings: async () => {
        calls += 1;

        // The first reload reads slowly: side by side with the second, its plan would land last.
        const time = calls === 2 ? '04:00' : '05:00';
        const read: UpdateSettings = {
          ...AUTO_PACKAGES,
          window: { ...AUTO_PACKAGES.window, package: { mode: 'fixed', time } },
        };

        return new Promise((resolve) => {
          setTimeout(
            () => {
              resolve(read);
            },
            calls === 2 ? 30 : 1,
          );
        });
      },
    });

    clock.at = new Date('2026-11-06T01:00:00Z');
    await runner.start();
    await Promise.all([runner.reload(), runner.reload()]);
    await tickAt(runner, clock, '2026-11-06T04:00:00Z');
    expect(done).toEqual([]);
    await tickAt(runner, clock, '2026-11-06T05:00:00Z');
    await ended(runner);
    expect(done).toEqual(['package mqtt']);
  });

  it('makes up, as it starts, a run its window missed while it was down', async () => {
    const work = await scratch();

    folders.push(work);

    const runsFile = path.join(work, 'runs.json');
    const settings = { readSettings: async () => Promise.resolve(AUTO_PACKAGES), runsFile };

    // Never ran here: nothing to make up.
    const fresh = runnerWith(settings);

    fresh.clock.at = new Date('2026-11-06T15:00:00Z');
    await fresh.runner.start();
    await tickAt(fresh.runner, fresh.clock, '2026-11-06T15:01:00Z');
    expect(fresh.done).toEqual([]);

    // Ran yesterday, down at today's 03:00.
    await writeFile(runsFile, JSON.stringify({ package: '2026-11-05' }));

    const missed = runnerWith(settings);

    missed.clock.at = new Date('2026-11-06T15:00:00Z');
    await missed.runner.start();
    await tickAt(missed.runner, missed.clock, '2026-11-06T15:01:00Z');
    await ended(missed.runner);
    expect(missed.done).toEqual(['package mqtt']);
    expect(JSON.parse(await readFile(runsFile, 'utf8'))).toEqual({ package: '2026-11-06' });

    // Ran today already.
    const again = runnerWith(settings);

    again.clock.at = new Date('2026-11-06T16:00:00Z');
    await again.runner.start();
    await tickAt(again.runner, again.clock, '2026-11-06T16:01:00Z');
    expect(again.done).toEqual([]);
  });
});
