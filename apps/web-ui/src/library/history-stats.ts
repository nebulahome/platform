/**
 * The figures over an entity's history, for the row of stats above its chart: a reading's now,
 * lowest, average and highest; a switch's time on and how many times it turned on.
 *
 * Read from what the panel already fetched, so the figures always agree with the chart beside
 * them. Pure, so a test holds them to the arithmetic.
 */
import type { TelemetryPoint } from '@nebulahome/contracts';

import type { StateSegment } from '@/library/history-series';

/** A reading's figures over the window. */
export type NumericStats = {
  readonly now: number;
  readonly low: number;
  readonly average: number;
  readonly high: number;
};

/**
 * A reading's now, lowest, average and highest over the points read.
 *
 * A bucket's own lowest and highest count, not only its average: an hour that touched 18.6° is the
 * lowest even though its average was 19.
 *
 * @param points - The readings or buckets, oldest first.
 * @returns The figures, or null for no reading.
 */
export function numericStats(points: readonly TelemetryPoint[]): NumericStats | null {
  const last = points.at(-1);

  if (last === undefined) {
    return null;
  }

  const lows = points.map((point) => point.min ?? point.value);
  const highs = points.map((point) => point.max ?? point.value);

  return {
    now: last.value,
    low: Math.min(...lows),
    average: points.reduce((sum, point) => sum + point.value, 0) / points.length,
    high: Math.max(...highs),
  };
}

/** How long something was on over the window, and how often it turned on. */
export type ActiveStats = {
  /** The time it was on, in milliseconds. */
  readonly activeMs: number;

  /** How many times it went from off to on inside the window. */
  readonly turnedOn: number;

  /** When it last turned on, or null. */
  readonly lastOnAt: number | null;

  /** The longest stretch on, in milliseconds. */
  readonly longestMs: number;
};

/**
 * How long something was on, and how often it turned on, from its band.
 *
 * @param segments - The band, oldest first.
 * @returns The figures.
 */
export function activeStats(segments: readonly StateSegment[]): ActiveStats {
  let activeMs = 0;
  let turnedOn = 0;
  let lastOnAt: number | null = null;
  let longestMs = 0;

  segments.forEach((segment, index) => {
    if (!segment.isActive) {
      return;
    }

    const length = segment.to - segment.from;
    activeMs += length;
    longestMs = Math.max(longestMs, length);

    // A band that opens already on did not turn on inside the window.
    if (index > 0 && segments[index - 1]?.isActive === false) {
      turnedOn += 1;
      lastOnAt = segment.from;
    }
  });

  return { activeMs, turnedOn, lastOnAt, longestMs };
}

/**
 * A stretch of time in short words: "5 h 40 min", "18 min", "40 s".
 *
 * @param ms - The stretch.
 * @returns The words.
 */
export function durationText(ms: number): string {
  if (ms < 60_000) {
    return `${String(Math.round(ms / 1000))} s`;
  }

  const minutes = Math.round(ms / 60_000);

  if (minutes < 60) {
    return `${String(minutes)} min`;
  }

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  return hours < 48
    ? rest === 0
      ? `${String(hours)} h`
      : `${String(hours)} h ${String(rest)} min`
    : `${String(Math.round(hours / 24))} d`;
}
