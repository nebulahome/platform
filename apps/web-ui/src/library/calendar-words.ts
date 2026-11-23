/**
 * An event as a calendar entity tells it (`current`, `next`), in words and in time: when it starts
 * and ends, "Today · 19:30 – 20:45", "in 48 min", "Fri 20:30", which of its days today is. Shared
 * by the entity dialog's calendar body and the dashboard's calendar and agenda cards.
 *
 * All-day events are days with no zone; they start at the house's midnight and end at the
 * midnight after their last day. Timed ones are instants, written on the zone's clock.
 */
import { daysBetween } from '@nebulahome/contracts';

import { dateTimeFormat } from '@/i18n/formatters';
import { durationText } from '@/library/history-stats';
import { clockOf, daysAwayText, formatClock, momentOf, wallOf } from '@/library/time-values';

/** The times of an event, as an entity's state or an occurrence carries them. */
export type EventTimes = {
  readonly isAllDay: boolean;
  readonly startsOn: string | null;
  readonly endsOn: string | null;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
};

/** An hour, in milliseconds. */
const HOUR_MS = 3_600_000;

/**
 * A day as an instant at noon, for a formatter told the zone is UTC.
 *
 * @param day - `YYYY-MM-DD`.
 * @returns Milliseconds.
 */
function noon(day: string): number {
  return Date.parse(`${day}T12:00:00Z`);
}

/**
 * The day after a day.
 *
 * @param day - `YYYY-MM-DD`.
 * @returns The next one.
 */
function nextDay(day: string): string {
  return new Date(noon(day) + 24 * HOUR_MS).toISOString().slice(0, 10);
}

/**
 * When an event starts.
 *
 * @param event - Its times.
 * @param zone - The zone whose midnight an all-day event starts at.
 * @returns Milliseconds since the epoch.
 */
export function startOf(event: EventTimes, zone: string): number {
  return event.isAllDay || event.startsAt === null
    ? Date.parse(momentOf(event.startsOn ?? '1970-01-01', 0, zone))
    : Date.parse(event.startsAt);
}

/**
 * When an event ends.
 *
 * @param event - Its times.
 * @param zone - The zone whose midnight an all-day event ends at.
 * @returns Milliseconds since the epoch.
 */
export function endOf(event: EventTimes, zone: string): number {
  return event.isAllDay || event.endsAt === null
    ? Date.parse(momentOf(nextDay(event.endsOn ?? event.startsOn ?? '1970-01-01'), 0, zone))
    : Date.parse(event.endsAt);
}

/**
 * The first and the last day an event is on.
 *
 * @param event - Its times.
 * @param zone - The zone.
 * @returns The days.
 */
export function daysOf(event: EventTimes, zone: string): { first: string; last: string } {
  if (event.isAllDay || event.startsAt === null) {
    const first = event.startsOn ?? '1970-01-01';

    return { first, last: event.endsOn ?? first };
  }

  const start = startOf(event, zone);

  return {
    first: wallOf(start, zone).day,
    last: wallOf(Math.max(start, endOf(event, zone) - 1), zone).day,
  };
}

/**
 * A moment's time on the zone's clock.
 *
 * @param at - Milliseconds.
 * @param zone - The zone.
 * @returns "19:30", or "7:30 PM".
 */
function clockAt(at: number, zone: string): string {
  return formatClock(clockOf(wallOf(at, zone).seconds, false));
}

/**
 * A timed event's times: "19:30 – 20:45".
 *
 * @param event - Its times.
 * @param zone - The zone.
 * @returns The times; empty for an all-day event.
 */
export function timesOf(event: EventTimes, zone: string): string {
  return event.isAllDay || event.startsAt === null
    ? ''
    : `${clockAt(startOf(event, zone), zone)} – ${clockAt(endOf(event, zone), zone)}`;
}

/**
 * A day in words: "Today", "Tomorrow", or "Tuesday 15 December".
 *
 * @param day - `YYYY-MM-DD`.
 * @param now - The time now.
 * @param zone - The zone whose today counts.
 * @returns The words.
 */
export function dayName(day: string, now: number, zone: string): string {
  const away = daysBetween(wallOf(now, zone).day, day);

  return away === 0 || away === 1
    ? daysAwayText(day, now, zone)
    : dateTimeFormat({ weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
        noon(day),
      );
}

/**
 * When an event is, in a line: "Today · 19:30 – 20:45", "Wednesday 2 – Saturday 5 December".
 *
 * @param event - Its times.
 * @param now - The time now.
 * @param zone - The zone.
 * @returns The line.
 */
export function whenLine(event: EventTimes, now: number, zone: string): string {
  const { first, last } = daysOf(event, zone);

  if (first !== last) {
    return dateTimeFormat({
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }).formatRange(noon(first), noon(last));
  }

  const times = timesOf(event, zone);

  return times === '' ? dayName(first, now, zone) : `${dayName(first, now, zone)} · ${times}`;
}

/**
 * When an event is, as a row's mono figure: "tomorrow", "Fri 20:30" this week, "Thu 10 19:30"
 * further, "Sat 5" for a day's event.
 *
 * @param event - Its times.
 * @param now - The time now.
 * @param zone - The zone.
 * @returns The figure.
 */
export function shortWhen(event: EventTimes, now: number, zone: string): string {
  const { first } = daysOf(event, zone);
  const away = daysBetween(wallOf(now, zone).day, first);
  const isTimed = !event.isAllDay && event.startsAt !== null;

  if (!isTimed && away === 1) {
    return daysAwayText(first, now, zone).toLocaleLowerCase();
  }

  const day = dateTimeFormat({
    weekday: 'short',
    ...(isTimed && away < 7 ? {} : { day: 'numeric' }),
    timeZone: 'UTC',
  }).format(noon(first));

  return isTimed ? `${day} ${clockAt(startOf(event, zone), zone)}` : day;
}

/**
 * How long until an event starts, while that is within the day: "48 min", "3 h".
 *
 * @param event - Its times.
 * @param now - The time now.
 * @param zone - The zone.
 * @returns The span; null for an all-day event or one further than a day.
 */
export function untilStart(event: EventTimes, now: number, zone: string): string | null {
  const gap = startOf(event, zone) - now;

  return event.isAllDay || gap < 0 || gap > 24 * HOUR_MS ? null : durationText(gap);
}

/**
 * Which of its days today is, for an event on more than one: the day bar.
 *
 * @param event - Its times.
 * @param now - The time now.
 * @param zone - The zone.
 * @returns Today's place, from 1, and how many days; null for an event of one day.
 */
export function dayOfEvent(
  event: EventTimes,
  now: number,
  zone: string,
): { readonly day: number; readonly of: number } | null {
  const { first, last } = daysOf(event, zone);
  const of = daysBetween(first, last) + 1;

  return of < 2
    ? null
    : { day: Math.min(of, Math.max(1, daysBetween(first, wallOf(now, zone).day) + 1)), of };
}

/**
 * The last day of an event, as "until Sat".
 *
 * @param event - Its times.
 * @param zone - The zone.
 * @returns The weekday of its last day, short.
 */
export function lastWeekday(event: EventTimes, zone: string): string {
  return dateTimeFormat({ weekday: 'short', timeZone: 'UTC' }).format(
    noon(daysOf(event, zone).last),
  );
}
