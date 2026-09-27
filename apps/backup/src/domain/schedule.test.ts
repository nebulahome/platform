/**
 * The settings as a cron pattern, and whether a missed backup is still owed.
 */
import { Cron } from 'croner';
import { describe, expect, it } from 'vitest';

import { cronPatternFor, isBackupOwed } from './schedule.js';

describe('cronPatternFor', () => {
  it('runs every day at the time', () => {
    expect(cronPatternFor({ mode: 'daily' }, '03:05')).toBe('5 3 * * *');
  });

  it('runs one day a week', () => {
    expect(cronPatternFor({ mode: 'weekly', day: 'sunday' }, '23:30')).toBe('30 23 * * 0');
  });

  it('runs on the days picked, in order', () => {
    expect(cronPatternFor({ mode: 'custom', days: ['friday', 'monday'] }, '00:00')).toBe(
      '0 0 * * 1,5',
    );
  });

  it('comes round at the time in the schedule’s zone, summer time or not', () => {
    const job = new Cron(cronPatternFor({ mode: 'daily' }, '03:00'), {
      timezone: 'Europe/Rome',
      paused: true,
    });
    // The night summer time ends in Rome: 03:00 happens twice, at 01:00 and 02:00 UTC.
    const next = job.nextRun(new Date('2026-10-24T12:00:00Z'));

    job.stop();
    expect(next?.toISOString()).toMatch(/^2026-10-25T0[12]:00:00/u);
  });
});

describe('isBackupOwed', () => {
  const occurrence = new Date('2026-09-27T01:00:00Z');

  it('is owed when nothing started since the schedule came round', () => {
    expect(isBackupOwed(occurrence, new Date('2026-09-26T01:00:00Z'))).toBe(true);
    expect(isBackupOwed(occurrence, null)).toBe(true);
  });

  it('is not owed once one started, or before the schedule ever came round', () => {
    expect(isBackupOwed(occurrence, new Date('2026-09-27T01:00:05Z'))).toBe(false);
    expect(isBackupOwed(null, null)).toBe(false);
  });
});
