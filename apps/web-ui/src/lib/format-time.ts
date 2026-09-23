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
