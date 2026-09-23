/**
 * Reading what is already added, for discovery not to propose it again.
 *
 * Every instance, enabled or not, running or failed, with its device's external id when it has
 * been identified: an owner who added a device that is switched off today must not be offered it
 * again tomorrow. Read-only, within the grant `hub` has on both tables.
 */
import { eq } from 'drizzle-orm';

import type { JsonObject } from '@nebula-home/contracts';
import { schema, type Database } from '@nebula-home/db';

import { takenFrom, type TakenDevices } from '../domain/taken.js';

/**
 * Reads the ids and addresses of every instance.
 *
 * @param db - A connected database handle.
 * @returns What is already added, keyed by vendor.
 */
export async function loadTakenDevices(db: Database): Promise<TakenDevices> {
  const rows = await db
    .select({
      kind: schema.registry.integrations.kind,
      transportConfig: schema.registry.integrations.transportConfig,
      externalId: schema.registry.devices.externalId,
    })
    .from(schema.registry.integrations)
    .leftJoin(
      schema.registry.devices,
      eq(schema.registry.devices.integrationId, schema.registry.integrations.id),
    );

  return takenFrom(
    rows.map((row) => ({
      kind: row.kind,
      transportConfig: row.transportConfig as JsonObject,
      externalId: row.externalId,
    })),
  );
}
