/**
 * Linking: one device reached two ways, and its readings each read as one entity.
 *
 * A device found twice - over its own transport and through the Matter broker - is linked by the
 * owner, never on its own: the house offers it, with the reasons, and the owner says yes. Of the
 * two devices the one the house had first is the one it shows; of two entities that read the same
 * thing, the one with the longer history leads, keeps its address and goes on recording, and the
 * other is linked to it and stops. Nothing that names either is rewritten: `core` reads the
 * address of an entity linked to another as that one, so an automation, a scene, a card follow,
 * and unlinking gives each back its own.
 *
 * Every change says first what it will do - which readings are linked, which stay one way, what
 * follows which address - so the dialog lists it before the owner confirms, and the same
 * function then does it. `core` is told afterwards, the way an alias is synced.
 */
import { and, asc, eq, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';

import {
  busSubjects,
  CORE_SERVICE,
  CORE_SYNC_LINKS_METHOD,
  linkPreviewSchema,
  MATTER_TRANSPORT,
  NotFoundError,
  syncLinksReplySchema,
  ValidationError,
  type IntegrationVendor,
  type LinkOrigin,
  type LinkPair,
  type LinkPreview,
  type LinkReason,
  type LinkSide,
  type LinkSuggestionView,
  type LinkUse,
} from '@nebulahome/contracts';
import { schema, type Database } from '@nebulahome/db';

import { linkHintOf } from './entities.js';
import { catalogueIfUp, vendorIdOf, type IntegrationsContext } from './integrations.js';
import { matchEntities, type MatchEntity } from './link-matching.js';

/** One way into a device, as linking reads it. */
type WayRow = {
  readonly rowId: string;

  /** The instance, which is the device's public id. */
  readonly id: string;
  readonly name: string;
  readonly model: string | null;
  readonly kind: string;
  readonly transport: string;
  readonly areaName: string | null;
  readonly createdAt: Date;
  readonly linkedTo: string | null;
  readonly linkedAt: Date | null;
  readonly preferredTransport: string | null;
  readonly linkRefused: [string, string][];
  readonly mac: string | null;
  readonly serialNumber: string | null;
};

/** One entity, as linking reads it. */
type EntityRow = {
  readonly rowId: string;
  readonly entityId: string;
  readonly name: string;
  readonly deviceRowId: string | null;
  readonly integrationId: string | null;
  readonly domain: string | null;
  readonly deviceClass: string | null;
  readonly unit: string | null;
  readonly stateClass: string | null;
  readonly config: unknown;
  readonly linkedTo: string | null;
  readonly linkOrigin: string | null;
  readonly linkedAt: Date | null;
  readonly transport: string | null;
  readonly createdAt: Date;
  readonly instanceTransport: string | null;
  readonly kind: string | null;
  readonly value: string | null;
};

/**
 * The columns a way into a device is read with.
 *
 * @returns The columns, by field.
 */
function wayColumns() {
  const { devices, integrations, areas } = schema.registry;

  return {
    rowId: devices.id,
    id: integrations.id,
    name: devices.name,
    model: sql<string | null>`coalesce(${devices.model}, ${integrations.model})`,
    kind: integrations.kind,
    transport: integrations.transport,
    areaName: areas.name,
    createdAt: devices.createdAt,
    linkedTo: devices.linkedTo,
    linkedAt: devices.linkedAt,
    preferredTransport: devices.preferredTransport,
    linkRefused: devices.linkRefused,
    mac: devices.mac,
    serialNumber: devices.serialNumber,
  };
}

/**
 * Reads ways into devices.
 *
 * @param db - The database.
 * @param where - Which.
 * @returns The ways, oldest first.
 */
async function readWays(db: Database, where: SQL | undefined): Promise<WayRow[]> {
  const { devices, integrations, areas } = schema.registry;

  return db
    .select(wayColumns())
    .from(devices)
    .innerJoin(integrations, eq(integrations.id, devices.integrationId))
    .leftJoin(areas, eq(areas.id, devices.areaId))
    .where(where)
    .orderBy(asc(devices.createdAt), asc(devices.id));
}

/**
 * Reads one way in by its instance.
 *
 * @param db - The database.
 * @param id - The device's public id.
 * @returns The way.
 * @throws {NotFoundError} When no integration device has that id.
 */
async function wayOf(db: Database, id: string): Promise<WayRow> {
  const [way] = await readWays(db, eq(schema.registry.integrations.id, id));

  if (way === undefined) {
    throw new NotFoundError('No device has that id', { details: { id } });
  }

  return way;
}

/** A linked device: the one the house shows, and the other ways into it. */
type Group = { readonly holder: WayRow; readonly others: readonly WayRow[] };

/**
 * Reads the linked device a way in belongs to.
 *
 * @param db - The database.
 * @param way - The way.
 * @returns The device the house shows, and every other way into it; no others when it is reached
 * one way.
 */
async function groupOf(db: Database, way: WayRow): Promise<Group> {
  const holder =
    way.linkedTo === null
      ? way
      : ((await readWays(db, eq(schema.registry.devices.id, way.linkedTo)))[0] ?? way);
  const others = await readWays(db, eq(schema.registry.devices.linkedTo, holder.rowId));

  return { holder, others };
}

/**
 * Reads the entities of some ways in.
 *
 * @param db - The database.
 * @param deviceRowIds - The ways' rows.
 * @returns Their entities, oldest first.
 */
async function entitiesOf(db: Database, deviceRowIds: readonly string[]): Promise<EntityRow[]> {
  if (deviceRowIds.length === 0) {
    return [];
  }

  const { entities, entityStates, integrations } = schema.registry;

  return db
    .select({
      rowId: entities.id,
      entityId: entities.entityId,
      name: entities.name,
      deviceRowId: entities.deviceId,
      integrationId: entities.integrationId,
      domain: entities.domain,
      deviceClass: entities.deviceClass,
      unit: entities.unitOfMeasurement,
      stateClass: entities.stateClass,
      config: entities.config,
      linkedTo: entities.linkedTo,
      linkOrigin: entities.linkOrigin,
      linkedAt: entities.linkedAt,
      transport: entities.transport,
      createdAt: entities.createdAt,
      instanceTransport: integrations.transport,
      kind: integrations.kind,
      value: sql<string | null>`${entityStates.state} -> 'sensor_numeric' ->> 'value'`,
    })
    .from(entities)
    .leftJoin(integrations, eq(integrations.id, entities.integrationId))
    .leftJoin(entityStates, eq(entityStates.entityId, entities.id))
    .where(inArray(entities.deviceId, [...deviceRowIds]))
    .orderBy(asc(entities.createdAt), asc(entities.id));
}

/**
 * The capabilities of some entities.
 *
 * @param db - The database.
 * @param rowIds - Their rows.
 * @returns Each one's capability names.
 */
async function capabilitiesOf(
  db: Database,
  rowIds: readonly string[],
): Promise<Map<string, string[]>> {
  const grouped = new Map<string, string[]>();

  if (rowIds.length === 0) {
    return grouped;
  }

  const rows = await db
    .select({
      rowId: schema.registry.entityCapabilities.entityId,
      capability: schema.registry.entityCapabilities.capability,
    })
    .from(schema.registry.entityCapabilities)
    .where(inArray(schema.registry.entityCapabilities.entityId, [...rowIds]));

  for (const row of rows) {
    grouped.set(row.rowId, [...(grouped.get(row.rowId) ?? []), row.capability]);
  }

  return grouped;
}

/**
 * An entity, the way linking compares it.
 *
 * @param row - Its row.
 * @param capabilities - What it declares.
 * @returns What {@link matchEntities} takes.
 */
function toMatch(row: EntityRow, capabilities: readonly string[]): MatchEntity {
  const value = row.value === null ? Number.NaN : Number(row.value);

  return {
    rowId: row.rowId,
    entityId: row.entityId,
    domain: row.domain ?? row.entityId.split('.')[0] ?? '',
    capabilities,
    deviceClass: row.deviceClass,
    unit: row.unit,
    stateClass: row.stateClass,
    matter: linkHintOf(row.config).matter,
    isMatter: row.instanceTransport === MATTER_TRANSPORT,
    value: Number.isFinite(value) ? value : null,
  };
}

/**
 * How an entity was linked.
 *
 * @param row - The entity linked to another.
 * @returns How; by hand when the row does not say.
 */
function originOf(row: EntityRow | undefined): LinkOrigin {
  const origin = row?.linkOrigin;

  return origin === 'declared' || origin === 'auto' ? origin : 'manual';
}

/** Nothing uses an address. */
const NO_USE: LinkUse = { automations: [], scenes: [], aliases: [], cards: [] };

/**
 * Whether a document names an address anywhere, as a whole string.
 *
 * @param value - The document.
 * @param address - The address.
 * @returns How many times it names it.
 */
function mentions(value: unknown, address: string): number {
  if (typeof value === 'string') {
    return value === address ? 1 : 0;
  }

  if (Array.isArray(value)) {
    return value.reduce<number>((count, each) => count + mentions(each, address), 0);
  }

  if (value !== null && typeof value === 'object') {
    return Object.values(value).reduce<number>((count, each) => count + mentions(each, address), 0);
  }

  return 0;
}

/**
 * What uses each of some entities: the automations, scenes and aliases that name it, and the
 * cards that show it.
 *
 * @param db - The database.
 * @param rows - The entities, by row and address.
 * @returns What uses each, by address.
 */
async function usesOf(
  db: Database,
  rows: readonly { readonly rowId: string; readonly entityId: string }[],
): Promise<Map<string, LinkUse>> {
  const used = new Map<string, LinkUse>();

  if (rows.length === 0) {
    return used;
  }

  const { automations, scenes, sceneEntities, aliases, aliasSources, entities, dashboards } =
    schema.registry;
  const rowIds = rows.map((row) => row.rowId);
  const [automationRows, sceneRows, aliasRows, dashboardRows] = await Promise.all([
    db.select({ name: automations.name, definition: automations.definition }).from(automations),
    db
      .select({ name: scenes.name, rowId: sceneEntities.entityId })
      .from(sceneEntities)
      .innerJoin(scenes, eq(scenes.id, sceneEntities.sceneId))
      .where(inArray(sceneEntities.entityId, rowIds)),
    db
      .select({ name: entities.name, rowId: aliasSources.entityId })
      .from(aliasSources)
      .innerJoin(aliases, eq(aliases.id, aliasSources.aliasId))
      .innerJoin(entities, eq(entities.id, aliases.entityId))
      .where(inArray(aliasSources.entityId, rowIds)),
    db.select({ name: dashboards.name, layout: dashboards.layout }).from(dashboards),
  ]);

  for (const row of rows) {
    used.set(row.entityId, {
      automations: automationRows
        .filter((automation) => mentions(automation.definition, row.entityId) > 0)
        .map((automation) => automation.name),
      scenes: [
        ...new Set(sceneRows.filter((scene) => scene.rowId === row.rowId).map((s) => s.name)),
      ],
      aliases: [
        ...new Set(aliasRows.filter((alias) => alias.rowId === row.rowId).map((a) => a.name)),
      ],
      cards: dashboardRows.flatMap((dashboard) => {
        const count = mentions(dashboard.layout, row.entityId);

        return count === 0 ? [] : [{ dashboard: dashboard.name, count }];
      }),
    });
  }

  return used;
}

/**
 * One entity in a link's account.
 *
 * @param row - The entity.
 * @param used - What uses each address.
 * @returns Its side.
 */
function sideOf(row: EntityRow, used: ReadonlyMap<string, LinkUse>): LinkSide {
  return {
    entityId: row.entityId as LinkSide['entityId'],
    name: row.name,
    deviceId: row.integrationId ?? '',
    vendorId: vendorIdOf(row.kind ?? ''),
    transport: row.instanceTransport ?? '',
    usedBy: used.get(row.entityId) ?? NO_USE,
  };
}

/**
 * A device in a link's account.
 *
 * @param way - The way in.
 * @returns What the dialog shows of it.
 */
function deviceOf(way: WayRow): LinkPreview['device'] {
  return {
    id: way.id,
    name: way.name,
    model: way.model,
    vendorId: vendorIdOf(way.kind),
    transport: way.transport,
    areaName: way.areaName,
  };
}

/**
 * Which of two entities leads: the one others already read through, else the one with the longer
 * history.
 *
 * @param a - One.
 * @param b - The other.
 * @param leading - The rows others already read through.
 * @returns The one that leads, then the other.
 */
function leadOf(a: EntityRow, b: EntityRow, leading: ReadonlySet<string>): [EntityRow, EntityRow] {
  if (leading.has(b.rowId) && !leading.has(a.rowId)) {
    return [b, a];
  }

  if (leading.has(a.rowId)) {
    return [a, b];
  }

  return a.createdAt.getTime() <= b.createdAt.getTime() ? [a, b] : [b, a];
}

/**
 * Tells `core` to take the links in again.
 *
 * @param context - The request's collaborators.
 * @param rowIds - The entities whose links changed.
 */
export async function syncLinksOnCore(
  context: IntegrationsContext,
  rowIds: readonly string[],
): Promise<void> {
  if (context.bus === undefined || rowIds.length === 0) {
    return;
  }

  try {
    await context.bus.request(
      busSubjects.service(CORE_SERVICE, CORE_SYNC_LINKS_METHOD),
      { entityRowIds: [...new Set(rowIds)].slice(0, 1024) },
      syncLinksReplySchema,
      { traceId: context.traceId, timeoutMs: context.timeoutMs },
    );
  } catch (error: unknown) {
    // The rows are written; `core` reads them all again when it next starts.
    context.logger.warn({ err: error }, 'core did not take in the links');
  }
}

/** What a link or an unlink will do, and the rows it writes. */
type Plan = {
  readonly preview: LinkPreview;
  readonly write: (db: Database) => Promise<string[]>;
};

/**
 * Plans linking two devices: the one the house had first is the one it shows, and their readings
 * are linked where the integration declares it or they read alike.
 *
 * @param context - The request's collaborators.
 * @param id - One device.
 * @param withId - The other way into it.
 * @returns What it will do, and how.
 * @throws {ValidationError} When the two are one already, of different vendors, or one is
 * already another way into a third.
 */
async function planDeviceLink(
  context: IntegrationsContext,
  id: string,
  withId: string,
): Promise<Plan> {
  const [first, second] = await Promise.all([wayOf(context.db, id), wayOf(context.db, withId)]);
  const [a, b] = await Promise.all([groupOf(context.db, first), groupOf(context.db, second)]);

  if (a.holder.rowId === b.holder.rowId) {
    throw new ValidationError('The two are one device already', { details: { id, withId } });
  }

  if (vendorIdOf(first.kind) !== vendorIdOf(second.kind)) {
    throw new ValidationError('Only devices of one integration can be linked', {
      details: { id, withId },
    });
  }

  if (a.others.length > 0 && b.others.length > 0) {
    throw new ValidationError('Both are linked to others already: unlink one first', {
      details: { id, withId },
    });
  }

  // The one others already go through, else the one the house had first.
  const keepFirst =
    b.others.length === 0 &&
    (a.others.length > 0 || a.holder.createdAt.getTime() <= b.holder.createdAt.getTime());
  const group = keepFirst ? a : b;
  const joining = keepFirst ? b.holder : a.holder;
  const holder = group.holder;
  const ways = [holder, ...group.others];

  const [kept, coming] = await Promise.all([
    entitiesOf(
      context.db,
      ways.map((way) => way.rowId),
    ),
    entitiesOf(context.db, [joining.rowId]),
  ]);
  const capabilities = await capabilitiesOf(
    context.db,
    [...kept, ...coming].map((row) => row.rowId),
  );
  const open = kept.filter((row) => row.linkedTo === null);
  const leading = new Set(kept.flatMap((row) => (row.linkedTo === null ? [] : [row.linkedTo])));
  const matched = matchEntities(
    open.map((row) => toMatch(row, capabilities.get(row.rowId) ?? [])),
    coming.map((row) => toMatch(row, capabilities.get(row.rowId) ?? [])),
    holder.linkRefused,
  );
  const byRow = new Map([...kept, ...coming].map((row) => [row.rowId, row]));
  const pairs = matched.pairs.flatMap((pair) => {
    const left = byRow.get(pair.a.rowId);
    const right = byRow.get(pair.b.rowId);

    return left === undefined || right === undefined
      ? []
      : [{ lead: leadOf(left, right, leading), origin: pair.origin }];
  });
  const paired = new Set(pairs.flatMap(({ lead }) => lead.map((row) => row.rowId)));
  const single = [...open.filter((row) => !leading.has(row.rowId)), ...coming].filter(
    (row) => !paired.has(row.rowId),
  );
  const used = await usesOf(
    context.db,
    pairs.flatMap(({ lead }) => lead),
  );

  const preview = linkPreviewSchema.parse({
    action: 'link',
    scope: 'device',
    device: deviceOf(holder),
    other: deviceOf(joining),
    pairs: pairs.map(({ lead, origin }): LinkPair => ({
      holder: sideOf(lead[0], used),
      others: [sideOf(lead[1], used)],
      origin,
    })),
    single: single.map((row) => sideOf(row, used)),
    preferred: {
      deviceId: holder.preferredTransport ?? holder.id,
      vendorId: vendorIdOf(holder.kind),
      transport:
        ways.find((way) => way.id === holder.preferredTransport)?.transport ?? holder.transport,
    },
    linkedSince: null,
  });

  return {
    preview,
    /**
     * Writes it, in one transaction.
     *
     * @param db - The database.
     * @returns The entities whose links changed.
     */
    write: async (db) => {
      const now = new Date();

      await db.transaction(async (tx) => {
        const { devices, entities, linkSuggestions } = schema.registry;

        await tx
          .update(devices)
          .set({ linkedTo: holder.rowId, linkedAt: now, updatedAt: now })
          .where(eq(devices.id, joining.rowId));
        await tx
          .update(devices)
          .set({ preferredTransport: holder.preferredTransport ?? holder.id, updatedAt: now })
          .where(eq(devices.id, holder.rowId));

        for (const { lead, origin } of pairs) {
          // eslint-disable-next-line no-await-in-loop -- one transaction, one statement at a time
          await tx
            .update(entities)
            .set({ linkedTo: lead[0].rowId, linkOrigin: origin, linkedAt: now, updatedAt: now })
            .where(eq(entities.id, lead[1].rowId));
        }

        // Offered no more: they are one now.
        await tx
          .delete(linkSuggestions)
          .where(
            or(
              and(
                eq(linkSuggestions.deviceA, holder.rowId),
                eq(linkSuggestions.deviceB, joining.rowId),
              ),
              and(
                eq(linkSuggestions.deviceA, joining.rowId),
                eq(linkSuggestions.deviceB, holder.rowId),
              ),
            ),
          );
      });

      return pairs.flatMap(({ lead }) => lead.map((row) => row.rowId));
    },
  };
}

/**
 * Plans unlinking a device: the way given leaves - every other way, when it is the device the
 * house shows - and each reading linked across goes back to its own entity.
 *
 * @param context - The request's collaborators.
 * @param id - The device.
 * @returns What it will do, and how.
 * @throws {ValidationError} When the device is reached one way.
 */
async function planDeviceUnlink(context: IntegrationsContext, id: string): Promise<Plan> {
  const way = await wayOf(context.db, id);
  const group = await groupOf(context.db, way);

  if (group.others.length === 0) {
    throw new ValidationError('The device is reached one way', { details: { id } });
  }

  const leaving = way.rowId === group.holder.rowId ? group.others : [way];
  const all = await entitiesOf(context.db, [
    group.holder.rowId,
    ...group.others.map((each) => each.rowId),
  ]);
  const leavingRows = new Set(leaving.map((each) => each.rowId));
  const byRow = new Map(all.map((row) => [row.rowId, row]));

  // Every pair with a side on a way that leaves.
  const children = all.filter((row) => {
    const lead = row.linkedTo === null ? undefined : byRow.get(row.linkedTo);

    return (
      lead !== undefined &&
      (leavingRows.has(row.deviceRowId ?? '') || leavingRows.has(lead.deviceRowId ?? ''))
    );
  });
  const pairs = groupPairs(children, byRow);
  const used = await usesOf(
    context.db,
    pairs.flatMap((pair) => [pair.lead, ...pair.others]),
  );
  const stays = group.holder;

  const preview = linkPreviewSchema.parse({
    action: 'unlink',
    scope: 'device',
    device: deviceOf(stays),
    other: deviceOf(leaving[0] ?? way),
    pairs: pairs.map((pair) => ({
      holder: sideOf(pair.lead, used),
      others: pair.others.map((row) => sideOf(row, used)),
      origin: originOf(pair.others[0]),
    })),
    single: [],
    preferred: { deviceId: stays.id, vendorId: vendorIdOf(stays.kind), transport: stays.transport },
    linkedSince: leaving[0]?.linkedAt ?? null,
  });

  return {
    preview,
    /**
     * Writes it, in one transaction.
     *
     * @param db - The database.
     * @returns The entities whose links changed.
     */
    write: async (db) => {
      const now = new Date();

      await db.transaction(async (tx) => {
        const { devices, entities } = schema.registry;

        if (children.length > 0) {
          await tx
            .update(entities)
            .set({ linkedTo: null, linkOrigin: null, linkedAt: null, updatedAt: now })
            .where(
              inArray(
                entities.id,
                children.map((row) => row.rowId),
              ),
            );
        }

        await tx
          .update(devices)
          .set({ linkedTo: null, linkedAt: null, updatedAt: now })
          .where(
            inArray(
              devices.id,
              leaving.map((each) => each.rowId),
            ),
          );

        const remaining = group.others.length - leaving.length;

        await tx
          .update(devices)
          .set(
            remaining === 0
              ? { preferredTransport: null, linkRefused: [], updatedAt: now }
              : { preferredTransport: stays.id, updatedAt: now },
          )
          .where(eq(devices.id, stays.rowId));
      });

      return children.flatMap((row) => [row.rowId, row.linkedTo ?? row.rowId]);
    },
  };
}

/**
 * Groups linked entities by the one they read through.
 *
 * @param children - The entities linked to others.
 * @param byRow - Every entity, by row.
 * @returns Each leading entity with those linked to it.
 */
function groupPairs(
  children: readonly EntityRow[],
  byRow: ReadonlyMap<string, EntityRow>,
): { lead: EntityRow; others: EntityRow[] }[] {
  const grouped = new Map<string, { lead: EntityRow; others: EntityRow[] }>();

  for (const child of children) {
    const lead = child.linkedTo === null ? undefined : byRow.get(child.linkedTo);

    if (lead !== undefined) {
      const entry = grouped.get(lead.rowId) ?? { lead, others: [] };

      entry.others.push(child);
      grouped.set(lead.rowId, entry);
    }
  }

  return [...grouped.values()];
}

/**
 * Reads an entity for linking, with the device it is reached through.
 *
 * @param db - The database.
 * @param entityId - Its address.
 * @returns The entity.
 * @throws {NotFoundError} When nothing has that address.
 */
async function entityByAddress(db: Database, entityId: string): Promise<EntityRow> {
  const { entities } = schema.registry;
  const [found] = await db
    .select({ deviceRowId: entities.deviceId })
    .from(entities)
    .where(eq(entities.entityId, entityId));
  const rows = found?.deviceRowId == null ? [] : await entitiesOf(db, [found.deviceRowId]);
  const row = rows.find((each) => each.entityId === entityId);

  if (row === undefined) {
    throw new NotFoundError(`No entity ${entityId}`, { details: { entityId } });
  }

  return row;
}

/**
 * The linked device an entity's device belongs to, and every entity of it.
 *
 * @param db - The database.
 * @param row - The entity.
 * @returns The device the house shows, its other ways in, and the entities of all of them.
 * @throws {ValidationError} When the entity is not on a device reached more than one way.
 */
async function entityGroupOf(
  db: Database,
  row: EntityRow,
): Promise<{ group: Group; entities: EntityRow[] }> {
  const [way] =
    row.deviceRowId === null
      ? []
      : await readWays(db, eq(schema.registry.devices.id, row.deviceRowId));

  if (way === undefined) {
    throw new ValidationError('The entity is not on a device', {
      details: { entityId: row.entityId },
    });
  }

  const group = await groupOf(db, way);

  if (group.others.length === 0) {
    throw new ValidationError('Its device is reached one way: there is nothing to link it to', {
      details: { entityId: row.entityId },
    });
  }

  return {
    group,
    entities: await entitiesOf(db, [group.holder.rowId, ...group.others.map((each) => each.rowId)]),
  };
}

/**
 * The way an entity is read first: its own choice, else its device's.
 *
 * @param lead - The entity.
 * @param group - Its device.
 * @returns The way.
 */
function preferredOf(lead: EntityRow, group: Group): LinkPreview['preferred'] {
  const ways = [group.holder, ...group.others];
  const id = lead.transport ?? group.holder.preferredTransport ?? group.holder.id;
  const way = ways.find((each) => each.id === id) ?? group.holder;

  return { deviceId: way.id, vendorId: vendorIdOf(way.kind), transport: way.transport };
}

/**
 * Plans linking two entities by hand.
 *
 * @param context - The request's collaborators.
 * @param entityId - One.
 * @param withId - The one that reads the same thing another way.
 * @returns What it will do, and how.
 * @throws {ValidationError} When they are not of one kind, on one device, reached two ways.
 */
async function planEntityLink(
  context: IntegrationsContext,
  entityId: string,
  withId: string,
): Promise<Plan> {
  const [first, second] = await Promise.all([
    entityByAddress(context.db, entityId),
    entityByAddress(context.db, withId),
  ]);
  const { group, entities } = await entityGroupOf(context.db, first);
  const byRow = new Map(entities.map((row) => [row.rowId, row]));
  const left = first.linkedTo === null ? first : (byRow.get(first.linkedTo) ?? first);

  if (!byRow.has(second.rowId)) {
    throw new ValidationError('Only entities of one device can be linked', {
      details: { entityId, withId },
    });
  }

  if (second.linkedTo !== null) {
    throw new ValidationError(`${withId} is linked already: unlink it first`, {
      details: { entityId, withId },
    });
  }

  if (left.rowId === second.rowId || (left.domain ?? '') !== (second.domain ?? '')) {
    throw new ValidationError('Only entities of the same kind can be linked', {
      details: { entityId, withId },
    });
  }

  const leading = new Set(entities.flatMap((row) => (row.linkedTo === null ? [] : [row.linkedTo])));
  const [lead, other] = leadOf(left, second, leading);

  if (leading.has(other.rowId)) {
    throw new ValidationError(`${other.entityId} has others linked to it: unlink them first`, {
      details: { entityId, withId },
    });
  }

  const used = await usesOf(context.db, [lead, other]);
  const preview = linkPreviewSchema.parse({
    action: 'link',
    scope: 'entity',
    device: null,
    other: null,
    pairs: [{ holder: sideOf(lead, used), others: [sideOf(other, used)], origin: 'manual' }],
    single: [],
    preferred: preferredOf(lead, group),
    linkedSince: null,
  });

  return {
    preview,
    /**
     * Writes it, in one transaction.
     *
     * @param db - The database.
     * @returns The entities whose links changed.
     */
    write: async (db) => {
      const now = new Date();
      const refused = group.holder.linkRefused.filter(
        ([a, b]) =>
          !((a === lead.rowId && b === other.rowId) || (a === other.rowId && b === lead.rowId)),
      );

      await db.transaction(async (tx) => {
        const { devices, entities: table } = schema.registry;

        await tx
          .update(table)
          .set({ linkedTo: lead.rowId, linkOrigin: 'manual', linkedAt: now, updatedAt: now })
          .where(eq(table.id, other.rowId));
        await tx
          .update(devices)
          .set({ linkRefused: refused, updatedAt: now })
          .where(eq(devices.id, group.holder.rowId));
      });

      return [lead.rowId, other.rowId];
    },
  };
}

/**
 * Plans unlinking an entity: it, and every entity linked to it, each its own again; the pairs are
 * never linked again on their own.
 *
 * @param context - The request's collaborators.
 * @param entityId - The entity, or one linked to it.
 * @returns What it will do, and how.
 * @throws {ValidationError} When nothing is linked to it.
 */
async function planEntityUnlink(context: IntegrationsContext, entityId: string): Promise<Plan> {
  const named = await entityByAddress(context.db, entityId);
  const { group, entities } = await entityGroupOf(context.db, named);
  const byRow = new Map(entities.map((row) => [row.rowId, row]));
  const lead = named.linkedTo === null ? named : (byRow.get(named.linkedTo) ?? named);
  const others = entities.filter((row) => row.linkedTo === lead.rowId);

  if (others.length === 0) {
    throw new ValidationError('Nothing is linked to it', { details: { entityId } });
  }

  const used = await usesOf(context.db, [lead, ...others]);
  const preview = linkPreviewSchema.parse({
    action: 'unlink',
    scope: 'entity',
    device: null,
    other: null,
    pairs: [
      {
        holder: sideOf(lead, used),
        others: others.map((row) => sideOf(row, used)),
        origin: originOf(others[0]),
      },
    ],
    single: [],
    preferred: {
      deviceId: lead.integrationId ?? group.holder.id,
      vendorId: vendorIdOf(lead.kind ?? group.holder.kind),
      transport: lead.instanceTransport ?? group.holder.transport,
    },
    linkedSince: others.map((row) => row.linkedAt).find((at) => at !== null) ?? null,
  });

  return {
    preview,
    /**
     * Writes it, in one transaction.
     *
     * @param db - The database.
     * @returns The entities whose links changed.
     */
    write: async (db) => {
      const now = new Date();
      const refused: [string, string][] = [
        ...group.holder.linkRefused,
        ...others.map((row): [string, string] => [lead.rowId, row.rowId]),
      ];

      await db.transaction(async (tx) => {
        const { devices, entities: table } = schema.registry;

        await tx
          .update(table)
          .set({ linkedTo: null, linkOrigin: null, linkedAt: null, updatedAt: now })
          .where(
            inArray(
              table.id,
              others.map((row) => row.rowId),
            ),
          );
        // Read through the way it is reached itself, now it has no other.
        await tx
          .update(table)
          .set({ transport: null, updatedAt: now })
          .where(eq(table.id, lead.rowId));
        await tx
          .update(devices)
          .set({ linkRefused: refused, updatedAt: now })
          .where(eq(devices.id, group.holder.rowId));
      });

      return [lead.rowId, ...others.map((row) => row.rowId)];
    },
  };
}

/** What a link or unlink route does: says, or does. */
export type LinkAction = 'device-link' | 'device-unlink' | 'entity-link' | 'entity-unlink';

/**
 * Links or unlinks, or says what it would do.
 *
 * @param context - The request's collaborators.
 * @param action - Which.
 * @param target - The device or entity, by its public id or address.
 * @param other - The other device or entity, for a link.
 * @param isPreview - Whether only to say.
 * @returns What it does, or would do.
 */
export async function changeLink(
  context: IntegrationsContext,
  action: LinkAction,
  target: string,
  other: string | undefined,
  isPreview: boolean,
): Promise<LinkPreview> {
  const plan =
    action === 'device-link'
      ? await planDeviceLink(context, target, other ?? '')
      : action === 'device-unlink'
        ? await planDeviceUnlink(context, target)
        : action === 'entity-link'
          ? await planEntityLink(context, target, other ?? '')
          : await planEntityUnlink(context, target);

  if (!isPreview) {
    const rowIds = await plan.write(context.db);

    await syncLinksOnCore(context, rowIds);
  }

  return plan.preview;
}

/**
 * The pairs of a linked device's entities that read alike and are not linked: what its Sensors
 * list suggests.
 *
 * @param db - The database.
 * @param deviceRowId - Any way into the device.
 * @returns The pairs, by address.
 */
export async function suggestedLinksOf(
  db: Database,
  deviceRowId: string,
): Promise<[string, string][]> {
  const [way] = await readWays(db, eq(schema.registry.devices.id, deviceRowId));

  if (way === undefined) {
    return [];
  }

  const group = await groupOf(db, way);

  if (group.others.length === 0) {
    return [];
  }

  const entities = await entitiesOf(db, [
    group.holder.rowId,
    ...group.others.map((each) => each.rowId),
  ]);
  const capabilities = await capabilitiesOf(
    db,
    entities.map((row) => row.rowId),
  );
  const open = entities.filter((row) => row.linkedTo === null);
  const left = open.filter((row) => row.deviceRowId === group.holder.rowId);
  const right = open.filter((row) => row.deviceRowId !== group.holder.rowId);
  const { suggested } = matchEntities(
    left.map((row) => toMatch(row, capabilities.get(row.rowId) ?? [])),
    right.map((row) => toMatch(row, capabilities.get(row.rowId) ?? [])),
    group.holder.linkRefused,
  );

  return suggested.map(([a, b]) => [a.entityId, b.entityId]);
}

/**
 * What two devices have alike, among what their integration says makes them one.
 *
 * @param a - One.
 * @param b - The other.
 * @param twins - What must agree.
 * @returns The facts that agree; null when one that must does not.
 */
export function twinReasons(
  a: Pick<WayRow, 'mac' | 'serialNumber' | 'model'>,
  b: Pick<WayRow, 'mac' | 'serialNumber' | 'model'>,
  twins: IntegrationVendor['twins'],
): LinkReason[] | null {
  const reasons: LinkReason[] = [];

  for (const fact of twins) {
    const left = fact === 'mac' ? a.mac : a.serialNumber;
    const right = fact === 'mac' ? b.mac : b.serialNumber;

    if (left === null || left.toLowerCase() !== right?.toLowerCase()) {
      return null;
    }

    reasons.push({ kind: fact, value: left });
  }

  if (!twins.includes('serial') && a.serialNumber !== null && a.serialNumber === b.serialNumber) {
    reasons.push({ kind: 'serial', value: a.serialNumber });
  }

  if (a.model !== null && a.model === b.model) {
    reasons.push({ kind: 'model', value: a.model });
  }

  return reasons.length === 0 ? null : reasons;
}

/**
 * Finds the devices that look like one device reached two ways, and offers each pair once.
 *
 * Run beside the adoption pass, so a twin is offered whenever its second way in arrives, and
 * again after a restart for one that arrived while `api` was down. A pair offered once is never
 * offered again on its own: set aside, it stays among the dismissed.
 *
 * @param context - The request's collaborators.
 * @returns How many pairs were offered for the first time.
 */
export async function offerTwins(context: IntegrationsContext): Promise<number> {
  const catalogue = await catalogueIfUp(context);
  const vendors = new Map(
    catalogue
      .filter((vendor) => vendor.twins.length > 0)
      .map((vendor) => [vendor.id, vendor.twins]),
  );

  if (vendors.size === 0) {
    return 0;
  }

  const ways = await readWays(
    context.db,
    and(
      isNull(schema.registry.devices.linkedTo),
      or(isNotNull(schema.registry.devices.mac), isNotNull(schema.registry.devices.serialNumber)),
    ) ?? sql`true`,
  );
  const fresh: { vendorId: string; a: WayRow; b: WayRow; reasons: LinkReason[] }[] = [];

  for (const [index, a] of ways.entries()) {
    for (const b of ways.slice(index + 1)) {
      const vendorId = vendorIdOf(a.kind);
      const twins = vendors.get(vendorId);

      // One device two ways: the same vendor, but not the same way in twice.
      if (twins === undefined || vendorId !== vendorIdOf(b.kind) || a.transport === b.transport) {
        continue;
      }

      const reasons = twinReasons(a, b, twins);

      if (reasons !== null) {
        fresh.push({ vendorId, a, b, reasons });
      }
    }
  }

  if (fresh.length === 0) {
    return 0;
  }

  const inserted = await context.db
    .insert(schema.registry.linkSuggestions)
    .values(
      fresh.map(({ vendorId, a, b, reasons }) => {
        const [first, second] = a.rowId < b.rowId ? [a, b] : [b, a];

        return { vendorId, deviceA: first.rowId, deviceB: second.rowId, reasons };
      }),
    )
    .onConflictDoNothing()
    .returning({ id: schema.registry.linkSuggestions.id });

  return inserted.length;
}

/**
 * A vendor's link suggestions, offered and set aside, the newest first.
 *
 * @param context - The request's collaborators.
 * @param vendorId - The vendor.
 * @returns The suggestions; a pair linked since is not among them.
 */
export async function listLinkSuggestions(
  context: IntegrationsContext,
  vendorId: string,
): Promise<LinkSuggestionView[]> {
  const { linkSuggestions } = schema.registry;
  const rows = await context.db
    .select()
    .from(linkSuggestions)
    .where(eq(linkSuggestions.vendorId, vendorId))
    .orderBy(sql`${linkSuggestions.createdAt} DESC`);
  const ids = rows.flatMap((row) => [row.deviceA, row.deviceB]);
  const ways =
    ids.length === 0 ? [] : await readWays(context.db, inArray(schema.registry.devices.id, ids));
  const byRow = new Map(ways.map((way) => [way.rowId, way]));

  return rows.flatMap((row) => {
    const a = byRow.get(row.deviceA);
    const b = byRow.get(row.deviceB);

    if (a === undefined || b === undefined || a.linkedTo === b.rowId || b.linkedTo === a.rowId) {
      return [];
    }

    // The device the house had first, then the newer way in.
    const [device, twin] = a.createdAt.getTime() <= b.createdAt.getTime() ? [a, b] : [b, a];
    /**
     * One device of the suggestion.
     *
     * @param way - The way in.
     * @returns What the suggestion shows of it.
     */
    const summary = (way: WayRow) => ({
      id: way.id,
      name: way.name,
      model: way.model,
      vendorId: vendorIdOf(way.kind),
      transport: way.transport,
      createdAt: way.createdAt,
    });

    return [
      {
        id: row.id,
        vendorId: row.vendorId,
        device: summary(device),
        twin: summary(twin),
        reasons: row.reasons,
        dismissedAt: row.dismissedAt,
        createdAt: row.createdAt,
      },
    ];
  });
}

/**
 * Sets a suggestion aside, or offers it again.
 *
 * @param context - The request's collaborators.
 * @param id - The suggestion.
 * @param isDismissed - Whether to set it aside.
 * @throws {NotFoundError} When there is no such suggestion.
 */
export async function setLinkSuggestionDismissed(
  context: IntegrationsContext,
  id: string,
  isDismissed: boolean,
): Promise<void> {
  const { linkSuggestions } = schema.registry;
  const changed = await context.db
    .update(linkSuggestions)
    .set({ dismissedAt: isDismissed ? new Date() : null })
    .where(eq(linkSuggestions.id, id))
    .returning({ id: linkSuggestions.id });

  if (changed.length === 0) {
    throw new NotFoundError('No such suggestion', { details: { id } });
  }
}

/**
 * The suggestion a newly added device is part of, for the dialog that added it.
 *
 * @param context - The request's collaborators.
 * @param deviceId - The device, by its public id.
 * @returns The suggestion still offered; undefined when there is none.
 */
export async function suggestionOfDevice(
  context: IntegrationsContext,
  deviceId: string,
): Promise<LinkSuggestionView | undefined> {
  const way = await wayOf(context.db, deviceId).catch(() => undefined);

  if (way === undefined) {
    return undefined;
  }

  const suggestions = await listLinkSuggestions(context, vendorIdOf(way.kind));

  return suggestions.find(
    (each) =>
      each.dismissedAt === null && (each.device.id === deviceId || each.twin.id === deviceId),
  );
}
