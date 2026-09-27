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
import { and, asc, eq, gt, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';

import {
  containerDeviceId,
  entityViewSchema,
  NotFoundError,
  parseEntityId,
  type CapabilityName,
  type EntityQuery,
  type EntityUpdate,
  type EntityView,
  type Identity,
  type JsonObject,
} from '@nebula-home/contracts';
import { schema, type Database } from '@nebula-home/db';

import { entityScopes, isPermitted } from '../auth/permissions.js';
import { decodeCursor, encodeCursor, toPage, type PageResult } from '../http/pagination.js';

import { checkIcon, type IconLookup } from './icon-lookup.js';
import { assertTagsExist, replaceEntityTags } from './tags.js';

/** One entity row before its capabilities, tags and state are attached. */
type EntityRow = {
  rowId: string;
  entityId: string;
  domain: string | null;
  name: string;
  icon: string | null;
  deviceId: string | null;
  packageId: string | null;
  integrationId: string | null;
  source: string;

  /** The device's `external_id`: a container's name, for a container entity. */
  deviceExternalId: string | null;
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

/**
 * The area an entity is in: its own, or failing that its device's.
 *
 * An entity is wherever its device is unless somebody has said otherwise, which is what
 * `registry.v_entities_expanded` documents as `effective_area_id`. Every read joins the areas
 * through this rather than through the entity's own column, so a device put in a room takes
 * its entities with it - in what the rows say, and in what an area-scoped permission covers.
 */
const EFFECTIVE_AREA_ID = sql`coalesce(${schema.registry.entities.areaId}, ${schema.registry.devices.areaId})`;

/** The columns every entity read selects. */
const ENTITY_COLUMNS = {
  rowId: schema.registry.entities.id,
  entityId: schema.registry.entities.entityId,
  domain: schema.registry.entities.domain,
  name: schema.registry.entities.name,
  icon: schema.registry.entities.icon,
  deviceId: schema.registry.entities.deviceId,
  packageId: schema.registry.entities.packageId,
  integrationId: schema.registry.entities.integrationId,
  source: schema.registry.entities.source,
  deviceExternalId: schema.registry.devices.externalId,
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
 * Turns `registry.entities.source` and the two owner columns back into one owner.
 *
 * The column holds the *kind* of source - `adapter`, `derived`, `system` or `container` - and the
 * owner is a separate column: `package_id` for an entity an adapter registered, `integration_id`
 * for one the hub registered on an instance's behalf. Reading `source` alone would say "adapter"
 * where the contract wants the owner's id - the same id the bus carries as the source of its
 * states, and the id of the device the interface lists its entities under.
 *
 * A container's entities are the one case where the two differ: the supervisor reports every one
 * of them, but each belongs to its container's device, `container-<slug>`, and that is what the
 * interface groups a device's entities by.
 *
 * @param kind - The `source` column.
 * @param packageId - The `package_id` column.
 * @param integrationId - The `integration_id` column.
 * @param deviceExternalId - The device's `external_id`: the container's name, for a container
 * entity.
 * @returns The owner as the contract defines it.
 */
export function toSourceRef(
  kind: string,
  packageId: string | null,
  integrationId: string | null,
  deviceExternalId: string | null = null,
): string {
  if (kind === 'container' && deviceExternalId !== null) {
    return containerDeviceId(deviceExternalId);
  }

  if (kind !== 'adapter') {
    return kind;
  }

  return packageId ?? integrationId ?? kind;
}

/**
 * Assembles one view from its parts.
 *
 * @param row - The joined entity row.
 * @param capabilities - Its declared capabilities.
 * @param tags - The tags on it.
 * @returns The entity as the API presents it.
 */
function toView(
  row: EntityRow,
  capabilities: readonly { capability: string; params: unknown }[],
  tags: readonly EntityTag[] = [],
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
    source: toSourceRef(row.source, row.packageId, row.integrationId, row.deviceExternalId),
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
    tagIds: tags.map((tag) => tag.id),
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

/** One tag on an entity: the id the view lists, and the key a permission scope names. */
type EntityTag = {
  readonly id: string;
  readonly key: string;
};

/**
 * Reads the tags on a set of entities.
 *
 * @param db - The database.
 * @param rowIds - The entity row identifiers.
 * @returns Tags grouped by row id, in key order.
 */
export async function readTags(
  db: Database,
  rowIds: readonly string[],
): Promise<Map<string, EntityTag[]>> {
  const grouped = new Map<string, EntityTag[]>();

  if (rowIds.length === 0) {
    return grouped;
  }

  const rows = await db
    .select({
      rowId: schema.registry.entityTags.entityId,
      id: schema.registry.tags.id,
      key: schema.registry.tags.key,
    })
    .from(schema.registry.entityTags)
    .innerJoin(schema.registry.tags, eq(schema.registry.tags.id, schema.registry.entityTags.tagId))
    .where(inArray(schema.registry.entityTags.entityId, [...rowIds]))
    .orderBy(asc(schema.registry.tags.key));

  for (const row of rows) {
    grouped.set(row.rowId, [...(grouped.get(row.rowId) ?? []), { id: row.id, key: row.key }]);
  }

  return grouped;
}

/**
 * Reads the keys of the tags on a set of devices.
 *
 * @param db - The database.
 * @param deviceIds - The devices' identity rows; nulls, for entities without one, are skipped.
 * @returns Tag keys grouped by device row id.
 */
async function readDeviceTagKeys(
  db: Database,
  deviceIds: readonly (string | null)[],
): Promise<Map<string, string[]>> {
  const grouped = new Map<string, string[]>();
  const wanted = [...new Set(deviceIds.filter((id): id is string => id !== null))];

  if (wanted.length === 0) {
    return grouped;
  }

  const rows = await db
    .select({ deviceId: schema.registry.deviceTags.deviceId, key: schema.registry.tags.key })
    .from(schema.registry.deviceTags)
    .innerJoin(schema.registry.tags, eq(schema.registry.tags.id, schema.registry.deviceTags.tagId))
    .where(inArray(schema.registry.deviceTags.deviceId, wanted));

  for (const row of rows) {
    grouped.set(row.deviceId, [...(grouped.get(row.deviceId) ?? []), row.key]);
  }

  return grouped;
}

/**
 * The tag keys an entity falls under, which is what a permission scope names.
 *
 * Its own tags and its device's. An entity is wherever its device is, and it is tagged however
 * its device is: tagging a device `exterior` puts every one of its entities under
 * `tag.exterior`, the way putting a device in a room puts them under `area.<room>`. The entity's
 * view still lists only its own tags - those are what the owner can take off it.
 *
 * @param own - The tags on the entity.
 * @param device - The keys of the tags on its device.
 * @returns Every key, once each.
 */
function scopeTagKeys(
  own: readonly EntityTag[] | undefined,
  device: readonly string[] | undefined,
): string[] {
  return [...new Set([...(own ?? []).map((tag) => tag.key), ...(device ?? [])])];
}

/**
 * Reads the tag keys each of a set of entities falls under: its own tags and its device's.
 *
 * For callers outside this file that decide on an entity's scopes - the alias sources, the
 * members of a scene - so that every check agrees with what the entity routes enforce.
 *
 * @param db - The database.
 * @param rows - The entities, by row id and by the device row they belong to.
 * @returns Tag keys grouped by entity row id.
 */
export async function readTagKeys(
  db: Database,
  rows: readonly { readonly rowId: string; readonly deviceId: string | null }[],
): Promise<Map<string, string[]>> {
  const [own, device] = await Promise.all([
    readTags(
      db,
      rows.map((row) => row.rowId),
    ),
    readDeviceTagKeys(
      db,
      rows.map((row) => row.deviceId),
    ),
  ]);

  return new Map(
    rows.map((row) => [
      row.rowId,
      scopeTagKeys(
        own.get(row.rowId),
        row.deviceId === null ? undefined : device.get(row.deviceId),
      ),
    ]),
  );
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
 * scoped to an entity, an area or a tag, and expressing "any of the caller's scopes covers
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
    .leftJoin(
      schema.registry.devices,
      eq(schema.registry.devices.id, schema.registry.entities.deviceId),
    )
    .leftJoin(schema.registry.areas, eq(schema.registry.areas.id, EFFECTIVE_AREA_ID))
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
  const [capabilities, tags, deviceTags] = await Promise.all([
    readCapabilities(db, rowIds),
    readTags(db, rowIds),
    readDeviceTagKeys(
      db,
      rows.map((row) => row.deviceId),
    ),
  ]);

  /**
   * The tag keys one row falls under.
   *
   * @param row - The entity row.
   * @returns Its own tags' keys and its device's.
   */
  const keysUnder = (row: EntityRow): string[] =>
    scopeTagKeys(
      tags.get(row.rowId),
      row.deviceId === null ? undefined : deviceTags.get(row.deviceId),
    );

  const visible = rows.filter((row) =>
    isPermitted(
      identity.permissions,
      'entity:read',
      entityScopes(row.entityId, row.areaKey, keysUnder(row)),
    ),
  );

  // By what the entity falls under rather than by its own tags alone, for the reason the scopes
  // are: "every entity tagged exterior" includes those whose device is.
  const filtered =
    query.tag === undefined
      ? visible
      : visible.filter((row) => keysUnder(row).includes(query.tag ?? ''));

  const byCapability =
    query.capability === undefined
      ? filtered
      : filtered.filter((row) =>
          (capabilities.get(row.rowId) ?? []).some(
            (entry) => entry.capability === query.capability,
          ),
        );

  return toPage(
    byCapability.map((row) =>
      toView(row, capabilities.get(row.rowId) ?? [], tags.get(row.rowId) ?? []),
    ),
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

  /** The registry row, which is what a write addresses. */
  readonly rowId: string;
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
    .leftJoin(
      schema.registry.devices,
      eq(schema.registry.devices.id, schema.registry.entities.deviceId),
    )
    .leftJoin(schema.registry.areas, eq(schema.registry.areas.id, EFFECTIVE_AREA_ID))
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

  const [capabilities, tags, deviceTags] = await Promise.all([
    readCapabilities(db, [row.rowId]),
    readTags(db, [row.rowId]),
    readDeviceTagKeys(db, [row.deviceId]),
  ]);

  return {
    view: toView(row, capabilities.get(row.rowId) ?? [], tags.get(row.rowId) ?? []),
    scopes: entityScopes(
      row.entityId,
      row.areaKey,
      scopeTagKeys(
        tags.get(row.rowId),
        row.deviceId === null ? undefined : deviceTags.get(row.deviceId),
      ),
    ),
    rowId: row.rowId,
  };
}

/**
 * Reads several entities by their identifiers, in one pass: {@link findEntity} for a list.
 *
 * What a page about one device needs for each of the device's entities - its view, the scopes a
 * grant could cover it by, and its row - in four queries however many entities there are.
 *
 * @param db - The database.
 * @param entityIds - The addresses.
 * @returns The entities found, by address; an address nothing is registered under is left out.
 */
export async function findEntities(
  db: Database,
  entityIds: readonly string[],
): Promise<EntityDetail[]> {
  if (entityIds.length === 0) {
    return [];
  }

  const rows: EntityRow[] = await db
    .select(ENTITY_COLUMNS)
    .from(schema.registry.entities)
    .leftJoin(
      schema.registry.devices,
      eq(schema.registry.devices.id, schema.registry.entities.deviceId),
    )
    .leftJoin(schema.registry.areas, eq(schema.registry.areas.id, EFFECTIVE_AREA_ID))
    .leftJoin(
      schema.registry.entityStates,
      eq(schema.registry.entityStates.entityId, schema.registry.entities.id),
    )
    .where(inArray(schema.registry.entities.entityId, [...entityIds]))
    .orderBy(asc(schema.registry.entities.entityId));

  const rowIds = rows.map((row) => row.rowId);
  const [capabilities, tags, deviceTags] = await Promise.all([
    readCapabilities(db, rowIds),
    readTags(db, rowIds),
    readDeviceTagKeys(
      db,
      rows.map((row) => row.deviceId),
    ),
  ]);

  return rows.map((row) => ({
    view: toView(row, capabilities.get(row.rowId) ?? [], tags.get(row.rowId) ?? []),
    scopes: entityScopes(
      row.entityId,
      row.areaKey,
      scopeTagKeys(
        tags.get(row.rowId),
        row.deviceId === null ? undefined : deviceTags.get(row.deviceId),
      ),
    ),
    rowId: row.rowId,
  }));
}

/**
 * Changes what a person calls an entity, what it is drawn as, and the tags on it.
 *
 * The identifier is not among what can change: it is what automations and history name the
 * entity by. Nothing here reaches `core` - its directory holds an entity's address, owner and
 * capabilities, none of which this touches - so the change is the registry's alone.
 *
 * @param db - The database.
 * @param icons - The catalogue, to check an icon against.
 * @param detail - The entity as found, with the row the change addresses.
 * @param body - What to change.
 * @returns The entity as it now stands.
 * @throws {ValidationError} When the icon is not in the catalogue, or a tag id names no tag.
 */
export async function updateEntity(
  db: Database,
  icons: IconLookup,
  detail: EntityDetail,
  body: EntityUpdate,
): Promise<EntityView> {
  if (body.icon !== undefined && body.icon !== null) {
    checkIcon(icons, body.icon);
  }

  await db.transaction(async (tx) => {
    if (body.name !== undefined || body.icon !== undefined) {
      await tx
        .update(schema.registry.entities)
        .set({
          ...(body.name === undefined ? {} : { name: body.name }),
          ...(body.icon === undefined ? {} : { icon: body.icon }),
          updatedAt: new Date(),
        })
        .where(eq(schema.registry.entities.id, detail.rowId));
    }

    if (body.tagIds !== undefined) {
      await assertTagsExist(tx, body.tagIds);
      await replaceEntityTags(tx, detail.rowId, body.tagIds);
    }
  });

  const changed = await findEntity(db, detail.view.entityId);

  if (changed === undefined) {
    throw new NotFoundError(`No entity ${detail.view.entityId}`, {
      details: { entityId: detail.view.entityId },
    });
  }

  return changed.view;
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
      deviceId: schema.registry.entities.deviceId,
      areaKey: schema.registry.areas.key,
    })
    .from(schema.registry.entities)
    .leftJoin(
      schema.registry.devices,
      eq(schema.registry.devices.id, schema.registry.entities.deviceId),
    )
    .leftJoin(schema.registry.areas, eq(schema.registry.areas.id, EFFECTIVE_AREA_ID));

  const tags = await readTagKeys(db, rows);

  const allowed = new Set<string>();

  for (const row of rows) {
    if (
      isPermitted(
        identity.permissions,
        'entity:read',
        entityScopes(row.entityId, row.areaKey, tags.get(row.rowId) ?? []),
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
