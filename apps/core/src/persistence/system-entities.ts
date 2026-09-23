/**
 * The device the platform creates for itself, and its entities.
 *
 * The machine the platform runs on is a device like any other in the registry - it has a name
 * the owner can change, a room it can be put in, tags - but no integration reaches it and no
 * package installed it: `core` writes it at startup, before the registry is loaded, so the
 * directory finds its entities where it finds every other.
 *
 * The same split as a device's completion (`services/registration.ts`). What the machine says
 * about itself - its operating system, its processor, its host name - is the platform's, and is
 * written again at every start, so an upgraded machine reads as upgraded. The name and the icon
 * are the owner's once written, and the room and tags are never touched here.
 */
import { and, eq, inArray, ne, sql } from 'drizzle-orm';

import { entityRegistrationSchema, SYSTEM_ENTITIES } from '@nebula-home/contracts';
import { schema, type Database } from '@nebula-home/db';
import type { PlatformLogger } from '@nebula-home/logging';

/** What the system device is called until the owner calls it something else. */
export const SYSTEM_DEVICE_NAME = 'NebulaHome server';

/** The icon it starts with. */
export const SYSTEM_DEVICE_ICON = 'server';

/** What the machine says about itself, written at every start. */
export type SystemDeviceFacts = {
  readonly manufacturer: string;

  /** The operating system and the architecture: `Windows 11 Pro · x64`. */
  readonly model: string;

  /** The platform's version. */
  readonly swVersion: string;

  /** The processor. */
  readonly hwVersion: string;

  /** The host name, which is the closest thing a machine has to a serial. */
  readonly externalId: string;
};

/**
 * Writes the system device and its entities, creating them the first time.
 *
 * One transaction, so a `core` that dies halfway leaves either the old rows or the new ones.
 *
 * An entity id already taken by something that is not a system entity - a device that happens
 * to call its sensor `sensor.system_cpu_usage` - is left alone and reported: taking it over would
 * hand a device's entity to the platform, and the reverse would leave the reading nowhere.
 *
 * @param db - A connected database handle.
 * @param facts - What the machine says about itself.
 * @param logger - Where a taken entity id is reported.
 * @returns The device's row id.
 */
export async function ensureSystemDevice(
  db: Database,
  facts: SystemDeviceFacts,
  logger: PlatformLogger,
): Promise<string> {
  const registrations = SYSTEM_ENTITIES.map((entity) => entityRegistrationSchema.parse(entity));

  return db.transaction(async (tx) => {
    const { devices, entities, entityCapabilities } = schema.registry;

    const [existing] = await tx
      .select({ id: devices.id })
      .from(devices)
      .where(eq(devices.source, 'system'))
      .limit(1);

    const [device] =
      existing === undefined
        ? await tx
            .insert(devices)
            .values({
              source: 'system',
              name: SYSTEM_DEVICE_NAME,
              icon: SYSTEM_DEVICE_ICON,
              ...facts,
              lastSeenAt: new Date(),
            })
            .returning({ id: devices.id })
        : await tx
            .update(devices)
            .set({ ...facts, lastSeenAt: new Date(), updatedAt: new Date() })
            .where(eq(devices.id, existing.id))
            .returning({ id: devices.id });

    if (device === undefined) {
      throw new Error('The system device was neither found nor written');
    }

    const taken = await tx
      .select({ entityId: entities.entityId, source: entities.source })
      .from(entities)
      .where(
        and(
          inArray(
            entities.entityId,
            registrations.map((entity) => entity.entityId),
          ),
          ne(entities.source, 'system'),
        ),
      );

    for (const row of taken) {
      logger.error(
        { entityId: row.entityId, source: row.source },
        'A system entity id is taken by another entity; that reading will have no entity',
      );
    }

    const takenIds = new Set(taken.map((row) => row.entityId));
    const wanted = registrations.filter((entity) => !takenIds.has(entity.entityId));

    if (wanted.length === 0) {
      return device.id;
    }

    const rows = await tx
      .insert(entities)
      .values(
        wanted.map((entity) => ({
          entityId: entity.entityId,
          deviceId: device.id,
          source: 'system',
          name: entity.name,
          icon: entity.icon ?? null,
          unitOfMeasurement: entity.unitOfMeasurement ?? null,
          deviceClass: entity.deviceClass ?? null,
          stateClass: entity.stateClass ?? null,
          displayPrecision: entity.displayPrecision ?? null,
        })),
      )
      .onConflictDoUpdate({
        target: entities.entityId,
        set: {
          // The owner's name stays and their icon stays; what the reading is - its unit, its
          // class, how it is shown - is the platform's, and follows the release.
          icon: sql`coalesce(${entities.icon}, excluded.icon)`,
          deviceId: sql`excluded.device_id`,
          unitOfMeasurement: sql`excluded.unit_of_measurement`,
          deviceClass: sql`excluded.device_class`,
          stateClass: sql`excluded.state_class`,
          displayPrecision: sql`excluded.display_precision`,
          updatedAt: new Date(),
        },
      })
      .returning({ id: entities.id, entityId: entities.entityId });

    const declared = new Map(
      wanted.map((entity) => [String(entity.entityId), entity.capabilities]),
    );

    // Replaced rather than merged, as a device's are: a reading that changes capability must
    // not keep the old one beside it.
    await tx.delete(entityCapabilities).where(
      inArray(
        entityCapabilities.entityId,
        rows.map((row) => row.id),
      ),
    );

    await tx.insert(entityCapabilities).values(
      rows.flatMap((row) =>
        Object.entries(declared.get(row.entityId) ?? {}).map(([capability, params]) => ({
          entityId: row.id,
          capability,
          params,
        })),
      ),
    );

    return device.id;
  });
}
