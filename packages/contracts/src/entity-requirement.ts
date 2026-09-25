/**
 * What something that reads an entity needs the entity to be.
 *
 * A dashboard card that draws a power flow can do nothing with a temperature, and a battery gauge
 * nothing with a power meter; offering them in its picker only invites a card that shows nonsense.
 * So whatever reads an entity states what it needs, beside the schema of what it reads, and a
 * picker offers only the entities that meet it. One rule for every card, and for the next one.
 *
 * A requirement is a capability, and optionally the sensor classes that fit. An entity without a
 * class still fits when its unit is one of those classes' units: a meter a bundle registered as a
 * bare number in `W` is still a power meter.
 */
import type { CapabilityName } from './capabilities.js';
import { findSensorUnit, getSensorClass } from './sensor-classes.js';

/** What an entity must be to be read. */
export type EntityRequirement = {
  /** A capability it must have. */
  readonly capability: CapabilityName;

  /** The sensor classes that fit, by id; any class, or none, when absent. */
  readonly deviceClasses?: readonly string[];
};

/** What a requirement reads of an entity. */
export type RequiredEntity = {
  readonly capabilities: readonly { readonly capability: CapabilityName }[];
  readonly deviceClass: string | null;
  readonly unitOfMeasurement: string | null;
};

/**
 * Whether an entity is what a reader needs.
 *
 * @param entity - Its capabilities, class and unit.
 * @param requirement - What is needed.
 * @returns True when it has the capability and, when classes are named, is of one of them - or,
 * having no class, reads in one of their units.
 */
export function meetsRequirement(entity: RequiredEntity, requirement: EntityRequirement): boolean {
  if (!entity.capabilities.some((entry) => entry.capability === requirement.capability)) {
    return false;
  }

  const classes = requirement.deviceClasses;

  if (classes === undefined) {
    return true;
  }

  if (entity.deviceClass !== null && entity.deviceClass !== '') {
    return classes.includes(entity.deviceClass);
  }

  const unit = entity.unitOfMeasurement;

  return (
    unit !== null &&
    classes.some((id) => {
      const entry = getSensorClass(id);

      return entry !== undefined && findSensorUnit(entry, unit) !== undefined;
    })
  );
}
