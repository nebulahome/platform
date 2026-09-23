/**
 * Numeric sensor classes: the shared catalogue of what a reading means and how its units convert.
 *
 * The file is the dictionary; the entity row only stores the class id and the canonical unit.
 * Hub converts from the device's native unit before publishing, and the UI formats the stored
 * number - a later display preference can convert for the screen without rewriting history.
 *
 * Binary sensors (`running`, motion, door, …) are not here. A classless numeric entity (print
 * progress, layer count) is also not here: it stays a raw number plus whatever unit string the
 * profile wrote.
 */
import { z } from 'zod';

import catalogJson from './sensor-classes.json' with { type: 'json' };

/** How history should aggregate a numeric entity - mirrored from registration, kept local to avoid a cycle. */
const STATE_CLASSES = ['measurement', 'total', 'total_increasing'] as const;

/** How history should aggregate a numeric entity. */
export type SensorStateClass = (typeof STATE_CLASSES)[number];

/** How a catalogue entry holds a value. */
export const SENSOR_VALUE_KINDS = ['number', 'date', 'timestamp'] as const;

/** How a catalogue entry holds a value. */
export type SensorValueKind = (typeof SENSOR_VALUE_KINDS)[number];

/**
 * Named converters for units that are not a pure scale of the canonical.
 *
 * `celsius` / `celsius-delta` cover temperature; `blood-glucose` is mg/dL ↔ mmol/L; the `gas-*`
 * family needs the class's molar mass; the `energy-distance-*` family covers consumption per
 * distance and its reciprocals.
 */
export const SENSOR_UNIT_CONVERTERS = [
  'celsius',
  'celsius-delta',
  'blood-glucose',
  'gas-ug',
  'gas-mg',
  'gas-ppb-from-ug',
  'gas-ppm-from-ug',
  'energy-distance-kwh100',
  'energy-distance-km-kwh',
  'energy-distance-mi-kwh',
] as const;

/** A named converter for a unit that is not a pure scale. */
export type SensorUnitConverter = (typeof SENSOR_UNIT_CONVERTERS)[number];

/** One unit a class understands. */
export const sensorUnitSchema = z
  .object({
    id: z.string().min(1).max(32),
    symbol: z.string().min(1).max(32),
    /** How many canonical units one of this unit is. Absent when conversion is named or impossible. */
    scale: z.number().positive().optional(),
    /** Named converter when a scale would be wrong. */
    convert: z.enum(SENSOR_UNIT_CONVERTERS).optional(),
  })
  .refine((unit) => !(unit.scale !== undefined && unit.convert !== undefined), {
    message: 'A unit has either a scale or a named converter, not both',
  });

/** One unit a class understands. */
export type SensorUnit = z.output<typeof sensorUnitSchema>;

/** One sensor class in the catalogue. */
export const sensorClassSchema = z
  .object({
    id: z.string().min(1).max(64),
    label: z.string().min(1).max(64),
    valueKind: z.enum(SENSOR_VALUE_KINDS),
    /** Canonical unit id, or null when the class has none (AQI, pH, monetary, date, …). */
    canonicalUnit: z.string().min(1).max(32).nullable(),
    /**
     * Copied onto the entity when the profile omits `stateClass`. Not a second identifier.
     * Absent for date / timestamp / uptime.
     */
    stateClassDefault: z.enum(STATE_CLASSES).optional(),
    /** Molar mass (g/mol) for gas density conversions. */
    molarMass: z.number().positive().optional(),
    units: z.array(sensorUnitSchema),
  })
  .superRefine((entry, ctx) => {
    if (entry.valueKind !== 'number') {
      if (entry.units.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['units'],
          message: 'Non-numeric classes have no units',
        });
      }

      return;
    }

    if (entry.canonicalUnit !== null) {
      const canonical = entry.units.find((unit) => unit.id === entry.canonicalUnit);

      if (canonical === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['canonicalUnit'],
          message: `Canonical unit ${entry.canonicalUnit} is not listed`,
        });
      }
    }

    const seen = new Set<string>();

    for (const [index, unit] of entry.units.entries()) {
      if (seen.has(unit.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['units', index, 'id'],
          message: `Duplicate unit ${unit.id}`,
        });
      }

      seen.add(unit.id);
    }
  });

/** One sensor class in the catalogue. */
export type SensorClass = z.output<typeof sensorClassSchema>;

/** The catalogue file root. */
export const sensorClassesCatalogSchema = z.object({
  classes: z.array(sensorClassSchema).min(1),
});

/** The catalogue file root. */
export type SensorClassesCatalog = z.output<typeof sensorClassesCatalogSchema>;

/** Molar volume of an ideal gas at 25 °C and 1 atm, in L/mol. */
const MOLAR_VOLUME_L = 24.45;

/** Miles per kilometre, for energy-distance reciprocals. */
const MI_PER_KM = 1 / 1.609344;

/** mg/dL per mmol/L for blood glucose. */
const MG_DL_PER_MMOL_L = 18.0182;

const parsedCatalog = sensorClassesCatalogSchema.parse(catalogJson);

/** Every class in the catalogue, keyed by id. */
export const SENSOR_CLASSES: ReadonlyMap<string, SensorClass> = new Map(
  parsedCatalog.classes.map((entry) => [entry.id, entry]),
);

/** The catalogue as an ordered list, matching the JSON file. */
export const SENSOR_CLASS_LIST: readonly SensorClass[] = parsedCatalog.classes;

/**
 * Looks up a sensor class by id.
 *
 * @param id - The class id, when there is one.
 * @returns The class, or undefined when the id is unknown or absent.
 */
export function getSensorClass(id: string | null | undefined): SensorClass | undefined {
  if (id === null || id === undefined || id === '') {
    return undefined;
  }

  return SENSOR_CLASSES.get(id);
}

/**
 * Whether a device class is a numeric entry in this catalogue.
 *
 * Binary classes and classless sensors are not; they must not be rejected at registration for
 * lacking a catalogue unit.
 *
 * @param id - The device class.
 * @returns True when the id names a numeric catalogue class.
 */
export function isNumericSensorClass(id: string | null | undefined): boolean {
  const entry = getSensorClass(id);

  return entry?.valueKind === 'number';
}

/**
 * The display label for a class id, when the catalogue knows it.
 *
 * @param id - The device class.
 * @returns The label, or undefined when the id is not in the catalogue.
 */
export function sensorClassLabel(id: string | null | undefined): string | undefined {
  return getSensorClass(id)?.label;
}

/**
 * Finds a unit on a class by id.
 *
 * @param entry - The class.
 * @param unitId - The unit id.
 * @returns The unit, or undefined.
 */
export function findSensorUnit(entry: SensorClass, unitId: string): SensorUnit | undefined {
  return entry.units.find((unit) => unit.id === unitId);
}

/**
 * Whether a unit id belongs to a class (including as its canonical unit).
 *
 * @param entry - The class.
 * @param unitId - The unit id.
 * @returns True when the class lists it.
 */
export function isUnitOfSensorClass(entry: SensorClass, unitId: string): boolean {
  return findSensorUnit(entry, unitId) !== undefined;
}

/**
 * The state class to register: the profile's value, or the catalogue default when omitted.
 *
 * @param deviceClass - The class id.
 * @param stateClass - What the profile wrote, if anything.
 * @returns The state class to store, or undefined when neither the profile nor the default says.
 */
export function resolveStateClass(
  deviceClass: string | null | undefined,
  stateClass: SensorStateClass | undefined,
): SensorStateClass | undefined {
  if (stateClass !== undefined) {
    return stateClass;
  }

  return getSensorClass(deviceClass)?.stateClassDefault;
}

/**
 * The canonical unit id to register for a class, when the catalogue names one.
 *
 * @param deviceClass - The class id.
 * @returns The canonical unit, or undefined when the class has none or is unknown.
 */
export function resolveCanonicalUnit(deviceClass: string | null | undefined): string | undefined {
  return getSensorClass(deviceClass)?.canonicalUnit ?? undefined;
}

/**
 * Converts a value in a class unit into the class's canonical unit.
 *
 * @param deviceClass - The class id.
 * @param value - The number as the device reported it.
 * @param fromUnit - The unit that number is in (the device's native unit).
 * @returns The canonical number, or undefined when the class or unit is unknown, or the unit
 * cannot convert (dB ↔ dBm, missing molar mass, reciprocal of zero).
 */
export function toCanonical(
  deviceClass: string,
  value: number,
  fromUnit: string,
): number | undefined {
  const entry = getSensorClass(deviceClass);

  if (entry?.valueKind !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  if (entry.canonicalUnit === null) {
    // Unitless numbers (AQI, pH) and power_factor ratios: only `%` converts; anything else is raw.
    if (fromUnit === '' || fromUnit === entry.id) {
      return value;
    }

    const unit = findSensorUnit(entry, fromUnit);

    if (unit?.scale !== undefined) {
      return value * unit.scale;
    }

    return fromUnit === '%' && entry.id === 'power_factor' ? value * 0.01 : undefined;
  }

  if (fromUnit === entry.canonicalUnit) {
    const unit = findSensorUnit(entry, fromUnit);

    if (unit?.convert !== undefined) {
      return applyConverter(unit.convert, value, 'toCanonical', fromUnit, entry);
    }

    return value;
  }

  const unit = findSensorUnit(entry, fromUnit);

  if (unit === undefined) {
    return undefined;
  }

  if (unit.scale !== undefined) {
    return value * unit.scale;
  }

  if (unit.convert !== undefined) {
    return applyConverter(unit.convert, value, 'toCanonical', fromUnit, entry);
  }

  // Listed without scale or convert (dB beside dBm): not convertible.
  return undefined;
}

/**
 * Converts a canonical value into another unit of the same class.
 *
 * Kept for a future display preference; the UI today shows the canonical unit already stored.
 *
 * @param deviceClass - The class id.
 * @param value - The stored canonical number.
 * @param toUnit - The unit to show.
 * @returns The display number, or undefined when conversion is impossible.
 */
export function fromCanonical(
  deviceClass: string,
  value: number,
  toUnit: string,
): number | undefined {
  const entry = getSensorClass(deviceClass);

  if (entry?.valueKind !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  if (entry.canonicalUnit === null) {
    if (toUnit === '' || toUnit === entry.id) {
      return value;
    }

    const unit = findSensorUnit(entry, toUnit);

    if (unit?.scale !== undefined) {
      return value / unit.scale;
    }

    return toUnit === '%' && entry.id === 'power_factor' ? value / 0.01 : undefined;
  }

  if (toUnit === entry.canonicalUnit) {
    const unit = findSensorUnit(entry, toUnit);

    if (unit?.convert !== undefined) {
      return applyConverter(unit.convert, value, 'fromCanonical', toUnit, entry);
    }

    return value;
  }

  const unit = findSensorUnit(entry, toUnit);

  if (unit === undefined) {
    return undefined;
  }

  if (unit.scale !== undefined) {
    return value / unit.scale;
  }

  if (unit.convert !== undefined) {
    return applyConverter(unit.convert, value, 'fromCanonical', toUnit, entry);
  }

  return undefined;
}

/**
 * Applies a named converter in either direction.
 *
 * @param name - Which converter.
 * @param value - The number.
 * @param direction - Toward or away from canonical.
 * @param unitId - The non-canonical (or temperature) unit involved.
 * @param entry - The class, for molar mass.
 * @returns The converted number, or undefined when the inputs cannot convert.
 */
function applyConverter(
  name: SensorUnitConverter,
  value: number,
  direction: 'toCanonical' | 'fromCanonical',
  unitId: string,
  entry: SensorClass,
): number | undefined {
  switch (name) {
    case 'celsius':
      return convertCelsius(value, direction, unitId);
    case 'celsius-delta':
      return convertCelsiusDelta(value, direction, unitId);
    case 'blood-glucose':
      return direction === 'toCanonical' ? value * MG_DL_PER_MMOL_L : value / MG_DL_PER_MMOL_L;
    case 'gas-ug':
      return convertGasUg(value, direction, entry.molarMass);
    case 'gas-mg': {
      if (direction === 'toCanonical') {
        return convertGasUg(value * 1000, 'toCanonical', entry.molarMass);
      }

      const asUg = convertGasUg(value, 'fromCanonical', entry.molarMass);

      return asUg === undefined ? undefined : asUg / 1000;
    }
    case 'gas-ppb-from-ug':
      return convertGasPartsFromUg(value, direction, entry.molarMass, 0.001);
    case 'gas-ppm-from-ug':
      return convertGasPartsFromUg(value, direction, entry.molarMass, 1);
    case 'energy-distance-kwh100':
      // 1 kWh/100km = 10 Wh/km
      return direction === 'toCanonical' ? value * 10 : value / 10;
    case 'energy-distance-km-kwh':
      return convertEnergyDistanceReciprocal(value, direction, 1);
    case 'energy-distance-mi-kwh':
      return convertEnergyDistanceReciprocal(value, direction, MI_PER_KM);
    default: {
      const exhaustive: never = name;

      return exhaustive;
    }
  }
}

/**
 * Absolute temperature ↔ °C.
 *
 * @param value - The number.
 * @param direction - Toward or away from °C.
 * @param unitId - °C, °F or K.
 * @returns The converted number.
 */
function convertCelsius(
  value: number,
  direction: 'toCanonical' | 'fromCanonical',
  unitId: string,
): number | undefined {
  if (unitId === '°C') {
    return value;
  }

  if (unitId === 'K') {
    return direction === 'toCanonical' ? value - 273.15 : value + 273.15;
  }

  if (unitId === '°F') {
    return direction === 'toCanonical' ? ((value - 32) * 5) / 9 : (value * 9) / 5 + 32;
  }

  return undefined;
}

/**
 * Temperature difference ↔ °C (no +32 offset).
 *
 * @param value - The number.
 * @param direction - Toward or away from °C.
 * @param unitId - °C, °F or K (kelvin differences match °C).
 * @returns The converted number.
 */
function convertCelsiusDelta(
  value: number,
  direction: 'toCanonical' | 'fromCanonical',
  unitId: string,
): number | undefined {
  if (unitId === '°C' || unitId === 'K') {
    return value;
  }

  if (unitId === '°F') {
    return direction === 'toCanonical' ? (value * 5) / 9 : (value * 9) / 5;
  }

  return undefined;
}

/**
 * µg/m³ ↔ ppm using molar mass at 25 °C, 1 atm.
 *
 * @param value - The number.
 * @param direction - Toward ppm (canonical for CO) or from it.
 * @param molarMass - g/mol.
 * @returns The converted number.
 */
function convertGasUg(
  value: number,
  direction: 'toCanonical' | 'fromCanonical',
  molarMass: number | undefined,
): number | undefined {
  if (molarMass === undefined) {
    return undefined;
  }

  // µg/m³ = ppm × MW × 1000 / 24.45
  const factor = (molarMass * 1000) / MOLAR_VOLUME_L;

  return direction === 'toCanonical' ? value / factor : value * factor;
}

/**
 * ppb or ppm ↔ µg/m³ when µg/m³ is canonical.
 *
 * @param value - The number.
 * @param direction - Toward or away from µg/m³.
 * @param molarMass - g/mol.
 * @param ppmPerUnit - 1 for ppm, 0.001 for ppb (ppb expressed as ppm equivalent).
 * @returns The converted number.
 */
function convertGasPartsFromUg(
  value: number,
  direction: 'toCanonical' | 'fromCanonical',
  molarMass: number | undefined,
  ppmPerUnit: number,
): number | undefined {
  if (molarMass === undefined) {
    return undefined;
  }

  const factor = (molarMass * 1000) / MOLAR_VOLUME_L;

  // canonical µg/m³ = parts × ppmPerUnit × factor
  return direction === 'toCanonical' ? value * ppmPerUnit * factor : value / (ppmPerUnit * factor);
}

/**
 * Reciprocal energy-distance units (km/kWh, mi/kWh) ↔ Wh/km.
 *
 * @param value - The number.
 * @param direction - Toward or away from Wh/km.
 * @param distancePerKm - 1 for km, mi-per-km for miles.
 * @returns The converted number.
 */
function convertEnergyDistanceReciprocal(
  value: number,
  direction: 'toCanonical' | 'fromCanonical',
  distancePerKm: number,
): number | undefined {
  if (value === 0) {
    return undefined;
  }

  // x Wh/km → (1000 / x) × distancePerKm in (distance)/kWh
  if (direction === 'toCanonical') {
    return (1000 * distancePerKm) / value;
  }

  return (1000 * distancePerKm) / value;
}

/**
 * Checks that a registration's unit and state class agree with the catalogue.
 *
 * When `deviceClass` is a numeric catalogue class, the unit must be that class's canonical unit
 * (what `describe` writes after converting from the device's native unit). Missing `stateClass`
 * is filled from `stateClassDefault` by the caller via {@link resolveStateClass}; this only
 * refuses a foreign unit.
 *
 * Classes not in the catalogue - binaries, classless sensors - pass through.
 *
 * @param entity - The fields under check.
 * @param entity.deviceClass - The catalogue class id, when there is one.
 * @param entity.unitOfMeasurement - The unit the registration declares.
 * @returns An error message when invalid, or undefined when fine.
 */
export function sensorRegistrationIssue(entity: {
  readonly deviceClass?: string | undefined;
  readonly unitOfMeasurement?: string | undefined;
}): string | undefined {
  const entry = getSensorClass(entity.deviceClass);

  if (entry?.valueKind !== 'number') {
    return undefined;
  }

  // Monetary: the unit is an ISO 4217 code and is not converted; any non-empty string is fine.
  if (entry.id === 'monetary') {
    return undefined;
  }

  // Unitless classes (AQI, pH, power_factor without `%`): omit the unit, or use a listed one.
  if (entry.canonicalUnit === null) {
    if (entity.unitOfMeasurement === undefined || entity.unitOfMeasurement === '') {
      return undefined;
    }

    if (entry.units.length === 0) {
      return `Class ${entry.id} has no unit of measurement`;
    }

    if (!isUnitOfSensorClass(entry, entity.unitOfMeasurement)) {
      return `Unit ${entity.unitOfMeasurement} does not belong to class ${entry.id}`;
    }

    return undefined;
  }

  const unit = entity.unitOfMeasurement;

  if (unit === undefined || unit === '') {
    return `Class ${entry.id} requires unit ${entry.canonicalUnit}`;
  }

  // Prefer canonical on the entity so the column and the stored number agree.
  if (unit !== entry.canonicalUnit) {
    if (!isUnitOfSensorClass(entry, unit)) {
      return `Unit ${unit} does not belong to class ${entry.id}`;
    }

    return `Class ${entry.id} registers as ${entry.canonicalUnit}, not ${unit}`;
  }

  return undefined;
}
