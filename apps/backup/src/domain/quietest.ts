/**
 * The quietest time of day to back up at, learned from the processor's load.
 *
 * The load of the last weeks, in quarter hours of the schedule's own day, becomes one profile of
 * a typical day: each day weighted by how recent it is - half as much a week older - so a change
 * of habits is followed within weeks, and each quarter hour the weighted mean of the days that
 * have it. The profile is smoothed, going round midnight, so one busy evening does not make a
 * trough of the quarter beside it; then the cost of starting at each quarter is the mean load over
 * as long as a backup takes. The candidates are where that cost stops falling - its gradient goes
 * from negative to not - and the best is the lowest of them.
 *
 * Two things keep the answer from wandering. The windows the backups themselves ran in are left
 * out of the data (the query's job), or each backup would make its own slot look busy and push
 * the next one away. And the time already in use is kept unless another is clearly quieter.
 *
 * Pure: the load comes in, the time goes out.
 */
import type { DayOfWeek, QuietTime } from '@nebulahome/contracts';

/** One quarter hour of one day's load. */
export type LoadCell = {
  /** The day, `YYYY-MM-DD`, in the schedule's time zone. */
  readonly day: string;

  /** The quarter hour from midnight, 0 to 95. */
  readonly slot: number;

  /** The mean processor load, in percent. */
  readonly load: number;
};

/** What the estimate is made from. */
export type QuietInput = {
  readonly cells: readonly LoadCell[];

  /** Today, `YYYY-MM-DD`, in the schedule's time zone. */
  readonly today: string;

  /** The days the backups run on, or null for every day. */
  readonly weekdays: readonly DayOfWeek[] | null;

  /** How long a backup takes, in minutes. */
  readonly durationMinutes: number;

  /** The time in use now, `HH:MM`, kept unless another is clearly quieter. */
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

/** Days of load needed before the time is trusted. */
export const MINIMUM_DAYS = 3;

/** The share of a day's quarter hours a day needs to count at all. */
const MINIMUM_COVERAGE = 0.5;

/** How much quieter another time must be to replace the one in use: this many points, or… */
const KEEP_MARGIN_POINTS = 2;

/** …this share of the quieter one's load, whichever is larger. */
const KEEP_MARGIN_SHARE = 0.1;

/** The smoothing: a Gaussian this many quarter hours wide, reaching three of them each way. */
const SMOOTHING_SIGMA = 1;
const SMOOTHING_REACH = 3;

/** The day names, as `Date.getUTCDay()` numbers them. */
const WEEKDAY_BY_NUMBER: readonly DayOfWeek[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

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
 * Finds the quietest time of day to back up at.
 *
 * @param input - See {@link QuietInput}.
 * @returns The time, how it was found, and the day's profile.
 */
export function quietestTime(input: QuietInput): QuietTime {
  const byDay = new Map<string, (number | null)[]>();

  for (const cell of input.cells) {
    if (cell.slot < 0 || cell.slot >= SLOTS_PER_DAY || !Number.isFinite(cell.load)) {
      continue;
    }

    const day =
      byDay.get(cell.day) ?? Array.from<number | null>({ length: SLOTS_PER_DAY }).fill(null);

    day[cell.slot] = cell.load;
    byDay.set(cell.day, day);
  }

  const complete = [...byDay].filter(
    ([, day]) => day.filter((value) => value !== null).length >= SLOTS_PER_DAY * MINIMUM_COVERAGE,
  );
  const onScheduledDays =
    input.weekdays === null
      ? []
      : complete.filter(([day]) =>
          input.weekdays?.includes(
            WEEKDAY_BY_NUMBER[new Date(`${day}T12:00:00Z`).getUTCDay()] ?? 'monday',
          ),
        );
  const days = onScheduledDays.length >= MINIMUM_DAYS ? onScheduledDays : complete;

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
  const shown = profile.map((value) => (value === null ? null : Math.round(value * 10) / 10));

  if (days.length < MINIMUM_DAYS) {
    return {
      state: 'learning',
      time: input.fallbackTime,
      meanLoadPercent: null,
      daysOfData: days.length,
      daysNeeded: MINIMUM_DAYS,
      profile: shown,
      reason: `Learning the machine's load: ${String(days.length)} of ${String(MINIMUM_DAYS)} days`,
    };
  }

  const smoothed = profile.map((value) => value ?? 0);
  const width = Math.max(1, Math.ceil(input.durationMinutes / SLOT_MINUTES) + 1);
  // What starting at each quarter hour costs: the mean load over as long as a backup takes.
  const cost = smoothed.map(
    (nothing, start) =>
      Array.from(
        { length: width },
        (unused, offset) => smoothed[around(start + offset)] ?? 0,
      ).reduce((sum, value) => sum + value, 0) / width,
  );
  /**
   * What starting at a quarter hour costs, going round.
   *
   * @param slot - The quarter hour, before midnight or past it.
   * @returns The mean load over the run.
   */
  const costAt = (slot: number): number => cost[around(slot)] ?? 0;
  // The gradient, central: where it turns from falling to not, the cost has a trough.
  const gradient = cost.map((nothing, slot) => (costAt(slot + 1) - costAt(slot - 1)) / 2);
  const troughs = new Set<number>();

  for (let slot = 0; slot < SLOTS_PER_DAY; slot += 1) {
    if ((gradient[around(slot - 1)] ?? 0) < 0 && (gradient[slot] ?? 0) >= 0) {
      // The sign changed between two quarter hours; the trough is the lower of them and their
      // neighbours.
      const nearest = [slot - 1, slot, slot + 1].reduce((best, each) =>
        costAt(each) < costAt(best) ? each : best,
      );

      troughs.add(around(nearest));
    }
  }

  const fallback = slotOf(input.fallbackTime);
  /**
   * How far a quarter hour is from the usual time, going round.
   *
   * @param slot - The quarter hour.
   * @returns The distance, in quarter hours.
   */
  const distance = (slot: number): number =>
    Math.min(Math.abs(slot - fallback), SLOTS_PER_DAY - Math.abs(slot - fallback));
  // A flat day has no trough: any time is as good, so the usual one.
  const candidates = troughs.size === 0 ? [fallback] : [...troughs];
  const best = candidates.reduce((chosen, each) =>
    costAt(each) < costAt(chosen) ||
    (costAt(each) === costAt(chosen) && distance(each) < distance(chosen))
      ? each
      : chosen,
  );
  const previous = input.previousTime === null ? null : slotOf(input.previousTime);
  const keepsPrevious =
    previous !== null &&
    costAt(previous) <=
      costAt(best) + Math.max(KEEP_MARGIN_POINTS, KEEP_MARGIN_SHARE * costAt(best));
  const chosen = keepsPrevious ? previous : best;

  return {
    state: 'ready',
    time: timeOfSlot(chosen),
    meanLoadPercent: Math.round(costAt(chosen) * 10) / 10,
    daysOfData: days.length,
    daysNeeded: MINIMUM_DAYS,
    profile: shown,
    reason: null,
  };
}
