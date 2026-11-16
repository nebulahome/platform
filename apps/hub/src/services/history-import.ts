/**
 * A device's past readings, asked for once its entities are first registered (integration SDK
 * 1.10.0).
 *
 * A driver with `history` says how far back its device can tell its numeric readings and how to
 * ask: the hub sends that one request through the transport, as it sends a command, reads the
 * answer through the driver, and hands the readings of the entities `core` has just created to
 * `core` in batches, which writes them into the history and never into the state. Asked once,
 * for entities that have no history yet - not after a restart, not for an entity registered
 * before - so nothing is written twice.
 */
import type { BusClient } from '@nebulahome/bus';
import {
  busSubjects,
  CORE_HISTORY_IMPORT_METHOD,
  CORE_SERVICE,
  HISTORY_IMPORT_MAX_DAYS,
  HISTORY_IMPORT_MAX_READINGS,
  historyImportReplySchema,
  timestampSchema,
  type EntityId,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';
import type {
  Integration,
  MappingContext,
  PastReading,
  TransportConnection,
} from '@nebulahome/package-runtime';

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long the transport may take to answer: a month of a vendor's records, downloaded. */
const ANSWER_TIMEOUT_MS = 120_000;

/**
 * How long `core` may take to write one batch: thousands of rows across a month of chunks, some
 * of them compressed, on the house's own hardware - far longer than a command is given.
 */
const BATCH_TIMEOUT_MS = 60_000;

/** One device's import. */
export type HistoryImportJob = {
  /** The instance, which is the device's id and the entities' owner. */
  readonly instanceId: string;
  readonly integration: Integration;

  /** The device's mapping context: its claim, its settings, its entities' ids. */
  readonly context: MappingContext;

  /** The entities `core` has just created: only their readings are imported. */
  readonly entityIds: ReadonlySet<EntityId>;

  readonly connection: Pick<TransportConnection, 'send'>;

  /** Asks `core`, as the instance. */
  readonly client: Pick<BusClient, 'request'>;

  readonly logger: PlatformLogger;

  /** Ends the import: the instance stopped. */
  readonly signal: AbortSignal;

  /** The clock; the system's unless a test sets one. */
  readonly now?: () => Date;
};

/** What an import wrote. */
export type HistoryImportOutcome = {
  readonly written: number;
  readonly skipped: number;
};

/**
 * A reading as `core` takes it, or undefined for one it would refuse the whole batch over: a value
 * that is not a finite number, a time that is not ISO 8601 with its zone.
 *
 * @param reading - What the driver read.
 * @returns The reading, its time in UTC.
 */
function readingOf(reading: PastReading): { observedAt: string; value: number } | undefined {
  const at = timestampSchema.safeParse(reading.at);

  return at.success && Number.isFinite(reading.value)
    ? { observedAt: at.data.toISOString(), value: reading.value }
    : undefined;
}

/**
 * Imports a device's past, when its driver can tell it.
 *
 * @param job - The device, its new entities, its connection, and where to send what it answers.
 * @returns What was written and left out; undefined when nothing was asked for - a driver with no
 * `history`, no new entity - or the import was stopped.
 * @throws {Error} When the transport could not answer, or the driver could not read the answer.
 */
export async function importHistory(
  job: HistoryImportJob,
): Promise<HistoryImportOutcome | undefined> {
  const { history } = job.integration;

  if (history === undefined || job.entityIds.size === 0) {
    return undefined;
  }

  /**
   * Whether the instance stopped, read afresh each time: it may stop while the transport or
   * `core` is answering.
   *
   * @returns True once it stopped.
   */
  const isStopped = (): boolean => job.signal.aborted;
  const days = Number.isFinite(history.days)
    ? Math.min(Math.max(Math.floor(history.days), 1), HISTORY_IMPORT_MAX_DAYS)
    : HISTORY_IMPORT_MAX_DAYS;
  const to = (job.now?.() ?? new Date()).getTime();
  const range = {
    from: new Date(to - days * DAY_MS).toISOString(),
    to: new Date(to).toISOString(),
  };
  const answer = await job.connection.send(
    history.request(range, job.context),
    AbortSignal.any([job.signal, AbortSignal.timeout(ANSWER_TIMEOUT_MS)]),
  );

  // A transport that ignored the signal answers anyway: an instance that stopped asks nothing more.
  if (isStopped()) {
    return undefined;
  }

  let written = 0;
  let skipped = 0;

  for (const { entityId, readings } of history.toReadings(answer, job.context)) {
    if (!job.entityIds.has(entityId)) {
      continue;
    }

    const usable = readings.flatMap((reading) => readingOf(reading) ?? []);
    let failed = 0;
    let firstError: unknown;

    skipped += readings.length - usable.length;

    for (let start = 0; start < usable.length; start += HISTORY_IMPORT_MAX_READINGS) {
      if (isStopped()) {
        return { written, skipped };
      }

      const batch = usable.slice(start, start + HISTORY_IMPORT_MAX_READINGS);

      try {
        // eslint-disable-next-line no-await-in-loop -- one batch at a time, so core is never flooded
        const reply = await job.client.request(
          busSubjects.service(CORE_SERVICE, CORE_HISTORY_IMPORT_METHOD),
          { integrationId: job.instanceId, entityId, readings: batch },
          historyImportReplySchema,
          { timeoutMs: BATCH_TIMEOUT_MS },
        );

        written += reply.written;
        skipped += reply.skipped;
      } catch (error: unknown) {
        // The next batch is no less the entity's: one that timed out may even have been written.
        failed += 1;
        firstError ??= error;
      }
    }

    if (failed > 0) {
      job.logger.warn(
        { err: firstError, instanceId: job.instanceId, entityId, failedBatches: failed },
        "Could not import all of an entity's past readings",
      );
    }
  }

  return { written, skipped };
}
