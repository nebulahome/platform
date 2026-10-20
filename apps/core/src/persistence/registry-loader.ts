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
import { eq, sql } from 'drizzle-orm';

import {
  entityStateSchema,
  parseEntityId,
  type CapabilityName,
  type EntityId,
  type EntityState,
  type JsonObject,
} from '@nebulahome/contracts';
import { schema, type Database } from '@nebulahome/db';
import type { PlatformLogger } from '@nebulahome/logging';

import {
  EntityDirectory,
  isLinked,
  linkFieldsOf,
  type EntityRecord,
  type LinkFields,
} from '../domain/entity-directory.js';
import { resolveOwner } from '../domain/entity-owner.js';

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
        integrationId: schema.registry.entities.integrationId,
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
      source: resolveOwner(
        { kind: row.kind, packageId: row.packageId, integrationId: row.integrationId },
        entityId,
      ),
      isEnabled: row.isEnabled,
      capabilities: capabilitiesByRow.get(row.rowId) ?? new Map<CapabilityName, JsonObject>(),
    };

    directory.set(record);
  }

  applyLinks(directory, await loadLinks(db));

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

/** One entity's side of a link, by its address. */
export type StoredLink = LinkFields & { readonly entityId: EntityId };

/**
 * Loads every link between entities: for each entity read through another, which one; for each
 * entity others read through, every source in order, the way it prefers and its device's.
 *
 * Every link at once rather than the ones asked about: the house has few, and the directory is
 * then brought in line whole, so no link is left half undone.
 *
 * @param db - A connected database handle.
 * @returns Each side of each link, by entity row.
 */
export async function loadLinks(db: Database): Promise<Map<string, StoredLink>> {
  const rows = await db
    .execute<{
      id: string;
      entity_id: string;
      linked_to: string | null;
      transport: string | null;
      state_class: string | null;
      preferred: string | null;
    }>(
      sql`
    SELECT e.id, e.entity_id, e.linked_to, e.transport, e.state_class,
           coalesce(g.preferred_transport, d.preferred_transport) AS preferred
    FROM registry.entities e
    LEFT JOIN registry.devices d ON d.id = e.device_id
    LEFT JOIN registry.devices g ON g.id = d.linked_to
    WHERE e.linked_to IS NOT NULL
       OR EXISTS (SELECT 1 FROM registry.entities c WHERE c.linked_to = e.id)
    ORDER BY e.created_at, e.id
  `,
    )
    .then((result) => [...result]);
  const byRow = new Map(rows.map((row) => [row.id, row]));
  const sides = new Map<string, StoredLink>();

  for (const row of rows) {
    const entityId = parseEntityId(row.entity_id);
    const holder = row.linked_to === null ? undefined : byRow.get(row.linked_to);

    if (holder !== undefined) {
      sides.set(row.id, { entityId, linkedTo: parseEntityId(holder.entity_id) });
      continue;
    }

    const children = rows.filter((child) => child.linked_to === row.id);

    sides.set(row.id, {
      entityId,
      sources: [entityId, ...children.map((child) => parseEntityId(child.entity_id))],
      transport: row.transport,
      preferred: row.preferred,
      stateClass: row.state_class,
    });
  }

  return sides;
}

/**
 * Brings the directory's links in line with what was loaded: every entity linked now carries its
 * side, every entity no longer linked loses it.
 *
 * @param directory - The directory.
 * @param links - Every link, from {@link loadLinks}.
 * @returns The records as they were, for every entity whose link changed.
 */
export function applyLinks(
  directory: EntityDirectory,
  links: Map<string, StoredLink>,
): EntityRecord[] {
  const byAddress = new Map([...links.values()].map((side) => [side.entityId, side]));
  const changed: EntityRecord[] = [];

  for (const record of directory.all()) {
    const side = byAddress.get(record.entityId);

    if (side === undefined && !isLinked(record)) {
      continue;
    }

    const next: EntityRecord = {
      entityId: record.entityId,
      rowId: record.rowId,
      source: record.source,
      isEnabled: record.isEnabled,
      capabilities: record.capabilities,
      ...linkFieldsOf(side),
    };

    if (JSON.stringify(linkFieldsOf(record)) !== JSON.stringify(linkFieldsOf(next))) {
      changed.push(record);
      directory.set(next);
    }
  }

  return changed;
}

/**
 * Loads one configured entity, the way {@link loadRegistry} loads each of them.
 *
 * For a row written after startup by something other than a device's completion - an alias
 * the API has just made - so the directory can take it in without a restart.
 *
 * @param db - A connected database handle.
 * @param entityId - Which entity.
 * @returns Its configuration, or undefined when there is no such row.
 */
export async function loadEntityRecord(
  db: Database,
  entityId: EntityId,
): Promise<EntityRecord | undefined> {
  const [row] = await db
    .select({
      rowId: schema.registry.entities.id,
      kind: schema.registry.entities.source,
      packageId: schema.registry.entities.packageId,
      integrationId: schema.registry.entities.integrationId,
      isEnabled: schema.registry.entities.isEnabled,
    })
    .from(schema.registry.entities)
    .where(eq(schema.registry.entities.entityId, entityId));

  if (row === undefined) {
    return undefined;
  }

  const capabilityRows = await db
    .select({
      capability: schema.registry.entityCapabilities.capability,
      params: schema.registry.entityCapabilities.params,
    })
    .from(schema.registry.entityCapabilities)
    .where(eq(schema.registry.entityCapabilities.entityId, row.rowId));

  return {
    entityId,
    rowId: row.rowId,
    source: resolveOwner(
      { kind: row.kind, packageId: row.packageId, integrationId: row.integrationId },
      entityId,
    ),
    isEnabled: row.isEnabled,

    // Restricted to the contract's names by `entity_capabilities_known`, as in the full load.
    capabilities: new Map(
      capabilityRows.map((entry) => [
        entry.capability as CapabilityName,
        (entry.params ?? {}) as JsonObject,
      ]),
    ),
  };
}
