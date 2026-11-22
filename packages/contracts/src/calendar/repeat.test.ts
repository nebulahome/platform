import { describe, expect, it } from 'vitest';

import { occurrencesOf, type CalendarRepeat, type RepeatingEvent } from './repeat.js';
import { addDays, dayOf, daysBetween, instantOf, wallOf, weekdayOf } from './zoned-time.js';

const ROME = 'Europe/Rome';

/**
 * A timed event in Rome.
 *
 * @param startsAt - ISO start.
 * @param endsAt - ISO end.
 * @param repeat - The rule.
 * @param skippedOn - Days deleted one by one.
 * @returns The event.
 */
function timed(
  startsAt: string,
  endsAt: string,
  repeat: CalendarRepeat | null,
  skippedOn: string[] = [],
): RepeatingEvent {
  return {
    isAllDay: false,
    startsOn: null,
    endsOn: null,
    startsAt,
    endsAt,
    timeZone: ROME,
    repeat,
    skippedOn,
  };
}

/**
 * An all-day event.
 *
 * @param startsOn - First day.
 * @param endsOn - Last day.
 * @param repeat - The rule.
 * @returns The event.
 */
function allDay(startsOn: string, endsOn: string, repeat: CalendarRepeat | null): RepeatingEvent {
  return {
    isAllDay: true,
    startsOn,
    endsOn,
    startsAt: null,
    endsAt: null,
    timeZone: ROME,
    repeat,
    skippedOn: [],
  };
}

/**
 * The days of the times.
 *
 * @param event - The event.
 * @param from - First day.
 * @param to - Last day.
 * @returns The occurrence days.
 */
function days(event: RepeatingEvent, from: string, to: string): string[] {
  return occurrencesOf(event, from, to, ROME).map((time) => time.occurrenceOn);
}

describe('zoned time', () => {
  it('reads days and weekdays', () => {
    expect(weekdayOf('2026-12-03')).toBe('thursday');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-02-27', '2026-03-01')).toBe(2);
    expect(dayOf(2027, 2, 29)).toBeNull();
    expect(dayOf(2028, 2, 29)).toBe('2028-02-29');
  });

  it('finds the instant of a wall clock across daylight saving', () => {
    // Spring: 02:30 does not exist on 29 March 2026 in Rome; it moves on to 03:30.
    expect(new Date(instantOf('2026-03-29', 2.5 * 3600, ROME)).toISOString()).toBe(
      '2026-03-29T01:30:00.000Z',
    );
    // Autumn: 02:30 happens twice on 25 October 2026; the first is taken.
    expect(new Date(instantOf('2026-10-25', 2.5 * 3600, ROME)).toISOString()).toBe(
      '2026-10-25T00:30:00.000Z',
    );
    expect(wallOf(Date.parse('2026-12-03T17:42:00Z'), ROME)).toEqual({
      day: '2026-12-03',
      seconds: 18 * 3600 + 42 * 60,
    });
  });
});

describe('occurrencesOf', () => {
  it('gives a one-off event only when it touches the range', () => {
    const event = timed('2026-12-04T19:30:00Z', '2026-12-04T22:00:00Z', null);

    expect(days(event, '2026-12-01', '2026-12-07')).toEqual(['2026-12-04']);
    expect(days(event, '2026-12-05', '2026-12-07')).toEqual([]);
  });

  it('keeps the wall clock of a weekly event across both changes of the clocks', () => {
    // Thursdays at 18:00 in Rome, from 19 March 2026.
    const event = timed('2026-03-19T17:00:00Z', '2026-03-19T18:00:00Z', {
      every: 1,
      unit: 'week',
      ends: { kind: 'never' },
    });
    const spring = occurrencesOf(event, '2026-03-19', '2026-04-02', ROME);

    expect(spring.map((time) => (time.isAllDay ? '' : time.startsAt))).toEqual([
      '2026-03-19T17:00:00.000Z',
      '2026-03-26T17:00:00.000Z',
      '2026-04-02T16:00:00.000Z',
    ]);

    const autumn = occurrencesOf(event, '2026-10-22', '2026-10-29', ROME);

    expect(autumn.map((time) => (time.isAllDay ? '' : time.startsAt))).toEqual([
      '2026-10-22T16:00:00.000Z',
      '2026-10-29T17:00:00.000Z',
    ]);
  });

  it('repeats on some weekdays every other week, the first time included', () => {
    // Glass: every other Friday from 4 December 2026.
    const event = allDay('2026-12-04', '2026-12-04', {
      every: 2,
      unit: 'week',
      weekdays: ['friday'],
      ends: { kind: 'never' },
    });

    expect(days(event, '2026-12-01', '2027-01-31')).toEqual([
      '2026-12-04',
      '2026-12-18',
      '2027-01-01',
      '2027-01-15',
      '2027-01-29',
    ]);

    // Organic: Monday and Thursday, every week.
    const organic = allDay('2026-11-30', '2026-11-30', {
      every: 1,
      unit: 'week',
      weekdays: ['monday', 'thursday'],
      ends: { kind: 'never' },
    });

    expect(days(organic, '2026-12-01', '2026-12-10')).toEqual([
      '2026-12-03',
      '2026-12-07',
      '2026-12-10',
    ]);
  });

  it('skips months without the date, and 29 February outside leap years', () => {
    const monthly = allDay('2026-01-31', '2026-01-31', {
      every: 1,
      unit: 'month',
      ends: { kind: 'never' },
    });

    expect(days(monthly, '2026-01-01', '2026-06-30')).toEqual([
      '2026-01-31',
      '2026-03-31',
      '2026-05-31',
    ]);

    const leap = allDay('2028-02-29', '2028-02-29', {
      every: 1,
      unit: 'year',
      ends: { kind: 'never' },
    });

    expect(days(leap, '2028-01-01', '2033-12-31')).toEqual(['2028-02-29', '2032-02-29']);
  });

  it('repeats on the nth and on the last weekday of the month', () => {
    // The second Thursday: 10 December 2026.
    const second = allDay('2026-12-10', '2026-12-10', {
      every: 1,
      unit: 'month',
      monthly: 'weekday',
      ends: { kind: 'never' },
    });

    expect(days(second, '2026-12-01', '2027-03-31')).toEqual([
      '2026-12-10',
      '2027-01-14',
      '2027-02-11',
      '2027-03-11',
    ]);

    // The last Friday: 25 December 2026.
    const last = allDay('2026-12-25', '2026-12-25', {
      every: 1,
      unit: 'month',
      monthly: 'last_weekday',
      ends: { kind: 'never' },
    });

    expect(days(last, '2026-12-01', '2027-04-30')).toEqual([
      '2026-12-25',
      '2027-01-29',
      '2027-02-26',
      '2027-03-26',
      '2027-04-30',
    ]);
  });

  it('ends after a count, deleted times included, or on a day', () => {
    const counted = allDay('2026-12-03', '2026-12-03', {
      every: 1,
      unit: 'day',
      ends: { kind: 'after', count: 4 },
    });

    expect(days({ ...counted, skippedOn: ['2026-12-04'] }, '2026-12-01', '2026-12-31')).toEqual([
      '2026-12-03',
      '2026-12-05',
      '2026-12-06',
    ]);

    const until = allDay('2026-12-03', '2026-12-03', {
      every: 3,
      unit: 'day',
      ends: { kind: 'on', day: '2026-12-12' },
    });

    expect(days(until, '2026-12-01', '2026-12-31')).toEqual([
      '2026-12-03',
      '2026-12-06',
      '2026-12-09',
      '2026-12-12',
    ]);
  });

  it('leaves out replaced times and starts mid-series', () => {
    const event = allDay('2026-01-01', '2026-01-01', {
      every: 1,
      unit: 'week',
      ends: { kind: 'never' },
    });
    const times = occurrencesOf(event, '2026-12-01', '2026-12-31', ROME, new Set(['2026-12-17']));

    expect(times.map((time) => time.occurrenceOn)).toEqual([
      '2026-12-03',
      '2026-12-10',
      '2026-12-24',
      '2026-12-31',
    ]);
  });

  it('gives a multi-day event that started before the range', () => {
    // Aunt Carla, 2 to 5 December.
    const stay = allDay('2026-12-02', '2026-12-05', null);

    expect(occurrencesOf(stay, '2026-12-04', '2026-12-10', ROME)).toEqual([
      { occurrenceOn: '2026-12-02', isAllDay: true, startsOn: '2026-12-02', endsOn: '2026-12-05' },
    ]);
  });
});
