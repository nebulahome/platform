/**
 * Reading entities, joined the way the interface needs them.
 *
 * The registry says what an entity is called and where it is; `registry.entity_states` says what
 * it is doing. Both are read here rather than asking `core` over the bus, for two reasons: it
 * keeps `api` stateless and independently scalable, and a bus round-trip per HTTP request would
 * make the dashboard's first paint depend on the broker being fast.
 *
 * The cost is bounded staleness. `core` writes `entity_states` through a batching writer, so a
 * read can be up to one flush interval behind the truth. Changes reach a client with no such lag
 * over the WebSocket, which is the channel meant for watching. This is stated in API.md rather
 * than left to be discovered.
 */
import {
  entityViewSchema,
  parseEntityId,
  type CapabilityName,
  type EntityQuery,
  type EntityView,
  type Identity,
  type JsonObject,
} from '@nebula-home/contracts';
import { schema, type Database } from '@nebula-home/db';
import { and, asc, eq, gt, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';

import { entityScopes, isPermitted } from '../auth/permissions.js';
import { decodeCursor, encodeCursor, toPage, type PageResult } from '../http/pagination.js';

/** One entity row before its capabilities, labels and state are attached. */
type EntityRow = {
  rowId: string;
  entityId: string;
  domain: string | null;
  name: string;
  icon: string | null;
  deviceId: string | null;
  packageId: string | null;
  source: string;
  areaKey: string | null;
  areaName: string | null;
  unitOfMeasurement: string | null;
  deviceClass: string | null;
  isEnabled: boolean;
  isHidden: boolean;
  searchAliases: string[] | null;
  state: unknown;
  attributes: unknown;
  isAvailable: boolean | null;
  lastChanged: Date | null;
  lastUpdated: Date | null;
};

/** The columns every entity read selects. */
const ENTITY_COLUMNS = {
  rowId: schema.registry.entities.id,
  entityId: schema.registry.entities.entityId,
  domain: schema.registry.entities.domain,
  name: schema.registry.entities.name,
  icon: schema.registry.entities.icon,
  deviceId: schema.registry.entities.deviceId,
  packageId: schema.registry.entities.packageId,
  source: schema.registry.entities.source,
  areaKey: schema.registry.areas.key,
  areaName: schema.registry.areas.name,
  unitOfMeasurement: schema.registry.entities.unitOfMeasurement,
  deviceClass: schema.registry.entities.deviceClass,
  isEnabled: schema.registry.entities.isEnabled,
  isHidden: schema.registry.entities.isHidden,
  searchAliases: schema.registry.entities.searchAliases,
  state: schema.registry.entityStates.state,
  attributes: schema.registry.entityStates.attributes,
  isAvailable: schema.registry.entityStates.isAvailable,
  lastChanged: schema.registry.entityStates.lastChanged,
  lastUpdated: schema.registry.entityStates.lastUpdated,
} as const;

/**
 * Turns `registry.entities.source` and `package_id` back into one owner.
 *
 * The column holds the *kind* of source - `adapter`, `derived` or `system` - and the owning
 * package is a separate column. Reading `source` alone would say "adapter" where the contract
 * wants the package id.
 *
 * @param kind - The `source` column.
 * @param packageId - The `package_id` column.
 * @returns The owner as the contract defines it.
 */
function toSourceRef(kind: string, packageId: string | null): string {
  return kind === 'adapter' && packageId !== null ? packageId : kind;
}

/**
 * Assembles one view from its parts.
 *
 * @param row - The joined entity row.
 * @param capabilities - Its declared capabilities.
 * @returns The entity as the API presents it.
 */
function toView(
  row: EntityRow,
  capabilities: readonly { capability: string; params: unknown }[],
): EntityView {
  return entityViewSchema.parse({
    entityId: row.entityId,

    // The column is nullable, but an entity id is always `<domain>.<object_id>` - the pattern
    // is a CHECK constraint - so the prefix is the domain whenever the column was left empty.
    domain: row.domain ?? row.entityId.split('.')[0],
    name: row.name,
    icon: row.icon,
    areaKey: row.areaKey,
    areaName: row.areaName,
    deviceId: row.deviceId,
    source: toSourceRef(row.source, row.packageId),
    unitOfMeasurement: row.unitOfMeasurement,
    deviceClass: row.deviceClass,
    isEnabled: row.isEnabled,
    isHidden: row.isHidden,
    capabilities: capabilities.map((entry) => ({
      capability: entry.capability,
      params: entry.params ?? {},
    })),
    searchAliases: row.searchAliases ?? [],
    state: row.state ?? null,
    attributes: row.attributes ?? {},

    // Null when nothing has ever reported: an entity that is configured but silent is not
    // available, and saying so is more honest than defaulting it to true.
    isAvailable: row.isAvailable ?? false,
    lastChanged: row.lastChanged,
    lastUpdated: row.lastUpdated,
  });
}

/**
 * Reads the capabilities of a set of entities in one query.
 *
 * @param db - The database.
 * @param rowIds - The entity row identifiers.
 * @returns Capabilities grouped by row id.
 */
async function readCapabilities(
  db: Database,
  rowIds: readonly string[],
): Promise<Map<string, { capability: CapabilityName; params: JsonObject }[]>> {
  const grouped = new Map<string, { capability: CapabilityName; params: JsonObject }[]>();

  if (rowIds.length === 0) {
    return grouped;
  }

  const rows = await db
    .select({
      rowId: schema.registry.entityCapabilities.entityId,
      capability: schema.registry.entityCapabilities.capability,
      params: schema.registry.entityCapabilities.params,
    })
    .from(schema.registry.entityCapabilities)
    .where(inArray(schema.registry.entityCapabilities.entityId, [...rowIds]));

  for (const row of rows) {
    const existing = grouped.get(row.rowId) ?? [];

    // The `entity_capabilities_known` CHECK constraint restricts this column to the contract's
    // capability names, so the cast records a database guarantee rather than assuming one.
    existing.push({
      capability: row.capability as CapabilityName,
      params: (row.params ?? {}) as JsonObject,
    });
    grouped.set(row.rowId, existing);
  }

  return grouped;
}

/**
 * Reads the label keys on a set of entities.
 *
 * @param db - The database.
 * @param rowIds - The entity row identifiers.
 * @returns Label keys grouped by row id.
 */
async function readLabels(db: Database, rowIds: readonly string[]): Promise<Map<string, string[]>> {
  const grouped = new Map<string, string[]>();

  if (rowIds.length === 0) {
    return grouped;
  }

  const rows = await db
    .select({
      rowId: schema.registry.entityLabels.entityId,
      key: schema.registry.labels.key,
    })
    .from(schema.registry.entityLabels)
    .innerJoin(
      schema.registry.labels,
      eq(schema.registry.labels.id, schema.registry.entityLabels.labelId),
    )
    .where(inArray(schema.registry.entityLabels.entityId, [...rowIds]));

  for (const row of rows) {
    grouped.set(row.rowId, [...(grouped.get(row.rowId) ?? []), row.key]);
  }

  return grouped;
}

/**
 * Builds the filters a list request asked for.
 *
 * @param query - What the caller narrowed by.
 * @param cursor - Where the page starts, when continuing.
 * @returns The conditions to apply, or undefined when there are none.
 */
function buildFilters(query: EntityQuery, cursor: string | undefined): SQL | undefined {
  const conditions: (SQL | undefined)[] = [];

  if (!query.includeHidden) {
    conditions.push(eq(schema.registry.entities.isHidden, false));
  }

  if (query.area !== undefined) {
    conditions.push(eq(schema.registry.areas.key, query.area));
  }

  if (query.domain !== undefined) {
    conditions.push(eq(schema.registry.entities.domain, query.domain));
  }

  if (query.search !== undefined) {
    const pattern = `%${query.search}%`;

    conditions.push(
      or(
        ilike(schema.registry.entities.name, pattern),
        ilike(schema.registry.entities.entityId, pattern),
        sql`EXISTS (SELECT 1 FROM unnest(${schema.registry.entities.searchAliases}) AS alias WHERE alias ILIKE ${pattern})`,
      ),
    );
  }

  if (cursor !== undefined) {
    conditions.push(gt(schema.registry.entities.entityId, decodeCursor(cursor).key));
  }

  const present = conditions.filter((condition): condition is SQL => condition !== undefined);

  return present.length === 0 ? undefined : and(...present);
}

/**
 * Lists entities the caller may see.
 *
 * Permission filtering happens after the database read rather than inside it. A grant can be
 * scoped to an entity, an area or a label, and expressing "any of the caller's scopes covers
 * this row" in SQL means rebuilding the resolution rules a second time, in a second language -
 * which DATABASE.md rejects for exactly the reason that they would then diverge.
 *
 * @param db - The database.
 * @param identity - Who is asking.
 * @param query - What they narrowed by.
 * @param page - How many and from where.
 * @param page.limit - The page size.
 * @param page.cursor - Where the previous page ended.
 * @returns The page of entities they are allowed to see.
 */
export async function listEntities(
  db: Database,
  identity: Identity,
  query: EntityQuery,
  page: { limit: number; cursor?: string },
): Promise<PageResult<EntityView>> {
  const rows: EntityRow[] = await db
    .select(ENTITY_COLUMNS)
    .from(schema.registry.entities)
    .leftJoin(schema.registry.areas, eq(schema.registry.areas.id, schema.registry.entities.areaId))
    .leftJoin(
      schema.registry.entityStates,
      eq(schema.registry.entityStates.entityId, schema.registry.entities.id),
    )
    .where(buildFilters(query, page.cursor))
    .orderBy(asc(schema.registry.entities.entityId))

    // One more than asked for: the extra row is how the next cursor is decided without a
    // second COUNT(*) over the whole table.
    .limit(page.limit + 1);

  const rowIds = rows.map((row) => row.rowId);
  const [capabilities, labels] = await Promise.all([
    readCapabilities(db, rowIds),
    readLabels(db, rowIds),
  ]);

  const visible = rows.filter((row) =>
    isPermitted(
      identity.permissions,
      'entity:read',
      entityScopes(row.entityId, row.areaKey, labels.get(row.rowId) ?? []),
    ),
  );

  const filtered =
    query.label === undefined
      ? visible
      : visible.filter((row) => (labels.get(row.rowId) ?? []).includes(query.label ?? ''));

  const byCapability =
    query.capability === undefined
      ? filtered
      : filtered.filter((row) =>
          (capabilities.get(row.rowId) ?? []).some(
            (entry) => entry.capability === query.capability,
          ),
        );

  return toPage(
    byCapability.map((row) => toView(row, capabilities.get(row.rowId) ?? [])),
    page.limit,
    (view) => ({ key: view.entityId }),
  );
}

/** One entity, with everything an authorisation decision about it needs. */
export type EntityDetail = {
  /** The entity as the API presents it. */
  readonly view: EntityView;

  /** Every scope a grant could name to cover it. */
  readonly scopes: string[];
};

/**
 * Reads one entity by its identifier.
 *
 * @param db - The database.
 * @param entityId - The address.
 * @returns The entity and its scopes, or undefined when nothing is registered under that id.
 */
export async function findEntity(
  db: Database,
  entityId: string,
): Promise<EntityDetail | undefined> {
  const rows: EntityRow[] = await db
    .select(ENTITY_COLUMNS)
    .from(schema.registry.entities)
    .leftJoin(schema.registry.areas, eq(schema.registry.areas.id, schema.registry.entities.areaId))
    .leftJoin(
      schema.registry.entityStates,
      eq(schema.registry.entityStates.entityId, schema.registry.entities.id),
    )
    .where(eq(schema.registry.entities.entityId, entityId))
    .limit(1);

  const row = rows[0];

  if (row === undefined) {
    return undefined;
  }

  const [capabilities, labels] = await Promise.all([
    readCapabilities(db, [row.rowId]),
    readLabels(db, [row.rowId]),
  ]);

  return {
    view: toView(row, capabilities.get(row.rowId) ?? []),
    scopes: entityScopes(row.entityId, row.areaKey, labels.get(row.rowId) ?? []),
  };
}

/**
 * Reads the identifiers of every entity a caller may watch.
 *
 * Used by the WebSocket to decide which state changes to forward. Computed once when a socket
 * subscribes rather than per event: the alternative is a permission evaluation on every state
 * change of every entity, for every connected client.
 *
 * @param db - The database.
 * @param identity - Who is watching.
 * @returns The entity identifiers they hold `entity:read` for.
 */
export async function readableEntityIds(db: Database, identity: Identity): Promise<Set<string>> {
  const rows = await db
    .select({
      rowId: schema.registry.entities.id,
      entityId: schema.registry.entities.entityId,
      areaKey: schema.registry.areas.key,
    })
    .from(schema.registry.entities)
    .leftJoin(schema.registry.areas, eq(schema.registry.areas.id, schema.registry.entities.areaId));

  const labels = await readLabels(
    db,
    rows.map((row) => row.rowId),
  );

  const allowed = new Set<string>();

  for (const row of rows) {
    if (
      isPermitted(
        identity.permissions,
        'entity:read',
        entityScopes(row.entityId, row.areaKey, labels.get(row.rowId) ?? []),
      )
    ) {
      allowed.add(row.entityId);
    }
  }

  return allowed;
}

/**
 * Encodes where a page of entities ended.
 *
 * Exported so the route can build a cursor without knowing the encoding.
 *
 * @param entityId - The last entity on the page.
 * @returns The cursor for the next one.
 */
export function entityCursor(entityId: string): string {
  return encodeCursor({ key: entityId });
}

/**
 * Parses and brands an entity identifier from a path parameter.
 *
 * @param value - What arrived in the path.
 * @returns The branded identifier.
 * @throws {z.ZodError} When it is not `<domain>.<object_id>`.
 */
export function toEntityId(value: string): ReturnType<typeof parseEntityId> {
  return parseEntityId(value);
}
