import { describe, expect, it } from 'vitest';

import {
  HISTORY_READ_MAX_ENTITIES,
  historyStatesRequestSchema,
  historyTelemetryRequestSchema,
  telemetryResolutionForSpan,
} from './history-reads.js';

describe('history reads', () => {
  it('take a window of a few entities, with the most points by default', () => {
    const request = historyStatesRequestSchema.parse({
      entityIds: ['sensor.kitchen_temperature', 'sensor.3d_home_room_a_temperature'],
      from: '2026-10-01T00:00:00Z',
      to: '2026-10-02T00:00:00Z',
    });

    expect(request.from).toEqual(new Date('2026-10-01T00:00:00Z'));
    expect(request.limit).toBe(10_000);
  });

  it('refuse a window backwards, no entity, or too many', () => {
    const window = { from: '2026-10-02T00:00:00Z', to: '2026-10-01T00:00:00Z' };

    expect(
      historyStatesRequestSchema.safeParse({ entityIds: ['light.a'], ...window }).success,
    ).toBe(false);
    expect(
      historyStatesRequestSchema.safeParse({
        entityIds: [],
        from: window.to,
        to: window.from,
      }).success,
    ).toBe(false);
    expect(
      historyTelemetryRequestSchema.safeParse({
        entityIds: Array.from(
          { length: HISTORY_READ_MAX_ENTITIES + 1 },
          (unused, n) => `sensor.s${String(n)}`,
        ),
        from: window.to,
        to: window.from,
        resolution: 'raw',
      }).success,
    ).toBe(false);
  });

  it('read longer windows at coarser resolutions', () => {
    const hour = 3_600_000;

    expect(telemetryResolutionForSpan(hour)).toBe('raw');
    expect(telemetryResolutionForSpan(24 * hour)).toBe('1m');
    expect(telemetryResolutionForSpan(7 * 24 * hour)).toBe('1h');
    expect(telemetryResolutionForSpan(365 * 24 * hour)).toBe('1d');
  });
});
