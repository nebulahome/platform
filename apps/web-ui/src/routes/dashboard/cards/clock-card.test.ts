import { describe, expect, it } from 'vitest';

import { calendarDay } from '@/routes/dashboard/cards/clock-card';

describe('calendarDay', () => {
  it('counts the ISO week and the day of the year', () => {
    // The boards' Thursday 1 October, in a leap year.
    expect(calendarDay(2020, 10, 1)).toEqual({ week: 40, day: 275 });
    expect(calendarDay(2026, 11, 17)).toEqual({ week: 47, day: 321 });
  });

  it('gives the first days of a year to the last week of the year before', () => {
    expect(calendarDay(2021, 1, 1)).toEqual({ week: 53, day: 1 });
    expect(calendarDay(2024, 12, 30).week).toBe(1);
  });
});
