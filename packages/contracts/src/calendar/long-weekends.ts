/**
 * The long weekends of a stretch of days, and the holidays lost to a weekend: what the Year view
 * marks.
 *
 * A long weekend is a run of days off that holds a weekend and a holiday on a working day of the
 * week: Friday 1 January to Sunday 3. When one working day sits between such a holiday and the
 * weekend, taking it off joins them: that day is the bridge (a holiday on Tuesday, the Monday
 * before). Only one bridge: two working days off are a holiday, not a bridge.
 */
import { DAYS_OF_WEEK } from '../automation-meta.js';

import { addDays, daysBetween, weekdayOf, type DayKey } from './zoned-time.js';

/** A long weekend. */
export type LongWeekend = {
  readonly from: DayKey;
  readonly to: DayKey;

  /** Days off in a row, the bridge counted. */
  readonly days: number;

  /** The working day to take off to join it up, or null when it joins up by itself. */
  readonly bridge: DayKey | null;

  /** Its holidays that fall on a working day of the week. */
  readonly holidays: readonly DayKey[];
};

/** What the Year view marks. */
export type YearMarks = {
  readonly longWeekends: readonly LongWeekend[];

  /** Holidays that fall on a weekend day, earliest first. */
  readonly weekendHolidays: readonly DayKey[];
};

/** A run of days off, and what is in it. */
type Run = {
  readonly from: DayKey;
  readonly to: DayKey;
  readonly hasWeekend: boolean;
  readonly holidays: readonly DayKey[];
};

/** Days looked at beyond the stretch, so a run crossing its edge is seen whole. */
const MARGIN_DAYS = 7;

/**
 * The long weekends of a stretch of days, and its holidays that fall on a weekend.
 *
 * @param fromDay - The stretch's first day.
 * @param toDay - Its last day, included.
 * @param weekendDays - The weekend's days of the week, 0 for Monday to 6 for Sunday.
 * @param holidayDays - The days of the holidays shown, hidden ones left out.
 * @returns The long weekends touching the stretch, earliest first, and the weekend holidays in it.
 */
export function longWeekendsOf(
  fromDay: DayKey,
  toDay: DayKey,
  weekendDays: readonly number[],
  holidayDays: ReadonlySet<DayKey>,
): YearMarks {
  /**
   * Whether a day is a weekend day.
   *
   * @param day - The day.
   * @returns True on a weekend.
   */
  const isWeekend = (day: DayKey): boolean =>
    weekendDays.includes(DAYS_OF_WEEK.indexOf(weekdayOf(day)));
  const runs: Run[] = [];
  let open: { from: DayKey; to: DayKey; hasWeekend: boolean; holidays: DayKey[] } | null = null;

  for (
    let day = addDays(fromDay, -MARGIN_DAYS);
    day <= addDays(toDay, MARGIN_DAYS);
    day = addDays(day, 1)
  ) {
    const weekend = isWeekend(day);

    if (!weekend && !holidayDays.has(day)) {
      if (open !== null) {
        runs.push(open);
        open = null;
      }

      continue;
    }

    open ??= { from: day, to: day, hasWeekend: false, holidays: [] };
    open.to = day;
    open.hasWeekend ||= weekend;

    if (!weekend) {
      open.holidays.push(day);
    }
  }

  if (open !== null) {
    runs.push(open);
  }

  const bridged: LongWeekend[] = [];

  for (const [index, run] of runs.entries()) {
    const next = runs[index + 1];

    if (next === undefined || daysBetween(run.to, next.from) !== 2) {
      continue;
    }

    const holidays = [...run.holidays, ...next.holidays];

    if ((run.hasWeekend || next.hasWeekend) && holidays.length > 0) {
      bridged.push({
        from: run.from,
        to: next.to,
        days: daysBetween(run.from, next.to) + 1,
        bridge: addDays(run.to, 1),
        holidays,
      });
    }
  }

  // A run that a bridge makes longer is shown with its bridge, not twice.
  const plain = runs
    .filter(
      (run) =>
        run.hasWeekend &&
        run.holidays.length > 0 &&
        !bridged.some((weekend) => weekend.from <= run.from && weekend.to >= run.to),
    )
    .map((run) => ({
      from: run.from,
      to: run.to,
      days: daysBetween(run.from, run.to) + 1,
      bridge: null,
      holidays: run.holidays,
    }));

  return {
    longWeekends: [...plain, ...bridged]
      .filter((weekend) => weekend.to >= fromDay && weekend.from <= toDay)
      .toSorted((left, right) => left.from.localeCompare(right.from)),
    weekendHolidays: [...holidayDays]
      .filter((day) => day >= fromDay && day <= toDay && isWeekend(day))
      .toSorted(),
  };
}
