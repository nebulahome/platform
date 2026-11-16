import { describe, expect, it } from 'vitest';

import { clockOf, momentOf, untilClock, wallOf } from '@/library/time-values';

const ROME = 'Europe/Rome';

describe('the values of the time domain', () => {
  it('writes seconds since midnight as a time of day, round the clock', () => {
    expect(clockOf(27_000, false)).toBe('07:30');
    expect(clockOf(27_005, true)).toBe('07:30:05');
    expect(clockOf(86_400 + 60, false)).toBe('00:01');
    expect(clockOf(-60, false)).toBe('23:59');
  });

  it("reads a zone's wall clock at an instant", () => {
    expect(wallOf(Date.parse('2026-11-24T06:30:00Z'), ROME)).toEqual({
      day: '2026-11-24',
      seconds: 27_000,
    });
  });

  it('writes a moment picked on a wall clock with that clock’s offset', () => {
    expect(momentOf('2026-11-24', 27_000, ROME)).toBe('2026-11-24T07:30:00+01:00');
    expect(momentOf('2026-07-01', 27_000, ROME)).toBe('2026-07-01T07:30:00+02:00');
    expect(momentOf('2026-07-01', 27_000, 'America/New_York')).toBe('2026-07-01T07:30:00-04:00');
  });

  it('moves a time the clocks skip on by the gap, and takes the first of one they repeat', () => {
    // 29 March 2026, 02:00 → 03:00 in Rome: 02:30 never happens.
    expect(momentOf('2026-03-29', 9000, ROME)).toBe('2026-03-29T03:30:00+02:00');
    // 25 October 2026, 03:00 → 02:00: 02:30 happens twice, first at +02:00.
    expect(momentOf('2026-10-25', 9000, ROME)).toBe('2026-10-25T02:30:00+02:00');
  });

  it('counts until a time of day next comes round', () => {
    const now = Date.parse('2026-11-24T06:00:00Z'); // 07:00 in Rome

    expect(untilClock('07:30', now, ROME)).toBe(30 * 60_000);
    expect(untilClock('06:30', now, ROME)).toBe(23.5 * 3_600_000);
  });
});
