/**
 * Days and wall clocks in a zone, shared by the API, core and the web UI.
 *
 * A calendar keeps two kinds of time. All-day events are days (`YYYY-MM-DD`) and never become
 * instants, so a day stays the same day whatever zone reads it. Timed events are instants, and
 * a repeating one keeps its wall clock in the zone it was made in: "every Thursday at 18:00" is
 * 18:00 on both sides of a daylight-saving change. `Intl` does the zone arithmetic; one formatter
 * per zone is kept because making one is the slow part.
 */
import { DAYS_OF_WEEK, type DayOfWeek } from '../automation-meta.js';

/** A day, `YYYY-MM-DD`. */
export type DayKey = string;

/** A day's length. */
export const DAY_MS = 86_400_000;

/** The wall clock of each zone asked about. */
const WALLS = new Map<string, Intl.DateTimeFormat>();

/**
 * The wall clock of a zone at an instant.
 *
 * @param instant - Milliseconds since the epoch.
 * @param zone - An IANA zone.
 * @returns The day there and the seconds since its midnight.
 */
export function wallOf(instant: number, zone: string): { day: DayKey; seconds: number } {
  let format = WALLS.get(zone);

  if (format === undefined) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    WALLS.set(zone, format);
  }

  const parts = new Map(format.formatToParts(instant).map((part) => [part.type, part.value]));
  /**
   * A part of the clock, as a number.
   *
   * @param type - Which part.
   * @returns It.
   */
  const number = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.get(type) ?? 0);

  return {
    day: `${parts.get('year') ?? '1970'}-${parts.get('month') ?? '01'}-${parts.get('day') ?? '01'}`,
    seconds: (number('hour') % 24) * 3600 + number('minute') * 60 + number('second'),
  };
}

/**
 * How far ahead of UTC a zone's clock is at an instant.
 *
 * @param instant - Milliseconds since the epoch.
 * @param zone - The zone.
 * @returns The offset, in milliseconds.
 */
export function offsetAt(instant: number, zone: string): number {
  const wall = wallOf(instant, zone);

  return (
    Date.parse(`${wall.day}T00:00:00Z`) + wall.seconds * 1000 - Math.floor(instant / 1000) * 1000
  );
}

/**
 * The instant a zone's clock shows a day and a time. A time the clocks skip moves on by the gap
 * (02:30 on the spring night is 03:30); a time they show twice is the first of the two.
 *
 * @param day - The day.
 * @param seconds - Seconds since that day's midnight.
 * @param zone - The zone.
 * @returns Milliseconds since the epoch.
 */
export function instantOf(day: DayKey, seconds: number, zone: string): number {
  const wall = Date.parse(`${day}T00:00:00Z`) + seconds * 1000;
  // The offsets either side of the day: one and the same, but for the nights the clocks change.
  const candidates = [offsetAt(wall - 43_200_000, zone), offsetAt(wall + 43_200_000, zone)].map(
    (offset) => wall - offset,
  );
  const fitting = candidates.filter((instant) => instant + offsetAt(instant, zone) === wall);

  return fitting.length > 0 ? Math.min(...fitting) : (candidates[0] ?? wall);
}

/**
 * The day a number of days after another.
 *
 * @param day - The day.
 * @param days - How many days on; negative goes back.
 * @returns That day.
 */
export function addDays(day: DayKey, days: number): DayKey {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * How many days from one day to another.
 *
 * @param from - The first day.
 * @param to - The second day.
 * @returns `to` minus `from`, in days.
 */
export function daysBetween(from: DayKey, to: DayKey): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/**
 * The day of the week of a day.
 *
 * @param day - The day.
 * @returns `monday` to `sunday`.
 */
export function weekdayOf(day: DayKey): DayOfWeek {
  // 1970-01-01 was a Thursday: index 3 from Monday.
  const index = (((daysBetween('1970-01-01', day) + 3) % 7) + 7) % 7;

  return DAYS_OF_WEEK[index] ?? 'monday';
}

/**
 * Writes a year, a month and a day as a day.
 *
 * @param year - The year.
 * @param month - 1 to 12.
 * @param date - 1 to 31.
 * @returns `YYYY-MM-DD`, or null when the month has no such day (31 April, 29 February 2027).
 */
export function dayOf(year: number, month: number, date: number): DayKey | null {
  const built = new Date(Date.UTC(year, month - 1, date));

  return built.getUTCMonth() === month - 1 && built.getUTCDate() === date
    ? built.toISOString().slice(0, 10)
    : null;
}
