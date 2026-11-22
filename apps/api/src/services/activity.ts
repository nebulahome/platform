/**
 * A device's activity, read from the state history `core` already keeps.
 *
 * `history.state_history` holds every notable change of every entity with the state it left, the
 * state it reached, whether the entity was reachable and when - which is everything an activity
 * log says, so this reads it rather than keeping a second copy. What it adds is the choosing: only
 * the device's entities, only those that switch, open, change mode or go offline rather than
 * those that count (a power meter's every reading is the history chart's to draw), and only the
 * rows where something a person would call a change happened - not an attribute that moved while
 * the state stood still.
 *
 * Paged newest first on `(time, entity)`, which unlike time alone survives two entities changing
 * in the same instant - a relay and its power reading, a device dropping off the network with all
 * its entities at once.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';

import {
  activityEntrySchema,
  type ActivityEntry,
  type CapabilityName,
  type Identity,
} from '@nebulahome/contracts';
import { schema, type Database } from '@nebulahome/db';

import { isPermitted } from '../auth/permissions.js';
import { decodeCursor, toPage, type PageResult } from '../http/pagination.js';

import { DESCRIBED_ACTION } from './described-devices.js';
import { EFFECTIVE_AREA_ID, findEntities, type EntityDetail } from './entities.js';

/**
 * Capabilities that never make an entity part of the activity on their own: a numeric reading
 * changes all the time and is drawn as a chart, and a button holds no state for a press to change.
 */
const QUIET_CAPABILITIES: ReadonlySet<CapabilityName> = new Set(['sensor_numeric', 'button']);

/** One row as the raw query returns it. */
type ActivityRow = {
  // A raw query leaves timestamps and jsonb as the driver hands them: text, or already parsed.
  readonly time: string | Date;
  readonly entity_row_id: string;
  readonly state: unknown;
  readonly previous_state: unknown;
  readonly is_available: boolean;
  readonly was_available: boolean | null;
  readonly source: string;
  readonly context_type: string | null;
  readonly context_id: string | null;

  /** For a device described again, what was removed and added: the audit row's details. */
  readonly described: unknown;
};

/** One entity a device described again removed or added, as the audit row keeps it. */
type DescribedEntity = { readonly entityId: string; readonly name: string };

/**
 * Whether an entity takes part in the activity: it has something other than readings to change.
 *
 * @param entity - The entity.
 * @returns True for a switch, a light, a door sensor, a thermostat; false for a meter or a button.
 */
export function isActivityEntity(entity: EntityDetail): boolean {
  return entity.view.capabilities.some((entry) => !QUIET_CAPABILITIES.has(entry.capability));
}

/**
 * The entities of a device whose activity a caller may read.
 *
 * Both permissions, per entity, as the history endpoints check them: `entity:read` to see the
 * entity at all and `history:read` to see its past. An entity outside either is left out rather
 * than failing the page - a guest shown one room sees that room's part of a device's activity.
 *
 * @param identity - Who is asking.
 * @param entities - The device's entities.
 * @returns The ones that take part in the activity and that the caller may read.
 */
export function readableActivityEntities(
  identity: Identity,
  entities: readonly EntityDetail[],
): EntityDetail[] {
  return entities.filter(
    (entity) =>
      isActivityEntity(entity) &&
      isPermitted(identity.permissions, 'entity:read', entity.scopes) &&
      isPermitted(identity.permissions, 'history:read', entity.scopes),
  );
}

/**
 * One time a device was described again, as an activity entry: `from.entities` names what was
 * removed, `to.entities` what was added, and the entry is about the first of them.
 *
 * @param row - The audit row.
 * @param described - Its details.
 * @returns The entry.
 */
function describedEntry(row: ActivityRow, described: Record<string, unknown>): ActivityEntry {
  /**
   * One list of the details.
   *
   * @param key - `added` or `removed`.
   * @returns The entities; none when the row says nothing.
   */
  const listOf = (key: string): DescribedEntity[] =>
    Array.isArray(described[key]) ? (described[key] as DescribedEntity[]) : [];
  const added = listOf('added');
  const removed = listOf('removed');

  return activityEntrySchema.parse({
    time: new Date(row.time),
    entityId: (added[0] ?? removed[0])?.entityId,
    kind: 'described',
    from: { entities: removed.map((entity) => entity.name) },
    to: { entities: added.map((entity) => entity.name) },
    isAvailable: true,
    wasAvailable: null,
    source: row.source,
  });
}

/**
 * Reads a JSON value the way the driver handed it over.
 *
 * @param value - Parsed already, or the column's text.
 * @returns The value.
 */
function jsonOf(value: unknown): unknown {
  return typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
}

/**
 * Reads what happened on some entities, newest first.
 *
 * The one query behind the activity. A row counts when the state changed, or the reachability
 * did; a row that only carried new attributes does not.
 *
 * Each entity's rows are walked on their own, newest first down the `(entity_id, time DESC)` index
 * (and the compressed chunks' `entity_id` segments, ordered by time), and the walk stops at one
 * page and one more: no more of one entity's rows can be on the page. Read for all the entities
 * at once and sorted, the whole history of every one of them was read to keep a page of it.
 *
 * `wasAvailable` is the reachability of the newest row strictly older than the row - the table
 * keeps the previous state but not the previous reachability - taken from the same walk: the first
 * row of a frame that starts a microsecond older, a timestamp's resolution. A lookup per row down
 * the index would cost as much again, and far more in a compressed chunk, which it decompresses.
 *
 * The cursor holds the time as Postgres wrote it, and is handed back to Postgres to compare, so
 * no precision is lost on the way through JavaScript's milliseconds.
 *
 * The times the device was described again - set up differently, its entities changed - come
 * from the audit log (`device.describe`), each with what was removed and added.
 *
 * @param db - The database.
 * @param entities - Whose activity, already narrowed to what the caller may read.
 * @param page - How many and from where.
 * @param page.limit - The page size.
 * @param page.cursor - Where the previous page ended.
 * @param deviceIds - The device's ways in, whose times it was described again are read too.
 * @returns A page of what happened, newest first.
 */
export async function readActivity(
  db: Database,
  entities: readonly EntityDetail[],
  page: { limit: number; cursor?: string },
  deviceIds: readonly string[] = [],
): Promise<PageResult<ActivityEntry>> {
  if (entities.length === 0) {
    return { items: [] };
  }

  const addressOf = new Map(entities.map((entity) => [entity.rowId, entity.view.entityId]));
  const rowIds = sql.join(
    entities.map((entity) => sql`${entity.rowId}::uuid`),
    sql`, `,
  );
  const ways =
    deviceIds.length === 0
      ? sql`NULL::text`
      : sql.join(
          deviceIds.map((id) => sql`${id}`),
          sql`, `,
        );
  const cursor = page.cursor === undefined ? undefined : decodeCursor(page.cursor);
  const after =
    cursor === undefined
      ? sql``
      : sql`WHERE (u.time, u.entity_row_id) < (${cursor.key}::timestamptz, ${cursor.id ?? ''}::uuid)`;
  // The same bound inside each entity's walk, and the time alone first: that is what the index
  // can start the walk from, rather than from the entity's newest row. A row it leaves out is
  // never the one before a row it keeps, which is older.
  const entityAfter =
    cursor === undefined
      ? sql``
      : sql`AND s.time <= ${cursor.key}::timestamptz
        AND (s.time, s.entity_id) < (${cursor.key}::timestamptz, ${cursor.id ?? ''}::uuid)`;

  const result = await db.execute<ActivityRow>(sql`
    SELECT
      u.time::text AS time,
      u.entity_row_id,
      u.state,
      u.previous_state,
      u.is_available,
      u.was_available,
      u.source,
      u.context_type,
      u.context_id,
      u.described
    FROM (
      SELECT c.*
      FROM (SELECT DISTINCT unnest(ARRAY[${rowIds}]) AS id) e
      CROSS JOIN LATERAL (
        SELECT w.*
        FROM (
          SELECT
            s.time,
            s.entity_id AS entity_row_id,
            s.state,
            s.previous_state,
            s.is_available,
            first_value(s.is_available) OVER (
              ORDER BY s.time DESC
              RANGE BETWEEN '1 microsecond'::interval FOLLOWING AND UNBOUNDED FOLLOWING
            ) AS was_available,
            s.source,
            s.context_type,
            s.context_id,
            NULL::jsonb AS described
          FROM history.state_history s
          WHERE s.entity_id = e.id
            ${entityAfter}
          ORDER BY s.time DESC
        ) w
        WHERE w.state IS DISTINCT FROM w.previous_state
          OR w.was_available IS DISTINCT FROM w.is_available
        ORDER BY w.time DESC
        LIMIT ${page.limit + 1}
      ) c
      UNION ALL
      SELECT a.time, a.id, '{}'::jsonb, NULL, true, NULL, a.resource_id, NULL, NULL, a.details
      FROM system.audit_log a
      WHERE a.action = ${DESCRIBED_ACTION}
        AND a.resource_type = 'device'
        AND a.resource_id IN (${ways})
    ) u
    ${after}
    ORDER BY u.time DESC, u.entity_row_id DESC
    LIMIT ${page.limit + 1}
  `);

  const rows = [...result];
  const entries = rows.map((row) => {
    const described = jsonOf(row.described);

    if (described !== null && typeof described === 'object') {
      return describedEntry(row, described as Record<string, unknown>);
    }

    const from = jsonOf(row.previous_state);
    const to = jsonOf(row.state);
    const isStateChange = JSON.stringify(from ?? null) !== JSON.stringify(to ?? null);

    return activityEntrySchema.parse({
      time: new Date(row.time),
      entityId: addressOf.get(row.entity_row_id),
      kind: isStateChange ? 'state' : 'availability',
      from: from ?? null,
      to: to ?? {},
      isAvailable: row.is_available,
      wasAvailable: row.was_available,
      source: row.source,
      ...(row.context_type === null
        ? {}
        : {
            context: {
              type: row.context_type,
              ...(row.context_id === null ? {} : { id: row.context_id }),
            },
          }),
    });
  });

  // The cursor is cut from the raw row rather than the parsed entry, for its exact time and row.
  const cursorOf = new Map(
    entries.map((entry, index) => {
      const row = rows[index];

      return [
        entry,
        {
          key: typeof row?.time === 'string' ? row.time : entry.time.toISOString(),
          id: row?.entity_row_id ?? '',
        },
      ];
    }),
  );

  return toPage(entries, page.limit, (entry) => cursorOf.get(entry) ?? { key: '' });
}

/**
 * The entities a dashboard's activity card follows: the ones picked by address, or every one of
 * an area, or of the whole house. Who may read them is decided after, by
 * {@link readableActivityEntities}.
 *
 * @param db - The database.
 * @param scope - What it follows.
 * @param scope.areaKey - One area, by its key.
 * @param scope.entityIds - A few entities, by address.
 * @returns The entities.
 */
export async function scopedActivityEntities(
  db: Database,
  scope: { readonly areaKey?: string; readonly entityIds?: readonly string[] },
): Promise<EntityDetail[]> {
  if (scope.entityIds !== undefined) {
    return findEntities(db, scope.entityIds);
  }

  if (scope.areaKey !== undefined) {
    const { entities, devices, areas } = schema.registry;
    // In the area as an entity's view says it is - its own, else its device's - and read as
    // itself: one linked to another is listed as that one, which is in the area or not by its
    // own room.
    const inArea = await db
      .select({ entityId: entities.entityId })
      .from(entities)
      .leftJoin(devices, eq(devices.id, entities.deviceId))
      .innerJoin(areas, eq(areas.id, EFFECTIVE_AREA_ID))
      .where(and(isNull(entities.linkedTo), eq(areas.key, scope.areaKey)));

    return findEntities(
      db,
      inArea.map((row) => row.entityId),
    );
  }

  const rows = await db
    .select({ entityId: schema.registry.entities.entityId })
    .from(schema.registry.entities);

  return findEntities(
    db,
    rows.map((row) => row.entityId),
  );
}
