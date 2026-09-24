/**
 * A day of a binary sensor, as the bars its card draws: how much of each hour it was active.
 *
 * A motion sensor has no value to plot, only when it fired. The card draws the last day as a row
 * of bars, one per hour, each as tall as the share of that hour the sensor spent detecting - so a
 * hallway that saw someone at breakfast and again at dinner reads as two bumps, not as a number.
 */

/** A stretch of time in one state. */
export type ActivityStretch = {
  /** When it began, in milliseconds since the epoch. */
  readonly from: number;

  /** When it ended. */
  readonly to: number;

  /** Whether it was active: on, detected, open. */
  readonly isActive: boolean;
};

/**
 * How much of each slice of a window was spent active.
 *
 * @param stretches - The states it was in, in order; the parts outside the window are ignored.
 * @param window - The window.
 * @param window.from - Its start, in milliseconds since the epoch.
 * @param window.to - Its end.
 * @param slices - How many equal slices to cut it into.
 * @returns One share per slice, from 0 (never active) to 1 (active throughout), oldest first.
 */
export function activityShares(
  stretches: readonly ActivityStretch[],
  window: { readonly from: number; readonly to: number },
  slices: number,
): number[] {
  const length = (window.to - window.from) / slices;

  return [...Array.from({ length: slices }).keys()].map((index) => {
    const start = window.from + index * length;
    const end = start + length;
    const active = stretches
      .filter((stretch) => stretch.isActive)
      .reduce(
        (sum, stretch) =>
          sum + Math.max(0, Math.min(end, stretch.to) - Math.max(start, stretch.from)),
        0,
      );

    return length <= 0 ? 0 : Math.min(1, active / length);
  });
}
