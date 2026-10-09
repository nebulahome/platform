/**
 * The sun, worked out here rather than asked for.
 *
 * Checked against the times almanacs print for Milan (a minute either way: the formulas are good
 * to about that), and against the polar day and night of Tromsø, which is where an event that
 * "happens every day" stops happening and a careless search walks for ever.
 */
import { describe, expect, it } from 'vitest';

import { isSunPhase, nextSunEvent, sunPhaseLabel, sunPosition, sunState, sunTimes } from './sun.js';

const MILAN = { latitude: 45.4642, longitude: 9.19 };
const TROMSO = { latitude: 69.6492, longitude: 18.9553 };
const EQUATOR = { latitude: 0, longitude: 0 };

/**
 * Expects an instant within a tolerance of another.
 *
 * @param actual - What was worked out.
 * @param expected - What the almanac says, as an ISO string.
 * @param toleranceMs - How far off it may be; two minutes unless said.
 */
function expectNear(actual: Date | null, expected: string, toleranceMs = 120_000): void {
  expect(actual).not.toBeNull();
  expect(Math.abs((actual?.getTime() ?? 0) - Date.parse(expected))).toBeLessThanOrEqual(
    toleranceMs,
  );
}

describe('sunTimes', () => {
  it('gives Milan its midsummer and midwinter days', () => {
    const june = sunTimes(new Date('2026-06-21T12:00:00Z'), MILAN);
    const december = sunTimes(new Date('2026-12-21T12:00:00Z'), MILAN);

    // 05:34 and 21:15 summer time; 08:00 and 16:42 winter time.
    expectNear(june.sunrise, '2026-06-21T03:34:40Z');
    expectNear(june.sunset, '2026-06-21T19:15:35Z');
    expectNear(december.sunrise, '2026-12-21T07:00:05Z');
    expectNear(december.sunset, '2026-12-21T15:42:35Z');
  });

  it('has no sunrise in the polar night', () => {
    const times = sunTimes(new Date('2026-12-21T12:00:00Z'), TROMSO);

    expect(times.sunrise).toBeNull();
    expect(times.sunset).toBeNull();
  });
});

describe('nextSunEvent', () => {
  const MIDNIGHT = new Date('2026-06-21T00:00:00Z');

  it('finds the day’s events in Milan, each in its order', () => {
    expectNear(nextSunEvent({ event: 'dawn' }, MILAN, MIDNIGHT), '2026-06-21T02:56:48Z');
    expectNear(nextSunEvent({ event: 'sunrise' }, MILAN, MIDNIGHT), '2026-06-21T03:34:40Z');
    expectNear(nextSunEvent({ event: 'solar_noon' }, MILAN, MIDNIGHT), '2026-06-21T11:25:40Z');
    expectNear(nextSunEvent({ event: 'sunset' }, MILAN, MIDNIGHT), '2026-06-21T19:15:35Z');
    expectNear(nextSunEvent({ event: 'dusk' }, MILAN, MIDNIGHT), '2026-06-21T19:53:40Z');
  });

  it('is strictly after the instant it is given', () => {
    const sunrise = nextSunEvent({ event: 'sunrise' }, MILAN, MIDNIGHT);
    const next = nextSunEvent({ event: 'sunrise' }, MILAN, sunrise ?? MIDNIGHT);

    expect((next?.getTime() ?? 0) - (sunrise?.getTime() ?? 0)).toBeGreaterThan(23 * 3_600_000);
  });

  it('applies an offset, and looks past the event for a later offset', () => {
    const sunset = nextSunEvent({ event: 'sunset' }, MILAN, MIDNIGHT);
    const before = nextSunEvent({ event: 'sunset', offsetMinutes: -15 }, MILAN, MIDNIGHT);

    expect((sunset?.getTime() ?? 0) - (before?.getTime() ?? 0)).toBe(15 * 60_000);

    // Ten minutes after sunset, an "after sunset +30" has not happened yet today.
    const tenAfter = new Date((sunset?.getTime() ?? 0) + 10 * 60_000);
    const later = nextSunEvent({ event: 'sunset', offsetMinutes: 30 }, MILAN, tenAfter);

    expect((later?.getTime() ?? 0) - (sunset?.getTime() ?? 0)).toBe(30 * 60_000);
  });

  it('takes the golden hour in the morning, the evening, or both', () => {
    const both = nextSunEvent({ event: 'golden_hour_start' }, MILAN, MIDNIGHT);
    const evening = nextSunEvent(
      { event: 'golden_hour_start', period: 'evening' },
      MILAN,
      MIDNIGHT,
    );

    // Morning: the sun climbing through -4°, before sunrise. Evening: sinking through +6°.
    expectNear(both, '2026-06-21T03:11:57Z');
    expectNear(evening, '2026-06-21T18:29:54Z');
  });

  it('finds the sun crossing an elevation the way asked', () => {
    const setting = nextSunEvent(
      { event: 'elevation_crossed', elevation: 10, direction: 'setting' },
      MILAN,
      MIDNIGHT,
    );

    expectNear(setting, '2026-06-21T18:04:37Z');
    expect(nextSunEvent({ event: 'elevation_crossed', elevation: 80 }, MILAN, MIDNIGHT)).toBeNull();
  });

  it('finds the midnight sun and the polar night where there are some', () => {
    const newYear = new Date('2026-01-01T00:00:00Z');

    // Tromsø: the sun stays up from about the 19th of May to the 26th of July, and down from the
    // end of November to the middle of January.
    expectNear(
      nextSunEvent({ event: 'midnight_sun_start' }, TROMSO, newYear),
      '2026-05-18T22:42:00Z',
      86_400_000,
    );
    expectNear(
      nextSunEvent({ event: 'midnight_sun_end' }, TROMSO, newYear),
      '2026-07-26T22:22:00Z',
      86_400_000,
    );
    expectNear(
      nextSunEvent({ event: 'polar_night_start' }, TROMSO, newYear),
      '2026-11-28T10:33:00Z',
      86_400_000,
    );
    expectNear(
      nextSunEvent({ event: 'polar_night_end' }, TROMSO, newYear),
      '2026-01-15T10:42:00Z',
      86_400_000,
    );
  });

  it('gives up, rather than walking for ever, where an event never happens', () => {
    const newYear = new Date('2026-01-01T00:00:00Z');

    expect(nextSunEvent({ event: 'midnight_sun_start' }, MILAN, newYear)).toBeNull();
    expect(nextSunEvent({ event: 'polar_night_start' }, EQUATOR, newYear)).toBeNull();
    expect(nextSunEvent({ event: 'elevation_changed' }, MILAN, newYear)).toBeNull();
  });
});

describe('sunPosition', () => {
  it('stands high and to the south at a Milan midsummer noon', () => {
    const position = sunPosition(new Date('2026-06-21T11:26:00Z'), MILAN);

    // 90 - 45.46 + 23.44.
    expect(position.elevation).toBeCloseTo(67.98, 0);
    expect(position.azimuth).toBeGreaterThan(175);
    expect(position.azimuth).toBeLessThan(185);
  });
});

describe('sun phases', () => {
  it('reads a Milan summer morning', () => {
    const state = sunState(new Date('2026-06-21T10:00:00Z'), MILAN);

    expect(state.isRising).toBe(true);
    expect(isSunPhase({ phase: 'day' }, state)).toBe(true);
    expect(isSunPhase({ phase: 'day', period: 'evening' }, state)).toBe(false);
    expect(isSunPhase({ phase: 'above', elevation: 30 }, state)).toBe(true);
    expect(isSunPhase({ phase: 'night' }, state)).toBe(false);
    expect(sunPhaseLabel(state)).toBe('day');
  });

  it('reads the golden hour, the blue hour and the night after a Milan sunset', () => {
    const at = (iso: string) => sunState(new Date(iso), MILAN);

    expect(isSunPhase({ phase: 'golden_hour' }, at('2026-06-21T19:00:00Z'))).toBe(true);
    expect(
      isSunPhase({ phase: 'golden_hour', period: 'morning' }, at('2026-06-21T19:00:00Z')),
    ).toBe(false);
    expect(isSunPhase({ phase: 'twilight' }, at('2026-06-21T19:30:00Z'))).toBe(true);
    expect(isSunPhase({ phase: 'blue_hour' }, at('2026-06-21T19:45:00Z'))).toBe(true);
    expect(isSunPhase({ phase: 'night' }, at('2026-06-21T21:00:00Z'))).toBe(true);
  });

  it('knows a polar day from a polar night', () => {
    const summer = sunState(new Date('2026-06-21T12:00:00Z'), TROMSO);
    const winter = sunState(new Date('2026-12-21T12:00:00Z'), TROMSO);

    expect(isSunPhase({ phase: 'midnight_sun' }, summer)).toBe(true);
    expect(isSunPhase({ phase: 'polar_night' }, winter)).toBe(true);
    expect(isSunPhase({ phase: 'polar_night' }, summer)).toBe(false);
    expect(sunPhaseLabel(winter)).toBe('polar_night');
  });
});
