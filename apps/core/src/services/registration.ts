/**
 * Registering a device an integration adopted.
 *
 * `hub` finds devices; `core` writes them down. That split exists because `core` is the single
 * writer of the registry **and** holds the directory it routes commands against, loaded once at
 * startup. A row written behind its back would be invisible until the next restart, so a command
 * for a device adopted a minute ago would come back as "not registered" - which looks like a
 * broken device rather than a stale cache.
 *
 * Writing the rows and updating the directory therefore happen in the same call, in that order:
 * the database first, because a directory entry for a row that failed to write would route
 * commands at nothing.
 *
 * **Registration is idempotent.** Adopting the same device again - after a firmware update, or a
 * rescan - updates what is there rather than adding a second copy of the same relay.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';

import type { BusClient, BusSubscription } from '@nebula-home/bus';
import {
  busSubjects,
  CORE_REGISTER_METHOD,
  CORE_SERVICE,
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
 * Finds the row of the device this one is reached through.
 *
 * @param db - A connected database handle.
 * @param integrationId - The instance both devices belong to.
 * @param externalId - What the integration calls the device in front, or undefined.
 * @returns Its row identifier, or null when there is none or it has not registered yet. Null
 * rather than an error: a BLE thermometer must not be unregisterable because the proxy relaying
 * it happens to come up second.
 */
async function resolveVia(
  db: Database,
  integrationId: string,
  externalId: string | undefined,
): Promise<string | null> {
  if (externalId === undefined) {
    return null;
  }

  const [row] = await db
    .select({ id: schema.registry.devices.id })
    .from(schema.registry.devices)
    .where(
      and(
        eq(schema.registry.devices.integrationId, integrationId),
        eq(schema.registry.devices.externalId, externalId),
      ),
    );

  return row?.id ?? null;
}

/**
 * Writes one device and its entities.
 *
 * Four statements regardless of how many entities the device has, rather than three per entity.
 * That is not only faster: a transaction holds one connection, so per-entity statements have to
 * run one after another anyway, and a device with twenty entities would hold the transaction open
 * for sixty round trips.
 *
 * @param db - A connected database handle.
 * @param request - What `hub` adopted.
 * @returns The device row and its entities.
 */
async function write(
  db: Database,
  request: RegisterDeviceRequest,
): Promise<{ deviceId: string; entities: WrittenEntity[] }> {
  const viaDeviceId = await resolveVia(db, request.integrationId, request.viaExternalId);

  return db.transaction(async (tx) => {
    const [device] = await tx
      .insert(schema.registry.devices)
      .values({
        integrationId: request.integrationId,
        externalId: request.externalId,
        name: request.name,
        manufacturer: request.manufacturer ?? null,
        model: request.model ?? null,
        swVersion: request.swVersion ?? null,
        hwVersion: request.hwVersion ?? null,
        areaId: request.areaId ?? null,
        viaDeviceId,
        config: request.config,
      })
      .onConflictDoUpdate({
        // The device is the same device when the integration calls it the same thing, which is
        // what `UNIQUE (integration_id, external_id)` says. Everything else may have changed:
        // firmware reports a new version, the owner renamed it, the owner recognised it afresh.
        target: [schema.registry.devices.integrationId, schema.registry.devices.externalId],
        set: {
          name: request.name,
          manufacturer: request.manufacturer ?? null,
          model: request.model ?? null,
          swVersion: request.swVersion ?? null,
          hwVersion: request.hwVersion ?? null,
          config: request.config,
          updatedAt: new Date(),
        },
      })
      .returning({ id: schema.registry.devices.id });

    const deviceId = device?.id ?? '';

    const rows = await tx
      .insert(schema.registry.entities)
      .values(
        request.entities.map((entity) => ({
          entityId: entity.entityId,
          deviceId,
          integrationId: request.integrationId,
          source: 'adapter',
          name: entity.name,
          areaId: request.areaId ?? null,
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
      entities: rows.map((row): WrittenEntity => ({
        rowId: row.id,
        entityId: parseEntityId(row.entityId),
        capabilities: toCapabilityMap(declaredBy.get(row.entityId) ?? {}),
      })),
    };
  });
}

/**
 * Serves the subject `hub` registers adopted devices on.
 *
 * @param options - The bus client, the database, the directory and the logger.
 * @returns The subscription, to unsubscribe on shutdown.
 */
export function startRegistrationService(options: RegistrationOptions): BusSubscription {
  return options.client.serve(
    busSubjects.service(CORE_SERVICE, CORE_REGISTER_METHOD),
    registerDeviceRequestSchema,

    /**
     * Registers one device and everything it exposes.
     *
     * @param request - What was adopted.
     * @returns What was written.
     */
    async (request: RegisterDeviceRequest): Promise<RegisterDeviceReply> => {
      const { deviceId, entities } = await write(options.db, request);

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

      options.client.publish(busSubjects.deviceEvent('added'), {
        deviceId,
        source: request.integrationId,
        name: request.name,
        entityIds,
      });

      options.logger.info(
        { deviceId, integrationId: request.integrationId, entities: entityIds.length },
        'Registered a device',
      );

      return { deviceId, entityIds };
    },
  );
}
