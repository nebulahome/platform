/**
 * Completing a device an instance has identified.
 *
 * The API creates a device - the instance that reaches it and the registry row that names it;
 * `hub` hears from the hardware; `core` writes what it heard down. That split exists because
 * `core` is the single writer of the registry **and** holds the directory it routes commands
 * against, loaded once at startup. A row written behind its back would be invisible until the
 * next restart, so a command for a device identified a minute ago would come back as "not
 * registered" - which looks like a broken device rather than a stale cache.
 *
 * Writing the rows and updating the directory therefore happen in the same call, in that order:
 * the database first, because a directory entry for a row that failed to write would route
 * commands at nothing.
 *
 * **Completion is idempotent, and it completes.** The name and the icon are the owner's, set
 * when the device was added, and are not touched; the serial, the claim and the entities are
 * written, and what the hardware reports about itself fills in only what the owner left blank.
 * Hearing the same device again - after a restart that could not bind it from its row - updates
 * what is there rather than adding a second copy of the same relay.
 *
 * An entity's name and icon follow the same rule one step later: the bundle's words are written
 * when the entity first appears, and from then on they belong to whoever renamed it or picked
 * its icon in the interface. Hearing the device again fills in an icon the row still lacks and
 * changes nothing else the owner could have set.
 *
 * **Releasing is the same call in reverse.** When the owner removes a device, the API asks here
 * rather than deleting the rows itself, for the reason completion is here: the entities go in
 * the same step as the directory that routes to them, the registry that snapshots them and
 * the buffered states that would otherwise be written against rows that no longer exist. One
 * transaction takes the entities, the identity row and the instance row together - the
 * entities restrict the instance's deletion, so they cannot go separately anyway.
 */
import { eq, inArray, sql } from 'drizzle-orm';

import type { BusClient, BusSubscription } from '@nebula-home/bus';
import {
  busSubjects,
  ConflictError,
  CORE_DEVICE_INFO_METHOD,
  CORE_REGISTER_METHOD,
  CORE_SERVICE,
  CORE_UNREGISTER_METHOD,
  deviceInfoRequestSchema,
  NotFoundError,
  parseEntityId,
  registerDeviceRequestSchema,
  unregisterDeviceRequestSchema,
  type CapabilityName,
  type DeviceInfoReply,
  type DeviceInfoRequest,
  type EntityId,
  type JsonObject,
  type RegisterDeviceReply,
  type RegisterDeviceRequest,
  type UnregisterDeviceReply,
  type UnregisterDeviceRequest,
} from '@nebula-home/contracts';
import { schema, type Database } from '@nebula-home/db';
import type { PlatformLogger } from '@nebula-home/logging';

import type { EntityDirectory } from '../domain/entity-directory.js';
import type { EntityRegistry } from '../domain/entity-registry.js';
import type { BatchWriter } from '../persistence/batch-writer.js';
import type { EntityStateRow } from '../persistence/history-writer.js';

/** What the registration service needs. */
export type RegistrationOptions = {
  /** The bus client to serve on and announce through. */
  readonly client: BusClient;

  readonly db: Database;

  /** The live directory, updated in the same call that writes the rows. */
  readonly directory: EntityDirectory;

  /** The live states, which forget a released entity in the same call that deletes its rows. */
  readonly registry: EntityRegistry;

  /** The state rows waiting to be written; those of a released entity are dropped with it. */
  readonly stateCache: BatchWriter<EntityStateRow>;

  readonly logger: PlatformLogger;
};

/** One entity as it was written. */
type WrittenEntity = {
  readonly rowId: string;
  readonly entityId: EntityId;
  readonly capabilities: Map<CapabilityName, JsonObject>;
};

/**
 * Reads the capabilities an entity declared into the shape the directory holds.
 *
 * @param declared - What the request carried.
 * @returns The same thing, keyed by capability name.
 */
function toCapabilityMap(declared: Record<string, JsonObject>): Map<CapabilityName, JsonObject> {
  return new Map(
    Object.entries(declared).map(([capability, params]) => [capability as CapabilityName, params]),
  );
}

/**
 * Completes one device and writes its entities.
 *
 * Four statements regardless of how many entities the device has, rather than three per entity.
 * That is not only faster: a transaction holds one connection, so per-entity statements have to
 * run one after another anyway, and a device with twenty entities would hold the transaction open
 * for sixty round trips.
 *
 * @param db - A connected database handle.
 * @param request - What `hub` heard.
 * @returns The device row, its name, and its entities.
 * @throws {NotFoundError} When no device row belongs to the instance. The API writes that row;
 * `hub` cannot, and must not, make it appear.
 */
async function write(
  db: Database,
  request: RegisterDeviceRequest,
): Promise<{ deviceId: string; name: string; entities: WrittenEntity[] }> {
  return db.transaction(async (tx) => {
    const { devices } = schema.registry;

    // What the hardware reports fills in only what the owner left blank. A printer that says
    // nothing about its model must not null the `X1C` the owner picked; a relay that reports
    // one refines it.
    const [device] = await tx
      .update(devices)
      .set({
        externalId: request.externalId,
        manufacturer: sql`coalesce(${request.manufacturer ?? null}, ${devices.manufacturer})`,
        model: sql`coalesce(${request.model ?? null}, ${devices.model})`,
        swVersion: sql`coalesce(${request.swVersion ?? null}, ${devices.swVersion})`,
        hwVersion: sql`coalesce(${request.hwVersion ?? null}, ${devices.hwVersion})`,
        config: request.config,
        updatedAt: new Date(),
      })
      .where(eq(devices.integrationId, request.integrationId))
      .returning({ id: devices.id, name: devices.name });

    if (device === undefined) {
      throw new NotFoundError('No device row belongs to that instance', {
        details: { integrationId: request.integrationId },
      });
    }

    const deviceId = device.id;

    const rows = await tx
      .insert(schema.registry.entities)
      .values(
        request.entities.map((entity) => ({
          entityId: entity.entityId,
          deviceId,
          integrationId: request.integrationId,
          source: 'adapter',
          name: entity.name,
          icon: entity.icon ?? null,
          unitOfMeasurement: entity.unitOfMeasurement ?? null,
          deviceClass: entity.deviceClass ?? null,
          stateClass: entity.stateClass ?? null,
          displayPrecision: entity.displayPrecision ?? null,
        })),
      )
      .onConflictDoUpdate({
        target: schema.registry.entities.entityId,
        set: {
          // The owner's name stays; an icon is only ever filled in, never replaced.
          icon: sql`coalesce(${schema.registry.entities.icon}, excluded.icon)`,
          deviceId: sql`excluded.device_id`,
          integrationId: sql`excluded.integration_id`,
          updatedAt: new Date(),
        },
      })
      .returning({
        id: schema.registry.entities.id,
        entityId: schema.registry.entities.entityId,
      });

    const declaredBy = new Map(
      request.entities.map((entity) => [String(entity.entityId), entity.capabilities]),
    );

    // Replaced rather than merged: a firmware update that drops a capability must drop it here
    // too, or `core` keeps accepting commands the device can no longer perform.
    await tx.delete(schema.registry.entityCapabilities).where(
      inArray(
        schema.registry.entityCapabilities.entityId,
        rows.map((row) => row.id),
      ),
    );

    await tx.insert(schema.registry.entityCapabilities).values(
      rows.flatMap((row) =>
        Object.entries(declaredBy.get(row.entityId) ?? {}).map(([capability, params]) => ({
          entityId: row.id,
          capability,
          params,
        })),
      ),
    );

    return {
      deviceId,
      name: device.name,
      entities: rows.map((row): WrittenEntity => ({
        rowId: row.id,
        entityId: parseEntityId(row.entityId),
        capabilities: toCapabilityMap(declaredBy.get(row.entityId) ?? {}),
      })),
    };
  });
}

/** One entity as it was released. */
type ReleasedEntity = {
  readonly rowId: string;
  readonly entityId: EntityId;
};

/**
 * Deletes a device: its entities, its identity row and its instance row, in one transaction.
 *
 * The entities go first because they restrict the instance's deletion; the instance goes last
 * and takes the identity row with it. Everything hanging off an entity - its capabilities, its
 * cached state, its tags, its place in a scene - cascades. A derived entity reading one of them
 * does not: `alias_sources` restricts on purpose, and the request is refused naming the entities
 * so the owner can edit the alias first.
 *
 * @param db - A connected database handle.
 * @param request - Which instance to release.
 * @returns The identity row, if the device had been identified, its name, and its entities.
 * @throws {NotFoundError} When no instance has that id.
 * @throws {ConflictError} When a derived entity reads one of the device's entities.
 */
async function erase(
  db: Database,
  request: UnregisterDeviceRequest,
): Promise<{ deviceId: string | null; name: string; entities: ReleasedEntity[] }> {
  return db.transaction(async (tx) => {
    const { aliasSources, devices, entities, integrations } = schema.registry;

    const [device] = await tx
      .select({ id: devices.id, name: devices.name })
      .from(devices)
      .where(eq(devices.integrationId, request.integrationId));

    const owned = await tx
      .select({ rowId: entities.id, entityId: entities.entityId })
      .from(entities)
      .where(eq(entities.integrationId, request.integrationId));

    const rowIds = owned.map((entity) => entity.rowId);

    if (rowIds.length > 0) {
      const read = await tx
        .selectDistinct({ rowId: aliasSources.entityId })
        .from(aliasSources)
        .where(inArray(aliasSources.entityId, rowIds));

      if (read.length > 0) {
        const reading = new Set(read.map((row) => row.rowId));

        throw new ConflictError('Derived entities still read this device', {
          details: {
            integrationId: request.integrationId,
            entityIds: owned
              .filter((entity) => reading.has(entity.rowId))
              .map((entity) => entity.entityId),
          },
        });
      }

      await tx.delete(entities).where(inArray(entities.id, rowIds));
    }

    const gone = await tx
      .delete(integrations)
      .where(eq(integrations.id, request.integrationId))
      .returning({ id: integrations.id });

    if (gone.length === 0) {
      throw new NotFoundError('No integration has that id', {
        details: { integrationId: request.integrationId },
      });
    }

    return {
      deviceId: device?.id ?? null,
      name: device?.name ?? request.integrationId,
      entities: owned.map((entity) => ({
        rowId: entity.rowId,
        entityId: parseEntityId(entity.entityId),
      })),
    };
  });
}

/**
 * Serves the subjects `hub` completes identified devices on and the API releases them on.
 *
 * @param options - The bus client, the database, the live directory and registry, the state
 * cache and the logger.
 * @returns The subscriptions, to unsubscribe on shutdown.
 */
export function startRegistrationService(options: RegistrationOptions): BusSubscription[] {
  return [serveRegister(options), serveUnregister(options), serveDeviceInfo(options)];
}

/**
 * Serves the subject `hub` reports a running device's firmware on.
 *
 * Written only when it differs, and announced only then: a hub that restarts reports every
 * device's firmware once, and a house of forty relays must not become forty events saying
 * nothing changed.
 *
 * @param options - See {@link RegistrationOptions}.
 * @returns The subscription.
 */
function serveDeviceInfo(options: RegistrationOptions): BusSubscription {
  return options.client.serve(
    busSubjects.service(CORE_SERVICE, CORE_DEVICE_INFO_METHOD),
    deviceInfoRequestSchema,

    /**
     * Writes down what changed.
     *
     * @param request - The device and what it reports.
     * @returns Whether the row changed.
     */
    async (request: DeviceInfoRequest): Promise<DeviceInfoReply> => {
      const { devices } = schema.registry;
      const swVersion = request.swVersion ?? null;
      const hwVersion = request.hwVersion ?? null;
      const [changed] = await options.db
        .update(devices)
        .set({
          swVersion: sql`coalesce(${swVersion}, ${devices.swVersion})`,
          hwVersion: sql`coalesce(${hwVersion}, ${devices.hwVersion})`,
          updatedAt: new Date(),
        })
        .where(
          sql`${devices.integrationId} = ${request.integrationId} AND (
            (${swVersion}::text IS NOT NULL AND ${devices.swVersion} IS DISTINCT FROM ${swVersion}::text)
            OR (${hwVersion}::text IS NOT NULL AND ${devices.hwVersion} IS DISTINCT FROM ${hwVersion}::text)
          )`,
        )
        .returning({ name: devices.name, swVersion: devices.swVersion });

      if (changed === undefined) {
        return { isChanged: false };
      }

      options.client.publish(busSubjects.deviceEvent('updated'), {
        deviceId: request.integrationId,
        source: request.integrationId,
        name: changed.name,
        entityIds: [],
      });
      options.logger.info(
        { integrationId: request.integrationId, swVersion: changed.swVersion },
        'A device reports new firmware',
      );

      return { isChanged: true };
    },
  );
}

/**
 * Serves the subject `hub` completes identified devices on.
 *
 * @param options - See {@link RegistrationOptions}.
 * @returns The subscription.
 */
function serveRegister(options: RegistrationOptions): BusSubscription {
  return options.client.serve(
    busSubjects.service(CORE_SERVICE, CORE_REGISTER_METHOD),
    registerDeviceRequestSchema,

    /**
     * Completes one device and registers everything it exposes.
     *
     * @param request - What was heard.
     * @returns What was written.
     */
    async (request: RegisterDeviceRequest): Promise<RegisterDeviceReply> => {
      const { deviceId, name, entities } = await write(options.db, request);

      for (const entity of entities) {
        options.directory.set({
          entityId: entity.entityId,
          rowId: entity.rowId,
          source: request.integrationId,
          isEnabled: true,
          capabilities: entity.capabilities,
        });
      }

      const entityIds = entities.map((entity) => entity.entityId);

      // Named by its public id - the instance id every page lists it under - and by the name
      // the owner gave it, which is the row's.
      options.client.publish(busSubjects.deviceEvent('added'), {
        deviceId: request.integrationId,
        source: request.integrationId,
        name,
        entityIds,
      });

      options.logger.info(
        { deviceId, integrationId: request.integrationId, entities: entityIds.length },
        'Completed a device',
      );

      return { deviceId, entityIds };
    },
  );
}

/**
 * Serves the subject the API releases devices on.
 *
 * The rows go first, then what is held in memory, in that order: a directory entry for a row
 * that failed to delete would still route correctly, whereas a deleted row still in the
 * directory would route commands at nothing. The directory goes before the buffered states so
 * that a report still in flight is refused by ingest rather than re-buffered behind the drop.
 *
 * @param options - See {@link RegistrationOptions}.
 * @returns The subscription.
 */
function serveUnregister(options: RegistrationOptions): BusSubscription {
  return options.client.serve(
    busSubjects.service(CORE_SERVICE, CORE_UNREGISTER_METHOD),
    unregisterDeviceRequestSchema,

    /**
     * Releases one device and everything it exposed.
     *
     * @param request - Which instance.
     * @returns What was released.
     */
    async (request: UnregisterDeviceRequest): Promise<UnregisterDeviceReply> => {
      const { deviceId, name, entities } = await erase(options.db, request);
      const rowIds = new Set(entities.map((entity) => entity.rowId));

      for (const entity of entities) {
        options.directory.remove(entity.entityId);
        options.registry.remove(entity.entityId);
      }

      const dropped = options.stateCache.discard((row) => rowIds.has(row.entityId));
      const entityIds = entities.map((entity) => entity.entityId);

      options.client.publish(busSubjects.deviceEvent('removed'), {
        deviceId: request.integrationId,
        source: request.integrationId,
        name,
        entityIds,
      });

      options.logger.info(
        { deviceId, integrationId: request.integrationId, entities: entityIds.length, dropped },
        'Released a device',
      );

      return { deviceId, entityIds };
    },
  );
}
