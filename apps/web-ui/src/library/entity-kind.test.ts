/**
 * An entity's capabilities becoming the name of a kind of thing.
 */
import { describe, expect, it } from 'vitest';

import { anEntity } from '@/testing/fixtures';

import { capabilityLabel, entityKindOf } from './entity-kind';

describe('entityKindOf', () => {
  it('calls a relay a switch and a lamp a light', () => {
    expect(entityKindOf(anEntity()).label).toBe('Switch');
    expect(entityKindOf(anEntity({ entityId: 'light.chamber_light' })).label).toBe('Light');
  });

  it('names a light by the most it can do', () => {
    const dimmable = anEntity({
      entityId: 'light.desk',
      capabilities: [
        { capability: 'on_off', params: {} },
        { capability: 'level', params: {} },
      ],
    });
    const tunable = anEntity({
      entityId: 'light.lounge',
      capabilities: [
        ...dimmable.capabilities,
        { capability: 'color_temp', params: { minMireds: 111, maxMireds: 500 } },
      ],
    });
    const colour = anEntity({
      entityId: 'light.strip',
      capabilities: [...tunable.capabilities, { capability: 'color_hs', params: {} }],
    });

    expect(entityKindOf(dimmable)).toEqual({
      label: 'Dimmable light',
      icon: 'lightbulb',
      tone: 'light',
    });
    expect(entityKindOf(tunable).label).toBe('Tunable white light');
    expect(entityKindOf(colour).label).toBe('Colour light');
  });

  it('names a reading by what it measures, and a binary sensor by its class', () => {
    const power = anEntity({
      entityId: 'sensor.plug_power',
      deviceClass: 'power',
      capabilities: [{ capability: 'sensor_numeric', params: {} }],
    });
    const printing = anEntity({
      entityId: 'binary_sensor.printing',
      deviceClass: 'running',
      capabilities: [{ capability: 'sensor_binary', params: {} }],
    });
    const unnamed = anEntity({
      entityId: 'sensor.layer',
      capabilities: [{ capability: 'sensor_numeric', params: {} }],
    });

    expect(entityKindOf(power).label).toBe('Power sensor');
    expect(entityKindOf(printing).label).toBe('Running sensor');
    expect(entityKindOf(unnamed).label).toBe('Sensor');
  });

  it('lets the strongest capability decide', () => {
    const thermostat = anEntity({
      entityId: 'climate.hall',
      capabilities: [
        { capability: 'thermostat', params: {} },
        { capability: 'on_off', params: {} },
      ],
    });

    expect(entityKindOf(thermostat).label).toBe('Thermostat');
  });

  it('says an alias is calculated', () => {
    const average = anEntity({
      entityId: 'alias.average_temperature',
      source: 'derived',
      deviceClass: 'temperature',
      capabilities: [{ capability: 'sensor_numeric', params: {} }],
    });

    expect(entityKindOf(average)).toEqual({
      label: 'Alias · Temperature',
      icon: 'sigma',
      tone: 'derived',
    });
  });
});

describe('capabilityLabel', () => {
  it('calls a light level its brightness, and any other level a level', () => {
    expect(capabilityLabel('level', 'light')).toBe('Brightness');
    expect(capabilityLabel('level', 'cover')).toBe('Level');
    expect(capabilityLabel('color_temp')).toBe('Colour temperature');
  });
});
