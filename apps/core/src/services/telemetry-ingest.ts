/**
 * Draining the durable telemetry stream into the hypertable.
 *
 * Readings are pulled in batches, written in one insert, and **only then acknowledged**. That
 * order is the whole point of the stream: acknowledging on receipt and writing afterwards would
 * lose exactly the readings the stream exists to protect, one crash later
 * (ARCHITECTURE.md 7.4).
 */
import type { NatsConnection } from 'nats';

import { createTelemetryConsumer, type TelemetryConsumer } from '@nebula-home/bus';
import { schema, type Database } from '@nebula-home/db';
import type { PlatformLogger } from '@nebula-home/logging';

import type { EntityDirectory } from '../domain/entity-directory.js';

/** How telemetry ingest is paced. */
export type TelemetryIngestOptions = {
  /** The NATS client, which JetStream needs directly. */
  readonly connection: NatsConnection;

  /** A connected database handle. */
  readonly db: Database;

  /** Configured entities, consulted for the uuid the hypertable references. */
  readonly directory: EntityDirectory;

  /** Where rejected readings and failed writes are reported. */
  readonly logger: PlatformLogger;

  /** Ends the loop on shutdown. */
  readonly signal: AbortSignal;

  /** Largest batch to pull at once. */
  readonly batchSize?: number;

  /** How long an empty stream is waited on before pulling again. */
  readonly pullTimeoutMs?: number;
};

const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_PULL_TIMEOUT_MS = 2000;

/**
 * The durable consumer name `core` reads telemetry through.
 *
 * Fixed rather than generated, because that is what makes it durable: a generated name would
 * create a new consumer on every restart, each one starting from the beginning of the stream.
 */
export const TELEMETRY_CONSUMER_NAME = 'core_telemetry';

/** One pull, written and acknowledged. */
export type TelemetryIngestCycle = {
  /** How many readings were stored. */
  readonly stored: number;

  /** How many were dropped because their entity is not registered. */
  readonly skipped: number;
};

/**
 * Pulls one batch, writes it and acknowledges it.
 *
 * A reading for an entity nobody has registered is dropped rather than held: the hypertable
 * references `registry.entities.id`, so there is no row to write, and leaving it unacknowledged
 * would put it in front of every subsequent reading forever.
 *
 * @param consumer - The durable reader.
 * @param options - Database, directory, logger and pacing.
 * @returns What the cycle did.
 * @throws {Error} When the insert fails. The batch is left unacknowledged, so the server
 * redelivers it - which is the behaviour that makes the stream worth having.
 */
export async function runTelemetryCycle(
  consumer: TelemetryConsumer,
  options: TelemetryIngestOptions,
): Promise<TelemetryIngestCycle> {
  const batch = await consumer.pull(
    options.batchSize ?? DEFAULT_BATCH_SIZE,
    options.pullTimeoutMs ?? DEFAULT_PULL_TIMEOUT_MS,
  );

  if (batch.deliveries.length === 0) {
    return { stored: 0, skipped: 0 };
  }

  const rows: { time: Date; entityId: string; value: number }[] = [];
  let skipped = 0;

  for (const delivery of batch.deliveries) {
    const record = options.directory.get(delivery.reading.entityId);

    if (record === undefined) {
      skipped += 1;
      continue;
    }

    rows.push({
      time: delivery.reading.observedAt,
      entityId: record.rowId,
      value: delivery.reading.value,
    });
  }

  if (rows.length > 0) {
    await options.db.insert(schema.history.telemetry).values(rows);
  }

  batch.ack();

  if (skipped > 0) {
    options.logger.warn({ skipped }, 'Dropped telemetry for entities that are not registered');
  }

  return { stored: rows.length, skipped };
}

/**
 * Runs the ingest loop until the caller aborts.
 *
 * @param options - Connection, database, directory, logger, cancellation and pacing.
 * @returns A promise that settles once the loop has stopped.
 */
export async function runTelemetryIngest(options: TelemetryIngestOptions): Promise<void> {
  const consumer = await createTelemetryConsumer({
    connection: options.connection,
    durableName: TELEMETRY_CONSUMER_NAME,
    logger: options.logger,
  });

  while (!options.signal.aborted) {
    try {
      // One batch at a time; overlapping pulls would acknowledge out of order and defeat the
      // durability the stream is here for.
      // eslint-disable-next-line no-await-in-loop -- see above
      await runTelemetryCycle(consumer, options);
    } catch (error: unknown) {
      options.logger.error({ err: error }, 'Telemetry cycle failed, the batch will be redelivered');

      // eslint-disable-next-line no-await-in-loop -- a pause before retrying, same reason
      await new Promise((resolve) => setTimeout(resolve, DEFAULT_PULL_TIMEOUT_MS));
    }
  }
}
