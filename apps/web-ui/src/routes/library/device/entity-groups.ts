/**
 * A device's entities in two groups: what can be operated, and what only reports.
 *
 * A dimmer with power metering is a light and six readings; listed by name they interleave, and
 * the light is hard to find among its own measurements. The controls - lights, switches,
 * buttons, covers, locks, climate, media - come first, then the sensors, each under a heading.
 */
import type { CapabilityName, EntityView } from '@nebula-home/contracts';

/** The capabilities that only report: an entity with nothing else is a sensor. */
const READING_CAPABILITIES: ReadonlySet<CapabilityName> = new Set([
  'sensor_numeric',
  'sensor_binary',
  'sensor_text',
]);

/** One group of a device's entities. */
export type EntityGroup<TLine> = {
  readonly title: 'Controls' | 'Sensors';
  readonly lines: readonly TLine[];
};

/**
 * Whether an entity only reports.
 *
 * @param entity - Its capabilities.
 * @returns True when every capability it has is a reading; false for one with none.
 */
export function isReadingOnly(entity: Pick<EntityView, 'capabilities'>): boolean {
  return (
    entity.capabilities.length > 0 &&
    entity.capabilities.every((entry) => READING_CAPABILITIES.has(entry.capability))
  );
}

/**
 * Splits a device's entities into controls and sensors, each in the order it was given.
 *
 * @param lines - The entity lines, in the order they are listed.
 * @returns The groups that have anything in them, controls first.
 */
export function entityGroupsOf<TLine extends { readonly entity: Pick<EntityView, 'capabilities'> }>(
  lines: readonly TLine[],
): EntityGroup<TLine>[] {
  const controls = lines.filter((line) => !isReadingOnly(line.entity));
  const sensors = lines.filter((line) => isReadingOnly(line.entity));

  return [
    { title: 'Controls' as const, lines: controls },
    { title: 'Sensors' as const, lines: sensors },
  ].filter((group) => group.lines.length > 0);
}
