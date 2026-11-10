/**
 * Creating, changing, duplicating, deleting, importing and exporting aliases.
 *
 * An alias is an `alias.*` entity the platform owns (`source: derived`) on a device - the shared
 * virtual device "Aliases", a virtual device of the owner's, or a real device - plus a row in
 * `registry.aliases` holding what it behaves as, its parts, its code and its cases. What it reads
 * is worked out here on every save and written to `registry.alias_reads`: its parts' entities,
 * the entity ids its formulas and its code name. Every entity it reads requires `entity:read` of
 * whoever saves it; refusals never include an entity's value.
 *
 * **Where each write happens.** The API writes the rows - the entity, the alias, what it reads,
 * its capabilities and their params - and then asks `core` to take it in: `core` holds the
 * directory commands are routed by and the catalogue aliases are worked out from, and neither
 * learns about a row written behind its back. The state is never written here: `core` is the one
 * writer of entity state (ARCHITECTURE.md 4.3). Removing an alias goes through `core`, because
 * the entity must leave its memory in the same step as its rows.
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import type { BusClient } from '@nebulahome/bus';
import {
  aliasCapabilities,
  aliasCapabilityParams,
  aliasCustomTypeSchema,
  aliasDisplaySchema,
  aliasEntryCode,
  aliasFileEntry,
  aliasesFile,
  aliasErrorSchema,
  aliasPartIssues,
  aliasPartsReads,
  aliasPartsSchema,
  aliasCaseSchema,
  aliasType,
  aliasTypeParts,
  ALIAS_FALLBACK_POLICIES,
  ALIAS_TYPE_IDS,
  busSubjects,
  ConflictError,
  CORE_REMOVE_ALIAS_METHOD,
  CORE_SERVICE,
  CORE_SYNC_ALIAS_METHOD,
  defaultAliasParts,
  DeviceUnavailableError,
  formatEntityId,
  jsonObjectSchema,
  NotFoundError,
  packageManifestSchema,
  PermissionError,
  removeAliasReplySchema,
  replaceAliasEntity,
  syncAliasReplySchema,
  ValidationError,
  type AliasCreate,
  type AliasCustomField,
  type AliasCustomType,
  type AliasDetail,
  type AliasDeviceInput,
  type AliasFallbackPolicy,
  type AliasFile,
  type AliasFileEntry,
  type AliasHealth,
  type AliasInput,
  type AliasListItem,
  type AliasParts,
  type AliasSetupChange,
  type AliasTypeDef,
  type AliasTypeId,
  type AliasUpdate,
  type AliasUsedBy,
  type AliasVirtualDevice,
  type AliasView,
  type EntityId,
  type Identity,
  type JsonObject,
} from '@nebulahome/contracts';
import { schema, type Database } from '@nebulahome/db';
import type { PlatformLogger } from '@nebulahome/logging';

import { entityScopes, isPermitted } from '../auth/permissions.js';

import { checkCode } from './alias-code-check.js';
import { readTagKeys } from './entities.js';
import { mentions } from './links.js';

/** What the alias writes need beyond the database: the bus to `core`, and a log. */
export type AliasesContext = {
  readonly db: Database;

  /** The bus, or undefined while it is unreachable. */
  readonly bus: BusClient | undefined;

  /** The request's trace id, carried onto the bus. */
  readonly traceId: string;

  /** How long `core` has to answer. */
  readonly timeoutMs: number;

  readonly logger: PlatformLogger;
};

/** The shared virtual device's external id. */
const SHARED_DEVICE = 'aliases';

/** The area an entity is in: its own, or failing that its device's. */
const EFFECTIVE_AREA_ID = sql`coalesce(${schema.registry.entities.areaId}, ${schema.registry.devices.areaId})`;

/** One alias as its rows hold it, before it is a view. */
type AliasRow = {
  readonly id: string;
  readonly rowId: string;
  readonly entityId: string;
  readonly name: string;
  readonly icon: string | null;
  readonly behavesAs: string;
  readonly customType: unknown;
  readonly parts: unknown;
  readonly code: string;
  readonly memory: unknown;
  readonly cases: unknown;
  readonly display: unknown;
  readonly debounceMs: number;
  readonly fallbackPolicy: string;
  readonly isEnabled: boolean;
  readonly lastError: unknown;
  readonly lastEvaluatedAt: Date | null;
  readonly createdAt: Date;
  readonly ownAreaId: string | null;
  readonly areaKey: string | null;
  readonly areaName: string | null;
  readonly deviceId: string | null;
  readonly deviceName: string | null;
  readonly deviceSource: string | null;
  readonly deviceExternalId: string | null;
  readonly isAvailable: boolean | null;
};

/**
 * Reads alias rows with their entity, device, area and availability.
 *
 * @param db - The database.
 * @param where - Which, by a condition on the alias or its entity; all when absent.
 * @returns The rows, by name.
 */
async function aliasRows(db: Database, where?: ReturnType<typeof eq>): Promise<AliasRow[]> {
  const { aliases, entities, devices, areas, entityStates } = schema.registry;

  return db
    .select({
      id: aliases.id,
      rowId: entities.id,
      entityId: entities.entityId,
      name: entities.name,
      icon: entities.icon,
      behavesAs: aliases.behavesAs,
      customType: aliases.customType,
      parts: aliases.parts,
      code: aliases.code,
      memory: aliases.memory,
      cases: aliases.cases,
      display: aliases.display,
      debounceMs: aliases.debounceMs,
      fallbackPolicy: aliases.fallbackPolicy,
      isEnabled: aliases.isEnabled,
      lastError: aliases.lastError,
      lastEvaluatedAt: aliases.lastEvaluatedAt,
      createdAt: aliases.createdAt,
      ownAreaId: entities.areaId,
      areaKey: areas.key,
      areaName: areas.name,
      deviceId: devices.id,
      deviceName: devices.name,
      deviceSource: devices.source,
      deviceExternalId: devices.externalId,
      isAvailable: entityStates.isAvailable,
    })
    .from(aliases)
    .innerJoin(entities, eq(entities.id, aliases.entityId))
    .leftJoin(devices, eq(devices.id, entities.deviceId))
    .leftJoin(areas, eq(areas.id, EFFECTIVE_AREA_ID))
    .leftJoin(entityStates, eq(entityStates.entityId, entities.id))
    .where(where)
    .orderBy(asc(entities.name));
}

/**
 * The entities each alias reads, by alias id.
 *
 * @param db - The database.
 * @param ids - The aliases.
 * @returns Their reads.
 */
async function readsOf(db: Database, ids: readonly string[]): Promise<Map<string, EntityId[]>> {
  const reads = new Map<string, EntityId[]>();

  if (ids.length === 0) {
    return reads;
  }

  const rows = await db
    .select({
      aliasId: schema.registry.aliasReads.aliasId,
      entityId: schema.registry.aliasReads.entityId,
    })
    .from(schema.registry.aliasReads)
    .where(inArray(schema.registry.aliasReads.aliasId, [...ids]))
    .orderBy(asc(schema.registry.aliasReads.entityId));

  for (const row of rows) {
    reads.set(row.aliasId, [...(reads.get(row.aliasId) ?? []), row.entityId as EntityId]);
  }

  return reads;
}

/**
 * How an alias is doing.
 *
 * @param row - Its rows.
 * @returns Off, failing, unavailable or working.
 */
function healthOf(row: AliasRow): AliasHealth {
  if (!row.isEnabled) {
    return 'off';
  }

  if (row.lastError !== null) {
    return 'failing';
  }

  return row.isAvailable === false ? 'unavailable' : 'ok';
}

/**
 * The first words of what is wrong, for the list's second line.
 *
 * @param row - Its rows.
 * @returns The words, or null while it works.
 */
function problemOf(row: AliasRow): string | null {
  const error = aliasErrorSchema.safeParse(row.lastError);

  if (!error.success) {
    return null;
  }

  const where = error.data.line === null ? '' : `Line ${String(error.data.line)} · `;
  const text = `${where}${error.data.message}`;

  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

/**
 * The type of an alias row, when this version knows it.
 *
 * @param behavesAs - What the row says.
 * @returns The type.
 * @throws {ValidationError} When it is not one.
 */
function typeOf(behavesAs: string): AliasTypeDef {
  if (!(ALIAS_TYPE_IDS as readonly string[]).includes(behavesAs)) {
    throw new ValidationError(`Unknown alias type ${behavesAs}`);
  }

  return aliasType(behavesAs as AliasTypeId);
}

/**
 * An alias's rows as its list item.
 *
 * @param row - Its rows.
 * @param reads - What it reads.
 * @returns The item.
 */
function toListItem(row: AliasRow, reads: readonly EntityId[]): AliasListItem {
  return {
    id: row.id,
    entityId: row.entityId as EntityId,
    name: row.name,
    icon: row.icon,
    behavesAs: typeOf(row.behavesAs).id,
    area:
      row.areaKey === null || row.areaName === null
        ? null
        : { key: row.areaKey, name: row.areaName },
    device: {
      id: row.deviceId ?? '00000000-0000-0000-0000-000000000000',
      name: row.deviceName ?? 'Aliases',
      isVirtual: row.deviceSource !== 'adapter',
      isShared: row.deviceSource === 'virtual' && row.deviceExternalId === SHARED_DEVICE,
    },
    isEnabled: row.isEnabled,
    health: healthOf(row),
    problem: problemOf(row),
    reads: [...reads],
  };
}

/**
 * An alias's rows as its whole view.
 *
 * @param row - Its rows.
 * @param reads - What it reads.
 * @returns The view.
 */
function toView(row: AliasRow, reads: readonly EntityId[]): AliasView {
  const custom = aliasCustomTypeSchema.nullable().safeParse(row.customType ?? null);
  const parts = aliasPartsSchema.safeParse(row.parts);
  // jsonb sorts keys by length: give them back in the type's order (a custom type's keep theirs).
  const order = typeOf(row.behavesAs).parts.map((def) => def.key);

  /**
   * Where a part goes.
   *
   * @param key - The part's key.
   * @returns Its place in the type, unknown keys last.
   */
  const rank = (key: string): number => (order.includes(key) ? order.indexOf(key) : order.length);
  const memory = jsonObjectSchema.safeParse(row.memory);
  const cases = aliasCaseSchema.array().safeParse(row.cases);
  const display = aliasDisplaySchema.safeParse(row.display);
  const lastError = aliasErrorSchema.nullable().safeParse(row.lastError ?? null);

  return {
    ...toListItem(row, reads),
    key: row.entityId.split('.')[1] ?? row.entityId,
    customType: custom.success ? custom.data : null,
    parts: parts.success
      ? Object.fromEntries(
          Object.entries(parts.data).toSorted(([left], [right]) => rank(left) - rank(right)),
        )
      : {},
    code: row.code,
    cases: cases.success ? cases.data : [],
    memory: memory.success ? memory.data : {},
    ifOneStops: (ALIAS_FALLBACK_POLICIES as readonly string[]).includes(row.fallbackPolicy)
      ? (row.fallbackPolicy as AliasFallbackPolicy)
      : 'unavailable',
    debounceMs: row.debounceMs,
    display: display.success ? display.data : { deviceClass: null, unit: null, precision: null },
    lastError: lastError.success ? lastError.data : null,
    lastEvaluatedAt: row.lastEvaluatedAt,
    createdAt: row.createdAt,
  };
}

/**
 * Lists every alias.
 *
 * @param db - The database.
 * @returns The aliases, by name.
 */
export async function listAliases(db: Database): Promise<AliasListItem[]> {
  const rows = await aliasRows(db);
  const reads = await readsOf(
    db,
    rows.map((row) => row.id),
  );

  return rows.flatMap((row) => {
    try {
      return [toListItem(row, reads.get(row.id) ?? [])];
    } catch {
      return [];
    }
  });
}

/**
 * Reads one alias whole.
 *
 * @param db - The database.
 * @param id - The alias.
 * @returns The view.
 * @throws {NotFoundError} When there is no such alias.
 */
export async function readAlias(db: Database, id: string): Promise<AliasView> {
  const [row] = await aliasRows(db, eq(schema.registry.aliases.id, id));

  if (row === undefined) {
    throw new NotFoundError('Alias not found', { details: { id } });
  }

  const reads = await readsOf(db, [id]);

  return toView(row, reads.get(id) ?? []);
}

/**
 * One alias with what it reads and what uses it: what its page shows.
 *
 * @param db - The database.
 * @param id - The alias.
 * @returns The alias, its inputs and its users.
 * @throws {NotFoundError} When there is no such alias.
 */
export async function aliasDetail(db: Database, id: string): Promise<AliasDetail> {
  const alias = await readAlias(db, id);
  const [inputs, usedBy, developerMode] = await Promise.all([
    inputsOf(db, alias.reads),
    usedByOf(db, alias.entityId),
    isDeveloperMode(db),
  ]);

  return { alias, inputs, usedBy, developerMode };
}

/**
 * The virtual devices an alias can go on: the shared one first, then the owner's by name.
 *
 * @param db - The database.
 * @returns The devices.
 */
export async function virtualDevices(db: Database): Promise<AliasVirtualDevice[]> {
  const { devices } = schema.registry;
  const rows = await db
    .select({ id: devices.id, name: devices.name, externalId: devices.externalId })
    .from(devices)
    .where(eq(devices.source, 'virtual'))
    .orderBy(devices.name);

  return rows
    .map((row) => ({ id: row.id, name: row.name, isShared: row.externalId === SHARED_DEVICE }))
    .toSorted((left, right) => Number(right.isShared) - Number(left.isShared));
}

/**
 * The entities an alias reads, named and placed, and whether each is in the house.
 *
 * @param db - The database.
 * @param reads - Their ids.
 * @returns One input per id, in the same order.
 */
async function inputsOf(db: Database, reads: readonly string[]): Promise<AliasInput[]> {
  if (reads.length === 0) {
    return [];
  }

  const { entities, devices, areas } = schema.registry;
  const rows = await db
    .select({ entityId: entities.entityId, name: entities.name, areaName: areas.name })
    .from(entities)
    .leftJoin(devices, eq(devices.id, entities.deviceId))
    .leftJoin(areas, eq(areas.id, EFFECTIVE_AREA_ID))
    .where(inArray(entities.entityId, [...reads]));
  const byId = new Map(rows.map((row) => [row.entityId, row]));

  return reads.map((entityId) => {
    const row = byId.get(entityId);

    return {
      entityId: entityId as EntityId,
      name: row?.name ?? entityId,
      areaName: row?.areaName ?? null,
      isPresent: row !== undefined,
    };
  });
}

/**
 * What uses an entity: the automations, scenes and dashboards that name it, and the aliases that
 * read it. What stops working if it goes.
 *
 * @param db - The database.
 * @param entityId - The entity.
 * @returns What uses it, by kind.
 */
export async function usedByOf(db: Database, entityId: string): Promise<AliasUsedBy> {
  const { automations, scenes, sceneEntities, entities, dashboards, aliases, aliasReads } =
    schema.registry;
  const [automationRows, sceneRows, dashboardRows, readerRows] = await Promise.all([
    db
      .select({ id: automations.id, name: automations.name, definition: automations.definition })
      .from(automations),
    db
      .selectDistinct({ id: scenes.id, name: scenes.name })
      .from(sceneEntities)
      .innerJoin(scenes, eq(scenes.id, sceneEntities.sceneId))
      .innerJoin(entities, eq(entities.id, sceneEntities.entityId))
      .where(eq(entities.entityId, entityId)),
    db
      .select({ id: dashboards.id, name: dashboards.name, layout: dashboards.layout })
      .from(dashboards),
    db
      .selectDistinct({ id: aliases.id, name: entities.name })
      .from(aliasReads)
      .innerJoin(aliases, eq(aliases.id, aliasReads.aliasId))
      .innerJoin(entities, eq(entities.id, aliases.entityId))
      .where(eq(aliasReads.entityId, entityId)),
  ]);

  return {
    automations: automationRows
      .filter((row) => mentions(row.definition, entityId) > 0)
      .map((row) => ({ id: row.id, name: row.name })),
    scenes: sceneRows.map((row) => ({ id: row.id, name: row.name })),
    dashboards: dashboardRows
      .filter((row) => mentions(row.layout, entityId) > 0)
      .map((row) => ({ id: row.id, name: row.name })),
    aliases: readerRows.map((row) => ({ id: row.id, name: row.name })),
  };
}

/**
 * The fields of a package's entity type, for a custom alias.
 *
 * @param db - The database.
 * @param custom - The package entity type.
 * @returns Its state fields.
 * @throws {NotFoundError} When the package does not define it.
 */
async function customFieldsOf(db: Database, custom: AliasCustomType): Promise<AliasCustomField[]> {
  const [row] = await db
    .select({ manifest: schema.system.packages.manifest })
    .from(schema.system.packages)
    .where(eq(schema.system.packages.id, custom.packageId));
  const manifest = packageManifestSchema.safeParse(row?.manifest);
  const type = manifest.success
    ? manifest.data.entityTypes.find((candidate) => candidate.id === custom.type)
    : undefined;

  if (type === undefined) {
    throw new NotFoundError('No package defines that entity type', { details: { ...custom } });
  }

  return type.state;
}

/**
 * Ensures the caller may read every entity an alias reads, and that each is in the house.
 * Refusals never include an entity's value.
 *
 * @param db - The database.
 * @param identity - Who is asking.
 * @param reads - The entity ids.
 * @throws {NotFoundError} When one is not in the house.
 * @throws {PermissionError} When the caller may not read one of them.
 */
async function requireReadable(
  db: Database,
  identity: Identity,
  reads: readonly string[],
): Promise<void> {
  if (reads.length === 0) {
    return;
  }

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
    .leftJoin(schema.registry.areas, eq(schema.registry.areas.id, EFFECTIVE_AREA_ID))
    .where(inArray(schema.registry.entities.entityId, [...reads]));
  const byId = new Map(rows.map((row) => [row.entityId, row]));
  const tags = await readTagKeys(db, rows);

  for (const entityId of reads) {
    const row = byId.get(entityId);

    if (row === undefined) {
      throw new NotFoundError(`${entityId} is not in this house`, { details: { entityId } });
    }

    if (
      !isPermitted(
        identity.permissions,
        'entity:read',
        entityScopes(row.entityId, row.areaKey, tags.get(row.rowId) ?? []),
      )
    ) {
      throw new PermissionError('This action requires entity:read on every entity an alias reads', {
        details: { permission: 'entity:read', entityId },
      });
    }
  }
}

/**
 * Finds a cycle among alias → read edges.
 *
 * @param edges - An alias entity id reads an entity id.
 * @returns The cycle path with the first node repeated at the end, or null.
 */
export function findCycle(
  edges: readonly { readonly alias: string; readonly reads: string }[],
): string[] | null {
  const adjacency = new Map<string, string[]>();

  for (const edge of edges) {
    adjacency.set(edge.alias, [...(adjacency.get(edge.alias) ?? []), edge.reads]);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  /**
   * Walks from one node, depth first.
   *
   * @param node - Where to start.
   * @returns The cycle found under it, or null.
   */
  const visit = (node: string): string[] | null => {
    if (visited.has(node)) {
      return null;
    }

    if (visiting.has(node)) {
      return [...stack.slice(stack.indexOf(node)), node];
    }

    visiting.add(node);
    stack.push(node);

    for (const next of adjacency.get(node) ?? []) {
      const cycle = adjacency.has(next) ? visit(next) : null;

      if (cycle !== null) {
        return cycle;
      }
    }

    stack.pop();
    visiting.delete(node);
    visited.add(node);

    return null;
  };

  for (const node of adjacency.keys()) {
    const cycle = visit(node);

    if (cycle !== null) {
      return cycle;
    }
  }

  return null;
}

/**
 * Refuses reads that would make an alias read itself, through other aliases or directly.
 *
 * @param db - The database.
 * @param aliasEntityId - The alias.
 * @param reads - What it would read.
 * @throws {ValidationError} Naming the cycle, when there would be one.
 */
async function assertNoCycle(
  db: Database,
  aliasEntityId: string,
  reads: readonly string[],
): Promise<void> {
  const rows = await db
    .select({
      alias: schema.registry.entities.entityId,
      reads: schema.registry.aliasReads.entityId,
    })
    .from(schema.registry.aliasReads)
    .innerJoin(
      schema.registry.aliases,
      eq(schema.registry.aliases.id, schema.registry.aliasReads.aliasId),
    )
    .innerJoin(
      schema.registry.entities,
      eq(schema.registry.entities.id, schema.registry.aliases.entityId),
    );
  const cycle = findCycle([
    ...rows.filter((row) => row.alias !== aliasEntityId),
    ...reads.map((read) => ({ alias: aliasEntityId, reads: read })),
  ]);

  if (cycle !== null) {
    throw new ValidationError('The alias would read itself', { details: { path: cycle } });
  }
}

/**
 * Whether developer mode is on: code can be written only then.
 *
 * @param db - The database.
 * @returns True when it is.
 */
async function isDeveloperMode(db: Database): Promise<boolean> {
  const [row] = await db
    .select({ value: schema.system.settings.value })
    .from(schema.system.settings)
    .where(eq(schema.system.settings.key, 'system.developer_mode'));

  return row?.value === true;
}

/** An alias's setup, checked and worked out, ready to write. */
type Prepared = {
  readonly parts: AliasParts;
  readonly code: string;
  readonly reads: readonly string[];
  readonly capabilities: ReturnType<typeof aliasCapabilities>;
  readonly params: Record<string, JsonObject>;
};

/**
 * Checks an alias's parts and code against its type and the house, and works out what it reads
 * and the params of its capabilities.
 *
 * @param db - The database.
 * @param identity - Who saves it.
 * @param aliasEntityId - The alias.
 * @param type - What it behaves as.
 * @param custom - For a custom alias, its package entity type.
 * @param parts - Its parts.
 * @param code - Its code.
 * @returns The setup to write.
 * @throws {ValidationError} When a part or the code is wrong for the type, or it reads itself.
 * @throws {NotFoundError} When it reads an entity that is not in the house.
 * @throws {PermissionError} When the caller may not read one it reads.
 */
async function prepare(
  db: Database,
  identity: Identity,
  aliasEntityId: string,
  type: AliasTypeDef,
  custom: AliasCustomType | null,
  parts: AliasParts,
  code: string,
): Promise<Prepared> {
  const fields = custom === null ? undefined : await customFieldsOf(db, custom);
  const defs = aliasTypeParts(type, fields);
  const issues = aliasPartIssues(type, parts, fields);

  if (issues.length > 0) {
    throw new ValidationError(issues[0]?.message ?? 'The parts do not fit the type', {
      details: {
        issues: issues.map((issue) => ({
          path: `parts.${issue.part ?? ''}`,
          message: issue.message,
        })),
      },
    });
  }

  const partReads = aliasPartsReads(parts);
  const known = new Set(
    (
      await db
        .select({ entityId: schema.registry.entities.entityId })
        .from(schema.registry.entities)
    ).map((row) => row.entityId),
  );
  const checked = checkCode(code, parts, defs, (entityId) => known.has(entityId));

  if (checked.problems.length > 0) {
    const [first] = checked.problems;

    throw new ValidationError(
      first === undefined
        ? 'The code has problems'
        : `Line ${String(first.line)}: ${first.message}`,
      {
        details: {
          issues: checked.problems.map((problem) => ({
            path: `code.${String(problem.line)}`,
            message: problem.message,
          })),
        },
      },
    );
  }

  const reads = [...new Set([...partReads, ...checked.reads])].sort();

  await requireReadable(db, identity, reads);
  await assertNoCycle(db, aliasEntityId, reads);

  const capabilities = aliasCapabilities(type, Object.keys(parts));
  const entityParams = await capabilityParamsOf(db, reads);

  return {
    parts,
    code,
    reads,
    capabilities,
    params: aliasCapabilityParams(
      capabilities,
      parts,
      defs,
      (entityId, capability) => entityParams.get(`${entityId}\u0000${capability}`) ?? null,
      custom ?? undefined,
    ),
  };
}

/**
 * The params of the capabilities of some entities, by entity id and capability.
 *
 * @param db - The database.
 * @param entityIds - The entities.
 * @returns Their params.
 */
async function capabilityParamsOf(
  db: Database,
  entityIds: readonly string[],
): Promise<Map<string, JsonObject>> {
  const params = new Map<string, JsonObject>();

  if (entityIds.length === 0) {
    return params;
  }

  const rows = await db
    .select({
      entityId: schema.registry.entities.entityId,
      capability: schema.registry.entityCapabilities.capability,
      params: schema.registry.entityCapabilities.params,
    })
    .from(schema.registry.entityCapabilities)
    .innerJoin(
      schema.registry.entities,
      eq(schema.registry.entities.id, schema.registry.entityCapabilities.entityId),
    )
    .where(inArray(schema.registry.entities.entityId, [...entityIds]));

  for (const row of rows) {
    const parsed = jsonObjectSchema.safeParse(row.params);
    params.set(`${row.entityId}\u0000${row.capability}`, parsed.success ? parsed.data : {});
  }

  return params;
}

/**
 * An object id for a new alias, from its name, not yet taken.
 *
 * @param db - The database.
 * @param name - The alias's name.
 * @returns The object id.
 */
async function freeObjectId(db: Database, name: string): Promise<string> {
  const base =
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '_')
      .replace(/^_+|_+$/gu, '')
      .replace(/^(?=[0-9])/u, 'alias_')
      .slice(0, 56) || 'alias';
  const taken = new Set(
    (
      await db
        .select({ entityId: schema.registry.entities.entityId })
        .from(schema.registry.entities)
        .where(sql`${schema.registry.entities.entityId} LIKE ${`alias.${base}%`}`)
    ).map((row) => row.entityId),
  );
  let candidate = base;

  for (let n = 2; taken.has(`alias.${candidate}`); n += 1) {
    candidate = `${base}_${String(n)}`;
  }

  return candidate;
}

/**
 * The device a new alias goes on.
 *
 * @param db - The database.
 * @param device - Which: the shared one, one by id, or a new virtual one.
 * @returns Its row id and whether it is virtual.
 * @throws {NotFoundError} When the device named is not there.
 */
async function deviceFor(
  db: Database,
  device: AliasDeviceInput,
): Promise<{ readonly id: string; readonly isVirtual: boolean }> {
  const { devices } = schema.registry;

  if (device.kind === 'new') {
    const [row] = await db
      .insert(devices)
      .values({
        source: 'virtual',
        name: device.name,
        icon: 'layers',
        manufacturer: 'Nebula',
        model: 'Virtual device',
      })
      .returning({ id: devices.id });

    if (row === undefined) {
      throw new ConflictError('Could not make the virtual device');
    }

    return { id: row.id, isVirtual: true };
  }

  const [row] = await db
    .select({ id: devices.id, source: devices.source })
    .from(devices)
    .where(
      device.kind === 'shared'
        ? and(eq(devices.source, 'virtual'), eq(devices.externalId, SHARED_DEVICE))
        : eq(devices.id, device.deviceId),
    );

  if (row === undefined) {
    throw new NotFoundError('That device is not there', { details: { ...device } });
  }

  return { id: row.id, isVirtual: row.source === 'virtual' };
}

/**
 * An area's row, by its key.
 *
 * @param db - The database.
 * @param key - The area's key, or null.
 * @returns Its row id, or null.
 * @throws {NotFoundError} When there is no such area.
 */
async function areaIdOf(db: Database, key: string | null): Promise<string | null> {
  if (key === null) {
    return null;
  }

  const [row] = await db
    .select({ id: schema.registry.areas.id })
    .from(schema.registry.areas)
    .where(eq(schema.registry.areas.key, key));

  if (row === undefined) {
    throw new NotFoundError('No such area', { details: { area: key } });
  }

  return row.id;
}

/**
 * Writes an alias's reads and capabilities, replacing what was there.
 *
 * @param tx - The transaction.
 * @param aliasId - The alias.
 * @param rowId - Its entity row.
 * @param prepared - Its setup.
 */
async function writeDerived(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  aliasId: string,
  rowId: string,
  prepared: Prepared,
): Promise<void> {
  await tx
    .delete(schema.registry.aliasReads)
    .where(eq(schema.registry.aliasReads.aliasId, aliasId));

  if (prepared.reads.length > 0) {
    await tx
      .insert(schema.registry.aliasReads)
      .values(prepared.reads.map((entityId) => ({ aliasId, entityId })));
  }

  await tx
    .delete(schema.registry.entityCapabilities)
    .where(eq(schema.registry.entityCapabilities.entityId, rowId));
  await tx.insert(schema.registry.entityCapabilities).values(
    prepared.capabilities.map((capability) => ({
      entityId: rowId,
      capability,
      params: prepared.params[capability] ?? {},
    })),
  );
}

/**
 * Asks `core` to take in an alias whose rows were just written. Best effort: a `core` that does
 * not answer is logged, and loads the alias when it next starts.
 *
 * @param context - The bus, the trace id and the log.
 * @param entityId - The alias entity.
 */
async function syncOnCore(context: AliasesContext, entityId: EntityId): Promise<void> {
  if (context.bus === undefined) {
    context.logger.warn(
      { entityId },
      'The bus is away; core will load the alias on its next start',
    );

    return;
  }

  try {
    await context.bus.request(
      busSubjects.service(CORE_SERVICE, CORE_SYNC_ALIAS_METHOD),
      { entityId },
      syncAliasReplySchema,
      { traceId: context.traceId, timeoutMs: context.timeoutMs },
    );
  } catch (error: unknown) {
    context.logger.warn(
      { entityId, err: error },
      'Core did not take the alias in; it will on its next start',
    );
  }
}

/**
 * Creates an alias: every required part Stored unless the body says otherwise.
 *
 * @param context - The database, the bus and the log.
 * @param body - What to create.
 * @param identity - Who is creating it.
 * @returns The alias as stored.
 */
export async function createAlias(
  context: AliasesContext,
  body: AliasCreate,
  identity: Identity,
): Promise<AliasView> {
  const { db } = context;
  const type = aliasType(body.behavesAs);
  const custom = type.id === 'custom' ? body.customType : null;

  if (type.id === 'custom' && custom === null) {
    throw new ValidationError('A custom alias names its package entity type');
  }

  const fields = custom === null ? undefined : await customFieldsOf(db, custom);
  const parts = body.parts ?? defaultAliasParts(type, fields);
  const objectId = await freeObjectId(db, body.name);
  const entityId = formatEntityId('alias', objectId);
  const prepared = await prepare(db, identity, entityId, type, custom, parts, '');
  const device = await deviceFor(db, body.device);
  const areaId = device.isVirtual ? await areaIdOf(db, body.area) : null;

  const id = await db.transaction(async (tx) => {
    const [entity] = await tx
      .insert(schema.registry.entities)
      .values({
        entityId,
        source: 'derived',
        name: body.name,
        icon: body.icon,
        areaId,
        deviceId: device.id,
        isEnabled: body.isEnabled,
      })
      .returning({ id: schema.registry.entities.id });

    if (entity === undefined) {
      throw new ConflictError('Could not write the alias entity');
    }

    const [alias] = await tx
      .insert(schema.registry.aliases)
      .values({
        entityId: entity.id,
        behavesAs: type.id,
        customType: custom,
        parts: prepared.parts,
        isEnabled: body.isEnabled,
        createdBy: identity.userId,
      })
      .returning({ id: schema.registry.aliases.id });

    if (alias === undefined) {
      throw new ConflictError('Could not write the alias');
    }

    await writeDerived(tx, alias.id, entity.id, prepared);

    return alias.id;
  });

  await syncOnCore(context, entityId);

  return readAlias(db, id);
}

/**
 * Changes an alias. Its type and its entity id never change.
 *
 * @param context - The database, the bus and the log.
 * @param id - The alias.
 * @param body - What to change.
 * @param identity - Who is changing it.
 * @returns The alias before and after, for the audit's Diff.
 * @throws {PermissionError} When the code changes while developer mode is off.
 */
export async function updateAlias(
  context: AliasesContext,
  id: string,
  body: AliasUpdate,
  identity: Identity,
): Promise<{ readonly before: AliasView; readonly after: AliasView }> {
  const { db } = context;
  const before = await readAlias(db, id);
  const type = aliasType(before.behavesAs);
  const parts = body.parts ?? before.parts;
  const code = body.code ?? before.code;
  /**
   * Which parts come from which function, as one text to compare.
   *
   * @param from - The parts.
   * @returns The code parts and their functions.
   */
  const codeParts = (from: AliasParts): string =>
    JSON.stringify(
      Object.entries(from)
        .filter(([, config]) => config.from === 'code')
        .map(([key, config]) => [key, config.from === 'code' ? config.function : '']),
    );

  if (
    (code !== before.code || codeParts(parts) !== codeParts(before.parts)) &&
    !(await isDeveloperMode(db))
  ) {
    throw new PermissionError('Code can be changed only in developer mode', {
      details: { setting: 'system.developer_mode' },
    });
  }

  const prepared =
    body.parts === undefined && body.code === undefined
      ? undefined
      : await prepare(db, identity, before.entityId, type, before.customType, parts, code);
  const display = body.display ?? before.display;

  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ rowId: schema.registry.aliases.entityId })
      .from(schema.registry.aliases)
      .where(eq(schema.registry.aliases.id, id));

    if (row === undefined) {
      throw new NotFoundError('Alias not found', { details: { id } });
    }

    await tx
      .update(schema.registry.aliases)
      .set({
        ...(prepared === undefined ? {} : { parts: prepared.parts, code: prepared.code }),
        ...(body.cases === undefined ? {} : { cases: body.cases }),
        ...(body.memory === undefined ? {} : { memory: body.memory }),
        ...(body.isEnabled === undefined ? {} : { isEnabled: body.isEnabled }),
        ...(body.ifOneStops === undefined ? {} : { fallbackPolicy: body.ifOneStops }),
        ...(body.debounceMs === undefined ? {} : { debounceMs: body.debounceMs }),
        display,
        ...(prepared === undefined && body.isEnabled !== false ? {} : { lastError: null }),
      })
      .where(eq(schema.registry.aliases.id, id));

    const areaId =
      body.area === undefined || !before.device.isVirtual
        ? undefined
        : await areaIdOf(db, body.area);

    await tx
      .update(schema.registry.entities)
      .set({
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.icon === undefined ? {} : { icon: body.icon }),
        ...(areaId === undefined ? {} : { areaId }),
        ...(body.isEnabled === undefined ? {} : { isEnabled: body.isEnabled }),
        unitOfMeasurement: display.unit,
        deviceClass: display.deviceClass,
        displayPrecision: display.precision,
        updatedAt: new Date(),
      })
      .where(eq(schema.registry.entities.id, row.rowId));

    if (prepared !== undefined) {
      await writeDerived(tx, id, row.rowId, prepared);
    }
  });

  await syncOnCore(context, before.entityId);

  return { before, after: await readAlias(db, id) };
}

/**
 * Makes a copy of an alias on the same device, under another name; its code's memory starts
 * empty.
 *
 * @param context - The database, the bus and the log.
 * @param id - The alias to copy.
 * @param name - The copy's name.
 * @param identity - Who is copying it.
 * @returns The copy.
 */
export async function duplicateAlias(
  context: AliasesContext,
  id: string,
  name: string,
  identity: Identity,
): Promise<AliasView> {
  const source = await readAlias(context.db, id);
  const copy = await createAlias(
    context,
    {
      name,
      icon: source.icon,
      area: source.area?.key ?? null,
      behavesAs: source.behavesAs,
      customType: source.customType,
      device: { kind: 'device', deviceId: source.device.id },
      parts: source.parts,
      isEnabled: source.isEnabled,
    },
    identity,
  );

  if (source.code === '' && source.cases.length === 0) {
    return copy;
  }

  // The code goes in as the original's: copying is not writing new code.
  await context.db
    .update(schema.registry.aliases)
    .set({ code: source.code, cases: source.cases, display: source.display })
    .where(eq(schema.registry.aliases.id, copy.id));
  await syncOnCore(context, copy.entityId);

  return readAlias(context.db, copy.id);
}

/**
 * Deletes an alias through `core`, saying what stopped working.
 *
 * @param context - The database, the bus and the log.
 * @param id - The alias.
 * @returns What it was, and what used it.
 * @throws {DeviceUnavailableError} When `core` cannot be reached: it must forget the alias in
 * the same step as its rows go.
 */
export async function deleteAlias(
  context: AliasesContext,
  id: string,
): Promise<{ readonly alias: AliasView; readonly usedBy: AliasUsedBy }> {
  const alias = await readAlias(context.db, id);
  const usedBy = await usedByOf(context.db, alias.entityId);

  if (context.bus === undefined) {
    throw new DeviceUnavailableError('Core is not reachable to delete the alias', {
      details: { entityId: alias.entityId },
    });
  }

  await context.bus.request(
    busSubjects.service(CORE_SERVICE, CORE_REMOVE_ALIAS_METHOD),
    { entityId: alias.entityId },
    removeAliasReplySchema,
    { traceId: context.traceId, timeoutMs: context.timeoutMs },
  );

  return { alias, usedBy };
}

/**
 * An alias's entry in a file.
 *
 * @param alias - The alias.
 * @returns The entry.
 */
export function entryOf(alias: AliasView): AliasFileEntry {
  return aliasFileEntry(alias, alias.device.isVirtual ? (alias.area?.key ?? null) : null);
}

/**
 * The file of some aliases, or of all.
 *
 * @param db - The database.
 * @param ids - The aliases; all when empty.
 * @returns The file.
 */
export async function exportAliases(db: Database, ids: readonly string[]): Promise<AliasFile> {
  const rows = await aliasRows(
    db,
    ids.length === 0 ? undefined : inArray(schema.registry.aliases.id, [...ids]),
  );
  const reads = await readsOf(
    db,
    rows.map((row) => row.id),
  );

  return aliasesFile(rows.map((row) => entryOf(toView(row, reads.get(row.id) ?? []))));
}

/** What an import takes: the file, the aliases picked from it, and replacements for entities. */
export type AliasImport = {
  readonly file: AliasFile;
  readonly picks: readonly string[];
  readonly replacements: Readonly<Record<string, string>>;
};

/**
 * Imports aliases from a file: each picked one replaces the alias of its key, or is created.
 *
 * @param context - The database, the bus and the log.
 * @param body - The file, the picks and the replacements.
 * @param identity - Who is importing.
 * @returns How many were created and replaced, with the views.
 */
export async function importAliases(
  context: AliasesContext,
  body: AliasImport,
  identity: Identity,
): Promise<{
  readonly created: AliasView[];
  readonly replaced: { before: AliasView; after: AliasView }[];
}> {
  const created: AliasView[] = [];
  const replaced: { before: AliasView; after: AliasView }[] = [];
  const picked = body.file.aliases.filter((entry) => body.picks.includes(entry.key));

  if (
    picked.some((entry) => aliasEntryCode(entry) !== '') &&
    !(await isDeveloperMode(context.db))
  ) {
    throw new PermissionError('Aliases with code can be imported only in developer mode', {
      details: { setting: 'system.developer_mode' },
    });
  }

  for (const original of picked) {
    let entry = original;

    for (const [from, to] of Object.entries(body.replacements)) {
      entry = replaceAliasEntity(entry, from, to);
    }

    // eslint-disable-next-line no-await-in-loop -- one alias at a time, each checked on its own
    const [existing] = await aliasRows(
      context.db,
      eq(schema.registry.entities.entityId, formatEntityId('alias', entry.key)),
    );

    if (existing !== undefined) {
      replaced.push(
        // eslint-disable-next-line no-await-in-loop -- as above
        await updateAlias(
          context,
          existing.id,
          {
            name: entry.name,
            icon: entry.icon,
            ...(entry.area === null ? {} : { area: entry.area }),
            isEnabled: entry.isEnabled,
            parts: entry.parts,
            code: aliasEntryCode(entry),
            cases: entry.cases,
            ifOneStops: entry.ifOneStops,
            debounceMs: entry.debounceMs,
            display: entry.display,
          },
          identity,
        ),
      );
      continue;
    }

    // eslint-disable-next-line no-await-in-loop -- as above
    const device = await deviceOfEntry(context.db, entry);
    // eslint-disable-next-line no-await-in-loop -- as above
    const view = await createAlias(
      context,
      {
        name: entry.name,
        icon: entry.icon,
        area: entry.area,
        behavesAs: entry.behavesAs,
        customType: entry.customType,
        device,
        parts: entry.parts,
        isEnabled: entry.isEnabled,
      },
      identity,
    );
    // eslint-disable-next-line no-await-in-loop -- as above
    await context.db
      .update(schema.registry.aliases)
      .set({
        code: aliasEntryCode(entry),
        cases: entry.cases,
        display: entry.display,
        fallbackPolicy: entry.ifOneStops,
        debounceMs: entry.debounceMs,
      })
      .where(eq(schema.registry.aliases.id, view.id));
    // eslint-disable-next-line no-await-in-loop -- as above
    await syncOnCore(context, view.entityId);
    // eslint-disable-next-line no-await-in-loop -- as above
    created.push(await readAlias(context.db, view.id));
  }

  return { created, replaced };
}

/**
 * The device an entry of a file goes on: the shared one, a virtual one by name (made when it is
 * not there), or a real one by name (the shared one when it is not in the house).
 *
 * @param db - The database.
 * @param entry - The entry.
 * @returns The device.
 */
async function deviceOfEntry(db: Database, entry: AliasFileEntry): Promise<AliasDeviceInput> {
  if (entry.device === 'aliases') {
    return { kind: 'shared' };
  }

  const isVirtual = 'virtual' in entry.device;
  const name = 'virtual' in entry.device ? entry.device.virtual : entry.device.device;
  const [row] = await db
    .select({ id: schema.registry.devices.id })
    .from(schema.registry.devices)
    .where(
      and(
        eq(schema.registry.devices.name, name),
        isVirtual
          ? eq(schema.registry.devices.source, 'virtual')
          : sql`${schema.registry.devices.source} <> 'virtual'`,
      ),
    );

  if (row !== undefined) {
    return { kind: 'device', deviceId: row.id };
  }

  return isVirtual ? { kind: 'new', name } : { kind: 'shared' };
}

/**
 * The changes made to an alias's setup, newest first, from the audit trail.
 *
 * @param db - The database.
 * @param id - The alias.
 * @param since - From when.
 * @returns The changes.
 */
export async function setupHistory(
  db: Database,
  id: string,
  since: Date,
): Promise<AliasSetupChange[]> {
  const rows = await db
    .select({
      time: schema.system.auditLog.time,
      actorLabel: schema.system.auditLog.actorLabel,
      actorType: schema.system.auditLog.actorType,
      action: schema.system.auditLog.action,
      details: schema.system.auditLog.details,
    })
    .from(schema.system.auditLog)
    .where(
      and(
        eq(schema.system.auditLog.resourceType, 'alias'),
        eq(schema.system.auditLog.resourceId, id),
        eq(schema.system.auditLog.result, 'success'),
        inArray(schema.system.auditLog.action, ['alias.create', 'alias.update', 'alias.import']),
        sql`${schema.system.auditLog.time} >= ${since.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(desc(schema.system.auditLog.time))
    .limit(200);

  return rows.map((row) => {
    const details = jsonObjectSchema.safeParse(row.details);
    const before = details.success
      ? jsonObjectSchema.nullable().safeParse(details.data['before'] ?? null)
      : undefined;
    const after = details.success
      ? jsonObjectSchema.nullable().safeParse(details.data['after'] ?? null)
      : undefined;

    return {
      at: row.time,
      by: row.actorType === 'user' ? row.actorLabel : null,
      action:
        row.action === 'alias.create'
          ? 'create'
          : row.action === 'alias.import'
            ? 'import'
            : 'update',
      before: before?.success === true ? before.data : null,
      after: after?.success === true ? after.data : null,
    };
  });
}

/**
 * An alias's setup as the audit keeps it: its file entry, as JSON.
 *
 * @param alias - The alias.
 * @returns The entry, as a JSON object.
 */
export function auditEntryOf(alias: AliasView): JsonObject {
  return JSON.parse(JSON.stringify(entryOf(alias))) as JsonObject;
}
