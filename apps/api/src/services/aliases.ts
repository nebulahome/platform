/**
 * Creating, updating, deleting and previewing aliases.
 *
 * An alias is an `alias.*` entity owned by the platform (`source: derived`) plus a row in
 * `registry.aliases`. Calculated aliases carry a formula and sources; stored helpers carry an
 * empty expression and accept commands in core. Every source on create, update and preview
 * requires `entity:read` on that entity; refusals never include the source value.
 *
 * **Where each write happens.** The API writes a definition - the entity row, the alias row,
 * its sources and capabilities - and then asks `core` to take it in, the way a device's row is
 * written here and completed there: `core` holds the directory commands are routed by and the
 * catalogue formulas are recomputed from, and neither learns about a row written behind its
 * back. The state is never written here: a helper's resting state and a formula's first value
 * come from `core`, the one writer of entity state (ARCHITECTURE.md 4.3). Removing an alias
 * goes the other way, through `core`, because the entity must leave its memory in the same
 * step as its rows.
 */
import { asc, eq, inArray, sql } from 'drizzle-orm';

import type { BusClient } from '@nebulahome/bus';
import {
  aliasScalarFromState,
  aliasViewSchema,
  busSubjects,
  capabilityStateSchema,
  ConflictError,
  CORE_REMOVE_ALIAS_METHOD,
  CORE_SERVICE,
  CORE_SYNC_ALIAS_METHOD,
  DeviceUnavailableError,
  evaluateAliasExpression,
  formatEntityId,
  NotFoundError,
  PermissionError,
  removeAliasReplySchema,
  storedHelperCapabilityIssues,
  syncAliasReplySchema,
  ValidationError,
  type AliasCreate,
  type AliasFallbackPolicy,
  type AliasPreviewRequest,
  type AliasPreviewResponse,
  type AliasSourceInput,
  type AliasStoredDomain,
  type AliasUpdate,
  type AliasView,
  type CapabilityName,
  type EntityId,
  type Identity,
  type JsonObject,
} from '@nebulahome/contracts';
import { schema, type Database } from '@nebulahome/db';
import type { PlatformLogger } from '@nebulahome/logging';

import { entityScopes, isPermitted } from '../auth/permissions.js';

import { readTagKeys } from './entities.js';

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

/** Config stored on the entity row for helper metadata. */
type AliasEntityConfig = {
  readonly alias?: {
    readonly domain?: string;
    readonly min?: number | null;
    readonly max?: number | null;
    readonly step?: number | null;
  };
};

/** One alias → source edge, by entity id. */
type AliasEdge = {
  readonly aliasEntityId: string;
  readonly sourceEntityId: string;
};

/** The area an entity is in: its own, or failing that its device's. */
const EFFECTIVE_AREA_ID = sql`coalesce(${schema.registry.entities.areaId}, ${schema.registry.devices.areaId})`;

/**
 * Finds a cycle among alias → source edges.
 *
 * @param edges - aliasEntityId reads sourceEntityId.
 * @returns The cycle path with the first node repeated at the end, or null.
 */
function findCycle(edges: readonly AliasEdge[]): string[] | null {
  const adjacency = new Map<string, string[]>();

  for (const edge of edges) {
    adjacency.set(edge.aliasEntityId, [
      ...(adjacency.get(edge.aliasEntityId) ?? []),
      edge.sourceEntityId,
    ]);
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

    for (const source of adjacency.get(node) ?? []) {
      const cycle = adjacency.has(source) ? visit(source) : null;

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
 * Derives a display domain when config does not name one.
 *
 * @param capability - Primary capability.
 * @param capabilities - All declared capabilities.
 * @returns A behavioural domain label.
 */
function deriveDomain(capability: CapabilityName, capabilities: readonly CapabilityName[]): string {
  if (capabilities.includes('cover')) {
    return 'cover';
  }

  if (capabilities.includes('lock')) {
    return 'lock';
  }

  if (capabilities.includes('thermostat')) {
    return 'climate';
  }

  if (capabilities.includes('media_player')) {
    return 'media_player';
  }

  if (
    capabilities.includes('level') ||
    capabilities.includes('color_hs') ||
    capabilities.includes('color_temp')
  ) {
    return 'light';
  }

  if (capability === 'on_off') {
    return 'switch';
  }

  if (capability === 'sensor_binary') {
    return 'binary_sensor';
  }

  return 'sensor';
}

/**
 * Refuses a source list that names one variable twice.
 *
 * @param sources - Proposed sources.
 * @throws {ValidationError} When two sources share a variable name.
 */
function assertUniqueVariables(sources: readonly AliasSourceInput[]): void {
  if (new Set(sources.map((source) => source.variableName)).size !== sources.length) {
    throw new ValidationError('Each source variable name must be unique', {
      details: { issues: [{ path: 'sources', message: 'A variable name is used twice' }] },
    });
  }
}

/**
 * Ensures the caller may read every source entity. Refusals never include state values.
 *
 * @param db - The database.
 * @param identity - Who is asking.
 * @param sources - Proposed sources.
 * @returns Map of entity id text → row uuid.
 * @throws {NotFoundError} When a source names no entity.
 * @throws {PermissionError} When the caller may not read one of them.
 */
async function requireReadableSources(
  db: Database,
  identity: Identity,
  sources: readonly AliasSourceInput[],
): Promise<Map<string, string>> {
  const entityIds = [...new Set(sources.map((source) => source.entityId))];
  const rows =
    entityIds.length === 0
      ? []
      : await db
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
          .where(inArray(schema.registry.entities.entityId, entityIds));

  const byId = new Map(rows.map((row) => [row.entityId, row]));
  const tags = await readTagKeys(db, rows);
  const rowIdByEntityId = new Map<string, string>();

  for (const source of sources) {
    const row = byId.get(source.entityId);

    if (row === undefined) {
      throw new NotFoundError('A source entity was not found', {
        details: { entityId: source.entityId },
      });
    }

    if (
      !isPermitted(
        identity.permissions,
        'entity:read',
        entityScopes(row.entityId, row.areaKey, tags.get(row.rowId) ?? []),
      )
    ) {
      throw new PermissionError('This action requires entity:read on every alias source', {
        details: { permission: 'entity:read', entityId: source.entityId },
      });
    }

    rowIdByEntityId.set(source.entityId, row.rowId);
  }

  return rowIdByEntityId;
}

/**
 * Loads every existing alias → source edge as entity ids.
 *
 * @param db - The database.
 * @returns The edges.
 */
async function loadAliasEdges(db: Database): Promise<AliasEdge[]> {
  return db
    .select({
      aliasEntityId: sql<string>`alias_entity.entity_id`,
      sourceEntityId: sql<string>`src_entity.entity_id`,
    })
    .from(schema.registry.aliasSources)
    .innerJoin(
      schema.registry.aliases,
      eq(schema.registry.aliases.id, schema.registry.aliasSources.aliasId),
    )
    .innerJoin(
      sql`registry.entities AS alias_entity`,
      sql`alias_entity.id = ${schema.registry.aliases.entityId}`,
    )
    .innerJoin(
      sql`registry.entities AS src_entity`,
      sql`src_entity.id = ${schema.registry.aliasSources.entityId}`,
    );
}

/**
 * Rejects a proposed source set when it would introduce a cycle.
 *
 * @param db - The database.
 * @param aliasEntityId - The alias being created or updated.
 * @param sources - Its sources.
 * @param replaceExisting - When true, drop edges from this alias before adding the new ones.
 * @throws {ValidationError} Naming the cycle, when there would be one.
 */
async function assertNoCycle(
  db: Database,
  aliasEntityId: string,
  sources: readonly AliasSourceInput[],
  replaceExisting: boolean,
): Promise<void> {
  const existing = await loadAliasEdges(db);
  const edges = [
    ...(replaceExisting
      ? existing.filter((edge) => edge.aliasEntityId !== aliasEntityId)
      : existing),
    ...sources.map((source) => ({ aliasEntityId, sourceEntityId: source.entityId })),
  ];
  const cycle = findCycle(edges);

  if (cycle !== null) {
    throw new ValidationError('Alias sources form a cycle', { details: { path: cycle } });
  }
}

/**
 * Asks `core` to take in an alias whose rows were just written.
 *
 * Best effort, as a hub reload is: the write has happened and is not undone by a silence. A
 * `core` that does not answer is logged, and loads the alias when it next starts.
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
 * Lists aliases, each with the entities its formula reads.
 *
 * @param db - The database.
 * @returns The aliases, by the identifier of the entity they produce.
 */
export async function listAliases(db: Database): Promise<AliasView[]> {
  const rows = await db
    .select({
      id: schema.registry.aliases.id,
      rowEntityId: schema.registry.aliases.entityId,
      entityId: schema.registry.entities.entityId,
      name: schema.registry.entities.name,
      capability: schema.registry.aliases.capability,
      expression: schema.registry.aliases.expression,
      debounceMs: schema.registry.aliases.debounceMs,
      fallbackPolicy: schema.registry.aliases.fallbackPolicy,
      isEnabled: schema.registry.aliases.isEnabled,
      lastError: schema.registry.aliases.lastError,
      lastEvaluatedAt: schema.registry.aliases.lastEvaluatedAt,
      unitOfMeasurement: schema.registry.entities.unitOfMeasurement,
      deviceClass: schema.registry.entities.deviceClass,
      config: schema.registry.entities.config,
    })
    .from(schema.registry.aliases)
    .innerJoin(
      schema.registry.entities,
      eq(schema.registry.entities.id, schema.registry.aliases.entityId),
    )
    .orderBy(asc(schema.registry.entities.entityId));

  if (rows.length === 0) {
    return [];
  }

  const rowIds = rows.map((row) => row.rowEntityId);

  const [sourceRows, capabilityRows] = await Promise.all([
    db
      .select({
        aliasId: schema.registry.aliasSources.aliasId,
        variableName: schema.registry.aliasSources.variableName,
        entityId: schema.registry.entities.entityId,
        entityName: schema.registry.entities.name,
        areaName: schema.registry.areas.name,
      })
      .from(schema.registry.aliasSources)
      .innerJoin(
        schema.registry.entities,
        eq(schema.registry.entities.id, schema.registry.aliasSources.entityId),
      )
      .leftJoin(
        schema.registry.devices,
        eq(schema.registry.devices.id, schema.registry.entities.deviceId),
      )
      .leftJoin(schema.registry.areas, eq(schema.registry.areas.id, EFFECTIVE_AREA_ID))
      .where(
        inArray(
          schema.registry.aliasSources.aliasId,
          rows.map((row) => row.id),
        ),
      ),
    db
      .select({
        entityId: schema.registry.entityCapabilities.entityId,
        capability: schema.registry.entityCapabilities.capability,
      })
      .from(schema.registry.entityCapabilities)
      .where(inArray(schema.registry.entityCapabilities.entityId, rowIds)),
  ]);

  const sourcesByAlias = new Map<string, unknown[]>();

  for (const row of sourceRows) {
    sourcesByAlias.set(row.aliasId, [
      ...(sourcesByAlias.get(row.aliasId) ?? []),
      {
        variableName: row.variableName,
        entityId: row.entityId,
        entityName: row.entityName,
        areaName: row.areaName,
      },
    ]);
  }

  const capsByRow = new Map<string, CapabilityName[]>();

  for (const row of capabilityRows) {
    // `entity_capabilities_known` restricts the column to the contract's names.
    capsByRow.set(row.entityId, [
      ...(capsByRow.get(row.entityId) ?? []),
      row.capability as CapabilityName,
    ]);
  }

  return rows.map((row) => {
    const config = (row.config ?? {}) as AliasEntityConfig;
    const capability = row.capability as CapabilityName;
    const capabilities = capsByRow.get(row.rowEntityId) ?? [capability];

    return aliasViewSchema.parse({
      id: row.id,
      entityId: row.entityId,
      name: row.name,
      kind: row.expression === '' ? 'stored' : 'calculated',
      domain: config.alias?.domain ?? deriveDomain(capability, capabilities),
      capability,
      capabilities,
      expression: row.expression,
      debounceMs: row.debounceMs,
      fallbackPolicy: row.fallbackPolicy,
      isEnabled: row.isEnabled,
      lastError: row.lastError,
      lastEvaluatedAt: row.lastEvaluatedAt,
      unitOfMeasurement: row.unitOfMeasurement,
      deviceClass: row.deviceClass,
      min: config.alias?.min ?? null,
      max: config.alias?.max ?? null,
      step: config.alias?.step ?? null,
      sources: sourcesByAlias.get(row.id) ?? [],
    });
  });
}

/**
 * Reads one alias by id.
 *
 * @param db - The database.
 * @param id - The aliases row id.
 * @returns The view.
 * @throws {NotFoundError} When no alias has that id.
 */
async function readAlias(db: Database, id: string): Promise<AliasView> {
  const found = (await listAliases(db)).find((item) => item.id === id);

  if (found === undefined) {
    throw new NotFoundError('No alias has that id', { details: { id } });
  }

  return found;
}

/**
 * Creates an alias: its entity, the alias row, its sources and its capabilities - and then
 * has `core` take it in, which is where its first state comes from.
 *
 * @param context - The database, the bus to `core`, and the log.
 * @param body - What to create.
 * @param identity - Who is creating it (for source permission checks).
 * @returns The alias as it now stands.
 * @throws {ValidationError} When a variable is named twice, or the sources form a cycle.
 * @throws {PermissionError} When the caller may not read one of the sources.
 * @throws {ConflictError} When an entity already has that id.
 */
export async function createAlias(
  context: AliasesContext,
  body: AliasCreate,
  identity: Identity,
): Promise<AliasView> {
  const { db } = context;
  const entityId = formatEntityId('alias', body.objectId);
  const sources = body.kind === 'calculated' ? body.sources : [];

  assertUniqueVariables(sources);

  const sourceRowIds = await requireReadableSources(db, identity, sources);

  if (sources.length > 0) {
    await assertNoCycle(db, entityId, sources, false);
  }

  const [existing] = await db
    .select({ id: schema.registry.entities.id })
    .from(schema.registry.entities)
    .where(eq(schema.registry.entities.entityId, entityId))
    .limit(1);

  if (existing !== undefined) {
    throw new ConflictError('An entity already has that id', { details: { entityId } });
  }

  const capabilityInputs: readonly { capability: CapabilityName; params: JsonObject }[] =
    body.kind === 'calculated' ? [{ capability: body.capability, params: {} }] : body.capabilities;
  const [primary] = capabilityInputs;

  if (primary === undefined) {
    throw new ValidationError('An alias declares at least one capability');
  }

  const aliasConfig: AliasEntityConfig = {
    alias: {
      domain:
        body.kind === 'stored'
          ? body.domain
          : deriveDomain(primary.capability, [primary.capability]),
      ...(body.kind === 'stored' && body.min !== undefined ? { min: body.min } : {}),
      ...(body.kind === 'stored' && body.max !== undefined ? { max: body.max } : {}),
      ...(body.kind === 'stored' && body.step !== undefined ? { step: body.step } : {}),
    },
  };

  const aliasId = await db.transaction(async (tx) => {
    const [entity] = await tx
      .insert(schema.registry.entities)
      .values({
        entityId,
        source: 'derived',
        name: body.name,
        unitOfMeasurement: body.unitOfMeasurement ?? null,
        deviceClass: body.kind === 'calculated' ? (body.deviceClass ?? null) : null,
        isEnabled: body.isEnabled,
        config: aliasConfig,
      })
      .returning({ id: schema.registry.entities.id });

    if (entity === undefined) {
      throw new ConflictError('An entity already has that id', { details: { entityId } });
    }

    const fallbackPolicy: AliasFallbackPolicy =
      body.kind === 'calculated' ? body.fallbackPolicy : 'unavailable';

    const [alias] = await tx
      .insert(schema.registry.aliases)
      .values({
        entityId: entity.id,
        capability: primary.capability,
        expression: body.kind === 'calculated' ? body.expression : '',
        debounceMs: body.kind === 'calculated' ? body.debounceMs : 0,
        fallbackPolicy,
        isEnabled: body.isEnabled,
        createdBy: identity.userId,
      })
      .returning({ id: schema.registry.aliases.id });

    if (alias === undefined) {
      throw new ConflictError('Could not create the alias');
    }

    if (sources.length > 0) {
      await tx.insert(schema.registry.aliasSources).values(
        sources.map((source) => ({
          aliasId: alias.id,
          variableName: source.variableName,
          entityId: sourceRowIdOf(sourceRowIds, source),
        })),
      );
    }

    await tx.insert(schema.registry.entityCapabilities).values(
      capabilityInputs.map((entry) => ({
        entityId: entity.id,
        capability: entry.capability,
        params: entry.params,
      })),
    );

    return alias.id;
  });

  await syncOnCore(context, entityId);

  return readAlias(db, aliasId);
}

/**
 * The row id of a source, as {@link requireReadableSources} resolved it.
 *
 * @param rowIds - What the check resolved.
 * @param source - The source.
 * @returns Its entity's row id.
 * @throws {NotFoundError} When the check did not resolve it, which it always does.
 */
function sourceRowIdOf(rowIds: ReadonlyMap<string, string>, source: AliasSourceInput): string {
  const rowId = rowIds.get(source.entityId);

  if (rowId === undefined) {
    throw new NotFoundError('A source entity was not found', {
      details: { entityId: source.entityId },
    });
  }

  return rowId;
}

/**
 * Refuses an update that does not fit the kind of alias it is changing.
 *
 * A stored helper has no formula and no sources; a calculated alias has no capabilities of its
 * own to change - its capability is the kind of reading it produces, fixed at creation. A
 * helper's capabilities must still suit its domain, and its bounds must still be in order.
 *
 * @param current - The alias as it stands.
 * @param body - What the request would change.
 * @throws {ValidationError} Naming what does not fit.
 */
function assertUpdateFits(current: AliasView, body: AliasUpdate): void {
  if (current.kind === 'stored' && (body.expression !== undefined || body.sources !== undefined)) {
    throw new ValidationError('A stored helper has no formula and no sources');
  }

  if (current.kind === 'calculated' && body.capabilities !== undefined) {
    throw new ValidationError('A calculated alias keeps the capability it was created with');
  }

  if (body.capabilities !== undefined) {
    const issues = storedHelperCapabilityIssues(
      // Written from `ALIAS_STORED_DOMAINS` when the helper was created, and never changed.
      current.domain as AliasStoredDomain,
      body.capabilities.map((entry) => entry.capability),
    );

    if (issues.length > 0) {
      throw new ValidationError('Those capabilities do not suit the helper', {
        details: { issues: issues.map((message) => ({ path: 'capabilities', message })) },
      });
    }
  }

  const min = body.min === undefined ? current.min : body.min;
  const max = body.max === undefined ? current.max : body.max;

  if (min !== null && max !== null && min > max) {
    throw new ValidationError('min must not exceed max', {
      details: { issues: [{ path: 'min', message: 'min must not exceed max' }] },
    });
  }
}

/**
 * Updates an alias, and has `core` take the change in. The entity id is immutable.
 *
 * @param context - The database, the bus to `core`, and the log.
 * @param id - Which alias.
 * @param body - Fields to change.
 * @param identity - Who is changing it.
 * @returns The alias as it now stands.
 * @throws {NotFoundError} When no alias has that id.
 * @throws {ValidationError} When the change does not fit the alias, or would make a cycle.
 * @throws {PermissionError} When the caller may not read one of the new sources.
 */
export async function updateAlias(
  context: AliasesContext,
  id: string,
  body: AliasUpdate,
  identity: Identity,
): Promise<AliasView> {
  const { db } = context;
  const current = await readAlias(db, id);

  assertUpdateFits(current, body);

  const nextSources = body.sources ?? [];

  if (body.sources !== undefined) {
    assertUniqueVariables(body.sources);
  }

  const sourceRowIds = await requireReadableSources(db, identity, nextSources);

  if (body.sources !== undefined) {
    await assertNoCycle(db, current.entityId, body.sources, true);
  }

  await db.transaction(async (tx) => {
    const [aliasRow] = await tx
      .update(schema.registry.aliases)
      .set({
        ...(body.expression === undefined ? {} : { expression: body.expression }),
        ...(body.debounceMs === undefined ? {} : { debounceMs: body.debounceMs }),
        ...(body.fallbackPolicy === undefined ? {} : { fallbackPolicy: body.fallbackPolicy }),
        ...(body.isEnabled === undefined ? {} : { isEnabled: body.isEnabled }),
        ...(body.capabilities?.[0] === undefined
          ? {}
          : { capability: body.capabilities[0].capability }),
        updatedAt: new Date(),
      })
      .where(eq(schema.registry.aliases.id, id))
      .returning({ entityId: schema.registry.aliases.entityId });

    if (aliasRow === undefined) {
      throw new NotFoundError('No alias has that id', { details: { id } });
    }

    const config: AliasEntityConfig = {
      alias: {
        domain: current.domain,
        min: body.min === undefined ? current.min : body.min,
        max: body.max === undefined ? current.max : body.max,
        step: body.step === undefined ? current.step : body.step,
      },
    };

    await tx
      .update(schema.registry.entities)
      .set({
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.unitOfMeasurement === undefined
          ? {}
          : { unitOfMeasurement: body.unitOfMeasurement }),
        ...(body.deviceClass === undefined ? {} : { deviceClass: body.deviceClass }),
        ...(body.isEnabled === undefined ? {} : { isEnabled: body.isEnabled }),
        config,
        updatedAt: new Date(),
      })
      .where(eq(schema.registry.entities.id, aliasRow.entityId));

    if (body.sources !== undefined) {
      await tx
        .delete(schema.registry.aliasSources)
        .where(eq(schema.registry.aliasSources.aliasId, id));

      await tx.insert(schema.registry.aliasSources).values(
        body.sources.map((source) => ({
          aliasId: id,
          variableName: source.variableName,
          entityId: sourceRowIdOf(sourceRowIds, source),
        })),
      );
    }

    if (body.capabilities !== undefined) {
      await tx
        .delete(schema.registry.entityCapabilities)
        .where(eq(schema.registry.entityCapabilities.entityId, aliasRow.entityId));

      await tx.insert(schema.registry.entityCapabilities).values(
        body.capabilities.map((entry) => ({
          entityId: aliasRow.entityId,
          capability: entry.capability,
          params: entry.params,
        })),
      );
    }
  });

  await syncOnCore(context, current.entityId);

  return readAlias(db, id);
}

/**
 * Deletes an alias and its entity, through `core`.
 *
 * Refused while another alias reads it. The refusal names those aliases only to a caller who
 * may see aliases; to anybody else it says that there are some.
 *
 * @param context - The database, the bus to `core`, and the log.
 * @param id - Which alias.
 * @param includeDependents - Whether the caller may see the aliases that block the deletion.
 * @returns The alias as it was.
 * @throws {NotFoundError} When no alias has that id.
 * @throws {DeviceUnavailableError} When the bus is away or `core` does not answer; nothing
 * has been deleted.
 * @throws {ConflictError} When another alias still reads it.
 */
export async function deleteAlias(
  context: AliasesContext,
  id: string,
  includeDependents: boolean,
): Promise<AliasView> {
  const current = await readAlias(context.db, id);

  if (context.bus === undefined) {
    throw new DeviceUnavailableError('The message bus is not reachable', { details: { id } });
  }

  try {
    await context.bus.request(
      busSubjects.service(CORE_SERVICE, CORE_REMOVE_ALIAS_METHOD),
      { entityId: current.entityId },
      removeAliasReplySchema,
      { traceId: context.traceId, timeoutMs: context.timeoutMs },
    );
  } catch (error: unknown) {
    if (error instanceof ConflictError && !includeDependents) {
      throw new ConflictError('Other aliases still read this one', {
        cause: error,
        details: { entityId: current.entityId },
      });
    }

    throw error;
  }

  return current;
}

/**
 * Evaluates a formula against current source states without saving.
 *
 * The same evaluator, and the same reading of each source, as the engine in `core`, so that a
 * preview says what the alias will do.
 *
 * @param db - The database.
 * @param body - Expression and sources.
 * @param identity - Who is asking (source permission checks).
 * @returns The preview result; errors never include source values.
 */
export async function previewAlias(
  db: Database,
  body: AliasPreviewRequest,
  identity: Identity,
): Promise<AliasPreviewResponse> {
  await requireReadableSources(db, identity, body.sources);

  const stateRows = await db
    .select({
      entityId: schema.registry.entities.entityId,
      state: schema.registry.entityStates.state,
      isAvailable: schema.registry.entityStates.isAvailable,
    })
    .from(schema.registry.entities)
    .leftJoin(
      schema.registry.entityStates,
      eq(schema.registry.entityStates.entityId, schema.registry.entities.id),
    )
    .where(
      inArray(
        schema.registry.entities.entityId,
        body.sources.map((source) => source.entityId),
      ),
    );

  const byId = new Map(stateRows.map((row) => [row.entityId, row]));
  const bindings = new Map<string, number | boolean | string>();

  for (const source of body.sources) {
    const row = byId.get(source.entityId);

    if (row?.isAvailable !== true) {
      if (body.fallbackPolicy === 'unavailable') {
        return { value: null, isAvailable: false, error: 'A source entity is unavailable' };
      }

      continue;
    }

    const state = capabilityStateSchema.safeParse(row.state);
    const scalar = state.success ? aliasScalarFromState(state.data) : undefined;

    if (scalar === undefined) {
      if (body.fallbackPolicy === 'unavailable') {
        return { value: null, isAvailable: false, error: 'A source entity has no usable reading' };
      }

      continue;
    }

    bindings.set(source.variableName, scalar);
  }

  const evaluated = evaluateAliasExpression(body.expression, bindings);

  if (!evaluated.ok) {
    return { value: null, isAvailable: false, error: evaluated.error };
  }

  return { value: evaluated.value, isAvailable: true, error: null };
}
