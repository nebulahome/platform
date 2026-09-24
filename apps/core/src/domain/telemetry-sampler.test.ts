import { describe, expect, it } from 'vitest';

import { parseEntityId } from '@nebula-home/contracts';

import { TelemetrySampler } from './telemetry-sampler.js';

const meter = parseEntityId('sensor.kitchen_power');
const other = parseEntityId('sensor.hall_power');

/**
 * A moment some seconds after the first reading.
 *
 * @param seconds - How long after.
 * @returns The moment.
 */
function at(seconds: number): Date {
  return new Date(Date.UTC(2026, 8, 24, 12, 0, seconds));
}

describe('TelemetrySampler', () => {
  it('keeps the first reading, and every one that differs', () => {
    const sampler = new TelemetrySampler(60_000);

    expect(sampler.take(meter, 120, at(0))).toBe(true);
    expect(sampler.take(meter, 121, at(1))).toBe(true);
    expect(sampler.take(meter, 120, at(2))).toBe(true);
  });

  it('drops a value that holds, until the heartbeat has passed', () => {
    const sampler = new TelemetrySampler(60_000);

    sampler.take(meter, 120, at(0));

    expect(sampler.take(meter, 120, at(1))).toBe(false);
    expect(sampler.take(meter, 120, at(59))).toBe(false);
    expect(sampler.take(meter, 120, at(60))).toBe(true);
    expect(sampler.take(meter, 120, at(61))).toBe(false);
  });

  it('keeps each entity apart', () => {
    const sampler = new TelemetrySampler(60_000);

    sampler.take(meter, 120, at(0));

    expect(sampler.take(other, 120, at(1))).toBe(true);
  });

  it('never keeps something that is not a number', () => {
    const sampler = new TelemetrySampler(60_000);

    expect(sampler.take(meter, Number.NaN, at(0))).toBe(false);
    expect(sampler.take(meter, Number.POSITIVE_INFINITY, at(0))).toBe(false);
  });

  it('keeps anything after the entity is forgotten', () => {
    const sampler = new TelemetrySampler(60_000);

    sampler.take(meter, 120, at(0));
    sampler.forget(meter);

    expect(sampler.take(meter, 120, at(1))).toBe(true);
  });

  it('does not move the heartbeat back for a reading replayed out of order', () => {
    const sampler = new TelemetrySampler(60_000);

    sampler.take(meter, 120, at(30));
    sampler.take(meter, 118, at(10));

    expect(sampler.take(meter, 120, at(31))).toBe(false);
  });
});
