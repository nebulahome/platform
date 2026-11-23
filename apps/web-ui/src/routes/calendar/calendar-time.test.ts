import { describe, expect, it } from 'vitest';

import {
  firstDayOf,
  isOn,
  lastDayOf,
  rangeOf,
  repeatWords,
  stepDay,
  type OccurrenceTimes,
} from './calendar-time';

describe('the days a view shows', () => {
  it('runs a month over six weeks from the Monday before its first', () => {
    expect(rangeOf('month', '2026-12-03')).toEqual({ from: '2026-11-30', to: '2027-01-10' });
    expect(rangeOf('week', '2026-12-06')).toEqual({ from: '2026-11-30', to: '2026-12-06' });
    expect(rangeOf('year', '2027-05-04')).toEqual({ from: '2027-01-01', to: '2027-12-31' });
    expect(rangeOf('agenda', '2026-12-03')).toEqual({ from: '2026-12-03', to: '2026-12-09' });
  });

  it('steps a month from its first day, across a year', () => {
    expect(stepDay('month', '2026-12-31', 1)).toBe('2027-01-01');
    expect(stepDay('month', '2026-03-31', -1)).toBe('2026-02-01');
    expect(stepDay('week', '2026-12-03', 1)).toBe('2026-12-10');
    expect(stepDay('year', '2026-12-03', -1)).toBe('2025-01-01');
  });
});

describe('the days an occurrence is on, in the house', () => {
  const late: OccurrenceTimes = {
    isAllDay: false,
    startsOn: null,
    endsOn: null,
    startsAt: '2026-12-03T22:30:00Z',
    endsAt: '2026-12-03T23:00:00Z',
  };

  it('reads a timed one on the house’s clock, and one that ends at midnight is not on the next day', () => {
    // 23:30 to midnight in Rome.
    expect(firstDayOf(late, 'Europe/Rome')).toBe('2026-12-03');
    expect(lastDayOf(late, 'Europe/Rome')).toBe('2026-12-03');
    expect(isOn(late, '2026-12-04', 'Europe/Rome')).toBe(false);
    // The same instants are the next day in Tokyo.
    expect(firstDayOf(late, 'Asia/Tokyo')).toBe('2026-12-04');
  });
});

describe('how an event repeats, in words', () => {
  it('says the rule as the boards do', () => {
    expect(
      repeatWords(
        { every: 1, unit: 'week', weekdays: ['thursday'], ends: { kind: 'never' } },
        '2026-11-05',
      ),
    ).toBe('Every Thursday');
    expect(
      repeatWords(
        { every: 1, unit: 'week', weekdays: ['monday', 'wednesday'], ends: { kind: 'never' } },
        '2026-11-02',
      ),
    ).toBe('Every Monday and Wednesday');
    expect(
      repeatWords(
        { every: 1, unit: 'month', monthly: 'weekday', ends: { kind: 'never' } },
        '2026-12-10',
      ),
    ).toBe('Every month on the second Thursday');
    expect(repeatWords({ every: 3, unit: 'day', ends: { kind: 'never' } }, '2026-12-10')).toBe(
      'Every 3 days',
    );
  });
});
