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
import { sql } from 'drizzle-orm';

import {
  activityEntrySchema,
  type ActivityEntry,
  type CapabilityName,
  type Identity,
} from '@nebula-home/contracts';
import type { Database } from '@nebula-home/db';

import { isPermitted } from '../auth/permissions.js';
import { decodeCursor, toPage, type PageResult } from '../http/pagination.js';

import type { EntityDetail } from './entities.js';

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
};

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
 * The one query behind the activity. `wasAvailable` is the previous row's reachability, found by a
 * lateral lookup down the `(entity_id, time DESC)` index - one index step per row returned - since
 * the table keeps the previous state but not the previous reachability. A row counts when the
 * state changed, or the reachability did; a row that only carried new attributes does not.
 *
 * The cursor holds the time as Postgres wrote it, and is handed back to Postgres to compare, so
 * no precision is lost on the way through JavaScript's milliseconds.
 *
 * @param db - The database.
 * @param entities - Whose activity, already narrowed to what the caller may read.
 * @param page - How many and from where.
 * @param page.limit - The page size.
 * @param page.cursor - Where the previous page ended.
 * @returns A page of what happened, newest first.
 */
export async function readActivity(
  db: Database,
  entities: readonly EntityDetail[],
  page: { limit: number; cursor?: string },
): Promise<PageResult<ActivityEntry>> {
  if (entities.length === 0) {
    return { items: [] };
  }

  const addressOf = new Map(entities.map((entity) => [entity.rowId, entity.view.entityId]));
  const rowIds = sql.join(
    entities.map((entity) => sql`${entity.rowId}::uuid`),
    sql`, `,
  );
  const cursor = page.cursor === undefined ? undefined : decodeCursor(page.cursor);
  const after =
    cursor === undefined
      ? sql``
      : sql`AND (s.time, s.entity_id) < (${cursor.key}::timestamptz, ${cursor.id ?? ''}::uuid)`;

  const result = await db.execute<ActivityRow>(sql`
    SELECT
      s.time::text AS time,
      s.entity_id AS entity_row_id,
      s.state,
      s.previous_state,
      s.is_available,
      p.is_available AS was_available,
      s.source,
      s.context_type,
      s.context_id
    FROM history.state_history s
    LEFT JOIN LATERAL (
      SELECT q.is_available
      FROM history.state_history q
      WHERE q.entity_id = s.entity_id AND q.time < s.time
      ORDER BY q.time DESC
      LIMIT 1
    ) p ON true
    WHERE s.entity_id IN (${rowIds})
      ${after}
      AND (
        s.state IS DISTINCT FROM s.previous_state
        OR p.is_available IS DISTINCT FROM s.is_available
      )
    ORDER BY s.time DESC, s.entity_id DESC
    LIMIT ${page.limit + 1}
  `);

  const rows = [...result];
  const entries = rows.map((row) => {
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
