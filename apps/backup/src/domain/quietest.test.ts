/**
 * The quietest time of day, from days of processor load: the trough found, the day wrapping at
 * midnight, recent days counting more, the time in use kept unless another is clearly better, and
 * the fallback while there is not enough to go on.
 */
import { describe, expect, it } from 'vitest';

import type { DayOfWeek } from '@nebula-home/contracts';

import { quietestTime, slotOf, SLOTS_PER_DAY, type LoadCell } from './quietest.js';

const TODAY = '2026-09-27';

/**
 * Days of load, each shaped by a function of the quarter hour.
 *
 * @param count - How many days, ending yesterday.
 * @param shape - The load at a quarter hour, for a day so many days ago.
 * @returns The cells.
 */
function days(count: number, shape: (slot: number, daysAgo: number) => number): LoadCell[] {
  return Array.from({ length: count }, (nothing, index) => {
    const daysAgo = index + 1;
    const day = new Date(Date.parse(`${TODAY}T00:00:00Z`) - daysAgo * 86_400_000)
      .toISOString()
      .slice(0, 10);

    return Array.from({ length: SLOTS_PER_DAY }, (unused, slot) => ({
      day,
      slot,
      load: shape(slot, daysAgo),
    }));
  }).flat();
}

/**
 * A busy day with a quiet stretch.
 *
 * @param from - The first quiet quarter hour.
 * @param to - The last.
 * @returns The shape.
 */
function troughAt(from: number, to: number): (slot: number) => number {
  return (slot) => {
    const inside = from <= to ? slot >= from && slot <= to : slot >= from || slot <= to;

    return inside ? 5 : 40 + 10 * Math.sin(slot / 7);
  };
}

const BASE = {
  today: TODAY,
  weekdays: null,
  durationMinutes: 10,
  previousTime: null,
  fallbackTime: '03:00',
} as const;

describe('quietestTime', () => {
  it('finds the quiet stretch of the day', () => {
    const result = quietestTime({
      ...BASE,
      cells: days(14, troughAt(slotOf('04:00'), slotOf('05:00'))),
    });

    expect(result.state).toBe('ready');
    expect(slotOf(result.time)).toBeGreaterThanOrEqual(slotOf('04:00'));
    expect(slotOf(result.time)).toBeLessThanOrEqual(slotOf('04:45'));
    expect(result.meanLoadPercent).toBeLessThan(15);
    expect(result.profile).toHaveLength(SLOTS_PER_DAY);
  });

  it('finds it across midnight', () => {
    const result = quietestTime({
      ...BASE,
      cells: days(7, troughAt(slotOf('23:30'), slotOf('00:30'))),
    });
    const slot = slotOf(result.time);

    expect(slot >= slotOf('23:15') || slot <= slotOf('00:30')).toBe(true);
  });

  it('follows a change of habits: recent days count more', () => {
    const cells = days(21, (slot, daysAgo) =>
      daysAgo <= 5
        ? troughAt(slotOf('05:00'), slotOf('06:00'))(slot)
        : troughAt(slotOf('01:00'), slotOf('02:00'))(slot),
    );
    const result = quietestTime({ ...BASE, cells });

    expect(slotOf(result.time)).toBeGreaterThanOrEqual(slotOf('04:45'));
    expect(slotOf(result.time)).toBeLessThanOrEqual(slotOf('06:00'));
  });

  it('keeps the time in use unless another is clearly quieter', () => {
    // Two troughs almost as quiet: the one in use stays.
    const shape = (slot: number): number =>
      slot >= slotOf('02:00') && slot <= slotOf('03:00')
        ? 6
        : slot >= slotOf('04:00') && slot <= slotOf('05:00')
          ? 5
          : 40;
    const kept = quietestTime({ ...BASE, cells: days(7, shape), previousTime: '02:15' });

    expect(kept.time).toBe('02:15');

    // One far quieter: it wins.
    const busy = (slot: number): number =>
      slot >= slotOf('02:00') && slot <= slotOf('03:00') ? 30 : shape(slot);
    const moved = quietestTime({ ...BASE, cells: days(7, busy), previousTime: '02:15' });

    expect(slotOf(moved.time)).toBeGreaterThanOrEqual(slotOf('04:00'));
  });

  it('learns from the days backups run on when there are enough of them', () => {
    const cells = days(21, (slot, daysAgo) => {
      const weekday = new Date(Date.parse(`${TODAY}T12:00:00Z`) - daysAgo * 86_400_000).getUTCDay();

      return weekday === 0
        ? troughAt(slotOf('10:00'), slotOf('11:00'))(slot)
        : troughAt(slotOf('03:00'), slotOf('04:00'))(slot);
    });
    const sundays: DayOfWeek[] = ['sunday'];
    const result = quietestTime({ ...BASE, cells, weekdays: sundays });

    expect(slotOf(result.time)).toBeGreaterThanOrEqual(slotOf('09:45'));
    expect(slotOf(result.time)).toBeLessThanOrEqual(slotOf('11:00'));
  });

  it('uses the usual time on a day with no trough', () => {
    expect(quietestTime({ ...BASE, cells: days(7, () => 20) }).time).toBe('03:00');
  });

  it('says it is learning, and uses the usual time, until it has enough days', () => {
    const result = quietestTime({ ...BASE, cells: days(2, troughAt(10, 14)) });

    expect(result).toMatchObject({
      state: 'learning',
      time: '03:00',
      daysOfData: 2,
      daysNeeded: 3,
    });
  });

  it('does not count a day it barely measured', () => {
    const sparse = days(5, () => 30).filter((cell) => cell.slot % 4 === 0);

    expect(quietestTime({ ...BASE, cells: sparse }).state).toBe('learning');
  });
});
