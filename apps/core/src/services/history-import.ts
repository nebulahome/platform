/**
 * A device's past readings, written into an entity's history and never into its state.
 *
 * `hub` asks once a device was first added and its driver could tell its past (integration SDK
 * 1.10.0, `history`). The readings go straight into the telemetry table - not through the
 * telemetry stream, whose sampler and state path are for what happens now - and the stretch
 * they cover is queued for the database job that brings the 1m/1h/1d summaries up to date (0012):
 * their own policies look only at the last hours, and `core` may not refresh them itself.
 *
 * Only the past is taken: a reading at or after the entity was registered would sit among the
 * live ones, and one older than {@link HISTORY_IMPORT_MAX_DAYS} where the raw readings are about
 * to be dropped. Nothing is written twice by design - `hub` asks once and never again.
 */
import { eq } from 'drizzle-orm';

import type { BusClient, BusSubscription } from '@nebulahome/bus';
import {
  busSubjects,
  CORE_HISTORY_IMPORT_METHOD,
  CORE_SERVICE,
  HISTORY_IMPORT_MAX_DAYS,
  historyImportRequestSchema,
  type HistoryImportReply,
  type HistoryImportRequest,
} from '@nebulahome/contracts';
import { schema, type Database } from '@nebulahome/db';
import type { PlatformLogger } from '@nebulahome/logging';

import type { EntityDirectory } from '../domain/entity-directory.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** What the history import is served with. */
export type HistoryImportOptions = {
  readonly client: BusClient;
  readonly db: Database;

  /** Configured entities: who owns one, what it can do, the uuid its history references. */
  readonly directory: EntityDirectory;

  readonly logger: PlatformLogger;

  /** The clock; the system's unless a test sets one. */
  readonly now?: () => Date;
};

/**
 * Serves the subject `hub` hands a device's past readings over on.
 *
 * @param options - The bus client, the database, the directory and the logger.
 * @returns The subscription, to unsubscribe on shutdown.
 */
export function startHistoryImportService(options: HistoryImportOptions): BusSubscription {
  return options.client.serve(
    busSubjects.service(CORE_SERVICE, CORE_HISTORY_IMPORT_METHOD),
    historyImportRequestSchema,

    /**
     * Writes what is the entity's past.
     *
     * @param request - The instance, the entity and its readings.
     * @returns How many readings were written and left out.
     * @throws {Error} When the entity is not registered, not the instance's, or not numeric.
     */
    async (request: HistoryImportRequest): Promise<HistoryImportReply> => {
      const record = options.directory.get(request.entityId);

      if (record?.source !== request.integrationId) {
        throw new Error(`${request.entityId} is not an entity of ${request.integrationId}`);
      }

      // A linked entity keeps no history of its own: its address means the entity it reads through.
      if (!record.capabilities.has('sensor_numeric') || record.linkedTo !== undefined) {
        throw new Error(`${request.entityId} keeps no numeric history of its own`);
      }

      const [row] = await options.db
        .select({ createdAt: schema.registry.entities.createdAt })
        .from(schema.registry.entities)
        .where(eq(schema.registry.entities.id, record.rowId));

      if (row === undefined) {
        throw new Error(`${request.entityId} is not registered`);
      }

      const oldest = (options.now?.() ?? new Date()).getTime() - HISTORY_IMPORT_MAX_DAYS * DAY_MS;
      const registered = row.createdAt.getTime();
      const rows = request.readings
        .filter((reading) => {
          const at = reading.observedAt.getTime();

          return at >= oldest && at < registered;
        })
        .map((reading) => ({
          time: reading.observedAt,
          entityId: record.rowId,
          value: reading.value,
        }));
      const skipped = request.readings.length - rows.length;

      if (rows.length === 0) {
        return { written: 0, skipped };
      }

      const times = rows.map((each) => each.time.getTime());

      await options.db.transaction(async (tx) => {
        await tx.insert(schema.history.telemetry).values(rows);
        await tx.insert(schema.history.telemetryRefreshes).values({
          fromTime: new Date(Math.min(...times)),
          toTime: new Date(Math.max(...times)),
        });
      });

      options.logger.info(
        { entityId: request.entityId, written: rows.length, skipped },
        "Imported an entity's past readings",
      );

      return { written: rows.length, skipped };
    },
  );
}
