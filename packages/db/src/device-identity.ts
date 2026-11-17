/**
 * One piece of hardware is one device: no two devices of a vendor share an `externalId`.
 *
 * There is no unique index to say so - `registry.devices` has no vendor column, the vendor is the
 * first half of its instance's kind - so `core`, completing a device, and `api`, adding one found
 * with its id already known, both lock the vendor and the id for the rest of their transaction
 * and look before they write. The lock is what keeps two of them identified at once from both
 * passing the look.
 */
import { and, eq, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { Database } from './client.js';
import { devices, integrations } from './schema/registry.js';

/** What the two lookups need of a database handle or a transaction. */
type Queryable = Pick<Database, 'execute' | 'select'>;

/**
 * Locks a vendor's `externalId` until the transaction ends.
 *
 * @param tx - The transaction.
 * @param vendorId - The vendor.
 * @param externalId - The hardware's id.
 * @returns Once the lock is held.
 */
export async function lockDeviceIdentity(
  tx: Queryable,
  vendorId: string,
  externalId: string,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${[vendorId, externalId].join('\n')}))`,
  );
}

/**
 * The device of a vendor that is some hardware, by its public id and name: for one way into a
 * linked device, the device the house shows for it.
 *
 * @param tx - The database or the transaction.
 * @param vendorId - The vendor.
 * @param externalId - The hardware's id.
 * @param except - An instance never counted: the device asking about itself.
 * @returns It, or nothing when no device of the vendor is that hardware.
 */
export async function deviceWithIdentity(
  tx: Queryable,
  vendorId: string,
  externalId: string,
  except?: string,
): Promise<{ readonly id: string; readonly name: string } | undefined> {
  const holder = alias(devices, 'holder');
  const [found] = await tx
    .select({
      id: sql<string>`coalesce(${holder.integrationId}, ${devices.integrationId})`,
      name: sql<string>`coalesce(${holder.name}, ${devices.name})`,
    })
    .from(devices)
    .innerJoin(integrations, eq(integrations.id, devices.integrationId))
    .leftJoin(holder, eq(holder.id, devices.linkedTo))
    .where(
      and(
        eq(devices.externalId, externalId),
        sql`split_part(${integrations.kind}, '/', 1) = ${vendorId}`,
        except === undefined ? undefined : ne(devices.integrationId, except),
      ),
    )
    .limit(1);

  return found;
}
