/**
 * The devices an instance adopted, read back so it can watch them again.
 *
 * A binding lives in memory - the book - and the book is rebuilt on every start. Before this it
 * was rebuilt empty: an instance came up, watched nothing, and its devices sat in the registry
 * until somebody ran a discovery pass and adopted them a second time. What a binding needs to be
 * rebuilt is the claim - how the transport addresses the device and what it was recognised from
 * - and that is what adoption now writes into `registry.devices.config`, under one key, for
 * exactly this read.
 *
 * The entity identifiers are not stored. They are a pure function of the descriptor the claim
 * yields, computed the same way adoption computed them, so a device adopted and a device
 * restored bind to the same identifiers by construction.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { jsonValueSchema, type EntityId, type JsonObject } from '@nebula-home/contracts';
import { schema, type Database } from '@nebula-home/db';
import type { Claim, Integration } from '@nebula-home/package-runtime';

import type { DeviceBinding } from '../domain/devices.js';
import { composeEntityId } from '../domain/entity-ids.js';

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
 * @param claim - The claim adoption holds.
 * @returns The config to register the device with.
 * @throws {z.ZodError} When the descriptor is not JSON. It always is for the integrations the
 * hub ships - a discovery payload is JSON by construction - and a bundle whose descriptor is not
 * could not be restored, which is worth failing its adoption over.
 */
export function configOf(claim: Claim): JsonObject {
  return { claim: persistedClaimSchema.parse(claim) };
}

/** One device that could not be restored, and why. */
export type SkippedDevice = {
  readonly externalId: string;
  readonly reason: string;
};

/** What a read of an instance's devices produced. */
export type RestoredDevices = {
  /** The bindings, ready for the book. */
  readonly bindings: readonly DeviceBinding[];

  /** The devices left unwatched, for the log. */
  readonly skipped: readonly SkippedDevice[];
};

/**
 * Reads the devices an instance adopted and turns each back into a binding.
 *
 * A device without a claim - adopted before claims were written, or written by hand - is
 * skipped rather than failing the instance: it stays in the registry, and adopting it again
 * writes the claim it lacks.
 *
 * @param db - The database.
 * @param instanceId - Which instance.
 * @param integration - The integration that owns the instance, which describes the claims.
 * @param options - The instance's options, handed to `describe` as adoption handed them.
 * @returns The bindings, and what could not be restored.
 */
export async function loadBindings(
  db: Database,
  instanceId: string,
  integration: Integration,
  options: JsonObject,
): Promise<RestoredDevices> {
  const rows = await db
    .select({
      externalId: schema.registry.devices.externalId,
      config: schema.registry.devices.config,
    })
    .from(schema.registry.devices)
    .where(eq(schema.registry.devices.integrationId, instanceId));

  const bindings: DeviceBinding[] = [];
  const skipped: SkippedDevice[] = [];

  for (const row of rows) {
    const config = configSchema.safeParse(row.config);

    if (!config.success) {
      skipped.push({ externalId: row.externalId, reason: 'No claim was kept for it' });

      continue;
    }

    const { claim } = config.data;
    const descriptor = integration.describe(claim, options);
    const entities = new Map<string, EntityId>(
      descriptor.entities.map((entity) => [
        entity.objectId ?? '',
        composeEntityId(entity.domain, descriptor.externalId, entity.objectId),
      ]),
    );

    bindings.push({ claim, entities });
  }

  return { bindings, skipped };
}
