/**
 * What a retention comes to: how many archives, how far back, how much room.
 */
import { describe, expect, it } from 'vitest';

import { archivesKept, daysCovered, retentionSummary, runsPerWeek } from './estimates';

describe('the retention estimates', () => {
  it('counts the backups a week takes', () => {
    expect(runsPerWeek({ mode: 'daily' })).toBe(7);
    expect(runsPerWeek({ mode: 'weekly', day: 'sunday' })).toBe(1);
    expect(runsPerWeek({ mode: 'custom', days: ['monday', 'thursday'] })).toBe(2);
  });

  it('keeps the count asked for, and reaches back by the schedule', () => {
    const retention = { mode: 'count', value: 4 } as const;

    expect(archivesKept(retention, { mode: 'weekly', day: 'sunday' })).toBe(4);
    expect(daysCovered(retention, { mode: 'weekly', day: 'sunday' })).toBe(28);
  });

  it('keeps as many as the days hold', () => {
    const retention = { mode: 'days', value: 14 } as const;

    expect(archivesKept(retention, { mode: 'daily' })).toBe(14);
    expect(archivesKept(retention, { mode: 'custom', days: ['monday', 'friday'] })).toBe(4);
    expect(archivesKept({ mode: 'days', value: 1 }, { mode: 'weekly', day: 'monday' })).toBe(1);
  });

  it('says it in a line, with the room it takes', () => {
    expect(retentionSummary({ mode: 'count', value: 7 }, { mode: 'daily' }, 300_000_000)).toBe(
      '≈ 7 backups, a week back, ≈ 2.1 GB',
    );
    expect(retentionSummary({ mode: 'days', value: 1 }, { mode: 'daily' }, null)).toBe(
      '≈ 1 backup, a day back',
    );
  });
});
