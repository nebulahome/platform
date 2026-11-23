/**
 * Days, ranges and words for the calendar page.
 *
 * The grid is drawn in the house's zone (docs/calendar.md 8.3): an all-day occurrence is its days,
 * as they are; a timed one is placed by the wall clock of the house at its instants. The days are
 * plain `YYYY-MM-DD` strings stepped with the contracts' `addDays`, so nothing slips across a
 * zone, and the words go through the formatters, in the language of whoever is reading.
 */
import {
  addDays,
  DAYS_OF_WEEK,
  daysBetween,
  wallOf,
  weekdayOf,
  type CalendarOccurrence,
  type CalendarRepeat,
} from '@nebulahome/contracts';
import { dayKey } from '@nebulahome/ui';

import { dateTimeFormat, listFormat } from '@/i18n/formatters';
import { translate } from '@/i18n/messages';
import { clockOf, formatClock } from '@/library/time-values';

/** The four ways the page shows the calendar. */
export const CALENDAR_PAGE_VIEWS = ['week', 'month', 'year', 'agenda'] as const;

/** A way the page shows the calendar. */
export type CalendarPageView = (typeof CALENDAR_PAGE_VIEWS)[number];

/** The days the agenda shows at once, from the day it starts on. */
export const AGENDA_DAYS = 7;

/** When an occurrence is: what placing it on days needs. */
export type OccurrenceTimes = Pick<
  CalendarOccurrence,
  'isAllDay' | 'startsOn' | 'endsOn' | 'startsAt' | 'endsAt'
>;

/** A run of days, both ends included. */
export type DayRange = { readonly from: string; readonly to: string };

/**
 * The Monday of a day's week.
 *
 * @param day - The day.
 * @returns Its week's Monday.
 */
export function mondayOf(day: string): string {
  return addDays(day, -DAYS_OF_WEEK.indexOf(weekdayOf(day)));
}

/**
 * The days a view shows around a day.
 *
 * @param view - The view.
 * @param day - The day it is on.
 * @returns The week, the six weeks of the month's grid, the year, or the agenda's days.
 */
export function rangeOf(view: CalendarPageView, day: string): DayRange {
  if (view === 'week') {
    const from = mondayOf(day);

    return { from, to: addDays(from, 6) };
  }

  if (view === 'month') {
    const from = mondayOf(`${day.slice(0, 7)}-01`);

    return { from, to: addDays(from, 41) };
  }

  if (view === 'year') {
    return { from: `${day.slice(0, 4)}-01-01`, to: `${day.slice(0, 4)}-12-31` };
  }

  return { from: day, to: addDays(day, AGENDA_DAYS - 1) };
}

/**
 * The day the arrows move a view to.
 *
 * @param view - The view.
 * @param day - The day it is on.
 * @param by - Back one, or on one.
 * @returns A week, a month, a year or the agenda's days on.
 */
export function stepDay(view: CalendarPageView, day: string, by: -1 | 1): string {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));

  if (view === 'month') {
    return dayKey(year, month + by, 1);
  }

  if (view === 'year') {
    return dayKey(year + by, 1, 1);
  }

  return addDays(day, by * (view === 'week' ? 7 : AGENDA_DAYS));
}

/**
 * The instant of a day's noon, UTC: what a day is formatted from, so no zone moves it.
 *
 * @param day - The day.
 * @returns Milliseconds since the epoch.
 */
function noonOf(day: string): number {
  return Date.parse(`${day}T12:00:00Z`);
}

/**
 * What the toolbar calls the stretch a view shows.
 *
 * @param view - The view.
 * @param day - The day it is on.
 * @returns "December 2026", "30 Nov – 6 Dec 2026", "2027", "3 – 9 December".
 */
export function titleOf(view: CalendarPageView, day: string): string {
  const range = rangeOf(view, day);

  if (view === 'month') {
    return dateTimeFormat({ month: 'long', year: 'numeric', timeZone: 'UTC' }).format(noonOf(day));
  }

  if (view === 'year') {
    return day.slice(0, 4);
  }

  return dateTimeFormat(
    view === 'week'
      ? { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }
      : { day: 'numeric', month: 'long', timeZone: 'UTC' },
  ).formatRange(noonOf(range.from), noonOf(range.to));
}

/**
 * Writes a day in words.
 *
 * @param day - The day.
 * @param style - `long`, "Thursday 3 December"; `short`, "Thu 10 Dec"; `year`, "Thu 10 Dec 2026";
 *   `brief`, "Sat 5"; `weekday`, "Saturday 5"; `date`, "5 November".
 * @returns The day.
 */
export function dayWords(
  day: string,
  style: 'long' | 'short' | 'year' | 'brief' | 'weekday' | 'date' = 'long',
): string {
  if (style === 'brief' || style === 'weekday') {
    return dateTimeFormat({
      weekday: style === 'brief' ? 'short' : 'long',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(noonOf(day));
  }

  if (style === 'date') {
    return dateTimeFormat({ day: 'numeric', month: 'long', timeZone: 'UTC' }).format(noonOf(day));
  }

  return dateTimeFormat(
    style === 'long'
      ? { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }
      : {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          ...(style === 'year' ? { year: 'numeric' } : {}),
          timeZone: 'UTC',
        },
  ).format(noonOf(day));
}

/**
 * The name of a day's weekday.
 *
 * @param day - The day.
 * @param width - `long`, "Thursday"; `short`, "Thu".
 * @returns The name.
 */
export function weekdayWords(day: string, width: 'long' | 'short' = 'long'): string {
  return dateTimeFormat({ weekday: width, timeZone: 'UTC' }).format(noonOf(day));
}

/**
 * The short name of a day's month: "Dec".
 *
 * @param day - The day.
 * @returns The name.
 */
export function monthShort(day: string): string {
  return dateTimeFormat({ month: 'short', timeZone: 'UTC' }).format(noonOf(day));
}

/**
 * The first day an occurrence is on, in the house.
 *
 * @param occurrence - The occurrence.
 * @param zone - The house's zone.
 * @returns The day.
 */
export function firstDayOf(occurrence: OccurrenceTimes, zone: string): string {
  return occurrence.isAllDay || occurrence.startsAt === null
    ? (occurrence.startsOn ?? '')
    : wallOf(Date.parse(occurrence.startsAt), zone).day;
}

/**
 * The last day an occurrence is on, in the house: an event that ends at midnight is not on the
 * day after.
 *
 * @param occurrence - The occurrence.
 * @param zone - The house's zone.
 * @returns The day.
 */
export function lastDayOf(occurrence: OccurrenceTimes, zone: string): string {
  if (occurrence.isAllDay || occurrence.startsAt === null || occurrence.endsAt === null) {
    return occurrence.endsOn ?? occurrence.startsOn ?? '';
  }

  const start = Date.parse(occurrence.startsAt);

  return wallOf(Math.max(start, Date.parse(occurrence.endsAt) - 1), zone).day;
}

/**
 * Whether an occurrence is on a day.
 *
 * @param occurrence - The occurrence.
 * @param day - The day.
 * @param zone - The house's zone.
 * @returns True when the day is one of its days.
 */
export function isOn(occurrence: OccurrenceTimes, day: string, zone: string): boolean {
  return firstDayOf(occurrence, zone) <= day && lastDayOf(occurrence, zone) >= day;
}

/**
 * How many days an occurrence covers.
 *
 * @param occurrence - The occurrence.
 * @param zone - The house's zone.
 * @returns One for a day's event, more for one that runs over.
 */
export function lengthInDays(occurrence: CalendarOccurrence, zone: string): number {
  return daysBetween(firstDayOf(occurrence, zone), lastDayOf(occurrence, zone)) + 1;
}

/**
 * Minutes since the house's midnight of an instant.
 *
 * @param moment - ISO 8601.
 * @param zone - The house's zone.
 * @returns The minutes.
 */
export function minutesOf(moment: string, zone: string): number {
  return Math.floor(wallOf(Date.parse(moment), zone).seconds / 60);
}

/**
 * Writes an instant's time on the house's clock, as the language does.
 *
 * @param moment - ISO 8601.
 * @param zone - The house's zone.
 * @returns "19:30", or "7:30 PM".
 */
export function clockText(moment: string, zone: string): string {
  return formatClock(clockOf(wallOf(Date.parse(moment), zone).seconds, false));
}

/**
 * Writes an occurrence's times.
 *
 * @param occurrence - A timed occurrence.
 * @param zone - The house's zone.
 * @returns "19:30 – 20:45".
 */
export function timesText(occurrence: CalendarOccurrence, zone: string): string {
  return occurrence.startsAt === null || occurrence.endsAt === null
    ? ''
    : `${clockText(occurrence.startsAt, zone)} – ${clockText(occurrence.endsAt, zone)}`;
}

/**
 * Says when an occurrence is, in full.
 *
 * @param occurrence - The occurrence.
 * @param zone - The house's zone.
 * @returns "Thursday 3 December · 19:30 – 20:45", "Monday 7 December · all day", or the days of
 *   one that runs over.
 */
export function whenWords(occurrence: CalendarOccurrence, zone: string): string {
  const first = firstDayOf(occurrence, zone);
  const last = lastDayOf(occurrence, zone);

  if (occurrence.isAllDay) {
    return first === last
      ? translate('calendar.when.allDay', '{{day}} · all day', { day: dayWords(first) })
      : dateTimeFormat({
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          timeZone: 'UTC',
        }).formatRange(noonOf(first), noonOf(last));
  }

  return first === last
    ? `${dayWords(first)} · ${timesText(occurrence, zone)}`
    : `${dayWords(first)} ${clockText(occurrence.startsAt ?? '', zone)} – ${dayWords(last)} ${clockText(occurrence.endsAt ?? '', zone)}`;
}

/**
 * The words for a weekday of the week.
 *
 * @param index - 0 for Monday.
 * @returns "Thursday".
 */
function weekdayName(index: number): string {
  // 2026-01-05 was a Monday.
  return weekdayWords(addDays('2026-01-05', index));
}

/**
 * Which of its month's weekdays a day is: the second Thursday, or the last one.
 *
 * @param day - The day.
 * @returns 1 to 5; 5 means the last.
 */
export function nthOfMonth(day: string): number {
  return Math.min(5, Math.ceil(Number(day.slice(8, 10)) / 7));
}

/**
 * Says how a monthly rule picks its day, from the series' first day.
 *
 * @param kind - The same date, or the same weekday.
 * @param day - The first day.
 * @returns "on day 10", "on the second Thursday", "on the last Friday".
 */
export function monthlyWords(kind: CalendarRepeat['monthly'], day: string): string {
  const weekday = weekdayWords(day);

  if (kind === 'weekday') {
    const ordinals = [
      translate('calendar.repeat.first', 'first'),
      translate('calendar.repeat.second', 'second'),
      translate('calendar.repeat.third', 'third'),
      translate('calendar.repeat.fourth', 'fourth'),
    ];

    return translate('calendar.repeat.onNthWeekday', 'on the {{nth}} {{weekday}}', {
      nth: ordinals[nthOfMonth(day) - 1] ?? ordinals[3],
      weekday,
    });
  }

  if (kind === 'last_weekday') {
    return translate('calendar.repeat.onLastWeekday', 'on the last {{weekday}}', { weekday });
  }

  return translate('calendar.repeat.onDay', 'on day {{day}}', { day: Number(day.slice(8, 10)) });
}

/**
 * Says how an event repeats.
 *
 * @param rule - The rule.
 * @param first - The series' first day.
 * @returns "Every Thursday", "Every 2 weeks on Friday", "Every month on day 10", "Every year on
 *   17 December".
 */
export function repeatWords(rule: CalendarRepeat, first: string): string {
  const count = rule.every;

  if (rule.unit === 'day') {
    return translate('calendar.repeat.everyDays', {
      count,
      defaultValue_one: 'Every day',
      defaultValue_other: 'Every {{count}} days',
    });
  }

  if (rule.unit === 'week') {
    const days = listFormat({ type: 'conjunction' }).format(
      (rule.weekdays ?? [weekdayOf(first)]).map((weekday) =>
        weekdayName(DAYS_OF_WEEK.indexOf(weekday)),
      ),
    );

    return translate('calendar.repeat.everyWeeks', {
      count,
      days,
      defaultValue_one: 'Every {{days}}',
      defaultValue_other: 'Every {{count}} weeks on {{days}}',
    });
  }

  if (rule.unit === 'month') {
    return translate('calendar.repeat.everyMonths', {
      count,
      on: monthlyWords(rule.monthly, first),
      defaultValue_one: 'Every month {{on}}',
      defaultValue_other: 'Every {{count}} months {{on}}',
    });
  }

  return translate('calendar.repeat.everyYears', {
    count,
    date: dateTimeFormat({ day: 'numeric', month: 'long', timeZone: 'UTC' }).format(noonOf(first)),
    defaultValue_one: 'Every year on {{date}}',
    defaultValue_other: 'Every {{count}} years on {{date}}',
  });
}

/**
 * Says how long until a time today: what the next event of the day carries.
 *
 * @param at - When it starts, ms.
 * @param now - Now, ms.
 * @returns "in 48 min", "in 2 h".
 */
export function untilWords(at: number, now: number): string {
  const minutes = Math.max(1, Math.round((at - now) / 60_000));

  return minutes < 90
    ? translate('calendar.inMinutes', {
        count: minutes,
        defaultValue_one: 'in {{count}} min',
        defaultValue_other: 'in {{count}} min',
      })
    : translate('calendar.inHours', {
        count: Math.round(minutes / 60),
        defaultValue_one: 'in {{count}} h',
        defaultValue_other: 'in {{count}} h',
      });
}
