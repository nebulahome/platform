/**
 * Reading a window of history for one entity at a time, oldest first, whole.
 *
 * The API reads history a page at a time, newest first, for a person scrolling back through a
 * chart. `core` reads it for a package's server (`ctx.history`), which asks for a window and
 * wants it in one answer: these are those reads. Each takes the newest `limit` rows of the window
 * and hands them back oldest first, so a window too long for the limit loses its oldest rows,
 * never the ones that end at now - the end a chart and a replay both start from.
 *
 * The hypertables are keyed on the registry row, not on the address, so a caller resolves the
 * address first. The rolled-up telemetry views are continuous aggregates, which drizzle's schema
 * does not model: they are named from a fixed table, never from input, and the window goes in as
 * ISO text cast to `timestamptz`, the one form a raw query's parameter takes.
 */
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';

import type { Database } from './client.js';
import { stateHistory, telemetry } from './schema/history.js';

/** A window of time: from inclusive, to exclusive. */
export type HistoryReadWindow = {
  readonly from: Date;
  readonly to: Date;
};

/** One recorded change, as the table holds it. */
export type StateHistoryRecord = {
  readonly time: Date;
  readonly state: unknown;
  readonly previousState: unknown;
  readonly attributes: unknown;
  readonly isAvailable: boolean;
  readonly source: string;
  readonly contextId: string | null;
  readonly contextType: string | null;
};

/** One reading, raw or a bucket of the rolled-up views. */
export type TelemetryRecord = {
  readonly time: Date;
  readonly value: number;
  readonly min?: number;
  readonly max?: number;
  readonly count?: number;
};

/** What a read found: the rows, and whether the window held more than the limit. */
export type HistoryReadResult<TRecord> = {
  readonly records: readonly TRecord[];
  readonly isTruncated: boolean;
};

/** The rolled-up views, by resolution. */
const AGGREGATE_VIEWS = {
  '1m': 'history.telemetry_1m',
  '1h': 'history.telemetry_1h',
  '1d': 'history.telemetry_1d',
} as const;

/** How finely telemetry is read: every reading, or a bucket of a minute, an hour or a day. */
export type TelemetryReadResolution = 'raw' | keyof typeof AGGREGATE_VIEWS;

/**
 * Keeps the newest `limit` of rows read newest first, and turns them oldest first.
 *
 * @param rows - Up to `limit + 1` rows, newest first.
 * @param limit - How many to keep.
 * @returns The rows oldest first, and whether one more was there.
 */
function oldestFirst<TRecord>(rows: readonly TRecord[], limit: number): HistoryReadResult<TRecord> {
  return { records: rows.slice(0, limit).reverse(), isTruncated: rows.length > limit };
}

/**
 * Reads one entity's changes in a window.
 *
 * @param db - The database.
 * @param rowId - The entity's `registry.entities.id`.
 * @param window - The window.
 * @param limit - The most rows to return; the newest are kept.
 * @returns The changes, oldest first.
 */
export async function readStateWindow(
  db: Database,
  rowId: string,
  window: HistoryReadWindow,
  limit: number,
): Promise<HistoryReadResult<StateHistoryRecord>> {
  const rows = await db
    .select()
    .from(stateHistory)
    .where(
      and(
        eq(stateHistory.entityId, rowId),
        gte(stateHistory.time, window.from),
        lt(stateHistory.time, window.to),
      ),
    )
    .orderBy(desc(stateHistory.time))
    .limit(limit + 1);

  return oldestFirst(
    rows.map((row) => ({
      time: row.time,
      state: row.state,
      previousState: row.previousState,
      attributes: row.attributes,
      isAvailable: row.isAvailable,
      source: row.source,
      contextId: row.contextId,
      contextType: row.contextType,
    })),
    limit,
  );
}

/**
 * Reads one entity's readings in a window, raw or rolled up.
 *
 * @param db - The database.
 * @param rowId - The entity's `registry.entities.id`.
 * @param resolution - Every reading, or buckets of a minute, an hour or a day.
 * @param window - The window.
 * @param limit - The most readings to return; the newest are kept.
 * @returns The readings, oldest first.
 */
export async function readTelemetryWindow(
  db: Database,
  rowId: string,
  resolution: TelemetryReadResolution,
  window: HistoryReadWindow,
  limit: number,
): Promise<HistoryReadResult<TelemetryRecord>> {
  if (resolution === 'raw') {
    const rows = await db
      .select()
      .from(telemetry)
      .where(
        and(
          eq(telemetry.entityId, rowId),
          gte(telemetry.time, window.from),
          lt(telemetry.time, window.to),
        ),
      )
      .orderBy(desc(telemetry.time))
      .limit(limit + 1);

    return oldestFirst(
      rows.map((row) => ({ time: row.time, value: row.value })),
      limit,
    );
  }

  const view = sql.raw(AGGREGATE_VIEWS[resolution]);
  const result = await db.execute<{
    // A raw query leaves the column as Postgres wrote it: `2026-09-24 16:14:00+00`.
    bucket: string | Date;
    avg_value: string | number;
    min_value: string | number;
    max_value: string | number;
    sample_count: string | number;
  }>(sql`
    SELECT bucket, avg_value, min_value, max_value, sample_count
    FROM ${view}
    WHERE entity_id = ${rowId}::uuid
      AND bucket >= ${window.from.toISOString()}::timestamptz
      AND bucket < ${window.to.toISOString()}::timestamptz
    ORDER BY bucket DESC
    LIMIT ${limit + 1}
  `);

  return oldestFirst(
    [...result].map((row) => ({
      time: new Date(row.bucket),
      value: Number(row.avg_value),
      min: Number(row.min_value),
      max: Number(row.max_value),
      count: Number(row.sample_count),
    })),
    limit,
  );
}
