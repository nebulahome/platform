/**
 * The `history` schema: everything that accumulates over time.
 *
 * All four tables are TimescaleDB hypertables and none has a `uuid` primary key, which is the
 * deliberate deviation from RULES.md 13 documented in DATABASE.md 16: a surrogate key on a table
 * written thousands of times a minute costs 16 bytes and an index per row to identify something
 * nothing ever looks up by id.
 *
 * There are also no foreign keys to `registry.entities`. A hypertable is many chunks, and a
 * foreign key would mean a constraint check per insert plus a lock relationship that makes
 * dropping an aged-out chunk far more expensive than a file unlink.
 *
 * Mirrors DATABASE.md 6.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSchema,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/** The `history` schema. */
export const historySchema = pgSchema('history');

/**
 * Every entity state change.
 *
 * `contextId` and `contextType` are what make "why did this light turn on?" answerable: every
 * change records what caused it, and the index on `contextId` retrieves every change one
 * automation run produced.
 */
export const stateHistory = historySchema.table(
  'state_history',
  {
    time: timestamp('time', { withTimezone: true }).notNull(),
    entityId: uuid('entity_id').notNull(),
    state: jsonb('state').notNull(),
    previousState: jsonb('previous_state'),
    attributes: jsonb('attributes'),
    isAvailable: boolean('is_available').notNull().default(true),
    source: text('source').notNull(),
    contextId: uuid('context_id'),
    contextType: text('context_type'),
  },
  (table) => [
    index('state_history_entity_id_time_idx').on(table.entityId, table.time.desc()),
    index('state_history_context_id_idx')
      .on(table.contextId, table.time.desc())
      .where(sql`context_id IS NOT NULL`),
  ],
);

/**
 * Numeric readings.
 *
 * Deliberately narrow: no unit, no attributes, no source. Those live once on `registry.entities`
 * and are joined in when needed. A table written thousands of times per minute earns every byte
 * it does not store.
 *
 * `double precision` rather than `numeric`: sensor readings are measurements with their own
 * error, far larger than any floating-point rounding, and `numeric` is variable-width and
 * arithmetically slower on exactly the operations the aggregates perform.
 */
export const telemetry = historySchema.table(
  'telemetry',
  {
    time: timestamp('time', { withTimezone: true }).notNull(),
    entityId: uuid('entity_id').notNull(),
    value: doublePrecision('value').notNull(),
  },
  (table) => [index('telemetry_entity_id_time_idx').on(table.entityId, table.time.desc())],
);

/**
 * The execution trace behind the automation timeline.
 *
 * `conditionNotMet` is a distinct result from `failed` on purpose: an automation whose
 * conditions did not match did the right thing, and treating that as a failure would drown the
 * real failures.
 */
export const automationRuns = historySchema.table(
  'automation_runs',
  {
    /** When the run started. */
    time: timestamp('time', { withTimezone: true }).notNull(),

    id: uuid('id').notNull().defaultRandom(),
    automationId: uuid('automation_id').notNull(),

    /** Which trigger fired, and with what. */
    trigger: jsonb('trigger').notNull(),

    result: text('result').notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),

    /** An ordered array of steps, stored whole because it is read whole, by one screen. */
    trace: jsonb('trace')
      .notNull()
      .default(sql`'[]'::jsonb`),

    error: text('error'),
  },
  (table) => [
    index('automation_runs_automation_id_time_idx').on(table.automationId, table.time.desc()),
    index('automation_runs_result_time_idx')
      .on(table.result, table.time.desc())
      .where(sql`result <> 'success'`),
  ],
);

/**
 * Application logs.
 *
 * `level` is the numeric pino level rather than a string: one byte instead of five, and
 * `WHERE level >= 40` is the query the interface actually runs - "show me warnings and worse" -
 * which a text column cannot answer from an index.
 */
export const logs = historySchema.table(
  'logs',
  {
    time: timestamp('time', { withTimezone: true }).notNull(),

    /** A pino level, 10 through 60. */
    level: smallint('level').notNull(),

    service: text('service').notNull(),
    packageId: text('package_id'),
    message: text('message').notNull(),
    traceId: text('trace_id'),
    context: jsonb('context')
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (table) => [
    index('logs_time_idx').on(table.time.desc()),
    index('logs_service_time_idx').on(table.service, table.time.desc()),
    index('logs_level_time_idx')
      .on(table.level, table.time.desc())
      .where(sql`level >= 40`),
    index('logs_trace_id_idx')
      .on(table.traceId, table.time.desc())
      .where(sql`trace_id IS NOT NULL`),
  ],
);
