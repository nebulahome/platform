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
import { and, asc, eq, gt, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';

import type { BusClient } from '@nebulahome/bus';
import {
  busSubjects,
  containerDeviceId,
  CORE_LINK_SOURCES_METHOD,
  CORE_SERVICE,
  entityViewSchema,
  linkSourcesReplySchema,
  MATTER_TRANSPORT,
  matterReferenceSchema,
  NotFoundError,
  parseEntityId,
  ValidationError,
  type CapabilityName,
  type EntityLinkView,
  type EntityQuery,
  type EntityUpdate,
  type EntityView,
  type Identity,
  type JsonObject,
  type LinkOrigin,
  type MatterReference,
} from '@nebulahome/contracts';
import { schema, type Database } from '@nebulahome/db';

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

  /** The entity it reads through, when it is linked to another. */
  linkedTo: string | null;
  linkOrigin: string | null;

  /** The way it is read first, overriding its device's, when others are linked to it. */
  transport: string | null;
  config: unknown;
  createdAt: Date | null;

  /** The instance its state last came through. */
  stateSource: string | null;

  /** The way its device - or the device it is one more way into - is read first. */
  devicePreferred: string | null;

  /** Its instance's driver and transport. */
  kind: string | null;
  instanceTransport: string | null;
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
  linkedTo: schema.registry.entities.linkedTo,
  linkOrigin: schema.registry.entities.linkOrigin,
  transport: schema.registry.entities.transport,
  config: schema.registry.entities.config,
  createdAt: schema.registry.entities.createdAt,
  stateSource: schema.registry.entityStates.source,
  devicePreferred: sql<string | null>`coalesce(
    (SELECT g.preferred_transport FROM registry.devices g WHERE g.id = ${schema.registry.devices.linkedTo}),
    ${schema.registry.devices.preferredTransport})`,
  kind: schema.registry.integrations.kind,
  instanceTransport: schema.registry.integrations.transport,
} as const;

/**
 * The entity reads every entity read starts from: the row, its device, its room, its state and
 * its instance.
 *
 * @param db - The database.
 * @returns The query, to narrow.
 */
function selectEntities(db: Database) {
  return db
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
    .leftJoin(
      schema.registry.integrations,
      eq(schema.registry.integrations.id, schema.registry.entities.integrationId),
    );
}

/** The entities linked to one entity, which read the same thing through it. */
type LinkedRows = ReadonlyMap<string, readonly EntityRow[]>;

/**
 * Reads the entities linked to each of some entities, in the order they were linked.
 *
 * @param db - The database.
 * @param rowIds - The entities others may be linked to.
 * @returns The linked entities, by the row of the one they read through.
 */
async function readLinked(db: Database, rowIds: readonly string[]): Promise<LinkedRows> {
  const grouped = new Map<string, EntityRow[]>();

  if (rowIds.length === 0) {
    return grouped;
  }

  const rows: EntityRow[] = await selectEntities(db)
    .where(inArray(schema.registry.entities.linkedTo, [...rowIds]))
    .orderBy(asc(schema.registry.entities.createdAt), asc(schema.registry.entities.id));

  for (const row of rows) {
    if (row.linkedTo !== null) {
      grouped.set(row.linkedTo, [...(grouped.get(row.linkedTo) ?? []), row]);
    }
  }

  return grouped;
}

/**
 * What an entity's bundle said links it to its twin: its key, and where it sits in Matter.
 *
 * @param config - The entity's `config`.
 * @returns The hint, with nothing for an entity whose bundle said nothing.
 */
export function linkHintOf(config: unknown): {
  key: string | null;
  matter: MatterReference | null;
} {
  const link = (config as { link?: { key?: unknown; matter?: unknown } } | null)?.link;
  const parsed = matterReferenceSchema.safeParse(link?.matter);

  return {
    key: typeof link?.key === 'string' ? link.key : null,
    matter: parsed.success ? parsed.data : null,
  };
}

/**
 * How a linked entity is read, from its rows: every source, which way it prefers and which it is
 * read through now. What each source last said is `core`'s, and is added by {@link withSources}.
 *
 * @param row - The entity others are linked to.
 * @param linked - The entities linked to it.
 * @returns The link's view, or null when nothing is linked to it.
 */
function linkViewOf(row: EntityRow, linked: readonly EntityRow[]): EntityLinkView | null {
  if (linked.length === 0 || row.integrationId === null) {
    return null;
  }

  const active = [row, ...linked].some((each) => each.integrationId === row.stateSource)
    ? row.stateSource
    : null;

  return {
    sources: [row, ...linked].flatMap((each) => {
      if (each.integrationId === null) {
        return [];
      }

      const hint = linkHintOf(each.config);
      const transport = each.instanceTransport ?? '';
      const isActive = each.integrationId === active;

      return [
        {
          entityId: parseEntityId(each.entityId),
          deviceId: each.integrationId,
          vendorId: (each.kind ?? '').split('/')[0] ?? '',
          transport,
          key: transport === MATTER_TRANSPORT ? null : hint.key,
          // Its own place in Matter, for a Matter source; another's twin is not where it sits.
          matter: transport === MATTER_TRANSPORT ? hint.matter : null,
          isActive,
          isAvailable: isActive && row.isAvailable === true,
          state: isActive ? ((row.state ?? null) as JsonObject | null) : null,
          lastUpdated: isActive ? row.lastUpdated : null,
          origin: each === row ? null : ((each.linkOrigin ?? 'manual') as LinkOrigin),
        },
      ];
    }),
    transport: row.transport,
    preferred: row.devicePreferred ?? row.integrationId,
    active,
  };
}

/**
 * Every capability of a linked entity: what any of its sources declares, its own first.
 *
 * @param own - The entity's own.
 * @param linked - Those of the entities linked to it.
 * @returns Each capability once.
 */
function unionOf(
  own: readonly { capability: string; params: unknown }[],
  linked: readonly (readonly { capability: string; params: unknown }[])[],
): { capability: string; params: unknown }[] {
  const seen = new Set(own.map((entry) => entry.capability));

  return [
    ...own,
    ...linked.flat().filter((entry) => {
      if (seen.has(entry.capability)) {
        return false;
      }

      seen.add(entry.capability);

      return true;
    }),
  ];
}

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
 * @param linked - The entities linked to it, and what each declares.
 * @returns The entity as the API presents it.
 */
function toView(
  row: EntityRow,
  capabilities: readonly { capability: string; params: unknown }[],
  tags: readonly EntityTag[] = [],
  linked: readonly {
    readonly row: EntityRow;
    readonly capabilities: readonly { capability: string; params: unknown }[];
  }[] = [],
): EntityView {
  const declared = unionOf(
    capabilities,
    linked.map((each) => each.capabilities),
  );

  return entityViewSchema.parse({
    addresses: linked.map((each) => each.row.entityId),
    linked: linkViewOf(
      row,
      linked.map((each) => each.row),
    ),
    key: linkHintOf(row.config).key,
    createdAt: row.createdAt,
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
    capabilities: declared.map((entry) => ({
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
  // An entity linked to another is read as that one, and listed only as that one.
  const conditions: (SQL | undefined)[] = [isNull(schema.registry.entities.linkedTo)];

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
  const rows: EntityRow[] = await selectEntities(db)
    .where(buildFilters(query, page.cursor))
    .orderBy(asc(schema.registry.entities.entityId))

    // One more than asked for: the extra row is how the next cursor is decided without a
    // second COUNT(*) over the whole table.
    .limit(page.limit + 1);

  const rowIds = rows.map((row) => row.rowId);
  const linked = await readLinked(db, rowIds);
  const [capabilities, tags, deviceTags] = await Promise.all([
    readCapabilities(db, [...rowIds, ...[...linked.values()].flat().map((row) => row.rowId)]),
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
      scopesOf(row, keysUnder(row), linked.get(row.rowId)),
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
      toView(
        row,
        capabilities.get(row.rowId) ?? [],
        tags.get(row.rowId) ?? [],
        linkedWith(linked.get(row.rowId), capabilities),
      ),
    ),
    page.limit,
    (view) => ({ key: view.entityId }),
  );
}

/**
 * The entities linked to one, each with what it declares.
 *
 * @param rows - The linked entities.
 * @param capabilities - Capabilities by row.
 * @returns What {@link toView} takes.
 */
function linkedWith(
  rows: readonly EntityRow[] | undefined,
  capabilities: ReadonlyMap<string, readonly { capability: string; params: unknown }[]>,
): { row: EntityRow; capabilities: readonly { capability: string; params: unknown }[] }[] {
  return (rows ?? []).map((row) => ({ row, capabilities: capabilities.get(row.rowId) ?? [] }));
}

/**
 * Every scope a grant could cover an entity by: its own and those of the entities linked to it,
 * whose addresses mean it.
 *
 * @param row - The entity.
 * @param tagKeys - The tags it falls under.
 * @param linked - The entities linked to it.
 * @returns The scopes.
 */
function scopesOf(
  row: EntityRow,
  tagKeys: readonly string[],
  linked: readonly EntityRow[] | undefined,
): string[] {
  return [
    ...entityScopes(row.entityId, row.areaKey, tagKeys),
    ...(linked ?? []).map((each) => `entity.${each.entityId}`),
  ];
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
  const [found] = await findEntities(db, [entityId]);

  return found;
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

  const named: EntityRow[] = await selectEntities(db).where(
    inArray(schema.registry.entities.entityId, [...entityIds]),
  );

  // The address of an entity linked to another means that one: it is what is read.
  const holderIds = named
    .map((row) => row.linkedTo)
    .filter((id): id is string => id !== null && !named.some((row) => row.rowId === id));
  const holders: EntityRow[] =
    holderIds.length === 0
      ? []
      : await selectEntities(db).where(inArray(schema.registry.entities.id, holderIds));
  const rows = [...named.filter((row) => row.linkedTo === null), ...holders]
    .filter((row, index, all) => all.findIndex((each) => each.rowId === row.rowId) === index)
    .sort((left, right) => left.entityId.localeCompare(right.entityId));

  const rowIds = rows.map((row) => row.rowId);
  const linked = await readLinked(db, rowIds);
  const [capabilities, tags, deviceTags] = await Promise.all([
    readCapabilities(db, [...rowIds, ...[...linked.values()].flat().map((row) => row.rowId)]),
    readTags(db, rowIds),
    readDeviceTagKeys(
      db,
      rows.map((row) => row.deviceId),
    ),
  ]);

  return rows.map((row) => ({
    view: toView(
      row,
      capabilities.get(row.rowId) ?? [],
      tags.get(row.rowId) ?? [],
      linkedWith(linked.get(row.rowId), capabilities),
    ),
    scopes: scopesOf(
      row,
      scopeTagKeys(
        tags.get(row.rowId),
        row.deviceId === null ? undefined : deviceTags.get(row.deviceId),
      ),
      linked.get(row.rowId),
    ),
    rowId: row.rowId,
  }));
}

/**
 * Adds to a linked entity's view what each of its sources last said, which `core` holds.
 *
 * @param bus - The bus, when it is reachable.
 * @param view - The entity.
 * @param timeoutMs - How long `core` has to answer.
 * @returns The view with each source's state; as it was when the entity is not linked or `core`
 * did not answer.
 */
export async function withSources(
  bus: BusClient | undefined,
  view: EntityView,
  timeoutMs: number,
): Promise<EntityView> {
  if (view.linked === null || bus === undefined) {
    return view;
  }

  const reply = await bus
    .request(
      busSubjects.service(CORE_SERVICE, CORE_LINK_SOURCES_METHOD),
      { entityId: view.entityId },
      linkSourcesReplySchema,
      { timeoutMs },
    )
    .catch(() => undefined);

  if (reply === undefined) {
    return view;
  }

  const said = new Map(reply.items.map((item) => [item.entityId as string, item]));

  return {
    ...view,
    linked: {
      ...view.linked,
      active: reply.items.find((item) => item.isActive)?.source ?? view.linked.active,
      sources: view.linked.sources.map((source) => {
        const item = said.get(source.entityId);

        return item === undefined
          ? source
          : {
              ...source,
              isActive: item.isActive,
              isAvailable: item.state?.isAvailable ?? false,
              state: (item.state?.state ?? null) as JsonObject | null,
              lastUpdated: item.state?.lastUpdated ?? null,
            };
      }),
    },
  };
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

  if (
    body.transport !== undefined &&
    body.transport !== null &&
    !(detail.view.linked?.sources ?? []).some((source) => source.deviceId === body.transport)
  ) {
    throw new ValidationError('The entity is not read that way', {
      details: { entityId: detail.view.entityId, transport: body.transport },
    });
  }

  await db.transaction(async (tx) => {
    if (body.name !== undefined || body.icon !== undefined || body.transport !== undefined) {
      await tx
        .update(schema.registry.entities)
        .set({
          ...(body.name === undefined ? {} : { name: body.name }),
          ...(body.icon === undefined ? {} : { icon: body.icon }),
          ...(body.transport === undefined ? {} : { transport: body.transport }),
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
