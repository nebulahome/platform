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
    return 'now';
  }

  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
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
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    when,
  );
}

/**
 * Names a moment briefly: day, month and time, with the year only when it is not this one.
 *
 * @param when - The moment.
 * @param now - What "this year" is measured against.
 * @returns A phrase such as `3 Sep, 14:00`, in the browser's locale and zone.
 */
export function shortTime(when: Date, now: Date = new Date()): string {
  return new Intl.DateTimeFormat(undefined, {
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
 * Says how long a duration in days is, in words.
 *
 * @param days - The number of days, or null for "kept forever".
 * @returns A phrase such as `30 days`, `1 year` or `Forever`.
 */
export function durationInDays(days: number | null): string {
  if (days === null) {
    return 'Forever';
  }

  if (days % 365 === 0 && days >= 365) {
    const years = days / 365;

    return years === 1 ? '1 year' : `${String(years)} years`;
  }

  return days === 1 ? '1 day' : `${String(days)} days`;
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
    return 'under a minute';
  }

  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;

  if (days > 0) {
    return hours > 0 ? `${String(days)} d ${String(hours)} h` : `${String(days)} d`;
  }

  if (hours > 0) {
    return rest > 0 ? `${String(hours)} h ${String(rest)} min` : `${String(hours)} h`;
  }

  return `${String(rest)} min`;
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
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86_400_000;

  if (when.getTime() >= startOfToday) {
    return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(when);
  }

  if (when.getTime() >= startOfToday - day) {
    return 'yesterday';
  }

  // In English, as the words around it are: "Ran Monday", not half in the browser's language.
  if (when.getTime() >= startOfToday - 6 * day) {
    return new Intl.DateTimeFormat('en', { weekday: 'long' }).format(when);
  }

  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(when.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  }).format(when);
}
