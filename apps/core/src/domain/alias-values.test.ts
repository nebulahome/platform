import { describe, expect, it } from 'vitest';

import { aliasPartsSchema, aliasType, type CapabilityState } from '@nebulahome/contracts';

import {
  applyCapabilityCommand,
  assembleState,
  camelCase,
  combine,
  fitPart,
  partsTouchedBy,
  readPart,
  stateField,
  type PartValue,
} from './alias-values.js';

const thermostat = aliasType('thermostat');
const light = aliasType('light');

/**
 * A part of a type, which must be there.
 *
 * @param type - The type.
 * @param key - The part's key.
 * @returns The part.
 * @throws {Error} When the type has no such part.
 */
function def(type: typeof thermostat, key: string) {
  const found = type.parts.find((part) => part.key === key);

  if (found === undefined) {
    throw new Error(`No part ${key}`);
  }

  return found;
}

describe('reading a part from an entity', () => {
  const climate: CapabilityState = {
    thermostat: {
      targetTemperature: 21,
      mode: 'heat',
      action: 'heating',
      currentTemperature: 20.4,
    },
  };

  it('takes the same field from an entity of the same capability', () => {
    expect(readPart(def(thermostat, 'current_temperature'), climate)).toBe(20.4);
    expect(readPart(def(thermostat, 'mode'), climate)).toBe('heat');
  });

  it('takes the one reading of another kind of entity when the kind fits', () => {
    const sensor: CapabilityState = { sensor_numeric: { value: 19.5 } };

    expect(readPart(def(thermostat, 'current_temperature'), sensor)).toBe(19.5);
    expect(readPart(def(thermostat, 'mode'), sensor)).toBeUndefined();
  });

  it('reads a colour as hue and saturation', () => {
    expect(readPart(def(light, 'color'), { color_hs: { hue: 30, saturation: 80 } })).toEqual({
      hue: 30,
      saturation: 80,
    });
  });

  it('finds a field by its snake-case name in any capability', () => {
    expect(camelCase('swing_horizontal_mode')).toBe('swingHorizontalMode');
    expect(stateField(climate, 'current_temperature')).toBe(20.4);
  });
});

describe('combining several entities', () => {
  it('combines by the rule', () => {
    expect(combine('average', [20, 22])).toBe(21);
    expect(combine('sum', [1, 2, 3])).toBe(6);
    expect(combine('any', [false, true])).toBe(true);
    expect(combine('all', [false, true])).toBe(false);
    expect(combine('first', ['eco', 'away'])).toBe('eco');
    expect(combine('max', [])).toBeUndefined();
  });
});

describe('fitting a worked-out value', () => {
  const config = aliasPartsSchema.parse({ mode: { from: 'formula', formula: 'x' } })['mode']!;

  it('keeps a value that fits and refuses one that does not', () => {
    expect(fitPart(def(thermostat, 'mode'), config, 'heat')).toBe('heat');
    expect(() => fitPart(def(thermostat, 'mode'), config, 'boost')).toThrow(/Mode must be one of/);
    expect(() => fitPart(def(thermostat, 'target_temperature'), config, 'warm')).toThrow(
      /must be a number/,
    );
  });
});

describe('putting the state together', () => {
  it('assembles each capability and checks it whole', () => {
    const parts = aliasPartsSchema.parse({
      target_temperature: { from: 'stored', value: 21 },
      mode: { from: 'stored', value: 'heat' },
      action: { from: 'stored', value: 'idle' },
    });
    const values = new Map<string, PartValue>([
      ['target_temperature', 21],
      ['mode', 'heat'],
      ['action', 'idle'],
    ]);

    expect(assembleState(['thermostat'], thermostat.parts, parts, values, 'color_temp')).toEqual({
      thermostat: { targetTemperature: 21, mode: 'heat', action: 'idle' },
    });

    values.delete('action');
    expect(() =>
      assembleState(['thermostat'], thermostat.parts, parts, values, 'color_temp'),
    ).toThrow(/not whole/);
  });

  it('says which of a colour and a temperature a lamp shows', () => {
    const parts = aliasPartsSchema.parse({
      on: { from: 'stored', value: true },
      color_temp: { from: 'stored', value: 370 },
      color: { from: 'stored', value: { hue: 10, saturation: 50 } },
    });
    const values = new Map<string, PartValue>([
      ['on', true],
      ['color_temp', 370],
      ['color', { hue: 10, saturation: 50 }],
    ]);
    const state = assembleState(
      ['on_off', 'color_temp', 'color_hs'],
      light.parts,
      parts,
      values,
      'color',
    );

    expect(state.color_hs?.isActive).toBe(true);
    expect(state.color_temp?.isActive).toBe(false);
  });
});

describe('commands', () => {
  const parts = aliasPartsSchema.parse({
    target_temperature: { from: 'stored', value: 21 },
    mode: { from: 'entity', entity: 'climate.hall' },
    action: { from: 'code', function: 'action' },
    target_temperature_low: { from: 'stored', value: 18 },
    target_temperature_high: { from: 'stored', value: 24 },
  });

  it('touches the parts that hold what the command sets', () => {
    expect(
      partsTouchedBy(thermostat.parts, parts, 'thermostat', 'set_target').map((part) => part.key),
    ).toEqual(['target_temperature']);
    expect(
      partsTouchedBy(thermostat.parts, parts, 'thermostat', 'set_target_range').map(
        (part) => part.key,
      ),
    ).toEqual(['target_temperature_low', 'target_temperature_high']);
  });

  it('applies every kind of command to a stored state', () => {
    expect(
      applyCapabilityCommand({}, 'thermostat', { command: 'set_target_range', low: 18, high: 25 })
        .thermostat,
    ).toMatchObject({ targetTemperatureLow: 18, targetTemperatureHigh: 25 });
    expect(
      applyCapabilityCommand(
        { media_player: { playback: 'idle', volume: 98, isMuted: false } },
        'media_player',
        {
          command: 'volume_up',
        },
      ).media_player?.volume,
    ).toBe(100);
    expect(applyCapabilityCommand({}, 'vacuum', { command: 'pause' }).vacuum).toMatchObject({
      activity: 'paused',
      isResumable: true,
    });
    expect(applyCapabilityCommand({}, 'lock', { command: 'open' }).lock).toEqual({
      lockState: 'unlocked',
      isOpen: true,
    });
  });
});
