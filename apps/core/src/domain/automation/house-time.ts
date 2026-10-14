/**
 * The time of day and the day of the week as the house keeps them.
 *
 * An automation that says "between 22:00 and 06:30" or "on weekdays" means the clock on the wall
 * of the house, not the machine's and not UTC. The house's zone is the `house.timezone` setting;
 * these functions read an instant in it. `Intl` does the zone arithmetic, daylight saving
 * included, and a formatter per zone is kept because building one is the expensive part.
 */
import { DAYS_OF_WEEK, type DayOfWeek } from '@nebulahome/contracts';

/** An instant, read on the house's clock. */
export type ZonedParts = {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly weekday: DayOfWeek;

  /** Seconds since midnight, 0 to 86 399. */
  readonly secondsOfDay: number;
};

/** One formatter per zone. */
const formatters = new Map<string, Intl.DateTimeFormat>();

/** `Intl`'s weekday names, to the format's. */
const WEEKDAYS: Readonly<Record<string, DayOfWeek>> = {
  Mon: 'monday',
  Tue: 'tuesday',
  Wed: 'wednesday',
  Thu: 'thursday',
  Fri: 'friday',
  Sat: 'saturday',
  Sun: 'sunday',
};

/**
 * The formatter for one zone.
 *
 * @param timeZone - An IANA zone.
 * @returns A formatter that splits an instant into its parts in that zone.
 */
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);

  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
    });
    formatters.set(timeZone, formatter);
  }

  return formatter;
}

/**
 * Reads an instant on the house's clock.
 *
 * @param instant - The moment.
 * @param timeZone - The house's IANA zone.
 * @returns Its date, weekday and time of day there.
 */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts: Record<string, string> = {};

  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    parts[part.type] = part.value;
  }

  const hour = Number(parts['hour']) % 24;

  return {
    year: Number(parts['year']),
    month: Number(parts['month']),
    day: Number(parts['day']),
    weekday: WEEKDAYS[parts['weekday'] ?? ''] ?? DAYS_OF_WEEK[0],
    secondsOfDay: hour * 3_600 + Number(parts['minute']) * 60 + Number(parts['second']),
  };
}

/**
 * Seconds since midnight of a time of day.
 *
 * @param clock - `HH:MM` or `HH:MM:SS`.
 * @returns The seconds.
 */
export function secondsOfClock(clock: string): number {
  const [hours = 0, minutes = 0, seconds = 0] = clock.split(':').map(Number);

  return hours * 3_600 + minutes * 60 + seconds;
}

/**
 * Whether a time of day falls in a window, which wraps past midnight when it ends before it
 * starts. Start inclusive, end exclusive; a window that starts where it ends is empty.
 *
 * @param secondsOfDay - The time of day.
 * @param from - The window's start.
 * @param to - The window's end.
 * @returns True inside the window.
 */
export function isInWindow(secondsOfDay: number, from: string, to: string): boolean {
  const start = secondsOfClock(from);
  const end = secondsOfClock(to);

  if (start === end) {
    return false;
  }

  return start < end
    ? secondsOfDay >= start && secondsOfDay < end
    : secondsOfDay >= start || secondsOfDay < end;
}

/** What a time condition says: from when, until when, on which days. */
export type TimeCondition = {
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly days?: readonly DayOfWeek[] | undefined;
};

/**
 * The day before.
 *
 * @param day - A day.
 * @returns The one before it.
 */
function dayBefore(day: DayOfWeek): DayOfWeek {
  const index = DAYS_OF_WEEK.indexOf(day);

  return DAYS_OF_WEEK[(index + DAYS_OF_WEEK.length - 1) % DAYS_OF_WEEK.length] ?? day;
}

/**
 * Whether an instant on the house's clock falls in a time condition.
 *
 * Without a start the window opens at midnight; without an end it closes at midnight. Days are a
 * whitelist (none means every day), and for a window that runs past midnight they name the day
 * it starts: "Friday 22:00 to 06:30" holds at two on Saturday morning.
 *
 * @param parts - The instant, read on the house's clock.
 * @param condition - The window and the days.
 * @returns True when it holds.
 */
export function isInTimeCondition(parts: ZonedParts, condition: TimeCondition): boolean {
  const days = condition.days ?? [];

  /**
   * Whether a day is one the condition holds on.
   *
   * @param day - The day.
   * @returns True when there is no list, or the day is in it.
   */
  const isDayIn = (day: DayOfWeek): boolean => days.length === 0 || days.includes(day);

  if (condition.from === undefined && condition.to === undefined) {
    return isDayIn(parts.weekday);
  }

  const start = condition.from === undefined ? 0 : secondsOfClock(condition.from);
  const end = condition.to === undefined ? 86_400 : secondsOfClock(condition.to);

  if (start < end) {
    return parts.secondsOfDay >= start && parts.secondsOfDay < end && isDayIn(parts.weekday);
  }

  if (start === end) {
    return false;
  }

  if (parts.secondsOfDay >= start) {
    return isDayIn(parts.weekday);
  }

  return parts.secondsOfDay < end && isDayIn(dayBefore(parts.weekday));
}
