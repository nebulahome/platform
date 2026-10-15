/**
 * The time zones offered for the house: UTC first, then the browser's, each with its offset.
 */
import { describe, expect, it } from 'vitest';

import { BROWSER_ZONE, TIME_ZONES, timeZoneChoices, zoneName, zoneOffset } from './time-zones';

describe('the zones offered', () => {
  it('starts with UTC and the browser’s own, each once', () => {
    expect(TIME_ZONES[0]).toBe('UTC');
    expect(TIME_ZONES).toContain(BROWSER_ZONE);
    expect(new Set(TIME_ZONES).size).toBe(TIME_ZONES.length);
  });

  it('reads a zone the way people do, with its offset at the moment asked', () => {
    const summer = new Date('2026-07-01T12:00:00Z');
    const winter = new Date('2026-01-15T12:00:00Z');

    expect(zoneName('America/New_York')).toBe('America/New York');
    expect(zoneOffset('Europe/Rome', summer)).toBe('UTC+2');
    expect(zoneOffset('Europe/Rome', winter)).toBe('UTC+1');
    expect(zoneOffset('Asia/Kolkata', winter)).toBe('UTC+5:30');
    expect(zoneOffset('UTC', winter)).toBe('UTC');
  });

  it('labels each choice with its offset', () => {
    const choices = timeZoneChoices(new Date('2026-07-01T12:00:00Z'));

    expect(choices[0]).toEqual({ value: 'UTC', label: 'UTC' });
    expect(choices.find((choice) => choice.value === 'Europe/Rome')?.label).toBe(
      'Europe/Rome · UTC+2',
    );
  });
});
