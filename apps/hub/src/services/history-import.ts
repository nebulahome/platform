/**
 * A device's past readings, asked for once it is first added (integration SDK 1.10.0).
 *
 * A driver with `history` says how far back its device can tell its numeric readings and how to
 * ask: the hub sends that one request through the transport, as it sends a command, reads the
 * answer through the driver, and hands each entity's readings to `core` in batches, which writes
 * them into the history and never into the state. Asked once and never again - not after a
 * restart, not when the device is set up differently - so nothing is written twice.
 */
import type { BusClient } from '@nebulahome/bus';
import {
  busSubjects,
  CORE_HISTORY_IMPORT_METHOD,
  CORE_SERVICE,
  HISTORY_IMPORT_MAX_DAYS,
  HISTORY_IMPORT_MAX_READINGS,
  historyImportReplySchema,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';
import type { Integration, MappingContext, TransportConnection } from '@nebulahome/package-runtime';

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long the transport may take to answer: a month of a vendor's records, downloaded. */
const ANSWER_TIMEOUT_MS = 120_000;

/** One device's import. */
export type HistoryImportJob = {
  /** The instance, which is the device's id and the entities' owner. */
  readonly instanceId: string;
  readonly integration: Integration;

  /** The device's mapping context: its claim, its settings, its entities' ids. */
  readonly context: MappingContext;

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
 * Imports a device's past, when its driver can tell it.
 *
 * @param job - The device, its connection, and where to send what it answers.
 * @returns What was written and left out; undefined for a driver with no `history`.
 * @throws {Error} When the transport could not answer, or the driver could not read the answer.
 */
export async function importHistory(
  job: HistoryImportJob,
): Promise<HistoryImportOutcome | undefined> {
  const { history } = job.integration;

  if (history === undefined) {
    return undefined;
  }

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
  let written = 0;
  let skipped = 0;

  for (const { entityId, readings } of history.toReadings(answer, job.context)) {
    try {
      for (let start = 0; start < readings.length; start += HISTORY_IMPORT_MAX_READINGS) {
        if (job.signal.aborted) {
          return { written, skipped };
        }

        // eslint-disable-next-line no-await-in-loop -- one batch at a time, so core is never flooded
        const reply = await job.client.request(
          busSubjects.service(CORE_SERVICE, CORE_HISTORY_IMPORT_METHOD),
          {
            integrationId: job.instanceId,
            entityId,
            readings: readings
              .slice(start, start + HISTORY_IMPORT_MAX_READINGS)
              .map((reading) => ({ observedAt: reading.at, value: reading.value })),
          },
          historyImportReplySchema,
        );

        written += reply.written;
        skipped += reply.skipped;
      }
    } catch (error: unknown) {
      // One entity refused - not numeric, a reading that is not a date - is not the others'.
      job.logger.warn(
        { err: error, instanceId: job.instanceId, entityId },
        "Could not import an entity's past readings",
      );
    }
  }

  return { written, skipped };
}
