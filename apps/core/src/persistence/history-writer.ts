/**
 * The two things `core` persists on every state change.
 *
 * `history.state_history` is the permanent record: one row per change, forever, subject to
 * retention. `registry.entity_states` is a **recovery cache**: one row per entity, overwritten,
 * read only at startup. They are written on different schedules for that reason - losing a few
 * seconds of the cache costs nothing, because adapters resynchronise anyway, while losing a
 * history row loses it for good.
 */
import { sql } from 'drizzle-orm';

import { schema, type Database } from '@nebula-home/db';
import type { PlatformLogger } from '@nebula-home/logging';

import { BatchWriter } from './batch-writer.js';

/** One row of `history.state_history`. */
export type StateHistoryRow = {
  /** When the change happened. */
  time: Date;

  /** The `registry.entities.id` uuid, which is what the hypertable references. */
  entityId: string;

  /** The capability state after the change. */
  state: unknown;

  /** The capability state before it, absent on the first report after an installation. */
  previousState: unknown;

  /** The free-form attributes at the time of the change. */
  attributes: unknown;

  /** Whether the entity was reachable. */
  isAvailable: boolean;

  /** The adapter or engine that produced the change. */
  source: string;

  /** Which automation run, scene or user caused it. */
  contextId: string | null;

  /** What kind of thing caused it. */
  contextType: string | null;
};

/** How the history writer is paced. */
export type HistoryWriterOptions = {
  /** A connected database handle. */
  readonly db: Database;

  /** Where flush failures are reported. */
  readonly logger: PlatformLogger;

  /** Rows that trigger an immediate write. */
  readonly batchSize?: number;

  /** How long a partial batch waits. */
  readonly flushIntervalMs?: number;
};

/**
 * Builds the batched writer for `history.state_history`.
 *
 * @param options - Database, logger and pacing.
 * @returns A writer rows are added to and which flushes on its own.
 */
export function createHistoryWriter(options: HistoryWriterOptions): BatchWriter<StateHistoryRow> {
  return new BatchWriter<StateHistoryRow>({
    name: 'state_history',
    logger: options.logger,
    ...(options.batchSize === undefined ? {} : { batchSize: options.batchSize }),
    ...(options.flushIntervalMs === undefined ? {} : { flushIntervalMs: options.flushIntervalMs }),

    /**
     * Inserts one batch of history rows.
     *
     * @param rows - The buffered rows.
     * @returns A promise that settles once they are written.
     */
    write: async (rows: readonly StateHistoryRow[]): Promise<void> => {
      await options.db.insert(schema.history.stateHistory).values([...rows]);
    },
  });
}

/** One row of the `registry.entity_states` recovery cache. */
export type EntityStateRow = {
  /** The `registry.entities.id` uuid. */
  entityId: string;

  /** The capability state. */
  state: unknown;

  /** The free-form attributes. */
  attributes: unknown;

  /** Whether the entity is reachable. */
  isAvailable: boolean;

  /** When the state last differed. */
  lastChanged: Date;

  /** When a report last arrived. */
  lastUpdated: Date;

  /** The adapter or engine that produced it. */
  source: string;

  /** Which automation run, scene or user caused the last change. */
  contextId: string | null;

  /** What kind of thing caused it. */
  contextType: string | null;
};

/**
 * Builds the batched writer for the `registry.entity_states` cache.
 *
 * Every row is an upsert keyed on the entity, so a chatty sensor that produced fifty rows in one
 * batch writes fifty times rather than once - but only within the batch, and the alternative is
 * de-duplicating on the hot path to save writes to a table with one row per entity.
 *
 * @param options - Database, logger and pacing.
 * @returns A writer rows are added to and which flushes on its own.
 */
export function createStateCacheWriter(options: HistoryWriterOptions): BatchWriter<EntityStateRow> {
  return new BatchWriter<EntityStateRow>({
    name: 'entity_states',
    logger: options.logger,
    ...(options.batchSize === undefined ? {} : { batchSize: options.batchSize }),
    ...(options.flushIntervalMs === undefined ? {} : { flushIntervalMs: options.flushIntervalMs }),

    /**
     * Upserts one batch of cached states.
     *
     * @param rows - The buffered rows.
     * @returns A promise that settles once they are written.
     */
    write: async (rows: readonly EntityStateRow[]): Promise<void> => {
      await options.db
        .insert(schema.registry.entityStates)
        .values([...rows])
        .onConflictDoUpdate({
          target: schema.registry.entityStates.entityId,
          set: {
            state: sql`excluded.state`,
            attributes: sql`excluded.attributes`,
            isAvailable: sql`excluded.is_available`,
            lastChanged: sql`excluded.last_changed`,
            lastUpdated: sql`excluded.last_updated`,
            source: sql`excluded.source`,
            contextId: sql`excluded.context_id`,
            contextType: sql`excluded.context_type`,
          },
        });
    },
  });
}
