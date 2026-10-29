import { beforeEach, describe, expect, it } from 'vitest';

import type { PlatformOperation } from '@nebulahome/contracts';

import { percentOf, stepsOf } from '@/system/platform-progress';
import { usePlatform } from '@/system/platform-store';

const STARTED = Date.parse('2026-11-14T03:00:00Z');

/**
 * An operation as the supervisor tells it.
 *
 * @param overrides - What differs.
 * @returns It.
 */
function operation(overrides: Partial<PlatformOperation> = {}): PlatformOperation {
  return {
    kind: 'update',
    phase: 'downloading',
    fromVersion: '2026.10.1',
    toVersion: '2026.11.0',
    percent: 40,
    backupBytes: 1_200_000_000,
    downloadBytes: 84_000_000,
    startedAt: new Date(STARTED),
    ...overrides,
  };
}

/**
 * The watch the store holds.
 *
 * @returns It.
 * @throws {Error} When nothing is watched.
 */
function watched() {
  const watch = usePlatform.getState().watch;

  if (watch === null) {
    throw new Error('Nothing is watched');
  }

  return watch;
}

describe('a restart', () => {
  beforeEach(() => {
    usePlatform.getState().dismiss();
  });

  it('times each step between the moments the page saw', () => {
    const { follow, reach } = usePlatform.getState();

    follow(
      operation({ kind: 'restart', phase: 'stopping', toVersion: null, percent: null }),
      STARTED + 400,
    );
    reach('away', STARTED + 1500);

    expect(stepsOf(watched()).map((step) => [step.id, step.status, step.ms])).toEqual([
      ['paused', 'done', 400],
      ['saved', 'done', 1100],
      ['starting', 'running', null],
      ['reconnecting', 'pending', null],
    ]);
    expect(percentOf(watched())).toBeNull();
  });

  it('is let go when the version still running gives it up, not once it has gone away', () => {
    const { follow, reach } = usePlatform.getState();
    const restart = operation({ kind: 'restart', phase: 'stopping', toVersion: null });

    follow(restart);
    reach('away');
    follow(null);

    expect(usePlatform.getState().watch?.stage).toBe('away');

    usePlatform.getState().dismiss();
    follow(restart);
    follow(null);

    expect(usePlatform.getState().watch).toBeNull();
  });
});

describe('an update', () => {
  beforeEach(() => {
    usePlatform.getState().dismiss();
  });

  it('fills the bar with the download, then a step at a time', () => {
    const { follow, reach } = usePlatform.getState();

    follow(operation());

    expect(percentOf(watched())).toBe(30);
    expect(stepsOf(watched()).map((step) => [step.id, step.status])).toEqual([
      ['backedUp', 'done'],
      ['downloaded', 'running'],
      ['installing', 'pending'],
      ['restarting', 'pending'],
      ['checking', 'pending'],
    ]);

    follow(operation({ phase: 'installing', percent: null }));
    reach('away');
    reach('back');

    expect(percentOf(watched())).toBe(80);
    expect(stepsOf(watched()).map((step) => step.status)).toEqual([
      'done',
      'done',
      'done',
      'running',
      'pending',
    ]);

    // The new version knows nothing of the sizes: they stay as the old one said them.
    follow(operation({ phase: 'checking', backupBytes: null, downloadBytes: null }));

    expect(watched().stage).toBe('checking');
    expect(stepsOf(watched())[1]?.bytes).toBe(84_000_000);
  });

  it('shows the backup running before the download', () => {
    const { follow } = usePlatform.getState();
    const backingUp = operation({ phase: 'backingUp', percent: null, downloadBytes: null });

    follow({ ...backingUp, backupBytes: null });

    expect(percentOf(watched())).toBe(5);
    expect(
      stepsOf(watched())
        .slice(0, 2)
        .map((step) => [step.id, step.status]),
    ).toEqual([
      ['backedUp', 'running'],
      ['downloaded', 'pending'],
    ]);

    follow(backingUp);

    expect(stepsOf(watched())[0]?.status).toBe('done');

    follow(operation({ percent: 0 }));

    expect(watched().stage).toBe('downloading');
    expect(percentOf(watched())).toBe(10);
  });

  it('lists the old version restored when it did not finish', () => {
    const { follow, fail } = usePlatform.getState();

    follow(operation({ backupBytes: null, phase: 'installing' }));
    fail({
      fromVersion: '2026.10.1',
      toVersion: '2026.11.0',
      status: 'rolled_back',
      finishedAt: new Date(STARTED + 120_000),
      error: 'The new version did not start: it is unhealthy',
      log: [],
      restoredInMs: 18_000,
    });

    expect(stepsOf(watched()).map((step) => [step.id, step.status, step.ms])).toEqual([
      ['downloaded', 'done', null],
      ['installing', 'failed', null],
      ['restored', 'done', 18_000],
    ]);
  });
});
