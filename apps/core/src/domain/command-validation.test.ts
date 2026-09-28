import { describe, expect, it } from 'vitest';

import {
  parseEntityId,
  ValidationError,
  type CapabilityName,
  type JsonObject,
} from '@nebula-home/contracts';

import { validateCommand } from './command-validation.js';
import type { EntityRecord } from './entity-directory.js';

/**
 * Builds an entity record with the given capabilities and their device limits.
 *
 * @param capabilities - Capability names mapped to the parameters the device declared.
 * @param overrides - Anything else to change about the record.
 * @returns The record.
 */
function record(
  capabilities: Record<string, JsonObject>,
  overrides: Partial<EntityRecord> = {},
): EntityRecord {
  return {
    entityId: parseEntityId('light.kitchen_ceiling'),
    rowId: '11111111-2222-4333-8444-555555555555',
    source: 'pkg-mqtt',
    isEnabled: true,
    capabilities: new Map(Object.entries(capabilities) as [CapabilityName, JsonObject][]),
    ...overrides,
  };
}

describe('validateCommand', () => {
  it('accepts a command the entity can execute', () => {
    const command = validateCommand(record({ on_off: {} }), 'on_off', { command: 'toggle' });

    expect(command).toStrictEqual({ command: 'toggle' });
  });

  it('refuses a capability the entity does not declare', () => {
    // ARCHITECTURE.md 5.3: a command targeting a capability the entity does not have is
    // rejected here rather than sent to a device that would not know what to do with it.
    expect(() => validateCommand(record({ on_off: {} }), 'lock', { command: 'lock' })).toThrow(
      /has no lock capability/,
    );
  });

  it('refuses a capability that only reports', () => {
    expect(() =>
      validateCommand(record({ sensor_numeric: {} }), 'sensor_numeric', { command: 'set' }),
    ).toThrow(/reports only/);
  });

  it('refuses a disabled entity', () => {
    expect(() =>
      validateCommand(record({ on_off: {} }, { isEnabled: false }), 'on_off', {
        command: 'turn_on',
      }),
    ).toThrow(/is disabled/);
  });

  it('refuses a command that is not in the capability schema', () => {
    expect(() => validateCommand(record({ on_off: {} }), 'on_off', { command: 'explode' })).toThrow(
      ValidationError,
    );
  });

  it('refuses an argument outside the schema range', () => {
    expect(() =>
      validateCommand(record({ level: { hasTransition: true } }), 'level', {
        command: 'set_level',
        level: 140,
      }),
    ).toThrow(ValidationError);
  });

  it('refuses a colour temperature the lamp cannot reach', () => {
    // The reason `params` exists: this is answerable without a round trip to the device.
    expect(() =>
      validateCommand(record({ color_temp: { minMireds: 250, maxMireds: 454 } }), 'color_temp', {
        command: 'set_color_temp',
        mireds: 153,
      }),
    ).toThrow(/between 250 and 454 mireds/);
  });

  it('accepts a colour temperature inside the lamp range', () => {
    expect(
      validateCommand(record({ color_temp: { minMireds: 250, maxMireds: 454 } }), 'color_temp', {
        command: 'set_color_temp',
        mireds: 300,
      }),
    ).toStrictEqual({ command: 'set_color_temp', mireds: 300 });
  });

  it('refuses a thermostat target outside the declared range', () => {
    expect(() =>
      validateCommand(
        record({
          thermostat: {
            supportedModes: ['off', 'heat'],
            minTemperature: 5,
            maxTemperature: 30,
            temperatureStep: 0.5,
          },
        }),
        'thermostat',
        { command: 'set_target', temperature: 45 },
      ),
    ).toThrow(/between 5 and 30/);
  });

  it('refuses a thermostat mode the device does not support', () => {
    expect(() =>
      validateCommand(
        record({
          thermostat: {
            supportedModes: ['off', 'heat'],
            minTemperature: 5,
            maxTemperature: 30,
            temperatureStep: 0.5,
          },
        }),
        'thermostat',
        { command: 'set_mode', mode: 'cool' },
      ),
    ).toThrow(/must be one of off, heat/);
  });

  it('refuses tilt on a cover that has none', () => {
    expect(() =>
      validateCommand(record({ cover: { hasPosition: true, hasTilt: false } }), 'cover', {
        command: 'set_tilt',
        tilt: 50,
      }),
    ).toThrow(/no tilt/);
  });

  it('refuses a source the player does not expose', () => {
    expect(() =>
      validateCommand(
        record({
          media_player: { supportedSources: ['spotify', 'radio'], hasSeek: true, hasVolume: true },
        }),
        'media_player',
        { command: 'set_source', source: 'cassette' },
      ),
    ).toThrow(/must be one of spotify, radio/);
  });

  it('allows any source when the player did not declare a list', () => {
    // An empty list means "did not say", not "supports nothing". Treating it as the latter would
    // make every source unreachable on a device that simply reports less about itself.
    expect(
      validateCommand(
        record({ media_player: { supportedSources: [], hasSeek: true, hasVolume: true } }),
        'media_player',
        { command: 'set_source', source: 'anything' },
      ),
    ).toStrictEqual({ command: 'set_source', source: 'anything' });
  });

  it('refuses an option a select does not offer', () => {
    const efficiency = record({
      select: {
        options: [
          { value: 'quick', label: 'Quick' },
          { value: 'delicate', label: 'Delicate' },
        ],
      },
    });

    expect(
      validateCommand(efficiency, 'select', { command: 'select_option', option: 'delicate' }),
    ).toStrictEqual({ command: 'select_option', option: 'delicate' });
    expect(() =>
      validateCommand(efficiency, 'select', { command: 'select_option', option: 'reckless' }),
    ).toThrow(/must be one of quick, delicate/);
  });

  it('keeps a number within its limits and on its steps', () => {
    const delay = record({ number: { min: 0, max: 1440, step: 30 } });

    expect(validateCommand(delay, 'number', { command: 'set_value', value: 180 })).toStrictEqual({
      command: 'set_value',
      value: 180,
    });
    expect(() => validateCommand(delay, 'number', { command: 'set_value', value: 1500 })).toThrow(
      /between 0 and 1440/,
    );
    expect(() => validateCommand(delay, 'number', { command: 'set_value', value: 45 })).toThrow(
      /steps of 30/,
    );
  });

  it('refuses to pause a mower that cannot be paused', () => {
    const mower = record({ lawn_mower: { canPause: false } });

    expect(validateCommand(mower, 'lawn_mower', { command: 'dock' })).toStrictEqual({
      command: 'dock',
    });
    expect(() => validateCommand(mower, 'lawn_mower', { command: 'pause' })).toThrow(/pause/);
  });

  it('reports a stored parameter set that is itself wrong', () => {
    // The registry row is wrong, not the command, and the message has to say so or somebody
    // spends an afternoon debugging the caller.
    expect(() =>
      validateCommand(record({ color_temp: { minMireds: 500, maxMireds: 100 } }), 'color_temp', {
        command: 'set_color_temp',
        mireds: 300,
      }),
    ).toThrow(/Stored parameters/);
  });
});
