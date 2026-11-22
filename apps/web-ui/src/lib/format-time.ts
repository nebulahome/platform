/**
 * Saying when something happened.
 *
 * Two forms, and the choice between them is not cosmetic. "3 days ago" is what a person needs to
 * judge a row - whether a session is theirs, whether a token is still in use - because it answers
 * the question without arithmetic. The exact moment is what they need once something looks wrong,
 * so it goes in the `title`, where hovering or focusing reveals it.
 *
 * Both use `Intl`, so both follow the browser's own locale and time zone rather than a format
 * chosen here. A date rendered as `03/04` is ambiguous in exactly the way that matters.
 */
import { dateTimeFormat, relativeTimeFormat } from '@/i18n/formatters';
import { translate } from '@/i18n/messages';

/** The thresholds, largest first: how many seconds a unit holds. */
const UNITS: readonly { readonly unit: Intl.RelativeTimeFormatUnit; readonly seconds: number }[] = [
  { unit: 'year', seconds: 31_536_000 },
  { unit: 'month', seconds: 2_592_000 },
  { unit: 'week', seconds: 604_800 },
  { unit: 'day', seconds: 86_400 },
  { unit: 'hour', seconds: 3600 },
  { unit: 'minute', seconds: 60 },
];

/** How close to now still counts as now. */
const JUST_NOW_SECONDS = 45;

/**
 * Says how long ago something happened, in words.
 *
 * @param when - The moment.
 * @param now - What to measure against. Injected so a test does not depend on the wall clock.
 * @returns A phrase such as `3 days ago`, or `now` for anything inside the last minute.
 */
export function relativeTime(when: Date, now: Date = new Date()): string {
  const seconds = Math.round((now.getTime() - when.getTime()) / 1000);

  if (Math.abs(seconds) < JUST_NOW_SECONDS) {
    return translate('time.now', 'now');
  }

  const format = relativeTimeFormat({ numeric: 'auto' });
  const match = UNITS.find((entry) => Math.abs(seconds) >= entry.seconds);

  if (match === undefined) {
    return format.format(-seconds, 'second');
  }

  return format.format(-Math.round(seconds / match.seconds), match.unit);
}

/**
 * Says exactly when something happened.
 *
 * @param when - The moment.
 * @returns The date and time, in the browser's locale and zone.
 */
export function absoluteTime(when: Date): string {
  return dateTimeFormat({ dateStyle: 'medium', timeStyle: 'short' }).format(when);
}

/**
 * Names a moment briefly: day, month and time, with the year only when it is not this one.
 *
 * @param when - The moment.
 * @param now - What "this year" is measured against.
 * @returns A phrase such as `3 Sep, 14:00`, in the browser's locale and zone.
 */
export function shortTime(when: Date, now: Date = new Date()): string {
  return dateTimeFormat({
    day: 'numeric',
    month: 'short',
    ...(when.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
  }).format(when);
}

/**
 * Writes a moment the way a `datetime-local` field holds it: local time, to the minute.
 *
 * @param when - The moment, in milliseconds since the epoch.
 * @returns `YYYY-MM-DDTHH:mm`.
 */
export function toDateTimeLocal(when: number): string {
  const date = new Date(when);
  /**
   * Writes a part of the date in two digits.
   *
   * @param value - The part.
   * @returns It, with a leading zero when it needs one.
   */
  const two = (value: number): string => String(value).padStart(2, '0');

  return (
    `${String(date.getFullYear())}-${two(date.getMonth() + 1)}-${two(date.getDate())}` +
    `T${two(date.getHours())}:${two(date.getMinutes())}`
  );
}

/**
 * Reads what a `datetime-local` field holds, as local time.
 *
 * @param value - `YYYY-MM-DDTHH:mm`, or whatever the field was left with.
 * @returns The moment in milliseconds since the epoch, or null when it does not read.
 */
export function readDateTimeLocal(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u.test(value)) {
    return null;
  }

  // Without a zone, a date-time string is read as local time: what the field shows is what it is.
  const when = new Date(value).getTime();

  return Number.isNaN(when) ? null : when;
}

/**
 * Says the time of day of a moment: 21:48.
 *
 * @param at - The moment, or milliseconds since the epoch.
 * @returns The time, in the interface's language.
 */
export function clockText(at: Date | number): string {
  return dateTimeFormat({ hour: '2-digit', minute: '2-digit' }).format(at);
}

/**
 * The midnight a moment's day begins at, on this browser's calendar.
 *
 * @param when - The moment.
 * @param daysBefore - How many days earlier: a day counted on the calendar, so a change of clocks
 *   does not shift it.
 * @returns The midnight, in milliseconds since the epoch.
 */
export function startOfDay(when: Date, daysBefore = 0): number {
  return new Date(when.getFullYear(), when.getMonth(), when.getDate() - daysBefore).getTime();
}

/**
 * Says how long a stretch of time lasted, to the two largest units that matter.
 *
 * @param ms - The length, in milliseconds.
 * @returns A phrase such as `3 h 20 min`, `2 d 4 h`, `45 min`, or `under a minute`.
 */
export function durationText(ms: number): string {
  const minutes = Math.floor(ms / 60_000);

  if (minutes < 1) {
    return translate('time.underMinute', 'under a minute');
  }

  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;

  if (days > 0) {
    return hours > 0
      ? translate('time.short.daysHours', '{{days}} d {{hours}} h', { days, hours })
      : translate('time.short.days', '{{days}} d', { days });
  }

  if (hours > 0) {
    return rest > 0
      ? translate('time.short.hoursMinutes', '{{hours}} h {{minutes}} min', {
          hours,
          minutes: rest,
        })
      : translate('time.short.hours', '{{hours}} h', { hours });
  }

  return translate('time.short.minutes', '{{minutes}} min', { minutes: rest });
}

/**
 * Names the moment a run happened, as briefly as the list can: the time today, "yesterday", the
 * weekday within the week, the date before that.
 *
 * @param when - The moment.
 * @param now - What "today" is measured against.
 * @returns `08:14`, `yesterday`, `Monday`, `3 Sep`.
 */
export function runMoment(when: Date, now: Date = new Date()): string {
  const startOfToday = startOfDay(now);
  const day = 86_400_000;

  if (when.getTime() >= startOfToday) {
    return clockText(when);
  }

  if (when.getTime() >= startOfToday - day) {
    return translate('time.yesterday', 'yesterday');
  }

  // In the language the words around it are in, as "Ran Monday" is.
  if (when.getTime() >= startOfToday - 6 * day) {
    return dateTimeFormat({ weekday: 'long' }).format(when);
  }

  return dateTimeFormat({
    day: 'numeric',
    month: 'short',
    ...(when.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  }).format(when);
}

/**
 * Writes how long something has been up, in its two largest units.
 *
 * @param seconds - The span.
 * @returns `3 d 4 h`, `5 h 12 min`, `2 h`, `12 min`, `under a minute`.
 */
export function formatUptime(seconds: number): string {
  return durationText(seconds * 1000);
}
