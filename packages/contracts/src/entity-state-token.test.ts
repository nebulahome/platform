/**
 * The one word an automation compares a state by: the editor offers these, the engine reads
 * them, and a disagreement between the two is an automation that never fires.
 */
import { describe, expect, it } from 'vitest';

import {
  numericReadingOf,
  stateTokenChoices,
  stateTokenOf,
  STATE_TOKEN_UNAVAILABLE,
} from './entity-state-token.js';

describe('stateTokenOf', () => {
  it('reads what a thing is doing before how much of it', () => {
    expect(stateTokenOf({ on_off: { isOn: true }, level: { level: 60 } })).toBe('on');
    expect(stateTokenOf({ sensor_binary: { isOn: false } })).toBe('off');
  });

  it('says a cover is moving, or open or closed at rest', () => {
    expect(stateTokenOf({ cover: { position: 40, motion: 'closing' } })).toBe('closing');
    expect(stateTokenOf({ cover: { position: 0, motion: 'stopped' } })).toBe('closed');
    expect(stateTokenOf({ cover: { position: 40, motion: 'stopped' } })).toBe('open');
  });

  it('uses the word a closed set already has', () => {
    expect(stateTokenOf({ lock: { lockState: 'jammed' } })).toBe('jammed');
    expect(
      stateTokenOf({
        thermostat: { currentTemperature: 20, targetTemperature: 21, mode: 'heat', action: 'idle' },
      }),
    ).toBe('heat');
    expect(stateTokenOf({ select: { option: 'eco' } })).toBe('eco');
  });

  it('writes a number without noise', () => {
    expect(stateTokenOf({ sensor_numeric: { value: 21.5 } })).toBe('21.5');
    expect(stateTokenOf({ sensor_numeric: { value: 0.1 + 0.2 } })).toBe('0.3');
  });

  it('is unavailable when the device cannot be reached, whatever it said last', () => {
    expect(stateTokenOf({ on_off: { isOn: true } }, false)).toBe(STATE_TOKEN_UNAVAILABLE);
  });

  it('has nothing to say for an entity that never reported', () => {
    expect(stateTokenOf(undefined)).toBeUndefined();
    expect(stateTokenOf({ select: { option: null } })).toBeUndefined();
  });
});

describe('numericReadingOf', () => {
  it("reads a light's level, not whether it is on", () => {
    expect(numericReadingOf({ on_off: { isOn: true }, level: { level: 40 } })).toBe(40);
  });

  it('reads a thermostat by the temperature it measures', () => {
    expect(
      numericReadingOf({
        thermostat: {
          currentTemperature: 19.5,
          targetTemperature: 21,
          mode: 'heat',
          action: 'heating',
        },
      }),
    ).toBe(19.5);
  });

  it('has no number for an on/off thing', () => {
    expect(numericReadingOf({ on_off: { isOn: true } })).toBeUndefined();
  });
});

describe('stateTokenChoices', () => {
  it('offers the closed set and unavailable', () => {
    expect(stateTokenChoices(['on_off', 'level'])).toEqual(['on', 'off', STATE_TOKEN_UNAVAILABLE]);
    expect(stateTokenChoices(['select'], ['eco', 'comfort'])).toEqual([
      'eco',
      'comfort',
      STATE_TOKEN_UNAVAILABLE,
    ]);
  });

  it('offers nothing for a reading that is typed', () => {
    expect(stateTokenChoices(['sensor_numeric'])).toEqual([]);
    expect(stateTokenChoices(['button'])).toEqual([]);
  });
});
