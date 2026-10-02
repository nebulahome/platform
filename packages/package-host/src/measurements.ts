/**
 * A package's numbers in the units the platform keeps their classes in.
 *
 * A package says what a sensor is and the unit its device speaks - a `power` in kW, a
 * `temperature` in °F - and the platform registers it in its class's unit, W or °C, and converts
 * every number reported for it on the way, so a history of it compares with every other. This is
 * what the integrations' runtime does for a bundle's profile; a package gets the same without
 * carrying the catalogue of classes itself.
 *
 * A class whose unit cannot be brought to the class's is dropped, and the number is kept as the
 * device gives it: an entity with the wrong unit for its class is one `core` refuses to register.
 */
import {
  getSensorClass,
  resolveCanonicalUnit,
  resolveStateClass,
  sensorRegistrationIssue,
  toCanonical,
} from '@nebulahome/contracts';
import type { ReportedCapabilityState } from '@nebulahome/package-sdk';
import type { CapabilityEntityInput } from '@nebulahome/package-sdk/server';

/** An entity as it is registered, with the unit its device reports in when it is converted. */
export type Measured = {
  readonly entity: Omit<CapabilityEntityInput, 'domain' | 'objectId'>;

  /** The device's unit, when the numbers are converted from it; undefined when they are not. */
  readonly conversion?: { readonly deviceClass: string; readonly unit: string };
};

/**
 * What an entity is registered as: in its class's unit, with the class's default state class,
 * or without the class when its unit cannot be brought to the class's.
 *
 * @param entity - The entity, as the package declares it.
 * @returns What is registered, and how its numbers are converted.
 */
export function measuredOf(entity: Omit<CapabilityEntityInput, 'domain' | 'objectId'>): Measured {
  const { deviceClass, unitOfMeasurement: unit } = entity;

  if (
    entity.capabilities.sensor_numeric === undefined ||
    deviceClass === undefined ||
    getSensorClass(deviceClass)?.valueKind !== 'number'
  ) {
    return { entity };
  }

  const canonical = resolveCanonicalUnit(deviceClass);
  const registered = canonical ?? unit;
  const isConvertible =
    unit === undefined ||
    canonical === undefined ||
    unit === canonical ||
    toCanonical(deviceClass, 1, unit) !== undefined;

  if (
    !isConvertible ||
    sensorRegistrationIssue({ deviceClass, unitOfMeasurement: registered }) !== undefined
  ) {
    return {
      entity: Object.fromEntries(
        Object.entries(entity).filter(([key]) => key !== 'deviceClass'),
      ) as Measured['entity'],
    };
  }

  const stateClass = resolveStateClass(deviceClass, entity.stateClass);

  return {
    entity: {
      ...entity,
      ...(registered === undefined ? {} : { unitOfMeasurement: registered }),
      ...(stateClass === undefined ? {} : { stateClass }),
    },
    ...(unit !== undefined && canonical !== undefined && unit !== canonical
      ? { conversion: { deviceClass, unit } }
      : {}),
  };
}

/**
 * A reported state with its number converted to its class's unit.
 *
 * @param state - The state, as the package reports it.
 * @param conversion - The device's unit and the class; undefined when nothing is converted.
 * @returns The state to publish; undefined when its number cannot be converted.
 */
export function convertedState(
  state: ReportedCapabilityState,
  conversion: Measured['conversion'],
): ReportedCapabilityState | undefined {
  const value = state.sensor_numeric?.value;

  if (conversion === undefined || typeof value !== 'number') {
    return state;
  }

  const converted = toCanonical(conversion.deviceClass, value, conversion.unit);

  return converted === undefined
    ? undefined
    : { ...state, sensor_numeric: { ...state.sensor_numeric, value: converted } };
}
