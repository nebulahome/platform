import { describe, expect, it } from 'vitest';

import type { BackupRunView } from '@nebula-home/contracts';

import { endingOf, stepStates } from './progress';

describe('stepStates', () => {
  it('lights the step of the phase, the ones before it done', () => {
    expect(stepStates('preparing', null)).toEqual(['current', 'waiting', 'waiting', 'waiting']);
    expect(stepStates('dumping', null)).toEqual(['done', 'current', 'waiting', 'waiting']);
    expect(stepStates('packing', null)).toEqual(['done', 'done', 'current', 'waiting']);
    expect(stepStates('pruning', null)).toEqual(['done', 'done', 'done', 'current']);
  });

  it('marks every step done once it succeeded, and the one it stopped at once it failed', () => {
    expect(stepStates(null, 'success')).toEqual(['done', 'done', 'done', 'done']);
    expect(stepStates('packing', 'failure')).toEqual(['done', 'done', 'failed', 'waiting']);
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
