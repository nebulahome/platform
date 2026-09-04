import { describe, expect, it } from 'vitest';

import {
  CAPABILITIES,
  CAPABILITY_DEFINITIONS,
  capabilityStateSchema,
  colorTempParamsSchema,
  commandSchemaFor,
  coverStateSchema,
  levelCommandSchema,
  onOffCommandSchema,
  thermostatParamsSchema,
} from './capabilities.js';

describe('the capability table', () => {
  it('defines every capability exactly once', () => {
    expect(Object.keys(CAPABILITY_DEFINITIONS).sort()).toEqual([...CAPABILITIES].sort());
  });

  it('gives the read-only sensor capabilities no commands at all', () => {
    expect(commandSchemaFor('sensor_numeric')).toBeNull();
    expect(commandSchemaFor('sensor_binary')).toBeNull();
  });

  it('gives every other capability a command schema', () => {
    const readOnly = new Set(['sensor_numeric', 'sensor_binary']);

    for (const capability of CAPABILITIES) {
      if (!readOnly.has(capability)) {
        expect(commandSchemaFor(capability)).not.toBeNull();
      }
    }
  });
});

describe('command schemas', () => {
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
