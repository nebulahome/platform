/**
 * Answering a package's read of the house (`ctx.house`).
 *
 * A package acts for the house, as `ctx.entities` does, and has no database: so `core` reads the
 * owner's arrangement for it - floors and rooms, devices, entities with their names, rooms and
 * declared capabilities - in one answer. Linked devices and entities are left out: the house
 * shows them as the one they are linked to, and their addresses mean that one. Disabled entities
 * are left out too: they take no commands and report nothing.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import type { BusClient, BusSubscription } from '@nebulahome/bus';
import {
  busSubjects,
  CORE_HOUSE_METHOD,
  CORE_SERVICE,
  houseReplySchema,
  type HouseReply,
  type JsonObject,
} from '@nebulahome/contracts';
import { schema, type Database } from '@nebulahome/db';

/** What the house service needs. */
export type HouseServiceOptions = {
  /** The bus client to serve on. */
  readonly client: BusClient;

  /** The database the house is read from. */
  readonly db: Database;
};

/**
 * The vendor of an integration's driver.
 *
 * @param kind - `shelly/dimmer-pm`.
 * @returns `shelly`.
 */
function vendorOf(kind: string): string {
  return kind.split('/')[0] ?? kind;
}

/**
 * Reads the house, whole.
 *
 * @param db - The database.
 * @returns Its areas, its listed devices and its enabled entities.
 */
export async function readHouse(db: Database): Promise<HouseReply> {
  const { areas, devices, entities, entityCapabilities, integrations } = schema.registry;
  const [areaRows, deviceRows, entityRows, capabilityRows, integrationRows] = await Promise.all([
    db.select().from(areas),
    db
      .select({
        id: devices.id,
        name: devices.name,
        icon: devices.icon,
        manufacturer: devices.manufacturer,
        model: devices.model,
        swVersion: devices.swVersion,
        externalId: devices.externalId,
        areaId: devices.areaId,
        packageId: devices.packageId,
        integrationId: devices.integrationId,
      })
      .from(devices)
      .where(isNull(devices.linkedTo)),
    db
      .select({
        rowId: entities.id,
        entityId: entities.entityId,
        name: entities.name,
        icon: entities.icon,
        shownDomain: entities.shownDomain,
        deviceId: entities.deviceId,
        areaId: entities.areaId,
        deviceClass: entities.deviceClass,
        unitOfMeasurement: entities.unitOfMeasurement,
        isHidden: entities.isHidden,
        kind: entities.source,
        packageId: entities.packageId,
        integrationId: entities.integrationId,
      })
      .from(entities)
      .where(and(isNull(entities.linkedTo), eq(entities.isEnabled, true))),
    db.select().from(entityCapabilities),
    db.select({ id: integrations.id, kind: integrations.kind }).from(integrations),
  ]);

  const vendorByInstance = new Map(integrationRows.map((row) => [row.id, vendorOf(row.kind)]));
  const deviceArea = new Map(deviceRows.map((row) => [row.id, row.areaId]));
  const capabilitiesByRow = new Map<string, Record<string, JsonObject>>();

  for (const row of capabilityRows) {
    const existing = capabilitiesByRow.get(row.entityId) ?? {};

    existing[row.capability] = (row.params ?? {}) as JsonObject;
    capabilitiesByRow.set(row.entityId, existing);
  }

  /**
   * Who brought a row: its package, or its integration's vendor.
   *
   * @param packageId - The package column.
   * @param integrationId - The integration column.
   * @returns The owner, or null for neither.
   */
  const ownerOf = (packageId: string | null, integrationId: string | null): string | null =>
    packageId ?? (integrationId === null ? null : (vendorByInstance.get(integrationId) ?? null));

  return houseReplySchema.parse({
    areas: areaRows.map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      parentId: row.parentId,
      level: row.level,
      icon: row.icon,
      sortOrder: row.sortOrder,
    })),
    devices: deviceRows.map((row) => ({
      id: row.id,
      name: row.name,
      icon: row.icon,
      manufacturer: row.manufacturer,
      model: row.model,
      swVersion: row.swVersion,
      externalId: row.externalId,
      areaId: row.areaId,
      owner: ownerOf(row.packageId, row.integrationId),
    })),
    entities: entityRows.map((row) => ({
      entityId: row.entityId,
      name: row.name,
      icon: row.icon,
      shownDomain: row.shownDomain,
      // A device linked to another is not listed: its entity hangs on no listed device.
      deviceId: row.deviceId !== null && deviceArea.has(row.deviceId) ? row.deviceId : null,
      areaId: row.areaId ?? (row.deviceId === null ? null : (deviceArea.get(row.deviceId) ?? null)),
      deviceClass: row.deviceClass,
      unitOfMeasurement: row.unitOfMeasurement,
      isHidden: row.isHidden,
      owner: ownerOf(row.packageId, row.integrationId) ?? row.kind,
      capabilities: capabilitiesByRow.get(row.rowId) ?? {},
    })),
  });
}

/**
 * Serves the house read.
 *
 * @param options - The bus client and the database.
 * @returns The subscription, to unsubscribe on shutdown.
 */
export function startHouseService(options: HouseServiceOptions): BusSubscription {
  return options.client.serve(
    busSubjects.service(CORE_SERVICE, CORE_HOUSE_METHOD),
    z.unknown(),

    /**
     * Answers with the house as it stands.
     *
     * @returns The areas, devices and entities.
     */
    async (): Promise<HouseReply> => readHouse(options.db),
  );
}
