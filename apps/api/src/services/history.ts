/**
 * Reading the two hypertables.
 *
 * Both are ordered newest first and paged by time, which is what makes the cursor natural: the
 * key is the timestamp of the last row returned, and the next page asks for rows strictly older
 * than it. Rows arriving while a client reads change nothing, which is the whole reason
 * RULES.md 14 forbids offsets here.
 *
 * Telemetry can be read raw or from one of the continuous aggregates. Those views are the reason
 * a year-long chart is affordable at all: DATABASE.md 9 rolls readings up to the minute, the
 * hour and the day, each level built from the one below.
 */
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';

import {
  stateHistoryPointSchema,
  telemetryPointSchema,
  ValidationError,
  type StateHistoryPoint,
  type TelemetryPoint,
  type TelemetryResolution,
} from '@nebula-home/contracts';
import { schema, type Database } from '@nebula-home/db';

import { decodeCursor, toPage, type PageResult } from '../http/pagination.js';

/** How far back a request reaches when it does not say, in milliseconds. */
const DEFAULT_WINDOW_MS = 86_400_000;

/** The rolled-up views, by the resolution a caller asks for. */
const AGGREGATE_VIEWS = {
  '1m': 'history.telemetry_1m',
  '1h': 'history.telemetry_1h',
  '1d': 'history.telemetry_1d',
} as const;

/** A resolved time window. */
type Window = {
  /** Inclusive lower bound. */
  readonly from: Date;

  /** Exclusive upper bound. */
  readonly to: Date;
};

/**
 * Fills in whichever end of the window the caller left out.
 *
 * @param from - The lower bound, when given.
 * @param to - The upper bound, when given.
 * @param now - The clock.
 * @returns Both bounds.
 * @throws {ValidationError} When the window is inverted. Answering with an empty page would let
 * a caller believe there is no history rather than that they asked backwards.
 */
export function resolveWindow(
  from: string | undefined,
  to: string | undefined,
  now: Date = new Date(),
): Window {
  const upper = to === undefined ? now : new Date(to);
  const lower = from === undefined ? new Date(upper.getTime() - DEFAULT_WINDOW_MS) : new Date(from);

  if (lower.getTime() >= upper.getTime()) {
    throw new ValidationError('The window starts at or after it ends', {
      details: { from: lower.toISOString(), to: upper.toISOString() },
    });
  }

  return { from: lower, to: upper };
}

/**
 * The entity a history read is about: the hypertables key on the registry row, and a point names
 * the entity by its address.
 */
export type HistoryEntity = {
  /** The `registry.entities.id` uuid, which is what the hypertables reference. */
  readonly rowId: string;

  /** The address, which is what a point is served under. */
  readonly entityId: string;
};

/**
 * Reads recorded state changes for one entity.
 *
 * @param db - The database.
 * @param entity - Its row, which the hypertable is keyed on, and its address.
 * @param window - The time range.
 * @param page - How many and from where.
 * @param page.limit - The page size.
 * @param page.cursor - Where the previous page ended.
 * @returns A page of changes, newest first.
 */
export async function readStateHistory(
  db: Database,
  entity: HistoryEntity,
  window: Window,
  page: { limit: number; cursor?: string },
): Promise<PageResult<StateHistoryPoint>> {
  const upper = page.cursor === undefined ? window.to : new Date(decodeCursor(page.cursor).key);
  const { entityId } = entity;

  const rows = await db
    .select()
    .from(schema.history.stateHistory)
    .where(
      and(
        eq(schema.history.stateHistory.entityId, entity.rowId),
        gte(schema.history.stateHistory.time, window.from),
        lt(schema.history.stateHistory.time, upper),
      ),
    )
    .orderBy(desc(schema.history.stateHistory.time))
    .limit(page.limit + 1);

  const points = rows.map((row) =>
    stateHistoryPointSchema.parse({
      time: row.time,
      entityId,
      state: row.state ?? {},
      previousState: row.previousState ?? null,
      attributes: row.attributes ?? {},
      isAvailable: row.isAvailable,
      source: row.source,
      context:
        row.contextType === null
          ? undefined
          : { type: row.contextType, ...(row.contextId === null ? {} : { id: row.contextId }) },
    }),
  );

  return toPage(points, page.limit, (point) => ({ key: point.time.toISOString() }));
}

/**
 * Reads numeric readings for one entity, raw or rolled up.
 *
 * The aggregate views are addressed by name in raw SQL because they are continuous aggregates
 * rather than tables, and drizzle's schema does not model them. The name comes from a fixed
 * table keyed by the validated `resolution` enum, never from caller input, so there is no string
 * from outside anywhere near this query. The window's ends go in as ISO strings cast to
 * `timestamptz`: a raw query does not know the column's type, and the driver refuses a `Date`
 * where it expects the text of a parameter.
 *
 * @param db - The database.
 * @param entity - Its row, which the hypertable and the views are keyed on, and its address.
 * @param resolution - Which level of the ladder to read.
 * @param window - The time range.
 * @param page - How many and from where.
 * @param page.limit - The page size.
 * @param page.cursor - Where the previous page ended.
 * @returns A page of readings, newest first.
 */
export async function readTelemetry(
  db: Database,
  entity: HistoryEntity,
  resolution: TelemetryResolution,
  window: Window,
  page: { limit: number; cursor?: string },
): Promise<PageResult<TelemetryPoint>> {
  const upper = page.cursor === undefined ? window.to : new Date(decodeCursor(page.cursor).key);

  if (resolution === 'raw') {
    const rows = await db
      .select()
      .from(schema.history.telemetry)
      .where(
        and(
          eq(schema.history.telemetry.entityId, entity.rowId),
          gte(schema.history.telemetry.time, window.from),
          lt(schema.history.telemetry.time, upper),
        ),
      )
      .orderBy(desc(schema.history.telemetry.time))
      .limit(page.limit + 1);

    const points = rows.map((row) =>
      telemetryPointSchema.parse({ time: row.time, value: row.value }),
    );

    return toPage(points, page.limit, (point) => ({ key: point.time.toISOString() }));
  }

  const view = sql.raw(AGGREGATE_VIEWS[resolution]);
  const result = await db.execute<{
    // A raw query leaves the column as Postgres wrote it: `2026-09-24 16:14:00+00`.
    bucket: string | Date;
    avg_value: string;
    min_value: string;
    max_value: string;
    sample_count: string;
  }>(sql`
    SELECT bucket, avg_value, min_value, max_value, sample_count
    FROM ${view}
    WHERE entity_id = ${entity.rowId}::uuid
      AND bucket >= ${window.from.toISOString()}::timestamptz
      AND bucket < ${upper.toISOString()}::timestamptz
    ORDER BY bucket DESC
    LIMIT ${page.limit + 1}
  `);

  const points = [...result].map((row) =>
    telemetryPointSchema.parse({
      time: new Date(row.bucket),
      value: Number(row.avg_value),
      min: Number(row.min_value),
      max: Number(row.max_value),
      count: Number(row.sample_count),
    }),
  );

  return toPage(points, page.limit, (point) => ({ key: point.time.toISOString() }));
}
