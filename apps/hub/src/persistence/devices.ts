/**
 * The device an instance identified, read back so it can bind it again.
 *
 * A binding lives in memory - the book - and the book is rebuilt on every start. What a binding
 * needs to be rebuilt is the claim - how the transport addresses the device and what it was
 * recognised from - and that is what identification writes into `registry.devices.config`,
 * under one key, for exactly this read. An instance whose row has no claim yet listens for its
 * device instead.
 *
 * The entity identifiers are not stored. They are a pure function of the device id and the
 * descriptor the claim yields, computed the same way identification computed them, so a device
 * identified and a device restored bind to the same identifiers by construction.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { jsonValueSchema, type JsonObject } from '@nebula-home/contracts';
import { schema, type Database } from '@nebula-home/db';
import type { Claim, Integration } from '@nebula-home/package-runtime';

import { describeDevice, type DeviceBinding } from '../domain/devices.js';

/** A claim as it is written, which is a claim whose descriptor is JSON. */
const persistedClaimSchema = z.object({
  deviceKey: z.string().min(1),
  externalId: z.string().min(1),
  descriptor: jsonValueSchema,
});

/** The device's `config`, as far as the hub reads it: the claim, under one key. */
const configSchema = z.object({ claim: persistedClaimSchema });

/**
 * What a claim becomes in the device's `config`.
 *
 * @param claim - The claim identification holds.
 * @returns The config to complete the device with.
 * @throws {z.ZodError} When the descriptor is not JSON. It always is for the integrations the
 * hub ships - a scan payload is JSON by construction - and a bundle whose descriptor is not
 * could not be restored, which is worth failing its identification over.
 */
export function configOf(claim: Claim): JsonObject {
  return { claim: persistedClaimSchema.parse(claim) };
}

/** What reading an instance's device row produced. */
export type RestoredBinding =
  /** Identified before, and the claim still describes it: bind and run. */
  | { readonly status: 'bound'; readonly binding: DeviceBinding; readonly externalId: string }

  /** The row is there, but nothing has been heard from the device yet: listen for it. */
  | { readonly status: 'unidentified' }

  /** Identified before, but nothing usable was kept: listen for it, and expect this one. */
  | { readonly status: 'unrestorable'; readonly externalId: string; readonly reason: string }

  /**
   * Adopted from discovery: the row names the device it reported and holds no claim yet. Listen
   * for it, and expect that one - the ordinary first start of an adopted device.
   */
  | { readonly status: 'adopted'; readonly externalId: string }

  /** No device row at all: the instance was not created through the API. */
  | { readonly status: 'missing' };

/**
 * Reads the device an instance owns and, when it can, turns the row back into a binding.
 *
 * @param db - The database.
 * @param instanceId - Which instance, which is the device's id.
 * @param integration - The integration that owns the instance, which describes the claim.
 * @param options - The instance's options, handed to `describe` as identification handed them.
 * @returns The binding, or why there is none yet.
 */
export async function loadBinding(
  db: Database,
  instanceId: string,
  integration: Integration,
  options: JsonObject,
): Promise<RestoredBinding> {
  const [row] = await db
    .select({
      externalId: schema.registry.devices.externalId,
      config: schema.registry.devices.config,
    })
    .from(schema.registry.devices)
    .where(eq(schema.registry.devices.integrationId, instanceId))
    .limit(1);

  if (row === undefined) {
    return { status: 'missing' };
  }

  if (row.externalId === null) {
    return { status: 'unidentified' };
  }

  const config = configSchema.safeParse(row.config);

  if (!config.success) {
    const isEmpty =
      typeof row.config === 'object' && row.config !== null && Object.keys(row.config).length === 0;

    return isEmpty
      ? { status: 'adopted', externalId: row.externalId }
      : { status: 'unrestorable', externalId: row.externalId, reason: 'No claim was kept' };
  }

  const { claim } = config.data;

  return {
    status: 'bound',
    binding: describeDevice(instanceId, integration, claim, options).binding,
    externalId: row.externalId,
  };
}

/**
 * Reads what an instance's device is called, for an event naming it.
 *
 * @param db - The database.
 * @param instanceId - Which instance, which is the device's id.
 * @returns Its name, or undefined when it has no row.
 */
export async function loadDeviceName(
  db: Database,
  instanceId: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ name: schema.registry.devices.name })
    .from(schema.registry.devices)
    .where(eq(schema.registry.devices.integrationId, instanceId))
    .limit(1);

  return row?.name;
}
