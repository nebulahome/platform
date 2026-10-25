/**
 * The quietest time of day, learned from the house's activity: when backups and updates run.
 *
 * Activity is what people do - commands, lights switched by hand, doors and motion, scenes,
 * automations - counted per quarter hour (`persistence/activity-load.ts`). The days of the last
 * weeks become one profile of a typical day: each day weighted by how recent it is - half as much
 * a week older - so a change of habits is followed within weeks, smoothed going round midnight.
 *
 * Then the rule: a quarter hour is quiet when its activity is within 5% of the day's range above
 * the quietest; the longest stretch of quiet quarter hours, going round midnight, is the house
 * asleep; the time is the window centred in it, as far as can be from the last one to bed and the
 * first one up. The stretch's edges move slowly, so the time does too; and the time in use is kept
 * while its window still lies inside the stretch.
 *
 * Pure: the activity comes in, the time goes out.
 */
import type { QuietTime } from '@nebulahome/contracts';

/** One quarter hour of one day's activity. */
export type ActivityCell = {
  /** The day, `YYYY-MM-DD`, in the house's time zone. */
  readonly day: string;

  /** The quarter hour from midnight, 0 to 95. */
  readonly slot: number;

  /** How many things people did in it. */
  readonly activity: number;
};

/** What the estimate is made from. */
export type QuietInput = {
  /** Every quarter hour of every day learned from, the quiet ones as zero. */
  readonly cells: readonly ActivityCell[];

  /** Today, `YYYY-MM-DD`, in the house's time zone. */
  readonly today: string;

  /** How long the window is, in minutes: room for a backup or an update. */
  readonly durationMinutes: number;

  /** The time in use now, `HH:MM`, kept while its window lies inside the quiet stretch. */
  readonly previousTime: string | null;

  /** The time used until enough is known. */
  readonly fallbackTime: string;
};

/** Quarter hours in a day. */
export const SLOTS_PER_DAY = 96;

/** Minutes in a quarter hour. */
const SLOT_MINUTES = 15;

/** Days before one counts for half as much. */
const HALF_LIFE_DAYS = 7;

/** Days of activity needed before the time is trusted. */
export const MINIMUM_DAYS = 3;

/** The share of a day's quarter hours a day needs to count at all. */
const MINIMUM_COVERAGE = 0.5;

/** A quarter hour is quiet within this share of the day's range above the quietest one. */
const QUIET_SHARE = 0.05;

/** The smoothing: a Gaussian this many quarter hours wide, reaching three of them each way. */
const SMOOTHING_SIGMA = 1;
const SMOOTHING_REACH = 3;

/**
 * Reads the quarter hour a time falls in.
 *
 * @param time - `HH:MM`.
 * @returns The quarter hour from midnight.
 */
export function slotOf(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);

  return (hours * 60 + minutes) / SLOT_MINUTES >= SLOTS_PER_DAY
    ? 0
    : Math.floor((hours * 60 + minutes) / SLOT_MINUTES);
}

/**
 * Writes the time a quarter hour starts at.
 *
 * @param slot - The quarter hour from midnight.
 * @returns `HH:MM`.
 */
export function timeOfSlot(slot: number): string {
  const minutes = (((slot % SLOTS_PER_DAY) + SLOTS_PER_DAY) % SLOTS_PER_DAY) * SLOT_MINUTES;

  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * The index going round the day.
 *
 * @param index - Any index, before midnight or past it.
 * @returns The same quarter hour, from 0 to 95.
 */
function around(index: number): number {
  return ((index % SLOTS_PER_DAY) + SLOTS_PER_DAY) % SLOTS_PER_DAY;
}

/**
 * Days between two dates.
 *
 * @param from - `YYYY-MM-DD`.
 * @param to - `YYYY-MM-DD`.
 * @returns How many days `to` is after `from`.
 */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * Fills the quarter hours nobody measured, from the nearest measured on each side, going round.
 *
 * @param values - The profile, with gaps.
 * @returns The profile without gaps; all zero when nothing was measured.
 */
function fillGaps(values: readonly (number | null)[]): number[] {
  const known = values.flatMap((value, index) => (value === null ? [] : [index]));

  if (known.length === 0) {
    return values.map(() => 0);
  }

  return values.map((value, index) => {
    if (value !== null) {
      return value;
    }

    const before = known.findLast((at) => at < index) ?? (known.at(-1) ?? index) - SLOTS_PER_DAY;
    const after = known.find((at) => at > index) ?? (known[0] ?? index) + SLOTS_PER_DAY;
    const from = values[around(before)] ?? 0;
    const to = values[around(after)] ?? 0;

    return from + ((to - from) * (index - before)) / (after - before);
  });
}

/**
 * Smooths a profile with a Gaussian, going round midnight.
 *
 * @param values - The profile.
 * @returns The smoothed profile.
 */
function smooth(values: readonly number[]): number[] {
  const kernel = Array.from({ length: SMOOTHING_REACH * 2 + 1 }, (nothing, index) => {
    const offset = index - SMOOTHING_REACH;

    return Math.exp(-(offset * offset) / (2 * SMOOTHING_SIGMA * SMOOTHING_SIGMA));
  });
  const total = kernel.reduce((sum, weight) => sum + weight, 0);

  return values.map(
    (nothing, index) =>
      kernel.reduce(
        (sum, weight, offset) =>
          sum + weight * (values[around(index + offset - SMOOTHING_REACH)] ?? 0),
        0,
      ) / total,
  );
}

/**
 * The longest stretch of quiet quarter hours, going round midnight.
 *
 * @param quiet - Whether each quarter hour is quiet.
 * @returns Its first quarter hour and its length; null when none is quiet or all are.
 */
export function longestQuietStretch(
  quiet: readonly boolean[],
): { readonly start: number; readonly length: number } | null {
  if (quiet.every(Boolean) || !quiet.some(Boolean)) {
    return null;
  }

  let best = { start: 0, length: 0 };
  // Starting just after a busy quarter hour, so a stretch across midnight is read whole.
  const origin = around(quiet.findIndex((value) => !value) + 1);
  let start = origin;
  let length = 0;

  for (let step = 0; step < SLOTS_PER_DAY; step += 1) {
    const slot = around(origin + step);

    if (quiet[slot] === true) {
      start = length === 0 ? slot : start;
      length += 1;

      if (length > best.length) {
        best = { start, length };
      }
    } else {
      length = 0;
    }
  }

  return best;
}

/**
 * Finds the quietest time of day.
 *
 * @param input - See {@link QuietInput}.
 * @returns The time, the quiet stretch it is in, and the day's profile.
 */
export function quietestTime(input: QuietInput): QuietTime {
  const byDay = new Map<string, (number | null)[]>();

  for (const cell of input.cells) {
    if (cell.slot < 0 || cell.slot >= SLOTS_PER_DAY || !Number.isFinite(cell.activity)) {
      continue;
    }

    const day =
      byDay.get(cell.day) ?? Array.from<number | null>({ length: SLOTS_PER_DAY }).fill(null);

    day[cell.slot] = cell.activity;
    byDay.set(cell.day, day);
  }

  const days = [...byDay].filter(
    ([, day]) => day.filter((value) => value !== null).length >= SLOTS_PER_DAY * MINIMUM_COVERAGE,
  );

  // A profile of a typical day: each quarter hour, the recency-weighted mean of the days that
  // measured it.
  const raw = Array.from({ length: SLOTS_PER_DAY }, (nothing, slot) => {
    let weighted = 0;
    let weights = 0;

    for (const [day, values] of days) {
      const value = values[slot];

      if (value !== null && value !== undefined) {
        const weight = 0.5 ** (Math.max(0, daysBetween(day, input.today)) / HALF_LIFE_DAYS);

        weighted += weight * value;
        weights += weight;
      }
    }

    return weights === 0 ? null : weighted / weights;
  });
  const profile = days.length === 0 ? raw : smooth(fillGaps(raw));
  const shown = profile.map((value) => (value === null ? null : Math.round(value * 100) / 100));
  const base = {
    daysOfData: days.length,
    daysNeeded: MINIMUM_DAYS,
    profile: shown,
  };

  if (days.length < MINIMUM_DAYS) {
    return {
      ...base,
      state: 'learning',
      time: input.fallbackTime,
      quietFrom: null,
      quietTo: null,
      reason: `Learning the house's activity: ${String(days.length)} of ${String(MINIMUM_DAYS)} days`,
    };
  }

  const values = profile.map((value) => value ?? 0);
  const lowest = Math.min(...values);
  const threshold = lowest + QUIET_SHARE * (Math.max(...values) - lowest);
  const stretch = longestQuietStretch(values.map((value) => value <= threshold));

  // A day with no activity at all, or the same all day: any time is as good, so the usual one.
  if (stretch === null) {
    return {
      ...base,
      state: 'ready',
      time: input.fallbackTime,
      quietFrom: null,
      quietTo: null,
      reason: null,
    };
  }

  const width = Math.max(1, Math.ceil(input.durationMinutes / SLOT_MINUTES));
  const centred = around(Math.round(stretch.start + (stretch.length - width) / 2));
  /**
   * Whether a window starting at a quarter hour lies wholly inside the stretch.
   *
   * @param slot - Where the window starts.
   * @returns True when it does.
   */
  const fits = (slot: number): boolean =>
    width <= stretch.length && around(slot - stretch.start) <= stretch.length - width;
  const previous = input.previousTime === null ? null : slotOf(input.previousTime);
  const chosen = previous !== null && fits(previous) ? previous : centred;

  return {
    ...base,
    state: 'ready',
    time: timeOfSlot(chosen),
    quietFrom: timeOfSlot(stretch.start),
    quietTo: timeOfSlot(stretch.start + stretch.length),
    reason: null,
  };
}
