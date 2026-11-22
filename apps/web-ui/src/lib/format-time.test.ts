/**
 * Saying when something happened.
 *
 * The clock is passed in rather than mocked, so these cases do not depend on the machine's
 * timezone or on the moment they run. `Intl` chooses the wording, in the interface's language, so
 * the assertions check what the function decides - which unit, and which side of "now" - rather
 * than pinning English.
 */
import { describe, expect, it } from 'vitest';

import { relativeTimeFormat } from '@/i18n/formatters';
import {
  absoluteTime,
  durationText,
  formatUptime,
  largestUnitText,
  readDateTimeLocal,
  relativeTime,
  startOfDay,
  toDateTimeLocal,
} from '@/lib/format-time';

/** A fixed moment to measure everything against. */
const NOW = new Date('2026-09-05T12:00:00.000Z');

/**
 * A moment some number of seconds before {@link NOW}.
 *
 * @param seconds - How long ago.
 * @returns The moment.
 */
function secondsAgo(seconds: number): Date {
  return new Date(NOW.getTime() - seconds * 1000);
}

describe('relativeTime', () => {
  it('calls anything inside the last minute now', () => {
    expect(relativeTime(secondsAgo(0), NOW)).toBe('now');
    expect(relativeTime(secondsAgo(30), NOW)).toBe('now');
  });

  it.each<[number, number, Intl.RelativeTimeFormatUnit]>([
    [120, -2, 'minute'],
    [7200, -2, 'hour'],
    [3 * 86_400, -3, 'day'],
    [14 * 86_400, -2, 'week'],
    [90 * 86_400, -3, 'month'],
    [800 * 86_400, -2, 'year'],
  ])('measures %d seconds as %d %ss', (seconds, count, unit) => {
    // Compared against `Intl`'s own wording, in the interface's language, rather than against
    // English. The decision being pinned is which unit the function picks and how many of it.
    const expected = relativeTimeFormat({ numeric: 'auto' }).format(count, unit);

    expect(relativeTime(secondsAgo(seconds), NOW)).toBe(expected);
  });

  it('reads a moment in the future as one', () => {
    // A session whose clock runs slightly ahead should not be described as having last been seen
    // in the past.
    const expected = relativeTimeFormat({ numeric: 'auto' }).format(2, 'hour');

    expect(relativeTime(new Date(NOW.getTime() + 7200 * 1000), NOW)).toBe(expected);
  });
});

describe('absoluteTime', () => {
  it('produces something with the year in it', () => {
    expect(absoluteTime(NOW)).toContain('2026');
  });
});

describe('durationText', () => {
  it('names the two largest units that matter', () => {
    expect(durationText(30_000)).toBe('under a minute');
    expect(durationText(45 * 60_000)).toBe('45 min');
    expect(durationText(200 * 60_000)).toBe('3 h 20 min');
    expect(durationText(3 * 3_600_000)).toBe('3 h');
    expect(durationText(52 * 3_600_000)).toBe('2 d 4 h');
  });
});

describe('largestUnitText', () => {
  it('says when something was last heard from, seconds included, as a device row does', () => {
    const seen = (ms: number): string => largestUnitText(ms, { hasSeconds: true });

    expect(seen(-5_000)).toBe('0 s');
    expect(seen(40_000)).toBe('40 s');
    expect(seen(59_400)).toBe('59 s');
    expect(seen(59_600)).toBe('1 min');
    expect(seen(3_599_000)).toBe('59 min');
    expect(seen(3_600_000)).toBe('1 h');
    expect(seen(86_399_000)).toBe('23 h');
    expect(seen(3 * 86_400_000)).toBe('3 d');
  });

  it('says how long something has lasted, a minute at least and days in words, as Matter does', () => {
    const lasted = (ms: number): string => largestUnitText(ms, { isDaysSpelledOut: true });

    expect(lasted(-60_000)).toBe('1 min');
    expect(lasted(30_000)).toBe('1 min');
    expect(lasted(59 * 60_000)).toBe('59 min');
    expect(lasted(3 * 3_600_000)).toBe('3 h');
    expect(lasted(24 * 3_600_000)).toBe('1 day');
    expect(lasted(73 * 3_600_000)).toBe('3 days');
  });
});

describe('the datetime-local field', () => {
  it('writes a moment to the minute, and reads it back as the same moment', () => {
    const when = new Date(2026, 8, 3, 14, 5, 0).getTime();

    expect(toDateTimeLocal(when)).toBe('2026-09-03T14:05');
    expect(readDateTimeLocal('2026-09-03T14:05')).toBe(when);
  });

  it('reads nothing from a field left empty or half typed', () => {
    expect(readDateTimeLocal('')).toBeNull();
    expect(readDateTimeLocal('2026-09-03')).toBeNull();
  });
});

describe('formatUptime', () => {
  it('says how long in its two largest units, as a duration is said', () => {
    expect([
      formatUptime(3 * 86_400 + 4 * 3600 + 59),
      formatUptime(5 * 3600 + 12 * 60),
      formatUptime(2 * 3600),
      formatUptime(12 * 60 + 5),
      formatUptime(30),
    ]).toEqual(['3 d 4 h', '5 h 12 min', '2 h', '12 min', 'under a minute']);
  });
});

describe('startOfDay', () => {
  it('finds the midnight a moment, or a day before it, begins at', () => {
    const evening = new Date(2026, 10, 21, 18, 30);

    expect(startOfDay(evening)).toBe(new Date(2026, 10, 21).getTime());
    expect(startOfDay(evening, 2)).toBe(new Date(2026, 10, 19).getTime());
  });
});
