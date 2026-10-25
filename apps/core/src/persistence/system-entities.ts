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

import {
  entityRegistrationSchema,
  parseEntityId,
  QUIET_TIME_ENTITY,
  SUN_ENTITIES,
  SUN_ENTITY_IDS,
  SYSTEM_ENTITIES,
  type CapabilityName,
  type EntityId,
  type EntityRegistration,
  type JsonObject,
} from '@nebulahome/contracts';
import { schema, type Database } from '@nebulahome/db';
import type { PlatformLogger } from '@nebulahome/logging';

import { unreadByAliases } from './alias-readers.js';

/** What the system device is called until the owner calls it something else. */
export const SYSTEM_DEVICE_NAME = 'System';

/** The icon it starts with. */
export const SYSTEM_DEVICE_ICON = 'server';

/** A transaction on the database, as Drizzle hands it to a callback. */
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** One system entity as written: what the directory needs of it. */
export type WrittenSystemEntity = {
  readonly rowId: string;
  readonly entityId: EntityId;
  readonly capabilities: ReadonlyMap<CapabilityName, JsonObject>;
};

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
  const registrations = [...SYSTEM_ENTITIES, QUIET_TIME_ENTITY].map((entity) =>
    entityRegistrationSchema.parse(entity),
  );

  return db.transaction(async (tx) => {
    const { devices } = schema.registry;

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

    await writeSystemEntities(tx, device.id, registrations, logger);

    return device.id;
  });
}

/**
 * Writes some entities on the system device, and their capabilities.
 *
 * An entity id already taken by something that is not a system entity - a device that happens to
 * call its sensor `sensor.system_cpu_usage` - is left alone and reported: taking it over would
 * hand a device's entity to the platform, and the reverse would leave the reading nowhere.
 *
 * @param tx - The transaction.
 * @param deviceId - The system device's row.
 * @param registrations - The entities.
 * @param logger - Where a taken entity id is reported.
 * @returns The entities written.
 */
async function writeSystemEntities(
  tx: Transaction,
  deviceId: string,
  registrations: readonly EntityRegistration[],
  logger: PlatformLogger,
): Promise<WrittenSystemEntity[]> {
  const { entities, entityCapabilities } = schema.registry;
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
    return [];
  }

  const rows = await tx
    .insert(entities)
    .values(
      wanted.map((entity) => ({
        entityId: entity.entityId,
        deviceId,
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

  const declared = new Map(wanted.map((entity) => [String(entity.entityId), entity.capabilities]));

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

  return rows.map((row) => ({
    rowId: row.id,
    entityId: parseEntityId(row.entityId),
    capabilities: new Map(
      Object.entries(declared.get(row.entityId) ?? {}) as [CapabilityName, JsonObject][],
    ),
  }));
}

/** What making the sun entities match the house did. */
export type SunEntitiesSync = {
  /** The entities written: the house has a position. */
  readonly written: readonly WrittenSystemEntity[];

  /** The entities deleted: the house has none. */
  readonly removed: readonly { readonly rowId: string; readonly entityId: EntityId }[];

  /** The entities kept, made unavailable, because a derived entity reads them. */
  readonly stranded: readonly EntityId[];
};

/**
 * Makes the sun's entities match the house: there while it has a position, gone when not.
 *
 * Written on the system device, which must already exist ({@link ensureSystemDevice}). Gone means
 * deleted - unless an alias reads one, which keeps it, unavailable, as a removed container's
 * entity is kept.
 *
 * @param db - A connected database handle.
 * @param isWanted - Whether the house has a position.
 * @param logger - Where a taken entity id is reported.
 * @returns What was written, deleted and kept.
 */
export async function syncSunEntities(
  db: Database,
  isWanted: boolean,
  logger: PlatformLogger,
): Promise<SunEntitiesSync> {
  return db.transaction(async (tx) => {
    const { devices, entities } = schema.registry;

    if (isWanted) {
      const [device] = await tx
        .select({ id: devices.id })
        .from(devices)
        .where(eq(devices.source, 'system'))
        .limit(1);

      if (device === undefined) {
        return { written: [], removed: [], stranded: [] };
      }

      const registrations = SUN_ENTITIES.map((entity) => entityRegistrationSchema.parse(entity));
      const written = await writeSystemEntities(tx, device.id, registrations, logger);

      return { written, removed: [], stranded: [] };
    }

    const present = await tx
      .select({ rowId: entities.id, entityId: entities.entityId })
      .from(entities)
      .where(and(eq(entities.source, 'system'), inArray(entities.entityId, [...SUN_ENTITY_IDS])));
    const free = await unreadByAliases(
      tx,
      present.map((row) => row.rowId),
    );

    if (free.size > 0) {
      await tx.delete(entities).where(inArray(entities.id, [...free]));
    }

    return {
      written: [],
      removed: present
        .filter((row) => free.has(row.rowId))
        .map((row) => ({ rowId: row.rowId, entityId: parseEntityId(row.entityId) })),
      stranded: present
        .filter((row) => !free.has(row.rowId))
        .map((row) => parseEntityId(row.entityId)),
    };
  });
}
