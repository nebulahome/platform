/**
 * The quietest time of day, from days of the house's activity: the window centred in the longest
 * quiet stretch, the stretch wrapping at midnight, the time in use kept while it fits, and the
 * fallback while there is not enough to go on or nothing to tell the hours apart.
 */
import { describe, expect, it } from 'vitest';

import {
  longestQuietStretch,
  quietestTime,
  slotOf,
  SLOTS_PER_DAY,
  type ActivityCell,
} from './quietest.js';

const TODAY = '2026-09-27';

/**
 * Days of activity, each shaped by a function of the quarter hour.
 *
 * @param count - How many days, ending yesterday.
 * @param shape - The activity at a quarter hour.
 * @returns The cells.
 */
function days(count: number, shape: (slot: number) => number): ActivityCell[] {
  return Array.from({ length: count }, (nothing, index) => {
    const day = new Date(Date.parse(`${TODAY}T00:00:00Z`) - (index + 1) * 86_400_000)
      .toISOString()
      .slice(0, 10);

    return Array.from({ length: SLOTS_PER_DAY }, (unused, slot) => ({
      day,
      slot,
      activity: shape(slot),
    }));
  }).flat();
}

/**
 * A day asleep between two times, busy otherwise.
 *
 * @param from - When the house falls asleep, `HH:MM`.
 * @param to - When it wakes, `HH:MM`.
 * @returns The activity at a quarter hour.
 */
function asleep(from: string, to: string): (slot: number) => number {
  const start = slotOf(from);
  const end = slotOf(to);

  return (slot) =>
    (start < end ? slot >= start && slot < end : slot >= start || slot < end) ? 0 : 6;
}

describe('quietestTime', () => {
  it('centres the window in the night', () => {
    const quiet = quietestTime({
      cells: days(7, asleep('01:00', '06:00')),
      today: TODAY,
      durationMinutes: 60,
      previousTime: null,
      fallbackTime: '03:00',
    });

    expect(quiet.state).toBe('ready');
    // The smoothing eats a quarter hour at each edge; the window stays in the middle.
    expect(slotOf(quiet.time)).toBeGreaterThanOrEqual(slotOf('02:45'));
    expect(slotOf(quiet.time)).toBeLessThanOrEqual(slotOf('03:15'));
    expect(quiet.quietFrom).not.toBeNull();
  });

  it('reads a night across midnight whole', () => {
    const quiet = quietestTime({
      cells: days(7, asleep('22:00', '04:00')),
      today: TODAY,
      durationMinutes: 60,
      previousTime: null,
      fallbackTime: '03:00',
    });

    expect(slotOf(quiet.time)).toBeGreaterThanOrEqual(slotOf('00:15'));
    expect(slotOf(quiet.time)).toBeLessThanOrEqual(slotOf('00:45'));
  });

  it('keeps the time in use while its window lies inside the night', () => {
    const quiet = quietestTime({
      cells: days(7, asleep('01:00', '06:00')),
      today: TODAY,
      durationMinutes: 60,
      previousTime: '02:00',
      fallbackTime: '03:00',
    });

    expect(quiet.time).toBe('02:00');
  });

  it('moves a time in use that no longer fits', () => {
    const quiet = quietestTime({
      cells: days(7, asleep('01:00', '06:00')),
      today: TODAY,
      durationMinutes: 60,
      previousTime: '22:00',
      fallbackTime: '03:00',
    });

    expect(quiet.time).not.toBe('22:00');
  });

  it('learns for three days, then keeps the usual time on a day without activity', () => {
    const learning = quietestTime({
      cells: days(2, asleep('01:00', '06:00')),
      today: TODAY,
      durationMinutes: 60,
      previousTime: null,
      fallbackTime: '03:00',
    });
    const flat = quietestTime({
      cells: days(5, () => 0),
      today: TODAY,
      durationMinutes: 60,
      previousTime: null,
      fallbackTime: '03:00',
    });

    expect(learning).toMatchObject({ state: 'learning', time: '03:00', daysOfData: 2 });
    expect(flat).toMatchObject({ state: 'ready', time: '03:00', quietFrom: null });
  });
});

describe('longestQuietStretch', () => {
  it('finds the longest run, going round midnight', () => {
    const quiet = Array.from({ length: SLOTS_PER_DAY }, (nothing, slot) => slot < 8 || slot >= 90);

    expect(longestQuietStretch(quiet)).toEqual({ start: 90, length: 14 });
  });

  it('has none when every quarter hour is alike', () => {
    expect(longestQuietStretch(Array.from({ length: SLOTS_PER_DAY }, () => true))).toBeNull();
    expect(longestQuietStretch(Array.from({ length: SLOTS_PER_DAY }, () => false))).toBeNull();
  });
});
