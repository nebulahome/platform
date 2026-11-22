import { describe, expect, it } from 'vitest';

import { capabilityStateSchema, commandSchemaFor } from '../capabilities.js';
import { DOMAIN_CAPABILITIES, PLATFORM_ENTITY_DOMAINS } from '../entity-id.js';
import { stateTokenOf } from '../entity-state-token.js';
import { isReservedDeviceId } from '../system-monitor.js';

import {
  calendarEventScopeQuerySchema,
  calendarEventWriteSchema,
  calendarIcsStateSchema,
  calendarOccurrencesQuerySchema,
  calendarPatronSchema,
  calendarUpdateSchema,
} from './calendar-schemas.js';

const CALENDAR = '6f1c2a52-8a3e-4d6b-9b8e-2f1d3c4b5a69';

describe('an event', () => {
  it('takes days when all day and instants when timed', () => {
    expect(
      calendarEventWriteSchema.safeParse({
        calendarId: CALENDAR,
        title: 'Glass',
        isAllDay: true,
        startsOn: '2026-11-24',
        endsOn: '2026-11-24',
      }).success,
    ).toBe(true);
    expect(
      calendarEventWriteSchema.safeParse({
        calendarId: CALENDAR,
        title: 'Swimming',
        isAllDay: false,
        startsAt: '2026-11-24T17:00:00Z',
        endsAt: '2026-11-24T18:00:00+01:00',
      }).success,
    ).toBe(true);
  });

  it('refuses days on a timed event, instants on an all-day one, and an end before the start', () => {
    for (const event of [
      { isAllDay: true, startsAt: '2026-11-24T17:00:00Z', endsAt: '2026-11-24T18:00:00Z' },
      { isAllDay: false, startsOn: '2026-11-24', endsOn: '2026-11-24' },
      { isAllDay: true, startsOn: '2026-11-24', endsOn: '2026-11-23' },
      { isAllDay: false, startsAt: '2026-11-24T18:00:00Z', endsAt: '2026-11-24T17:00:00Z' },
    ]) {
      expect(
        calendarEventWriteSchema.safeParse({ calendarId: CALENDAR, title: 'X', ...event }).success,
      ).toBe(false);
    }
  });

  it('needs the day of the time a change of one time is for', () => {
    expect(calendarEventScopeQuerySchema.parse({})).toEqual({ scope: 'all' });
    expect(calendarEventScopeQuerySchema.safeParse({ scope: 'one' }).success).toBe(false);
    expect(
      calendarEventScopeQuerySchema.safeParse({ scope: 'one', occurrenceOn: '2026-11-26' }).success,
    ).toBe(true);
  });
});

describe('the rest of the calendar shapes', () => {
  it('reads occurrences 400 days at most, never backwards', () => {
    expect(
      calendarOccurrencesQuerySchema.parse({
        from: '2026-01-01',
        to: '2027-02-05',
        calendars: `${CALENDAR},`,
      }),
    ).toEqual({ from: '2026-01-01', to: '2027-02-05', calendars: [CALENDAR] });
    expect(
      calendarOccurrencesQuerySchema.safeParse({ from: '2026-01-01', to: '2027-02-06' }).success,
    ).toBe(false);
    expect(
      calendarOccurrencesQuerySchema.safeParse({ from: '2026-01-02', to: '2026-01-01' }).success,
    ).toBe(false);
  });

  it('reads the {} a calendar starts with as a source never tried', () => {
    expect(calendarIcsStateSchema.parse({})).toMatchObject({
      lastAttemptAt: null,
      error: null,
      eventCount: 0,
    });
  });

  it('keeps one source a calendar', () => {
    expect(
      calendarUpdateSchema.safeParse({ icsUrl: 'webcal://example.com/a.ics', icsFileId: CALENDAR })
        .success,
    ).toBe(false);
    expect(calendarUpdateSchema.safeParse({ icsUrl: null, icsFileId: CALENDAR }).success).toBe(
      true,
    );
    expect(calendarUpdateSchema.safeParse({ icsUrl: 'ftp://example.com/a.ics' }).success).toBe(
      false,
    );
  });

  it('takes a typed patron on a day some year has', () => {
    expect(calendarPatronSchema.safeParse({ name: 'X', month: 2, day: 29 }).success).toBe(true);
    expect(calendarPatronSchema.safeParse({ name: 'X', month: 2, day: 30 }).success).toBe(false);
  });
});

describe('the calendar entity', () => {
  it('is read only, on while an event is, and says on or off', () => {
    expect(DOMAIN_CAPABILITIES.calendar).toEqual({ oneOf: ['calendar'], may: [] });
    expect(commandSchemaFor('calendar')).toBeNull();
    expect(capabilityStateSchema.parse({ calendar: { isActive: false } })).toEqual({
      calendar: { isActive: false, current: null, next: null, isStale: false },
    });
    expect(
      stateTokenOf({ calendar: { isActive: true, current: null, next: null, isStale: false } }),
    ).toBe('on');
  });

  it('is no integration’s to declare', () => {
    expect(PLATFORM_ENTITY_DOMAINS).toContain('calendar');
    expect(isReservedDeviceId('calendar')).toBe(true);
  });
});
