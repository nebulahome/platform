import { describe, expect, it } from 'vitest';

import { parseEntityId, type EntityState } from '@nebulahome/contracts';

import { nextFire, type House } from './schedule.js';

const rome: House = { timeZone: 'Europe/Rome', position: { latitude: 41.9, longitude: 12.5 } };

describe('nextFire: the clock', () => {
  it("fires at a time of day on the house's clock", () => {
    const next = nextFire(
      { type: 'time', at: { kind: 'clock', time: '07:00' } },
      rome,
      new Date('2026-07-10T12:00:00Z'),
    );

    // 07:00 in Rome in summer is 05:00 UTC, the next morning.
    expect(next).toEqual({ at: new Date('2026-07-11T05:00:00Z') });
  });

  it('keeps seven in the morning across the change of the clocks', () => {
    // Summer time ends in Rome on 25 October 2026.
    const next = nextFire(
      { type: 'time', at: { kind: 'clock', time: '07:00' } },
      rome,
      new Date('2026-10-25T00:00:00Z'),
    );

    expect(next).toEqual({ at: new Date('2026-10-25T06:00:00Z') });
  });

  it('is strictly later than the instant it looks past', () => {
    const next = nextFire(
      { type: 'time', at: { kind: 'clock', time: '07:00' } },
      rome,
      new Date('2026-07-11T05:00:00Z'),
    );

    expect(next).toEqual({ at: new Date('2026-07-12T05:00:00Z') });
  });

  it('keeps to its weekdays and its months', () => {
    // Friday 10 July 2026: the next Monday is the 13th.
    const monday = nextFire(
      { type: 'time', at: { kind: 'clock', time: '07:00:30', weekdays: ['monday'] } },
      rome,
      new Date('2026-07-10T12:00:00Z'),
    );
    const december = nextFire(
      { type: 'time', at: { kind: 'clock', time: '07:00', months: ['december'] } },
      rome,
      new Date('2026-07-10T12:00:00Z'),
    );

    expect(monday).toEqual({ at: new Date('2026-07-13T05:00:30Z') });
    // 07:00 in Rome in winter is 06:00 UTC.
    expect(december).toEqual({ at: new Date('2026-12-01T06:00:00Z') });
  });

  it('follows a cron expression', () => {
    const next = nextFire(
      { type: 'time', at: { kind: 'cron', expression: '0 */2 * * 1-5' } },
      { timeZone: 'UTC', position: null },
      new Date('2026-07-10T13:15:00Z'),
    );

    expect(next).toEqual({ at: new Date('2026-07-10T14:00:00Z') });
  });

  it('says why when a cron expression cannot be read', () => {
    const next = nextFire(
      { type: 'time', at: { kind: 'cron', expression: '99 99 * * *' } },
      { timeZone: 'UTC', position: null },
      new Date('2026-07-10T13:15:00Z'),
    );

    expect('problem' in next && next.problem).toMatch(/cannot be read/);
  });
});

describe('nextFire: the sun', () => {
  it('fires at sunset, moved by its offset', () => {
    const after = new Date('2026-07-10T10:00:00Z');
    const sunset = nextFire({ type: 'sun', event: 'sunset' }, rome, after);
    const early = nextFire({ type: 'sun', event: 'sunset', offsetMinutes: -15 }, rome, after);

    if (!('at' in sunset) || !('at' in early)) {
      throw new Error('expected a sunset');
    }

    // Sunset in Rome on 10 July is a little before 19:00 UTC.
    expect(sunset.at.getUTCHours()).toBe(18);
    expect(sunset.at.getTime() - early.at.getTime()).toBe(15 * 60_000);
  });

  it('looks to tomorrow once today has passed', () => {
    const next = nextFire(
      { type: 'sun', event: 'sunrise' },
      rome,
      new Date('2026-07-10T12:00:00Z'),
    );

    expect('at' in next && next.at.getUTCDate()).toBe(11);
  });

  it('has no sun to go by without a position', () => {
    const next = nextFire(
      { type: 'sun', event: 'sunset' },
      { timeZone: 'UTC', position: null },
      new Date(),
    );

    expect('problem' in next && next.problem).toMatch(/no position/);
  });

  it('says so when an event never happens where the house is', () => {
    const next = nextFire(
      { type: 'sun', event: 'midnight_sun_start' },
      rome,
      new Date('2026-06-20T12:00:00Z'),
    );

    expect('problem' in next && next.problem).toMatch(/no midnight sun/);
  });

  it('has no moment for a change of elevation, which comes from the sun entity', () => {
    const next = nextFire({ type: 'sun', event: 'elevation_changed' }, rome, new Date());

    expect('problem' in next).toBe(true);
  });

  it('fires each day at the time an entity holds, and waits while it holds none', () => {
    const trigger = {
      type: 'time' as const,
      at: { kind: 'entity' as const, entityId: parseEntityId('sensor.system_quiet_time') },
    };
    const quiet = {
      state: { sensor_text: { value: '03:15' } },
      isAvailable: true,
    } as unknown as EntityState;
    const after = new Date('2026-11-14T12:00:00Z');
    const next = nextFire(trigger, rome, after, () => quiet);

    expect(next).toEqual({ at: new Date('2026-11-15T02:15:00Z') });
    expect('problem' in nextFire(trigger, rome, after)).toBe(true);
    expect(
      'problem' in nextFire(trigger, rome, after, () => ({ ...quiet, isAvailable: false })),
    ).toBe(true);
  });
});
