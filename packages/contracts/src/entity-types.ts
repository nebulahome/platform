/**
 * What an entity may be shown as, when it is not what its integration says: a relay that drives a
 * lamp shown as a light, a motion sensor that really tells presence shown as presence.
 *
 * Only kinds that read and obey the same are interchangeable, because nothing is translated: a
 * switch and a light both hold `on_off` and take `turn_on`, so a relay shown as a light is
 * commanded exactly as before; a binary sensor is `sensor_binary` whatever it senses, so its class
 * is only how its state is worded and what it counts as. The address never changes - it is the
 * integration's - only what the house reads as its kind.
 */
import { z } from 'zod';

/** The kinds of thing a binary sensor can say it senses, the words for each the interface's. */
export const BINARY_SENSOR_CLASSES = [
  'motion',
  'occupancy',
  'presence',
  'door',
  'window',
  'opening',
  'garage_door',
  'running',
  'connectivity',
  'battery',
  'battery_charging',
  'moisture',
  'smoke',
  'gas',
  'problem',
  'plug',
  'power',
  'update',
] as const;

/** A kind an entity is shown as: a domain, and the class that goes with it. */
export const shownAsSchema = z.object({
  domain: z.enum(['switch', 'light', 'binary_sensor']),
  deviceClass: z.enum(BINARY_SENSOR_CLASSES).nullable(),
});

/** A kind an entity is shown as. */
export type ShownAs = z.output<typeof shownAsSchema>;

/** A kind as the integration gave it. */
export type EntityKindOrigin = {
  readonly domain: string;
  readonly deviceClass: string | null;
};

/**
 * What else an entity may be shown as, besides what its integration says it is.
 *
 * @param original - Its domain and class, as its integration gave them.
 * @param capabilities - What it declares.
 * @returns The other kinds it can be shown as; empty when it can be shown only as it is.
 */
export function shownAsOptions(
  original: EntityKindOrigin,
  capabilities: readonly string[],
): ShownAs[] {
  if (capabilities.includes('on_off') && original.domain === 'switch') {
    return [{ domain: 'light', deviceClass: null }];
  }

  if (capabilities.includes('on_off') && original.domain === 'light') {
    return [{ domain: 'switch', deviceClass: null }];
  }

  if (capabilities.includes('sensor_binary') && original.domain === 'binary_sensor') {
    return BINARY_SENSOR_CLASSES.filter((each) => each !== original.deviceClass).map(
      (deviceClass) => ({ domain: 'binary_sensor', deviceClass }),
    );
  }

  return [];
}

/**
 * Whether a kind is the one the integration gave.
 *
 * @param original - The integration's.
 * @param shown - The one asked for.
 * @returns True when they are the same.
 */
export function isOriginalKind(original: EntityKindOrigin, shown: ShownAs): boolean {
  return original.domain === shown.domain && original.deviceClass === shown.deviceClass;
}
