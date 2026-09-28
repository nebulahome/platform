import { describe, expect, it } from 'vitest';

import {
  CAPABILITIES,
  CAPABILITY_DEFINITIONS,
  capabilityStateSchema,
  colorTempParamsSchema,
  commandSchemaFor,
  coverStateSchema,
  lawnMowerCommandSchema,
  levelCommandSchema,
  numberParamsSchema,
  onOffCommandSchema,
  selectParamsSchema,
  thermostatParamsSchema,
} from './capabilities.js';

describe('the capability table', () => {
  it('defines every capability exactly once', () => {
    expect(Object.keys(CAPABILITY_DEFINITIONS).sort()).toEqual([...CAPABILITIES].sort());
  });

  it('gives the read-only sensor capabilities no commands at all', () => {
    expect(commandSchemaFor('sensor_numeric')).toBeNull();
    expect(commandSchemaFor('sensor_binary')).toBeNull();
    expect(commandSchemaFor('sensor_text')).toBeNull();
  });

  it('gives every other capability a command schema', () => {
    const readOnly = new Set(['sensor_numeric', 'sensor_binary', 'sensor_text']);

    for (const capability of CAPABILITIES) {
      if (!readOnly.has(capability)) {
        expect(commandSchemaFor(capability)).not.toBeNull();
      }
    }
  });
});

describe('command schemas', () => {
  it('lets a button be pressed and nothing else', () => {
    const schema = commandSchemaFor('button');

    expect(schema?.safeParse({ command: 'press' }).success).toBe(true);
    expect(schema?.safeParse({ command: 'toggle' }).success).toBe(false);
  });

  it('accepts a known command', () => {
    expect(onOffCommandSchema.parse({ command: 'toggle' })).toEqual({ command: 'toggle' });
  });

  it('rejects a command the capability does not define', () => {
    expect(onOffCommandSchema.safeParse({ command: 'dim' }).success).toBe(false);
  });

  it('rejects a level outside the normalised range', () => {
    expect(levelCommandSchema.safeParse({ command: 'set_level', level: 120 }).success).toBe(false);
  });

  it('accepts an optional transition', () => {
    const parsed = levelCommandSchema.parse({
      command: 'set_level',
      level: 40,
      transitionMs: 1500,
    });

    expect(parsed).toMatchObject({ level: 40, transitionMs: 1500 });
  });
});

describe('device limits', () => {
  it('rejects a mired range whose minimum exceeds its maximum', () => {
    expect(colorTempParamsSchema.safeParse({ minMireds: 400, maxMireds: 150 }).success).toBe(false);
  });

  it('rejects a thermostat range whose minimum exceeds its maximum', () => {
    const params = {
      supportedModes: ['heat'],
      minTemperature: 30,
      maxTemperature: 10,
    };

    expect(thermostatParamsSchema.safeParse(params).success).toBe(false);
  });

  it('rejects a thermostat that supports no modes at all', () => {
    const params = { supportedModes: [], minTemperature: 5, maxTemperature: 30 };

    expect(thermostatParamsSchema.safeParse(params).success).toBe(false);
  });
});

describe('composite entity state', () => {
  it('carries several capabilities at once, which a union could not', () => {
    const bulb = capabilityStateSchema.parse({
      on_off: { isOn: true },
      level: { level: 80 },
      color_hs: { hue: 30, saturation: 60 },
    });

    expect(bulb.on_off?.isOn).toBe(true);
    expect(bulb.level?.level).toBe(80);
    expect(bulb.color_hs?.hue).toBe(30);
  });

  it('leaves capabilities the entity does not have undefined', () => {
    const sensor = capabilityStateSchema.parse({ sensor_numeric: { value: 21.5 } });

    expect(sensor.on_off).toBeUndefined();
  });

  it('rejects a capability whose payload is the wrong shape', () => {
    expect(capabilityStateSchema.safeParse({ on_off: { isOn: 'yes' } }).success).toBe(false);
  });

  it('requires a cover to say whether it is moving', () => {
    expect(coverStateSchema.safeParse({ position: 50 }).success).toBe(false);
    expect(coverStateSchema.safeParse({ position: 50, motion: 'stopped' }).success).toBe(true);
  });
});

describe('a robot mower, a select and a number', () => {
  it('starts, pauses, stops and docks a mower, and nothing else', () => {
    for (const command of ['start', 'pause', 'stop', 'dock']) {
      expect(lawnMowerCommandSchema.safeParse({ command }).success, command).toBe(true);
    }

    expect(lawnMowerCommandSchema.safeParse({ command: 'mow_faster' }).success).toBe(false);
  });

  it('reads a mower that says nothing yet as unknown, not as idle', () => {
    expect(capabilityStateSchema.safeParse({ lawn_mower: {} }).success).toBe(false);
    expect(capabilityStateSchema.parse({ lawn_mower: { activity: 'returning' } })).toEqual({
      lawn_mower: { activity: 'returning' },
    });
  });

  it('offers each choice of a select once', () => {
    const quick = { value: 'quick', label: 'Quick' };

    expect(selectParamsSchema.safeParse({ options: [quick] }).success).toBe(true);
    expect(selectParamsSchema.safeParse({ options: [quick, quick] }).success).toBe(false);
    expect(selectParamsSchema.safeParse({ options: [] }).success).toBe(false);
  });

  it('keeps a number between a minimum below its maximum, in steps of one unless said', () => {
    expect(numberParamsSchema.parse({ min: 0, max: 180 })).toEqual({ min: 0, max: 180, step: 1 });
    expect(numberParamsSchema.safeParse({ min: 10, max: 10 }).success).toBe(false);
  });

  it('leaves a select and a number unknown until the device says', () => {
    expect(capabilityStateSchema.parse({ select: {}, number: {} })).toEqual({
      select: { option: null },
      number: { value: null },
    });
  });
});
