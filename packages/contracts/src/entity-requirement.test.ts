import { describe, expect, it } from 'vitest';

import { ENERGY_CARD_REQUIREMENTS } from './api-dashboards.js';
import type { CapabilityName } from './capabilities.js';
import { meetsRequirement, type RequiredEntity } from './entity-requirement.js';

/**
 * A numeric sensor.
 *
 * @param deviceClass - Its class.
 * @param unitOfMeasurement - Its unit.
 * @param capability - What it can do; a number when not said.
 * @returns The entity, as far as a requirement reads it.
 */
function sensor(
  deviceClass: string | null,
  unitOfMeasurement: string | null,
  capability: CapabilityName = 'sensor_numeric',
): RequiredEntity {
  return { capabilities: [{ capability }], deviceClass, unitOfMeasurement };
}

describe('meetsRequirement', () => {
  const power = ENERGY_CARD_REQUIREMENTS.gridPower;

  it('takes an entity of a class the reader names', () => {
    expect(meetsRequirement(sensor('power', 'W'), power)).toBe(true);
    expect(meetsRequirement(sensor('power', 'kW'), power)).toBe(true);
  });

  it('refuses another class, whatever its unit', () => {
    expect(meetsRequirement(sensor('temperature', '°C'), power)).toBe(false);
    expect(meetsRequirement(sensor('energy', 'kWh'), power)).toBe(false);
  });

  it('takes a classless entity by its unit, and refuses one without a fitting unit', () => {
    expect(meetsRequirement(sensor(null, 'kW'), power)).toBe(true);
    expect(meetsRequirement(sensor(null, 'kWh'), power)).toBe(false);
    expect(meetsRequirement(sensor(null, null), power)).toBe(false);
  });

  it('refuses an entity without the capability', () => {
    expect(meetsRequirement(sensor('power', 'W', 'sensor_binary'), power)).toBe(false);
  });

  it('asks the battery level for a percentage of charge', () => {
    const level = ENERGY_CARD_REQUIREMENTS.batteryLevel;

    expect(meetsRequirement(sensor('battery', '%'), level)).toBe(true);
    expect(meetsRequirement(sensor(null, '%'), level)).toBe(true);
    expect(meetsRequirement(sensor('humidity', '%'), level)).toBe(false);
    expect(meetsRequirement(sensor('power', 'W'), level)).toBe(false);
  });

  it('takes any entity with the capability when no class is named', () => {
    expect(meetsRequirement(sensor('humidity', '%'), { capability: 'sensor_numeric' })).toBe(true);
  });
});
