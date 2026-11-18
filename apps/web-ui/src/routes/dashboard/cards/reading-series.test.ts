import { describe, expect, it } from 'vitest';

import type { TelemetryPoint } from '@nebulahome/contracts';

import {
  barsOf,
  changeInLastHour,
  HOUR_MS,
  priceLevels,
  summaryOf,
} from '@/routes/dashboard/cards/reading-series';

/** 14:30 on a Tuesday, local time. */
const NOW = new Date(2026, 10, 17, 14, 30).getTime();

/**
 * Hourly readings ending at NOW.
 *
 * @param values - Oldest first.
 * @returns The points.
 */
function hourly(values: readonly number[]): TelemetryPoint[] {
  return values.map((value, index) => ({
    time: new Date(NOW - (values.length - 1 - index) * HOUR_MS),
    value,
  }));
}

describe('changeInLastHour', () => {
  it('measures against the reading an hour ago', () => {
    expect(changeInLastHour(hourly([18, 20.8, 21]), 21.4, NOW)).toBeCloseTo(0.6);
  });

  it('says nothing without a reading old enough', () => {
    expect(changeInLastHour(hourly([21]), 21.4, NOW)).toBeNull();
    expect(changeInLastHour(hourly([20, 21]), undefined, NOW)).toBeNull();
  });
});

describe('summaryOf', () => {
  it('takes the rolled-up lows and highs when there are some', () => {
    expect(
      summaryOf([
        { time: new Date(NOW), value: 20, min: 18.6, max: 21 },
        { time: new Date(NOW), value: 21, min: 20, max: 21.8 },
      ]),
    ).toEqual({ min: 18.6, average: 20.5, max: 21.8 });
    expect(summaryOf([])).toBeNull();
  });
});

describe('barsOf', () => {
  it('ends on the running hour, one bar a clock hour', () => {
    const bars = barsOf(
      hourly([1, 2, 3, 4, 5, 6]),
      { from: NOW - 6 * HOUR_MS, to: NOW },
      'hour',
      false,
    );

    expect(bars).toHaveLength(6);
    expect(bars.at(-1)?.from).toBe(new Date(2026, 10, 17, 14).getTime());
    expect(bars.at(-1)?.value).toBe(6);
  });

  it('counts how much a total grew in each day, on the calendar', () => {
    const points = [
      { time: new Date(2026, 10, 16, 8), value: 100 },
      { time: new Date(2026, 10, 16, 20), value: 112.4 },
      { time: new Date(2026, 10, 17, 9), value: 113 },
      { time: new Date(2026, 10, 17, 14), value: 120 },
    ];
    const bars = barsOf(points, { from: NOW - 7 * 24 * HOUR_MS, to: NOW }, 'day', true);

    expect(bars).toHaveLength(7);
    expect(bars.at(-1)?.from).toBe(new Date(2026, 10, 17).getTime());
    expect(bars.at(-1)?.value).toBeCloseTo(7);
    expect(bars.at(-2)?.value).toBeCloseTo(12.4);
    expect(bars[0]?.value).toBeNull();
  });
});

describe('priceLevels', () => {
  it('marks what is a quarter under or over the average', () => {
    expect(priceLevels([0.07, 0.1, 0.13, 0.1, null])).toEqual(['low', null, 'high', null, null]);
  });
});
