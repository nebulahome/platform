/**
 * The values of the `time` domain - a time of day, a day, a moment - read, written and counted.
 *
 * A time of day and a day are wall-clock values with no zone: `07:30`, `2026-11-24`. A moment is
 * an instant with its offset, shown on the clock of the user's time zone (the house's unless the
 * user chose another, as the dashboard's clock does), and a moment picked on that clock is sent
 * back with that zone's offset. A clock time a change of hour skips (02:30 the night the clocks go
 * forward) moves on by the gap; one it repeats is the first of the two.
 *
 * Twelve or twenty-four hours is the language's: an Italian page reads 23:00, an American 11:00 PM.
 */
import { secondsOfDay, type CapabilityName, type EntityView } from '@nebulahome/contracts';

import { useSession } from '@/auth/session-store';
import { dateTimeFormat, relativeTimeFormat } from '@/i18n/formatters';

/** The capabilities of the `time` domain, in the order an entity is looked at. */
export const TIME_CAPABILITIES = [
  'time_of_day',
  'date',
  'datetime',
] as const satisfies readonly CapabilityName[];

/** One of them. */
export type TimeCapability = (typeof TIME_CAPABILITIES)[number];

/** Seconds in a day. */
export const DAY_SECONDS = 86_400;

/**
 * Which of them an entity is.
 *
 * @param entity - The entity.
 * @returns The capability, or null for an entity of another kind.
 */
export function timeCapabilityOf(entity: Pick<EntityView, 'capabilities'>): TimeCapability | null {
  return (
    TIME_CAPABILITIES.find((capability) =>
      entity.capabilities.some((entry) => entry.capability === capability),
    ) ?? null
  );
}

/**
 * The zone moments are shown in: the user's, else the browser's.
 *
 * @returns An IANA zone.
 */
export function shownZone(): string {
  const chosen = useSession.getState().user?.timezone;

  return chosen === undefined || chosen === ''
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : chosen;
}

/** The wall clock of each zone asked about, kept: a formatter is slow to make. */
const WALLS = new Map<string, Intl.DateTimeFormat>();

/**
 * The wall clock of a zone at an instant.
 *
 * @param instant - Milliseconds since the epoch.
 * @param zone - The zone.
 * @returns The day there and the seconds since its midnight.
 */
export function wallOf(instant: number, zone: string): { day: string; seconds: number } {
  const format =
    WALLS.get(zone) ??
    new Intl.DateTimeFormat('en-US', {
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
    seconds: number('hour') * 3600 + number('minute') * 60 + number('second'),
  };
}

/**
 * How far ahead of UTC a zone's clock is at an instant.
 *
 * @param instant - Milliseconds since the epoch.
 * @param zone - The zone.
 * @returns The offset, in milliseconds.
 */
function offsetAt(instant: number, zone: string): number {
  const wall = wallOf(instant, zone);

  return (
    Date.parse(`${wall.day}T00:00:00Z`) + wall.seconds * 1000 - Math.floor(instant / 1000) * 1000
  );
}

/**
 * Writes a figure on two digits.
 *
 * @param value - The figure.
 * @returns `07`, `30`.
 */
function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Writes seconds since midnight as a time of day.
 *
 * @param seconds - The seconds, taken round the clock.
 * @param withSeconds - Whether to write the seconds.
 * @returns `HH:MM` or `HH:MM:SS`.
 */
export function clockOf(seconds: number, withSeconds: boolean): string {
  const within = ((Math.round(seconds) % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS;
  const head = `${pad(Math.floor(within / 3600))}:${pad(Math.floor(within / 60) % 60)}`;

  return withSeconds ? `${head}:${pad(within % 60)}` : head;
}

/**
 * The moment a zone's clock shows a day and a time, written with that zone's offset.
 *
 * @param day - `YYYY-MM-DD`.
 * @param seconds - Seconds since that day's midnight.
 * @param zone - The zone.
 * @returns ISO 8601 with the offset: `2026-11-24T07:30:00+01:00`.
 */
export function momentOf(day: string, seconds: number, zone: string): string {
  const wall = Date.parse(`${day}T00:00:00Z`) + seconds * 1000;
  // The offsets either side of the day: one and the same, but for the nights the clocks change.
  const candidates = [offsetAt(wall - 43_200_000, zone), offsetAt(wall + 43_200_000, zone)].map(
    (offset) => wall - offset,
  );
  const fitting = candidates.filter((instant) => instant + offsetAt(instant, zone) === wall);
  // Repeated: the first of the two. Skipped: on by the gap, with the offset from before it.
  const instant = fitting.length > 0 ? Math.min(...fitting) : (candidates[0] ?? wall);
  const offset = offsetAt(instant, zone) / 60_000;
  const local = wallOf(instant, zone);
  const sign = offset < 0 ? '-' : '+';

  return `${local.day}T${clockOf(local.seconds, true)}${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}

/**
 * Whether the language writes times on a 12-hour clock.
 *
 * @returns True for "11:00 PM", false for "23:00".
 */
export function uses12Hours(): boolean {
  const cycle = dateTimeFormat({ hour: 'numeric' }).resolvedOptions().hourCycle;

  return cycle === 'h11' || cycle === 'h12';
}

/**
 * Writes a time of day as the language does.
 *
 * @param clock - `HH:MM` or `HH:MM:SS`.
 * @returns "07:30", "7:30 AM", with the seconds when it has them.
 */
export function formatClock(clock: string): string {
  return dateTimeFormat({
    hour: '2-digit',
    minute: '2-digit',
    ...(clock.length > 5 ? { second: '2-digit' } : {}),
    timeZone: 'UTC',
  }).format(secondsOfDay(clock) * 1000);
}

/**
 * Writes a day as the language does.
 *
 * @param day - `YYYY-MM-DD`.
 * @returns "Nov 24, 2026", "24 nov 2026".
 */
export function formatDayOf(day: string): string {
  return dateTimeFormat({ dateStyle: 'medium', timeZone: 'UTC' }).format(Date.parse(day));
}

/**
 * Writes a moment on the clock of the zone it is shown in.
 *
 * @param moment - ISO 8601 with its offset.
 * @param now - The time now, so the year is left out within this one.
 * @param zone - The zone.
 * @returns "Nov 24, 07:30 AM", "24 nov, 07:30".
 */
export function formatMoment(moment: string, now: number, zone: string): string {
  const at = Date.parse(moment);
  const isThisYear = wallOf(at, zone).day.slice(0, 4) === wallOf(now, zone).day.slice(0, 4);

  return dateTimeFormat({
    month: 'short',
    day: 'numeric',
    ...(isThisYear ? {} : { year: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
    timeZone: zone,
  }).format(at);
}

/**
 * Says how many days off a day is, as the language does: "tomorrow", "in 16 days", "3 days ago".
 *
 * @param day - `YYYY-MM-DD`.
 * @param now - The time now.
 * @param zone - The zone whose today counts.
 * @returns The words, starting with a capital.
 */
export function daysAwayText(day: string, now: number, zone: string): string {
  const days = Math.round(
    (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${wallOf(now, zone).day}T00:00:00Z`)) /
      (DAY_SECONDS * 1000),
  );
  const words = relativeTimeFormat({ numeric: 'auto' }).format(days, 'day');

  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The day of the week of a day, as the language names it.
 *
 * @param day - `YYYY-MM-DD`.
 * @returns "Tuesday", in the language of the page.
 */
export function weekdayOf(day: string): string {
  const name = dateTimeFormat({ weekday: 'long', timeZone: 'UTC' }).format(Date.parse(day));

  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * How long until a time of day next comes round on a zone's clock.
 *
 * @param clock - `HH:MM` or `HH:MM:SS`.
 * @param now - The time now.
 * @param zone - The zone.
 * @returns Milliseconds, up to a day.
 */
export function untilClock(clock: string, now: number, zone: string): number {
  const ahead = secondsOfDay(clock) - wallOf(now, zone).seconds;

  return (((ahead % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS) * 1000;
}
