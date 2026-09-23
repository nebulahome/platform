/**
 * Saying when something happened.
 *
 * The clock is passed in rather than mocked, so these cases do not depend on the machine's
 * timezone or on the moment they run. `Intl` chooses the wording, so the assertions check what
 * the function decides - which unit, and which side of "now" - rather than pinning English.
 */
import { describe, expect, it } from 'vitest';

import { absoluteTime, durationInDays, durationText, relativeTime } from '@/lib/format-time';

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
    // Compared against `Intl`'s own wording rather than against English. The decision being
    // pinned is which unit the function picks and how many of it, and that has to hold on a
    // machine whose locale is not the one this was written on - as the one it was written on
    // proved by answering in Italian.
    const expected = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(
      count,
      unit,
    );

    expect(relativeTime(secondsAgo(seconds), NOW)).toBe(expected);
  });

  it('reads a moment in the future as one', () => {
    // A session whose clock runs slightly ahead should not be described as having last been seen
    // in the past.
    const expected = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(2, 'hour');

    expect(relativeTime(new Date(NOW.getTime() + 7200 * 1000), NOW)).toBe(expected);
  });
});

describe('absoluteTime', () => {
  it('produces something with the year in it', () => {
    expect(absoluteTime(NOW)).toContain('2026');
  });
});

describe('durationInDays', () => {
  it.each([
    [null, 'Forever'],
    [1, '1 day'],
    [30, '30 days'],
    [365, '1 year'],
    [1825, '5 years'],
  ])('calls %j %j', (days, expected) => {
    expect(durationInDays(days)).toBe(expected);
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
