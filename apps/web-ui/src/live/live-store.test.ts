/**
 * The live store: what the channel said, and what it forgets when the channel comes back.
 */
import { describe, expect, it, vi } from 'vitest';

import { entityIdSchema } from '@nebulahome/contracts';

import { useLive } from './live-store';

describe('useLive', () => {
  it('forgets its readings, and keeps its standing, when the channel comes back', () => {
    useLive.getState().reset();
    useLive.getState().setStatus('live');
    useLive.getState().apply({
      type: 'state_changed',
      entityId: entityIdSchema.parse('switch.bench_relay'),
      state: { on_off: { isOn: true } },
      attributes: {},
      isAvailable: true,
      changedAt: new Date('2026-09-25T10:00:00.000Z'),
    });
    useLive.getState().flush();

    expect(useLive.getState().readings['switch.bench_relay']).toBeDefined();

    useLive.getState().forgetReadings();

    expect(useLive.getState().readings).toEqual({});
    expect(useLive.getState().status).toBe('live');
  });

  it('lands a burst of state changes in one update, on the next frame', async () => {
    useLive.getState().reset();

    let updates = 0;
    const unsubscribe = useLive.subscribe(() => {
      updates += 1;
    });

    for (const value of [1, 2, 3]) {
      useLive.getState().apply({
        type: 'state_changed',
        entityId: entityIdSchema.parse(`sensor.probe_${String(value)}`),
        state: { sensor_numeric: { value } },
        attributes: {},
        isAvailable: true,
        changedAt: new Date('2026-09-25T10:00:00.000Z'),
      });
    }

    expect(updates).toBe(0);

    await vi.waitFor(() => {
      expect(Object.keys(useLive.getState().readings)).toHaveLength(3);
    });
    expect(updates).toBe(1);
    unsubscribe();
  });
});
