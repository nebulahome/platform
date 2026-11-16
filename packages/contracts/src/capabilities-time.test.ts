import { describe, expect, it } from 'vitest';

import {
  capabilityStateSchema,
  dateCommandSchema,
  dateParamsSchema,
  datetimeCommandSchema,
  datetimeParamsSchema,
  secondsOfDay,
  timeOfDayCommandSchema,
  timeOfDayParamsSchema,
} from './capabilities.js';
import { DOMAIN_CAPABILITIES } from './entity-id.js';
import { stateTokenOf } from './entity-state-token.js';

describe('the time domain', () => {
  it('is one domain with a time of day, a date or a moment', () => {
    expect(DOMAIN_CAPABILITIES.time).toEqual({
      oneOf: ['time_of_day', 'date', 'datetime'],
      may: [],
    });
  });

  it('reads a time of day on a 24-hour clock, with or without seconds', () => {
    expect(timeOfDayCommandSchema.safeParse({ command: 'set_value', value: '07:30' }).success).toBe(
      true,
    );
    expect(
      timeOfDayCommandSchema.safeParse({ command: 'set_value', value: '23:59:59' }).success,
    ).toBe(true);
    expect(timeOfDayCommandSchema.safeParse({ command: 'set_value', value: '24:00' }).success).toBe(
      false,
    );
    expect(timeOfDayCommandSchema.safeParse({ command: 'set_value', value: '7:30' }).success).toBe(
      false,
    );
    expect(secondsOfDay('07:30')).toBe(27_000);
    expect(secondsOfDay('00:00:05')).toBe(5);
  });

  it('refuses a day the calendar does not have', () => {
    expect(dateCommandSchema.safeParse({ command: 'set_value', value: '2028-02-29' }).success).toBe(
      true,
    );
    expect(dateCommandSchema.safeParse({ command: 'set_value', value: '2026-02-30' }).success).toBe(
      false,
    );
    expect(dateCommandSchema.safeParse({ command: 'set_value', value: '24/11/2026' }).success).toBe(
      false,
    );
  });

  it('wants a moment with its offset, never a bare wall-clock time', () => {
    for (const value of ['2026-11-24T07:30:00Z', '2026-11-24T07:30:00+01:00']) {
      expect(datetimeCommandSchema.safeParse({ command: 'set_value', value }).success, value).toBe(
        true,
      );
    }

    expect(
      datetimeCommandSchema.safeParse({ command: 'set_value', value: '2026-11-24T07:30:00' })
        .success,
    ).toBe(false);
  });

  it('is read only unless it says the house may set it', () => {
    expect(timeOfDayParamsSchema.parse({})).toEqual({ canSet: false, step: 60 });
    expect(dateParamsSchema.parse({ canSet: true })).toEqual({ canSet: true });
    expect(datetimeParamsSchema.parse({})).toEqual({ canSet: false, step: 60 });
  });

  it('refuses limits out of order', () => {
    expect(timeOfDayParamsSchema.safeParse({ min: '22:00', max: '06:00' }).success).toBe(false);
    expect(timeOfDayParamsSchema.safeParse({ min: '06:00', max: '22:00' }).success).toBe(true);
    expect(dateParamsSchema.safeParse({ min: '2026-12-01', max: '2026-11-01' }).success).toBe(
      false,
    );
    expect(
      datetimeParamsSchema.safeParse({
        min: '2026-11-24T08:00:00+01:00',
        max: '2026-11-24T07:30:00Z',
      }).success,
    ).toBe(true);
  });

  it('keeps a value not known yet as null, and compares by the value', () => {
    expect(capabilityStateSchema.parse({ date: {} })).toEqual({ date: { value: null } });
    expect(stateTokenOf({ time_of_day: { value: '07:30' } })).toBe('07:30');
    expect(stateTokenOf({ datetime: { value: null } })).toBeUndefined();
  });
});
