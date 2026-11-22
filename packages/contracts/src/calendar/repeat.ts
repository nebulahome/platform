/**
 * How an event repeats, and the times a repeating event happens.
 *
 * Repeat is always custom (CAL-Repeat): every N days, weeks, months or years; for weeks, on which
 * days; for months, the same date or the same weekday of the month (the second Thursday, the last
 * Friday); for years, the same date. It ends never, on a date, or after a number of times. There
 * are no ready-made choices and no "if it falls on a holiday" rule.
 *
 * The rule works like RFC 5545's RRULE: the first time is the event's own start; a month without
 * the date is skipped (no 31 April, no 29 February outside leap years); "after N times" counts the
 * times deleted one by one too. A timed event keeps its wall clock in the zone it was made in, so
 * "every Thursday at 18:00" stays 18:00 across a daylight-saving change, and keeps its length.
 */
import { z } from 'zod';

import { DAYS_OF_WEEK } from '../automation-meta.js';

import {
  addDays,
  dayOf,
  daysBetween,
  instantOf,
  wallOf,
  weekdayOf,
  type DayKey,
} from './zoned-time.js';

/** The units a rule counts in. */
export const REPEAT_UNITS = ['day', 'week', 'month', 'year'] as const;

/** For a monthly rule: the same date, the same nth weekday, or the last such weekday. */
export const MONTHLY_KINDS = ['date', 'weekday', 'last_weekday'] as const;

/** How a repeating event ends. */
export const repeatEndsSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('never') }),
  z.object({ kind: z.literal('on'), day: z.iso.date() }),
  z.object({ kind: z.literal('after'), count: z.int().min(1).max(999) }),
]);

/** How an event repeats. */
export const calendarRepeatSchema = z.object({
  /** Every how many units. */
  every: z.int().min(1).max(99),
  unit: z.enum(REPEAT_UNITS),

  /** For weeks: the days; the start's own day when left out. */
  weekdays: z.array(z.enum(DAYS_OF_WEEK)).min(1).max(7).optional(),

  /** For months: what stays the same each time; the date when left out. */
  monthly: z.enum(MONTHLY_KINDS).optional(),
  ends: repeatEndsSchema,
});

/** How an event repeats. */
export type CalendarRepeat = z.output<typeof calendarRepeatSchema>;

/** What the expansion needs of an event. */
export type RepeatingEvent = {
  readonly isAllDay: boolean;

  /** All day: the first and last day, both included. */
  readonly startsOn: DayKey | null;
  readonly endsOn: DayKey | null;

  /** Timed: ISO 8601 instants. */
  readonly startsAt: string | null;
  readonly endsAt: string | null;

  /** The zone its wall clock is kept in. */
  readonly timeZone: string;
  readonly repeat: CalendarRepeat | null;

  /** Times deleted one by one ("only this one"). */
  readonly skippedOn: readonly DayKey[];
};

/** One time an event happens. */
export type EventTime =
  | {
      /** The day of the series this time belongs to. */
      readonly occurrenceOn: DayKey;
      readonly isAllDay: true;
      readonly startsOn: DayKey;
      readonly endsOn: DayKey;
    }
  | {
      readonly occurrenceOn: DayKey;
      readonly isAllDay: false;

      /** ISO 8601, UTC. */
      readonly startsAt: string;
      readonly endsAt: string;
    };

/** Days a series is walked at most, a guard against a rule that never reaches the range. */
const MAX_STEPS = 50_000;

/**
 * The days of a series, in order, from its first.
 *
 * @param start - The first day.
 * @param rule - The rule.
 * @yields {DayKey} Each day the rule gives, the first included.
 */
function* seriesDays(start: DayKey, rule: CalendarRepeat): Generator<DayKey> {
  const [year = 1970, month = 1, date = 1] = start.split('-').map(Number);

  if (rule.unit === 'day') {
    for (let step = 0; ; step += 1) {
      yield addDays(start, step * rule.every);
    }
  }

  if (rule.unit === 'week') {
    const days = new Set(rule.weekdays ?? [weekdayOf(start)]);
    const monday = addDays(start, -DAYS_OF_WEEK.indexOf(weekdayOf(start)));

    yield start;

    for (let week = 0; ; week += rule.every) {
      for (const [index, weekday] of DAYS_OF_WEEK.entries()) {
        const day = addDays(monday, week * 7 + index);

        if (days.has(weekday) && day > start) {
          yield day;
        }
      }
    }
  }

  if (rule.unit === 'year') {
    for (let step = 0; ; step += 1) {
      const day = dayOf(year + step * rule.every, month, date);

      if (day !== null) {
        yield day;
      }
    }
  }

  // Months.
  const kind = rule.monthly ?? 'date';
  const weekday = weekdayOf(start);
  const nth = Math.ceil(date / 7);

  yield start;

  for (let step = rule.every; ; step += rule.every) {
    const index = month - 1 + step;
    const y = year + Math.floor(index / 12);
    const m = (index % 12) + 1;
    let day: DayKey | null;

    if (kind === 'date') {
      day = dayOf(y, m, date);
    } else {
      const first = dayOf(y, m, 1) ?? start;
      const firstMatch = addDays(
        first,
        (DAYS_OF_WEEK.indexOf(weekday) - DAYS_OF_WEEK.indexOf(weekdayOf(first)) + 7) % 7,
      );
      // The nth one, or the last one: four or five weeks on, whichever stays in the month.
      const candidate =
        kind === 'weekday'
          ? addDays(firstMatch, (nth - 1) * 7)
          : addDays(
              firstMatch,
              addDays(firstMatch, 28).slice(5, 7) === firstMatch.slice(5, 7) ? 28 : 21,
            );

      day = candidate.slice(5, 7) === firstMatch.slice(5, 7) ? candidate : null;
    }

    if (day !== null) {
      yield day;
    }
  }
}

/**
 * The times an event happens that touch a range of days, in order. A one-off event gives itself
 * when it touches the range; a repeating one gives every time its rule makes, but the ones
 * deleted one by one and the ones in `replaced` (changed one by one, so a row of their own).
 *
 * @param event - The event.
 * @param fromDay - The range's first day, in `zone`.
 * @param toDay - The range's last day, in `zone`, included.
 * @param zone - The zone the range is read in: the house's.
 * @param replaced - Days of the series that have a replacing event of their own.
 * @returns The times, earliest first.
 */
export function occurrencesOf(
  event: RepeatingEvent,
  fromDay: DayKey,
  toDay: DayKey,
  zone: string,
  replaced: ReadonlySet<DayKey> = new Set(),
): EventTime[] {
  const skipped = new Set([...event.skippedOn, ...replaced]);
  let start: DayKey;
  let lengthDays = 0;
  let startSeconds = 0;
  let durationMs = 0;

  if (event.isAllDay) {
    if (event.startsOn === null || event.endsOn === null) {
      return [];
    }

    start = event.startsOn;
    lengthDays = Math.max(0, daysBetween(event.startsOn, event.endsOn));
  } else {
    if (event.startsAt === null || event.endsAt === null) {
      return [];
    }

    const startMs = Date.parse(event.startsAt);
    const wall = wallOf(startMs, event.timeZone);

    start = wall.day;
    startSeconds = wall.seconds;
    durationMs = Math.max(0, Date.parse(event.endsAt) - startMs);
  }

  const rangeStart = instantOf(fromDay, 0, zone);
  const rangeEnd = instantOf(addDays(toDay, 1), 0, zone);

  /**
   * The time a series day stands for, when it touches the range.
   *
   * @param day - The series day.
   * @returns The time, or null outside the range.
   */
  const timeOf = (day: DayKey): EventTime | null => {
    if (event.isAllDay) {
      const endsOn = addDays(day, lengthDays);

      return endsOn >= fromDay && day <= toDay
        ? { occurrenceOn: day, isAllDay: true, startsOn: day, endsOn }
        : null;
    }

    const startsAt = instantOf(day, startSeconds, event.timeZone);
    const endsAt = startsAt + durationMs;
    // An event with no length (a moment) touches the range when it starts inside it.
    const touches =
      durationMs === 0
        ? startsAt >= rangeStart && startsAt < rangeEnd
        : endsAt > rangeStart && startsAt < rangeEnd;

    return touches
      ? {
          occurrenceOn: day,
          isAllDay: false,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
        }
      : null;
  };

  if (event.repeat === null) {
    const time = timeOf(start);

    return time === null || skipped.has(start) ? [] : [time];
  }

  const { ends } = event.repeat;
  const times: EventTime[] = [];
  // Past the range's last day plus the event's length (and a day for zones), nothing touches it.
  const lastStart = addDays(toDay, 1);
  let count = 0;
  let steps = 0;

  for (const day of seriesDays(start, event.repeat)) {
    steps += 1;
    count += 1;

    if (
      steps > MAX_STEPS ||
      day > lastStart ||
      (ends.kind === 'on' && day > ends.day) ||
      (ends.kind === 'after' && count > ends.count)
    ) {
      break;
    }

    if (!skipped.has(day) && addDays(day, lengthDays + 1) >= addDays(fromDay, -1)) {
      const time = timeOf(day);

      if (time !== null) {
        times.push(time);
      }
    }
  }

  return times;
}
