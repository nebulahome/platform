/**
 * A sensor's past as the reading cards sum it up: how far it moved in the last hour, its lowest,
 * average and highest, and one bar an hour or a day for the bar chart - with, for a price, which
 * hours are cheap and which are dear.
 *
 * Pure arithmetic on what `useTelemetry` read, so the cards stay drawings and this stays tested.
 */
import type { TelemetryPoint } from '@nebulahome/contracts';

import type { TimeWindow } from '@/library/history-series';

/** An hour, in milliseconds. */
export const HOUR_MS = 3_600_000;

/**
 * How far a reading has moved in the last hour.
 *
 * @param points - The readings, oldest first.
 * @param value - The reading now.
 * @param now - The present, in milliseconds since the epoch.
 * @returns The change, or null when nothing was read at least half an hour ago.
 */
export function changeInLastHour(
  points: readonly TelemetryPoint[],
  value: number | undefined,
  now: number,
): number | null {
  // The last reading an hour ago or before; a window of one hour starts with the nearest one.
  const then =
    points.findLast((point) => point.time.getTime() <= now - HOUR_MS) ??
    points.find((point) => point.time.getTime() >= now - HOUR_MS);

  return value === undefined || then === undefined || then.time.getTime() > now - HOUR_MS / 2
    ? null
    : value - then.value;
}

/** The lowest, the average and the highest of a window. */
export type ReadingSummary = {
  readonly min: number;
  readonly average: number;
  readonly max: number;
};

/**
 * The lowest, the average and the highest reading of a window.
 *
 * @param points - The readings, raw or rolled up.
 * @returns The three, or null for a window without readings.
 */
export function summaryOf(points: readonly TelemetryPoint[]): ReadingSummary | null {
  if (points.length === 0) {
    return null;
  }

  return {
    min: Math.min(...points.map((point) => point.min ?? point.value)),
    average: points.reduce((sum, point) => sum + point.value, 0) / points.length,
    max: Math.max(...points.map((point) => point.max ?? point.value)),
  };
}

/** One bar of the bar chart. */
export type ReadingBar = {
  /** When its hour or day began, in milliseconds since the epoch. */
  readonly from: number;

  /** What it stands for: the average, or how much a total grew; null with nothing read. */
  readonly value: number | null;
};

/**
 * Cuts a window into bars: one a clock hour, or one a calendar day, the last one the hour or the
 * day that is running now.
 *
 * @param points - The readings, oldest first.
 * @param window - The window they were read over.
 * @param unit - An hour or a day a bar.
 * @param isTotal - Whether the reading is a total that only grows: a bar is then how much it
 *   grew, as on the entity's own page, rather than its average.
 * @returns The bars, oldest first.
 */
export function barsOf(
  points: readonly TelemetryPoint[],
  window: TimeWindow,
  unit: 'hour' | 'day',
  isTotal: boolean,
): ReadingBar[] {
  const current = new Date(window.to);

  current.setMinutes(0, 0, 0);

  if (unit === 'day') {
    current.setHours(0);
  }

  /**
   * When a bar began. A day is counted on the calendar, so a change of clocks does not shift it.
   *
   * @param back - How many hours or days before the running one.
   * @returns Its start, in milliseconds since the epoch.
   */
  const startOf = (back: number): number =>
    unit === 'hour'
      ? current.getTime() - back * HOUR_MS
      : new Date(current.getFullYear(), current.getMonth(), current.getDate() - back).getTime();
  const count = Math.max(
    1,
    Math.round((window.to - window.from) / (unit === 'hour' ? HOUR_MS : 24 * HOUR_MS)),
  );

  return [...Array.from({ length: count }).keys()].map((index) => {
    const from = startOf(count - 1 - index);
    const to = index === count - 1 ? window.to + 1 : startOf(count - 2 - index);
    const inside = points.filter((point) => {
      const at = point.time.getTime();

      return at >= from && at < to;
    });

    if (inside.length === 0) {
      return { from, value: null };
    }

    return {
      from,
      value: isTotal
        ? Math.max(...inside.map((point) => point.max ?? point.value)) -
          Math.min(...inside.map((point) => point.min ?? point.value))
        : inside.reduce((sum, point) => sum + point.value, 0) / inside.length,
    };
  });
}

/** How far from the average a price must be to count as cheap or dear: a quarter. */
const PRICE_BAND = 0.25;

/**
 * Whether each price is cheap, dear or neither, against the average of the window.
 *
 * @param values - The prices, one a bar.
 * @returns For each, `low`, `high` or null.
 */
export function priceLevels(values: readonly (number | null)[]): ('low' | 'high' | null)[] {
  const known = values.filter((value): value is number => value !== null);
  const average = known.reduce((sum, value) => sum + value, 0) / Math.max(1, known.length);
  const band = Math.abs(average) * PRICE_BAND;

  return values.map((value) =>
    value === null ? null : value < average - band ? 'low' : value > average + band ? 'high' : null,
  );
}
