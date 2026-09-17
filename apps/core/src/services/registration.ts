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
 */
import { eq, inArray, sql } from 'drizzle-orm';

import type { BusClient, BusSubscription } from '@nebula-home/bus';
import {
  busSubjects,
  CORE_REGISTER_METHOD,
  CORE_SERVICE,
  NotFoundError,
  parseEntityId,
  registerDeviceRequestSchema,
  type CapabilityName,
  type EntityId,
  type JsonObject,
  type RegisterDeviceReply,
  type RegisterDeviceRequest,
} from '@nebula-home/contracts';
import { schema, type Database } from '@nebula-home/db';
import type { PlatformLogger } from '@nebula-home/logging';

import type { EntityDirectory } from '../domain/entity-directory.js';

/** What the registration service needs. */
export type RegistrationOptions = {
  /** The bus client to serve on and announce through. */
  readonly client: BusClient;

  readonly db: Database;

  /** The live directory, updated in the same call that writes the rows. */
  readonly directory: EntityDirectory;

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
          unitOfMeasurement: entity.unitOfMeasurement ?? null,
          deviceClass: entity.deviceClass ?? null,
          stateClass: entity.stateClass ?? null,
          displayPrecision: entity.displayPrecision ?? null,
        })),
      )
      .onConflictDoUpdate({
        target: schema.registry.entities.entityId,
        set: {
          name: sql`excluded.name`,
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

/**
 * Serves the subject `hub` completes identified devices on.
 *
 * @param options - The bus client, the database, the directory and the logger.
 * @returns The subscription, to unsubscribe on shutdown.
 */
export function startRegistrationService(options: RegistrationOptions): BusSubscription {
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
