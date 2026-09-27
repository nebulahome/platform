/**
 * The devices of the host's containers.
 *
 * The supervisor sees every container Docker runs; `core` is the one writer of the registry. So
 * the supervisor hands over the whole list whenever it changes - every container but the
 * platform's own, each with its entities already named after it - and `core` makes the devices
 * match: a device for a container it had not seen, the facts of one it had (the image, the
 * version) brought up to date, and the device of a container that is gone removed with its
 * entities. The name, the icon, the room and the tags of a device are the owner's once it exists,
 * as they are for the system device.
 *
 * One call for the whole list rather than one per container, because the list is what the
 * supervisor knows for certain: a container that vanished while the supervisor was down is only
 * noticed as missing from the next list.
 *
 * An entity of a gone container that a derived entity still reads is not deleted - the alias
 * restricts it, on purpose, as it restricts a device's release - and its device is kept, its
 * entities unavailable, until the owner edits the alias or the container comes back.
 */
import { and, eq, inArray, ne, notInArray, sql } from 'drizzle-orm';

import type { BusClient, BusSubscription } from '@nebula-home/bus';
import {
  busSubjects,
  containerDeviceId,
  CORE_SERVICE,
  CORE_SYNC_CONTAINERS_METHOD,
  parseEntityId,
  SUPERVISOR_SERVICE,
  syncContainersRequestSchema,
  type CapabilityName,
  type EntityId,
  type JsonObject,
  type SyncContainersReply,
  type SyncContainersRequest,
} from '@nebula-home/contracts';
import { schema, type Database } from '@nebula-home/db';
import type { PlatformLogger } from '@nebula-home/logging';

import type { EntityDirectory } from '../domain/entity-directory.js';
import type { EntityRegistry } from '../domain/entity-registry.js';
import type { BatchWriter } from '../persistence/batch-writer.js';
import type { EntityStateRow } from '../persistence/history-writer.js';

/** The icon a container's device starts with. */
export const CONTAINER_DEVICE_ICON = 'container';

/** Who makes what a container device is. */
const CONTAINER_MANUFACTURER = 'Docker';

/** What the containers service needs. */
export type ContainersServiceOptions = {
  readonly client: BusClient;
  readonly db: Database;

  /** The live directory, updated in the same call that writes the rows. */
  readonly directory: EntityDirectory;

  /** The live states, which forget a removed entity in the same call. */
  readonly registry: EntityRegistry;

  /** The state rows waiting to be written; those of a removed entity are dropped with it. */
  readonly stateCache: BatchWriter<EntityStateRow>;
  readonly logger: PlatformLogger;
};

/** One entity as it was written. */
type WrittenEntity = {
  readonly rowId: string;
  readonly entityId: EntityId;
  readonly isEnabled: boolean;
  readonly capabilities: Map<CapabilityName, JsonObject>;
};

/** One container's device as it was written. */
type WrittenDevice = {
  readonly name: string;
  readonly displayName: string;
  readonly isNew: boolean;
  readonly entities: WrittenEntity[];
};

/** One entity that was deleted. */
type RemovedEntity = { readonly rowId: string; readonly entityId: EntityId };

/** What a sync did. */
export type SyncOutcome = {
  readonly written: WrittenDevice[];

  /** The devices removed, each with the entities that went with it. */
  readonly removed: { readonly name: string; readonly entities: RemovedEntity[] }[];

  /** Entities of a container no longer declared that an alias still reads: kept, unavailable. */
  readonly stranded: EntityId[];

  /** Containers that are gone but whose device is kept because an alias reads it. */
  readonly kept: string[];
};

/** What reading the alias sources needs: the database, or a transaction on it. */
type Reader = Pick<Database, 'selectDistinct'>;

/**
 * The rows of entities no derived entity reads, out of those given.
 *
 * @param tx - The transaction.
 * @param rowIds - The candidates.
 * @returns The ones free to delete.
 */
async function unread(tx: Reader, rowIds: readonly string[]): Promise<Set<string>> {
  if (rowIds.length === 0) {
    return new Set();
  }

  const read = await tx
    .selectDistinct({ rowId: schema.registry.aliasSources.entityId })
    .from(schema.registry.aliasSources)
    .where(inArray(schema.registry.aliasSources.entityId, [...rowIds]));
  const reading = new Set(read.map((row) => row.rowId));

  return new Set(rowIds.filter((rowId) => !reading.has(rowId)));
}

/**
 * Makes the container devices match the list, in one transaction.
 *
 * @param db - A connected database handle.
 * @param request - Every container but the platform's own.
 * @param logger - Where a taken entity id is reported.
 * @returns What was written, removed and kept.
 */
export async function syncContainerDevices(
  db: Database,
  request: SyncContainersRequest,
  logger: PlatformLogger,
): Promise<SyncOutcome> {
  // One transaction holds one connection, so its statements run one after another whatever the
  // loops say; awaiting each in turn is what the database does anyway.
  /* eslint-disable no-await-in-loop -- see above */
  return db.transaction(async (tx) => {
    const { devices, entities, entityCapabilities } = schema.registry;

    const existing = await tx
      .select({ id: devices.id, externalId: devices.externalId, name: devices.name })
      .from(devices)
      .where(eq(devices.source, 'container'));
    const byName = new Map(existing.map((row) => [row.externalId ?? '', row]));
    const written: WrittenDevice[] = [];
    const stranded: EntityId[] = [];

    for (const container of request.containers) {
      const found = byName.get(container.name);
      const facts = {
        manufacturer: CONTAINER_MANUFACTURER,
        model: container.image,
        swVersion: container.swVersion ?? null,
        lastSeenAt: new Date(),
      };

      // The owner's name and icon are never touched once the device exists.
      const [device] =
        found === undefined
          ? await tx
              .insert(devices)
              .values({
                source: 'container',
                externalId: container.name,
                name: container.name,
                icon: CONTAINER_DEVICE_ICON,
                ...facts,
              })
              .returning({ id: devices.id, name: devices.name })
          : await tx
              .update(devices)
              .set({ ...facts, updatedAt: new Date() })
              .where(eq(devices.id, found.id))
              .returning({ id: devices.id, name: devices.name });

      if (device === undefined) {
        throw new Error(`The device of container ${container.name} was neither found nor written`);
      }

      const wantedIds = container.entities.map((entity) => entity.entityId);
      const taken = await tx
        .select({ entityId: entities.entityId, source: entities.source })
        .from(entities)
        .where(and(inArray(entities.entityId, wantedIds), ne(entities.source, 'container')));

      for (const row of taken) {
        logger.error(
          { entityId: row.entityId, source: row.source, container: container.name },
          'A container entity id is taken by another entity; that reading will have no entity',
        );
      }

      const takenIds = new Set(taken.map((row) => row.entityId));
      const wanted = container.entities.filter((entity) => !takenIds.has(entity.entityId));

      // An entity the container no longer has - the supervisor's set changed with a release -
      // goes, unless an alias reads it.
      const dropped = await tx
        .select({ rowId: entities.id, entityId: entities.entityId })
        .from(entities)
        .where(
          and(
            eq(entities.deviceId, device.id),
            wanted.length === 0
              ? sql`true`
              : notInArray(
                  entities.entityId,
                  wanted.map((entity) => entity.entityId),
                ),
          ),
        );
      const free = await unread(
        tx,
        dropped.map((row) => row.rowId),
      );

      if (free.size > 0) {
        await tx.delete(entities).where(inArray(entities.id, [...free]));
      }

      stranded.push(
        ...dropped.filter((row) => !free.has(row.rowId)).map((row) => parseEntityId(row.entityId)),
      );

      if (wanted.length === 0) {
        written.push({
          name: container.name,
          displayName: device.name,
          isNew: found === undefined,
          entities: [],
        });
        continue;
      }

      const rows = await tx
        .insert(entities)
        .values(
          wanted.map((entity) => ({
            entityId: entity.entityId,
            deviceId: device.id,
            source: 'container',
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
            // The owner's name and icon stay; what the reading is follows the release.
            icon: sql`coalesce(${entities.icon}, excluded.icon)`,
            deviceId: sql`excluded.device_id`,
            unitOfMeasurement: sql`excluded.unit_of_measurement`,
            deviceClass: sql`excluded.device_class`,
            stateClass: sql`excluded.state_class`,
            displayPrecision: sql`excluded.display_precision`,
            updatedAt: new Date(),
          },
        })
        .returning({
          id: entities.id,
          entityId: entities.entityId,
          isEnabled: entities.isEnabled,
        });

      const declared = new Map(
        wanted.map((entity) => [String(entity.entityId), entity.capabilities]),
      );

      // Replaced rather than merged: a managed container's image entity stops offering the
      // install, and the old parameters must not stay beside the new.
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

      written.push({
        name: container.name,
        displayName: device.name,
        isNew: found === undefined,
        entities: rows.map((row) => ({
          rowId: row.id,
          entityId: parseEntityId(row.entityId),
          isEnabled: row.isEnabled,
          capabilities: new Map(
            Object.entries(declared.get(row.entityId) ?? {}).map(([capability, params]) => [
              capability as CapabilityName,
              params,
            ]),
          ),
        })),
      });
    }

    const listed = new Set(request.containers.map((container) => container.name));
    const gone = existing.filter((row) => !listed.has(row.externalId ?? ''));
    const removed: SyncOutcome['removed'] = [];
    const kept: string[] = [];

    for (const device of gone) {
      const owned = await tx
        .select({ rowId: entities.id, entityId: entities.entityId })
        .from(entities)
        .where(eq(entities.deviceId, device.id));
      const free = await unread(
        tx,
        owned.map((row) => row.rowId),
      );
      const name = device.externalId ?? device.name;

      if (free.size > 0) {
        await tx.delete(entities).where(inArray(entities.id, [...free]));
      }

      if (free.size < owned.length) {
        kept.push(name);
        stranded.push(
          ...owned.filter((row) => !free.has(row.rowId)).map((row) => parseEntityId(row.entityId)),
        );
        continue;
      }

      await tx.delete(devices).where(eq(devices.id, device.id));
      removed.push({
        name,
        entities: owned.map((row) => ({ rowId: row.rowId, entityId: parseEntityId(row.entityId) })),
      });
    }

    return { written, removed, stranded, kept };
  });
  /* eslint-enable no-await-in-loop */
}

/**
 * Serves the subject the supervisor hands over its list of containers on.
 *
 * The rows first, then the directory, then the events, for the reason a device's completion
 * does it in that order (`registration.ts`).
 *
 * @param options - The bus client, the database, the directory, the registry, the state cache
 * and the logger.
 * @returns The subscription.
 */
export function startContainersService(options: ContainersServiceOptions): BusSubscription {
  return options.client.serve(
    busSubjects.service(CORE_SERVICE, CORE_SYNC_CONTAINERS_METHOD),
    syncContainersRequestSchema,

    /**
     * Makes the container devices match the list.
     *
     * @param request - Every container but the platform's own.
     * @returns What was written, and the gone containers kept for an alias.
     */
    async (request: SyncContainersRequest): Promise<SyncContainersReply> => {
      const outcome = await syncContainerDevices(options.db, request, options.logger);

      for (const device of outcome.written) {
        for (const entity of device.entities) {
          options.directory.set({
            entityId: entity.entityId,
            rowId: entity.rowId,
            source: SUPERVISOR_SERVICE,
            isEnabled: entity.isEnabled,
            capabilities: entity.capabilities,
          });
        }

        options.client.publish(busSubjects.deviceEvent(device.isNew ? 'added' : 'updated'), {
          deviceId: containerDeviceId(device.name),
          source: SUPERVISOR_SERVICE,
          name: device.displayName,
          entityIds: device.isNew ? device.entities.map((entity) => entity.entityId) : [],
        });
      }

      for (const device of outcome.removed) {
        const rowIds = new Set(device.entities.map((entity) => entity.rowId));

        for (const entity of device.entities) {
          options.directory.remove(entity.entityId);
          options.registry.remove(entity.entityId);
        }

        options.stateCache.discard((row) => rowIds.has(row.entityId));
        options.client.publish(busSubjects.deviceEvent('removed'), {
          deviceId: containerDeviceId(device.name),
          source: SUPERVISOR_SERVICE,
          name: device.name,
          entityIds: device.entities.map((entity) => entity.entityId),
        });
      }

      for (const entityId of outcome.stranded) {
        const result = options.registry.setAvailability(entityId, false);

        if (result !== undefined) {
          options.client.publish(busSubjects.stateChanged(entityId), {
            entityId,
            current: result.current,
            previous: result.previous,
          });
        }
      }

      const added = outcome.written.filter((device) => device.isNew).length;

      if (added > 0 || outcome.removed.length > 0 || outcome.kept.length > 0) {
        options.logger.info(
          {
            containers: outcome.written.length,
            added,
            removed: outcome.removed.map((device) => device.name),
            kept: outcome.kept,
          },
          'Took in the containers',
        );
      }

      return {
        devices: outcome.written.map((device) => ({
          deviceId: containerDeviceId(device.name),
          name: device.name,
          entityIds: device.entities.map((entity) => entity.entityId),
        })),
        kept: outcome.kept,
      };
    },
  );
}
