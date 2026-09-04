/**
 * Rebuilding the registry at startup.
 *
 * `core` comes back up with three questions: which entities exist, who owns each of them, and
 * what did they look like when the process died. The first two come from `registry.entities` and
 * `registry.entity_capabilities`, which the owner configured. The third comes from
 * `registry.entity_states`, which is a **recovery cache and not the truth** - the truth is at the
 * devices, and `core` asks every adapter for it immediately afterwards (ARCHITECTURE.md 4.1).
 *
 * Loading it anyway matters because the resynchronisation is not instantaneous: without it, the
 * interface shows an empty house for as long as the slowest adapter takes to answer.
 */
import {
  entityStateSchema,
  parseEntityId,
  sourceRefSchema,
  ValidationError,
  type CapabilityName,
  type EntityId,
  type EntityState,
  type JsonObject,
  type SourceRef,
} from '@nebula-home/contracts';
import { schema, type Database } from '@nebula-home/db';
import type { PlatformLogger } from '@nebula-home/logging';

import { EntityDirectory, type EntityRecord } from '../domain/entity-directory.js';

/** What a startup load produced. */
export type LoadedRegistry = {
  /** Every configured entity, indexed by identifier. */
  readonly directory: EntityDirectory;

  /** The last persisted state of each entity that had one. */
  readonly states: readonly EntityState[];

  /** How many stored states were discarded because they no longer validate. */
  readonly discardedStates: number;
};

/**
 * Resolves who owns an entity from the two columns that say it.
 *
 * `registry.entities.source` records the **kind** of entity - `adapter`, `derived` or `system` -
 * while the owning package is in `package_id`, and the `entities_source_consistency` constraint
 * guarantees an adapter entity has one. Everywhere above the database an owner is a single value,
 * so the two columns are folded back into one here rather than in every caller.
 *
 * @param kind - What `registry.entities.source` holds.
 * @param packageId - What `registry.entities.package_id` holds.
 * @param entityId - The entity, for the failure message.
 * @returns The owner, as the rest of the platform understands it.
 * @throws {ValidationError} When an adapter entity has no package, which the database constraint
 * makes impossible and which would otherwise become an entity nobody can command.
 */
function toSourceRef(kind: string, packageId: string | null, entityId: EntityId): SourceRef {
  if (kind !== 'adapter') {
    return sourceRefSchema.parse(kind);
  }

  if (packageId === null) {
    throw new ValidationError(`Entity ${entityId} is an adapter entity with no package`, {
      details: { entityId },
    });
  }

  return sourceRefSchema.parse(packageId);
}

/**
 * Loads the configured entities and their last known states.
 *
 * A stored state that no longer validates is **skipped, not fatal**. Rows outlive the build that
 * wrote them: a capability whose schema tightened between releases leaves rows that a stricter
 * schema rejects, and refusing to start over one of them would mean a release that cannot boot
 * because of a light bulb. The adapter's resynchronisation replaces it seconds later anyway.
 *
 * @param db - A connected database handle.
 * @param logger - Where discarded rows are reported.
 * @returns The directory, the recovered states, and how many were discarded.
 */
export async function loadRegistry(db: Database, logger: PlatformLogger): Promise<LoadedRegistry> {
  const [entityRows, capabilityRows, stateRows] = await Promise.all([
    db
      .select({
        rowId: schema.registry.entities.id,
        entityId: schema.registry.entities.entityId,
        kind: schema.registry.entities.source,
        packageId: schema.registry.entities.packageId,
        isEnabled: schema.registry.entities.isEnabled,
      })
      .from(schema.registry.entities),

    db
      .select({
        rowId: schema.registry.entityCapabilities.entityId,
        capability: schema.registry.entityCapabilities.capability,
        params: schema.registry.entityCapabilities.params,
      })
      .from(schema.registry.entityCapabilities),

    db.select().from(schema.registry.entityStates),
  ]);

  const capabilitiesByRow = new Map<string, Map<CapabilityName, JsonObject>>();

  for (const row of capabilityRows) {
    const existing = capabilitiesByRow.get(row.rowId) ?? new Map<CapabilityName, JsonObject>();

    // The `entity_capabilities_known` CHECK constraint already restricts this column to the
    // capability names in the contract, so the cast records a database guarantee rather than
    // assuming one.
    existing.set(row.capability as CapabilityName, (row.params ?? {}) as JsonObject);
    capabilitiesByRow.set(row.rowId, existing);
  }

  const directory = new EntityDirectory();
  const entityIdByRow = new Map<string, EntityId>();

  for (const row of entityRows) {
    const entityId = parseEntityId(row.entityId);

    entityIdByRow.set(row.rowId, entityId);

    const record: EntityRecord = {
      entityId,
      rowId: row.rowId,
      source: toSourceRef(row.kind, row.packageId, entityId),
      isEnabled: row.isEnabled,
      capabilities: capabilitiesByRow.get(row.rowId) ?? new Map<CapabilityName, JsonObject>(),
    };

    directory.set(record);
  }

  const states: EntityState[] = [];
  let discardedStates = 0;

  for (const row of stateRows) {
    const entityId = entityIdByRow.get(row.entityId);

    if (entityId === undefined) {
      // A state row whose entity was deleted. The foreign key cascades, so this should not
      // happen; counting it rather than crashing keeps a database anomaly from being a boot
      // failure.
      discardedStates += 1;
      continue;
    }

    const parsed = entityStateSchema.safeParse({
      entityId,
      state: row.state,
      attributes: row.attributes,
      isAvailable: row.isAvailable,
      lastChanged: row.lastChanged,
      lastUpdated: row.lastUpdated,
      source: row.source,
      ...(row.contextType === null
        ? {}
        : {
            context: {
              type: row.contextType,
              ...(row.contextId === null ? {} : { id: row.contextId }),
            },
          }),
    });

    if (parsed.success) {
      states.push(parsed.data);
    } else {
      discardedStates += 1;
      logger.warn(
        { entityId, issues: parsed.error.issues.map((issue) => issue.message) },
        'Discarded a stored state that no longer validates',
      );
    }
  }

  return { directory, states, discardedStates };
}
