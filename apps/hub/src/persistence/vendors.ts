/**
 * Reading what an owner saved for a vendor.
 *
 * The second of the two tables `hub` may read. `api` writes a vendor's shared settings - the
 * API key a cloud vendor asks for once - and `hub` reads them when it starts an instance of that
 * vendor, to put under the instance's own configuration. Nothing here is written: the grant is
 * SELECT, and the row has no runtime status because a vendor does not run.
 */
import { eq } from 'drizzle-orm';

import type { JsonObject } from '@nebula-home/contracts';
import { openSecrets, schema, type Database } from '@nebula-home/db';

import type { VendorSettings } from '../domain/vendors.js';

/**
 * Reads one vendor's saved settings, secrets opened.
 *
 * @param db - A connected database handle.
 * @param vendorId - Which vendor.
 * @param secretsKey - The installation's key.
 * @returns The settings, or undefined when the owner has saved nothing for that vendor.
 * @throws {ConfigurationError} When a value was sealed with another key.
 */
export async function loadVendorSettings(
  db: Database,
  vendorId: string,
  secretsKey: Buffer,
): Promise<VendorSettings | undefined> {
  const [row] = await db
    .select({
      transportConfig: schema.registry.integrationVendors.transportConfig,
      options: schema.registry.integrationVendors.options,
    })
    .from(schema.registry.integrationVendors)
    .where(eq(schema.registry.integrationVendors.id, vendorId))
    .limit(1);

  if (row === undefined) {
    return undefined;
  }

  return {
    transportConfig: openSecrets(row.transportConfig as JsonObject, secretsKey),
    options: openSecrets(row.options as JsonObject, secretsKey),
  };
}
