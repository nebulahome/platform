import { describe, expect, it } from 'vitest';

import { isInWindow, secondsOfClock, zonedParts } from './house-time.js';

describe('zonedParts', () => {
  it("reads an instant on the house's clock, not the machine's", () => {
    // 21:30 UTC on a Friday is 23:30 in Rome in summer time.
    const parts = zonedParts(new Date('2026-07-10T21:30:15Z'), 'Europe/Rome');

    expect(parts).toEqual({
      year: 2026,
      month: 7,
      day: 10,
      weekday: 'friday',
      secondsOfDay: 23 * 3_600 + 30 * 60 + 15,
    });
  });

  it('moves the day with the zone', () => {
    expect(zonedParts(new Date('2026-07-10T23:30:00Z'), 'Europe/Rome').weekday).toBe('saturday');
    expect(zonedParts(new Date('2026-07-10T23:30:00Z'), 'America/New_York').weekday).toBe('friday');
  });

  it('reads midnight as the start of the day', () => {
    expect(zonedParts(new Date('2026-01-01T00:00:00Z'), 'UTC').secondsOfDay).toBe(0);
  });
});

describe('isInWindow', () => {
  it('includes the start and leaves out the end', () => {
    expect(isInWindow(secondsOfClock('16:00'), '16:00', '23:30')).toBe(true);
    expect(isInWindow(secondsOfClock('23:30'), '16:00', '23:30')).toBe(false);
  });

  it('wraps past midnight when the window ends before it starts', () => {
    expect(isInWindow(secondsOfClock('23:00'), '22:00', '06:30')).toBe(true);
    expect(isInWindow(secondsOfClock('03:00'), '22:00', '06:30')).toBe(true);
    expect(isInWindow(secondsOfClock('12:00'), '22:00', '06:30')).toBe(false);
  });

  it('is empty when it starts where it ends', () => {
    expect(isInWindow(secondsOfClock('10:00'), '10:00', '10:00')).toBe(false);
  });

  it('reads seconds when a time has them', () => {
    expect(secondsOfClock('07:00:30')).toBe(7 * 3_600 + 30);
  });
});
