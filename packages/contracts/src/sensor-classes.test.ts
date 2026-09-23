/**
 * Round-trip coverage for every convertible unit in the sensor-class catalogue.
 */
import { describe, expect, it } from 'vitest';

import {
  fromCanonical,
  getSensorClass,
  SENSOR_CLASS_LIST,
  sensorRegistrationIssue,
  toCanonical,
  type SensorUnit,
} from './sensor-classes.js';

/** Relative tolerance for floating round-trips. */
const EPSILON = 1e-9;

/**
 * Whether a unit can round-trip through the canonical unit.
 *
 * @param unit - The unit entry.
 * @returns True when it has a scale or a named converter.
 */
function isConvertible(unit: SensorUnit): boolean {
  return unit.scale !== undefined || unit.convert !== undefined;
}

describe('sensor class catalogue', () => {
  it('loads every class with a unique id', () => {
    const ids = SENSOR_CLASS_LIST.map((entry) => entry.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(getSensorClass('current')?.canonicalUnit).toBe('A');
    expect(getSensorClass('energy')?.stateClassDefault).toBe('total_increasing');
    expect(getSensorClass('energy_storage')?.stateClassDefault).toBe('measurement');
  });

  it('round-trips every convertible unit through its canonical', () => {
    for (const entry of SENSOR_CLASS_LIST) {
      if (entry.valueKind !== 'number') {
        continue;
      }

      for (const unit of entry.units) {
        if (!isConvertible(unit)) {
          continue;
        }

        const sample = unit.id === 'K' && unit.convert === 'celsius' ? 300 : 12.5;
        const canonical = toCanonical(entry.id, sample, unit.id);
        expect(canonical, `${entry.id} ${unit.id} → canonical`).toBeTypeOf('number');

        const back = fromCanonical(entry.id, canonical!, unit.id);
        expect(back, `${entry.id} canonical → ${unit.id}`).toBeTypeOf('number');
        expect(Math.abs(back! - sample)).toBeLessThan(
          Math.max(EPSILON, Math.abs(sample) * EPSILON * 1000),
        );
      }
    }
  });

  it('converts named cases that a scale would get wrong', () => {
    expect(toCanonical('temperature', 70.7, '°F')).toBeCloseTo(21.5, 5);
    expect(fromCanonical('temperature', 21.5, '°F')).toBeCloseTo(70.7, 5);

    expect(toCanonical('temperature_delta', 18, '°F')).toBeCloseTo(10, 5);
    expect(fromCanonical('temperature_delta', 10, '°F')).toBeCloseTo(18, 5);

    expect(toCanonical('blood_glucose_concentration', 5, 'mmol/L')).toBeCloseTo(90.091, 3);
    expect(fromCanonical('blood_glucose_concentration', 90.091, 'mmol/L')).toBeCloseTo(5, 3);

    // CO: ppm is canonical; µg/m³ uses molar mass at 25 °C
    expect(toCanonical('carbon_monoxide', 1, 'ppm')).toBe(1);
    expect(fromCanonical('carbon_monoxide', 1, 'µg/m³')).toBeCloseTo((28.01 * 1000) / 24.45, 5);
    expect(toCanonical('carbon_monoxide', (28.01 * 1000) / 24.45, 'µg/m³')).toBeCloseTo(1, 5);

    expect(toCanonical('energy_distance', 15, 'kWh/100km')).toBe(150);
    expect(fromCanonical('energy_distance', 150, 'kWh/100km')).toBe(15);

    expect(toCanonical('energy_distance', 5, 'km/kWh')).toBeCloseTo(200, 5);
    expect(fromCanonical('energy_distance', 200, 'km/kWh')).toBeCloseTo(5, 5);

    const mi = toCanonical('energy_distance', 5, 'mi/kWh');
    expect(mi).toBeCloseTo(200 / 1.609344, 5);
    expect(fromCanonical('energy_distance', mi!, 'mi/kWh')).toBeCloseTo(5, 5);
  });

  it('does not invent a scale between dB and dBm', () => {
    expect(toCanonical('signal_strength', -50, 'dBm')).toBe(-50);
    expect(toCanonical('signal_strength', -50, 'dB')).toBeUndefined();
    expect(fromCanonical('signal_strength', -50, 'dB')).toBeUndefined();
  });

  it('leaves unknown classes as a raw number plus unit for the caller', () => {
    expect(getSensorClass('print_progress')).toBeUndefined();
    expect(toCanonical('print_progress', 87, '%')).toBeUndefined();
  });

  it('refuses a foreign unit at registration, and requires the canonical on the entity', () => {
    expect(
      sensorRegistrationIssue({ deviceClass: 'current', unitOfMeasurement: 'A' }),
    ).toBeUndefined();
    expect(sensorRegistrationIssue({ deviceClass: 'current', unitOfMeasurement: 'mA' })).toMatch(
      /registers as A/,
    );
    expect(sensorRegistrationIssue({ deviceClass: 'current', unitOfMeasurement: 'lx' })).toMatch(
      /does not belong/,
    );
    expect(
      sensorRegistrationIssue({ deviceClass: 'running', unitOfMeasurement: undefined }),
    ).toBeUndefined();
    expect(
      sensorRegistrationIssue({ deviceClass: undefined, unitOfMeasurement: '%' }),
    ).toBeUndefined();
  });
});
