import { describe, expect, it } from 'vitest';

import { nextFire, type House } from './schedule.js';

const rome: House = { timeZone: 'Europe/Rome', position: { latitude: 41.9, longitude: 12.5 } };

describe('nextFire', () => {
  it("fires at a time of day on the house's clock", () => {
    const next = nextFire({ kind: 'clock', time: '07:00' }, rome, new Date('2026-07-10T12:00:00Z'));

    // 07:00 in Rome in summer is 05:00 UTC, the next morning.
    expect(next).toEqual({ at: new Date('2026-07-11T05:00:00Z') });
  });

  it('keeps seven in the morning across the change of the clocks', () => {
    // Summer time ends in Rome on 25 October 2026.
    const next = nextFire({ kind: 'clock', time: '07:00' }, rome, new Date('2026-10-25T00:00:00Z'));

    expect(next).toEqual({ at: new Date('2026-10-25T06:00:00Z') });
  });

  it('is strictly later than the instant it looks past', () => {
    const next = nextFire({ kind: 'clock', time: '07:00' }, rome, new Date('2026-07-11T05:00:00Z'));

    expect(next).toEqual({ at: new Date('2026-07-12T05:00:00Z') });
  });

  it('follows a cron expression', () => {
    const next = nextFire(
      { kind: 'cron', expression: '0 */2 * * 1-5' },
      { timeZone: 'UTC', position: null },
      new Date('2026-07-10T13:15:00Z'),
    );

    expect(next).toEqual({ at: new Date('2026-07-10T14:00:00Z') });
  });

  it('says why when a cron expression cannot be read', () => {
    const next = nextFire(
      { kind: 'cron', expression: '99 99 * * *' },
      { timeZone: 'UTC', position: null },
      new Date('2026-07-10T13:15:00Z'),
    );

    expect('problem' in next && next.problem).toMatch(/cannot be read/);
  });

  it('fires at sunset, moved by its offset', () => {
    const after = new Date('2026-07-10T10:00:00Z');
    const sunset = nextFire({ kind: 'solar', event: 'sunset', offsetMinutes: 0 }, rome, after);
    const early = nextFire({ kind: 'solar', event: 'sunset', offsetMinutes: -15 }, rome, after);

    if (!('at' in sunset) || !('at' in early)) {
      throw new Error('expected a sunset');
    }

    // Sunset in Rome on 10 July is a little before 19:00 UTC.
    expect(sunset.at.getUTCHours()).toBe(18);
    expect(sunset.at.getTime() - early.at.getTime()).toBe(15 * 60_000);
  });

  it('looks to tomorrow once today has passed', () => {
    const next = nextFire(
      { kind: 'solar', event: 'sunrise', offsetMinutes: 0 },
      rome,
      new Date('2026-07-10T12:00:00Z'),
    );

    expect('at' in next && next.at.getUTCDate()).toBe(11);
  });

  it('has no sun to go by without a position', () => {
    const next = nextFire(
      { kind: 'solar', event: 'sunset', offsetMinutes: 0 },
      { timeZone: 'UTC', position: null },
      new Date(),
    );

    expect('problem' in next && next.problem).toMatch(/no position/);
  });

  it('says so when the sun does not set for a week', () => {
    const svalbard: House = { timeZone: 'UTC', position: { latitude: 78.2, longitude: 15.6 } };

    const next = nextFire(
      { kind: 'solar', event: 'sunset', offsetMinutes: 0 },
      svalbard,
      new Date('2026-06-20T12:00:00Z'),
    );

    expect('problem' in next && next.problem).toMatch(/no sunset/);
  });
});
