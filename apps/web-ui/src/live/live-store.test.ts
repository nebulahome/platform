/**
 * The live store: what the channel said, and what it forgets when the channel comes back.
 */
import { describe, expect, it } from 'vitest';

import { entityIdSchema } from '@nebula-home/contracts';

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

    expect(useLive.getState().readings['switch.bench_relay']).toBeDefined();

    useLive.getState().forgetReadings();

    expect(useLive.getState().readings).toEqual({});
    expect(useLive.getState().status).toBe('live');
  });
});
