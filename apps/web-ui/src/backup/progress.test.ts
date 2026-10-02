import { describe, expect, it } from 'vitest';

import type { BackupRunView } from '@nebulahome/contracts';

import { endingOf, progressOf } from './progress';

describe('progressOf', () => {
  const noBytes = { done: 0, total: null };

  it('fills the bar to the start of the phase’s step, and marks where that step ends', () => {
    expect(progressOf('preparing', null, noBytes)).toEqual({
      step: 'prepare',
      index: 0,
      percent: 0,
      stepEnd: 25,
    });
    expect(progressOf('dumping', null, noBytes)).toMatchObject({ step: 'database', percent: 25 });
    expect(progressOf('packing', null, noBytes)).toMatchObject({ step: 'files', percent: 50 });
  });

  it('moves along the copy as the archive is written', () => {
    expect(progressOf('uploading', null, { done: 50, total: 100 })).toMatchObject({
      step: 'copy',
      percent: 88,
      stepEnd: 100,
    });
    expect(progressOf('uploading', null, noBytes).percent).toBe(75);
    expect(progressOf('pruning', null, noBytes).percent).toBe(98);
  });

  it('fills the bar once it succeeded, and stops where it failed', () => {
    expect(progressOf('pruning', 'success', noBytes)).toMatchObject({ percent: 100 });
    expect(progressOf('packing', 'failure', noBytes)).toMatchObject({
      step: 'files',
      percent: 50,
      stepEnd: 75,
    });
  });
});

describe('endingOf', () => {
  const run = {
    id: '00000000-0000-4000-8000-000000000001',
    status: 'failure',
    error: null,
    destinations: [{ name: 'NAS', error: 'The share refused the password' }],
  } as unknown as BackupRunView;

  it('says how a run ended, with why when a location refused it', () => {
    expect(endingOf([run], run.id)).toEqual({
      status: 'failure',
      error: 'NAS: The share refused the password',
    });
  });

  it('says nothing while the runs still have it running, or do not have it yet', () => {
    expect(endingOf([{ ...run, status: 'running' }], run.id)).toBe(null);
    expect(endingOf([], run.id)).toBe(null);
  });
});
