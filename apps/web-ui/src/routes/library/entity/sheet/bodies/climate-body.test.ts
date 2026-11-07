/**
 * A thermostat's word, glyph and colour agree with its mode: an action the mode cannot have gives
 * way to the mode, and auto shows whichever way it is working.
 */
import { describe, expect, it } from 'vitest';

import { climateLookOf } from '@/routes/library/entity/sheet/bodies/climate-body';

/** A thermostat's state, at 21 °C. */
const BASE = { targetTemperature: 21, humidity: undefined } as const;

describe('a thermostat’s look', () => {
  it('follows the mode when the action contradicts it, and the action when it agrees', () => {
    expect(climateLookOf({ ...BASE, mode: 'cool', action: 'heating' }).tone).toBe('cyan');
    expect(climateLookOf({ ...BASE, mode: 'cool', action: 'cooling' }).icon).toBe('snowflake');
    expect(climateLookOf({ ...BASE, mode: 'auto', action: 'heating' }).tone).toBe('heat');
    expect(climateLookOf({ ...BASE, mode: 'heat', action: 'idle' }).tone).toBe('heat');
    expect(climateLookOf({ ...BASE, mode: 'off', action: 'heating' }).tone).toBe('muted');
  });
});
