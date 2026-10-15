/**
 * A cron schedule said in words, and when it next comes round on the house's clock - which is
 * what somebody checks the five fields against before saving.
 */
import { describe, expect, it } from 'vitest';

import { cronWords, nextCronRuns, shortMoment } from './cron-words';

describe('cronWords', () => {
  it('says a schedule in words, on a 24-hour clock', () => {
    expect(cronWords('0 7 * * 1-5')).toBe('At 07:00, Monday through Friday');
    expect(cronWords('*/15 * * * *')).toBe('Every 15 minutes');
    expect(cronWords('30 0 7 * * *')).toBe('At 07:00:30');
  });

  it('says nothing for what is not a schedule', () => {
    expect(cronWords('')).toBeNull();
    expect(cronWords('every morning')).toBeNull();
  });
});

describe('nextCronRuns', () => {
  it('counts the next runs in the house’s zone, not the browser’s', () => {
    const after = new Date('2026-10-15T00:00:00Z');
    const runs = nextCronRuns('0 7 * * *', 'Europe/Rome', 2, after);

    // 07:00 in Rome in October is 05:00 UTC.
    expect(runs?.map((run) => run.toISOString())).toEqual([
      '2026-10-15T05:00:00.000Z',
      '2026-10-16T05:00:00.000Z',
    ]);
    expect(runs?.[0] && shortMoment(runs[0], 'Europe/Rome')).toBe('Thu 07:00');
  });

  it('gives nothing for a schedule it cannot read', () => {
    expect(nextCronRuns('61 * * * *', 'Europe/Rome', 1)).toBeNull();
  });
});
