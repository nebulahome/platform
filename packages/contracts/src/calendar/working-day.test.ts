import { describe, expect, it } from 'vitest';

import { holidaysOf } from './holidays.js';
import { longWeekendsOf } from './long-weekends.js';
import { isWorkingDay } from './working-day.js';

/** Saturday and Sunday, Monday being 0. */
const WEEKEND = [5, 6];

/**
 * The days of the Italian holidays of a year, at a town.
 *
 * @param year - The year.
 * @param town - The town, or null for the national ones alone.
 * @returns The days.
 */
function italianHolidays(year: number, town: string | null = null): Set<string> {
  return new Set(
    holidaysOf(year, { country: 'IT', region: null, town }, 'it').map((holiday) => holiday.date),
  );
}

describe('a working day', () => {
  const none = new Set<string>();

  it('is a weekday that is no holiday and no day off', () => {
    expect(isWorkingDay('2026-11-24', WEEKEND, none, none)).toBe(true);
    expect(isWorkingDay('2026-11-28', WEEKEND, none, none)).toBe(false);
    expect(isWorkingDay('2026-11-29', WEEKEND, none, none)).toBe(false);
    expect(isWorkingDay('2026-12-08', WEEKEND, italianHolidays(2026), none)).toBe(false);
    expect(isWorkingDay('2026-11-24', WEEKEND, none, new Set(['2026-11-24']))).toBe(false);
  });

  it('follows the weekend the house keeps', () => {
    // Friday and Saturday.
    expect(isWorkingDay('2026-11-27', [4, 5], none, none)).toBe(false);
    expect(isWorkingDay('2026-11-29', [4, 5], none, none)).toBe(true);
  });

  it('makes 7 December a day off in Milan alone', () => {
    expect(isWorkingDay('2026-12-07', WEEKEND, italianHolidays(2026, 'Milano'), none)).toBe(false);
    expect(isWorkingDay('2026-12-07', WEEKEND, italianHolidays(2026, 'RM'), none)).toBe(true);
  });
});

describe('the long weekends of a year', () => {
  it('finds the Italian ones of 2027, and the holidays lost to a weekend', () => {
    const marks = longWeekendsOf('2027-01-01', '2027-12-31', WEEKEND, italianHolidays(2027));

    expect(marks.longWeekends).toEqual([
      { from: '2027-01-01', to: '2027-01-03', days: 3, bridge: null, holidays: ['2027-01-01'] },
      { from: '2027-03-27', to: '2027-03-29', days: 3, bridge: null, holidays: ['2027-03-29'] },
      { from: '2027-10-02', to: '2027-10-04', days: 3, bridge: null, holidays: ['2027-10-04'] },
      { from: '2027-10-30', to: '2027-11-01', days: 3, bridge: null, holidays: ['2027-11-01'] },
    ]);
    expect(marks.weekendHolidays).toEqual([
      '2027-03-28',
      '2027-04-25',
      '2027-05-01',
      '2027-08-15',
      '2027-12-25',
      '2027-12-26',
    ]);
  });

  it('offers the bridge when one working day sits between a holiday and the weekend', () => {
    const marks = longWeekendsOf('2026-05-01', '2026-06-30', WEEKEND, italianHolidays(2026));

    expect(marks.longWeekends).toContainEqual({
      from: '2026-05-30',
      to: '2026-06-02',
      days: 4,
      bridge: '2026-06-01',
      holidays: ['2026-06-02'],
    });
  });

  it("needs no bridge in Milan, where Sant'Ambrogio fills the Monday", () => {
    const rome = longWeekendsOf('2026-12-01', '2026-12-10', WEEKEND, italianHolidays(2026, 'RM'));
    const milan = longWeekendsOf(
      '2026-12-01',
      '2026-12-10',
      WEEKEND,
      italianHolidays(2026, 'Milano'),
    );

    expect(rome.longWeekends).toEqual([
      {
        from: '2026-12-05',
        to: '2026-12-08',
        days: 4,
        bridge: '2026-12-07',
        holidays: ['2026-12-08'],
      },
    ]);
    expect(milan.longWeekends).toEqual([
      {
        from: '2026-12-05',
        to: '2026-12-08',
        days: 4,
        bridge: null,
        holidays: ['2026-12-07', '2026-12-08'],
      },
    ]);
  });

  it('takes no two working days off as a bridge', () => {
    // 6 January 2027 is a Wednesday: Monday and Tuesday sit between it and the weekend.
    const marks = longWeekendsOf('2027-01-04', '2027-01-08', WEEKEND, italianHolidays(2027));

    expect(marks.longWeekends).toEqual([]);
  });
});
