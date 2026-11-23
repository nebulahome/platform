import { describe, expect, it } from 'vitest';

import {
  calendarStateOf,
  expandCalendars,
  isWorkingOn,
  nextChange,
  nextEdge,
  type CalendarEventInput,
  type CalendarInputs,
  type CalendarTime,
} from './calendar-times.js';

const ROME = 'Europe/Rome';
const HOUSE = '10000000-0000-4000-8000-000000000001';
const HOLIDAYS = '10000000-0000-4000-8000-000000000002';
const WASTE = '10000000-0000-4000-8000-000000000003';
const CLOSURES = '10000000-0000-4000-8000-000000000004';
const ORGANIC = '20000000-0000-4000-8000-000000000001';
const GLASS = '20000000-0000-4000-8000-000000000002';

/**
 * An event row with what most tests leave alone.
 *
 * @param event - What this one sets.
 * @returns The row.
 */
function event(
  event: Partial<CalendarEventInput> &
    Pick<CalendarEventInput, 'id' | 'calendarId' | 'title' | 'isAllDay'>,
): CalendarEventInput {
  return {
    modelId: null,
    icon: null,
    startsOn: null,
    endsOn: null,
    startsAt: null,
    endsAt: null,
    timeZone: ROME,
    repeat: null,
    skippedOn: [],
    ...event,
  };
}

const INPUTS: CalendarInputs = {
  calendars: [
    { id: HOUSE, kind: 'house', isDayOff: false },
    { id: HOLIDAYS, kind: 'holidays', isDayOff: true },
    { id: WASTE, kind: 'waste', isDayOff: false },
    { id: CLOSURES, kind: 'custom', isDayOff: true },
  ],
  events: [
    // Organic every Tuesday from 3 November, but the 17th, and the 1st of December moved on.
    event({
      id: '30000000-0000-4000-8000-000000000001',
      calendarId: WASTE,
      modelId: ORGANIC,
      title: 'Organic',
      isAllDay: true,
      startsOn: '2026-11-03',
      endsOn: '2026-11-03',
      repeat: { every: 1, unit: 'week', ends: { kind: 'never' } },
      skippedOn: ['2026-11-17'],
    }),
    event({
      id: '30000000-0000-4000-8000-000000000002',
      calendarId: WASTE,
      modelId: GLASS,
      title: 'Glass',
      isAllDay: true,
      startsOn: '2026-11-24',
      endsOn: '2026-11-24',
    }),
    event({
      id: '30000000-0000-4000-8000-000000000003',
      calendarId: HOUSE,
      title: 'Dinner',
      isAllDay: false,
      startsAt: '2026-11-23T17:00:00.000Z',
      endsAt: '2026-11-23T18:00:00.000Z',
    }),
    event({
      id: '30000000-0000-4000-8000-000000000004',
      calendarId: CLOSURES,
      title: 'Office closed',
      isAllDay: true,
      startsOn: '2026-11-27',
      endsOn: '2026-11-27',
    }),
    event({
      id: '30000000-0000-4000-8000-000000000005',
      calendarId: CLOSURES,
      title: 'Closed in the afternoon',
      isAllDay: false,
      startsAt: '2026-11-30T13:00:00.000Z',
      endsAt: '2026-11-30T17:00:00.000Z',
    }),
  ],
  replaced: new Map([['30000000-0000-4000-8000-000000000001', new Set(['2026-12-01'])]]),
  settings: {
    language: 'en',
    place: { country: 'IT', region: null, town: null },
    patron: null,
    hiddenHolidays: new Set(),
    weekendDays: [5, 6],
  },
  entities: [
    {
      entityId: 'time.boiler_service',
      name: 'Boiler service',
      icon: 'flame',
      calendarId: HOUSE,
      state: { date: { value: '2026-11-26' } },
    },
  ],
};

/**
 * The times of the inputs over November and December 2026.
 *
 * @param inputs - The inputs.
 * @returns The times.
 */
function timesOf(inputs: CalendarInputs = INPUTS): CalendarTime[] {
  return expandCalendars(inputs, '2026-11-01', '2026-12-31', ROME);
}

describe('expandCalendars', () => {
  it('expands a series, leaving out a day deleted and a day another row replaces', () => {
    const organic = timesOf()
      .filter((time) => time.title === 'Organic')
      .map((time) => time.startsOn);

    expect(organic.slice(0, 5)).toEqual([
      '2026-11-03',
      '2026-11-10',
      '2026-11-24',
      '2026-12-08',
      '2026-12-15',
    ]);
  });

  it('puts the holidays in the Holidays calendar, a hidden one left out', () => {
    const shown = timesOf().filter((time) => time.kind === 'holiday');
    const hidden = timesOf({
      ...INPUTS,
      settings: { ...INPUTS.settings, hiddenHolidays: new Set(['it.12_08']) },
    }).filter((time) => time.kind === 'holiday');

    expect(shown.map((time) => time.startsOn)).toContain('2026-12-08');
    expect(shown.every((time) => time.calendarId === HOLIDAYS)).toBe(true);
    expect(hidden.map((time) => time.startsOn)).not.toContain('2026-12-08');
    expect(hidden).toHaveLength(shown.length - 1);
  });

  it('runs an all-day time from midnight to midnight in the house zone', () => {
    const glass = timesOf().find((time) => time.title === 'Glass');

    expect(glass).toMatchObject({
      start: Date.parse('2026-11-23T23:00:00Z'),
      end: Date.parse('2026-11-24T23:00:00Z'),
    });
  });
});

describe('calendarStateOf', () => {
  it('says what is on now and what comes next', () => {
    const times = timesOf();
    const atDinner = calendarStateOf(times, HOUSE, Date.parse('2026-11-23T17:30:00Z'), false);
    const waste = calendarStateOf(times, WASTE, Date.parse('2026-11-23T12:00:00Z'), true);

    expect(atDinner).toMatchObject({
      isActive: true,
      current: { title: 'Dinner', startsAt: '2026-11-23T17:00:00.000Z' },
      next: { title: 'Boiler service', icon: 'flame', isAllDay: true, startsOn: '2026-11-26' },
      isStale: false,
    });
    // Glass and Organic both start on the 24th: the names in order.
    expect(waste).toMatchObject({
      isActive: false,
      current: null,
      next: { title: 'Glass', modelId: GLASS },
      isStale: true,
    });
  });
});

describe('the working-day sensors', () => {
  const times = timesOf();

  it('are off on a weekend day, a holiday and a day a day-off calendar takes whole', () => {
    expect(isWorkingOn('2026-12-07', times, INPUTS.calendars, [5, 6])).toBe(true);
    expect(isWorkingOn('2026-12-05', times, INPUTS.calendars, [5, 6])).toBe(false);
    expect(isWorkingOn('2026-12-08', times, INPUTS.calendars, [5, 6])).toBe(false);
    expect(isWorkingOn('2026-11-27', times, INPUTS.calendars, [5, 6])).toBe(false);
  });

  it('leave a day working when a day-off calendar takes part of it, or the holiday is hidden', () => {
    const hidden = expandCalendars(
      { ...INPUTS, settings: { ...INPUTS.settings, hiddenHolidays: new Set(['it.12_08']) } },
      '2026-11-01',
      '2026-12-31',
      ROME,
    );

    expect(isWorkingOn('2026-11-30', times, INPUTS.calendars, [5, 6])).toBe(true);
    expect(isWorkingOn('2026-12-08', hidden, INPUTS.calendars, [5, 6])).toBe(true);
  });

  it("change at midnight in the house's zone, not in UTC", () => {
    // 23:30 in Rome on Monday 7 December is 22:30 UTC; the day turns at 23:00 UTC.
    expect(nextChange(times, Date.parse('2026-12-07T22:30:00Z'), ROME)).toBe(
      Date.parse('2026-12-07T23:00:00Z'),
    );
  });

  it('change at the next start or end before midnight', () => {
    expect(nextChange(times, Date.parse('2026-11-23T12:00:00Z'), ROME)).toBe(
      Date.parse('2026-11-23T17:00:00Z'),
    );
    expect(nextChange(times, Date.parse('2026-11-23T17:30:00Z'), ROME)).toBe(
      Date.parse('2026-11-23T18:00:00Z'),
    );
  });
});

describe('nextEdge', () => {
  const times = timesOf();
  const after = Date.parse('2026-11-23T12:00:00Z');

  it('fires the evening before an all-day event, for each event at that moment', () => {
    const next = nextEdge(
      times,
      { calendarId: WASTE, edge: 'start', offsetMinutes: -240, modelIds: [] },
      after,
    );

    // Midnight in Rome less four hours: 20:00 on the 23rd, 19:00 UTC.
    expect(next?.at).toBe(Date.parse('2026-11-23T19:00:00Z'));
    expect(next?.times.map((time) => time.title)).toEqual(['Glass', 'Organic']);
  });

  it('keeps to the models asked for', () => {
    const next = nextEdge(
      times,
      { calendarId: WASTE, edge: 'start', offsetMinutes: -240, modelIds: [ORGANIC] },
      Date.parse('2026-11-23T19:00:00Z'),
    );

    // Strictly after 19:00 on the 23rd: the next Organic is 8 December (the 1st moved away).
    expect(next?.at).toBe(Date.parse('2026-12-07T19:00:00Z'));
    expect(next?.times.map((time) => time.title)).toEqual(['Organic']);
  });

  it('fires after the end of a timed event by its offset', () => {
    const next = nextEdge(
      times,
      { calendarId: HOUSE, edge: 'end', offsetMinutes: 30, modelIds: [] },
      after,
    );

    expect(next?.at).toBe(Date.parse('2026-11-23T18:30:00Z'));
    expect(next?.times[0]).toMatchObject({
      eventId: '30000000-0000-4000-8000-000000000003',
      title: 'Dinner',
    });
  });

  it('says nothing is coming in a calendar with nothing ahead', () => {
    expect(
      nextEdge(
        times,
        { calendarId: CLOSURES, edge: 'start', offsetMinutes: 0, modelIds: [] },
        Date.parse('2026-12-31T00:00:00Z'),
      ),
    ).toBeNull();
  });
});
