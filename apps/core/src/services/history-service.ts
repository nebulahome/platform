/**
 * Answering a package's reads of the past (`ctx.history`).
 *
 * `core` writes every state change and reading, and holds the one translation history needs:
 * from an entity's address to the registry row the hypertables are keyed on. So it answers these
 * reads too, rather than a package reaching the database: a package names entities and a window,
 * and gets each entity's points back oldest first, whole up to a limit.
 *
 * A read has the house's authority, as `ctx.entities` has: a package's process acts for the
 * house, not for a person. An entity never registered - or removed since - has no points, rather
 * than failing the read for the others.
 */
import type { BusClient, BusSubscription } from '@nebulahome/bus';
import {
  busSubjects,
  CORE_HISTORY_STATES_METHOD,
  CORE_HISTORY_TELEMETRY_METHOD,
  CORE_SERVICE,
  historyStatesRequestSchema,
  historyTelemetryRequestSchema,
  stateHistoryPointSchema,
  telemetryPointSchema,
  type EntityId,
  type HistoryStatesReply,
  type HistoryTelemetryReply,
  type StateHistoryPoint,
  type TelemetryPoint,
} from '@nebulahome/contracts';
import { readStateWindow, readTelemetryWindow, type Database } from '@nebulahome/db';

import type { EntityDirectory } from '../domain/entity-directory.js';

/** What the history service needs. */
export type HistoryServiceOptions = {
  /** The bus client to serve on. */
  readonly client: BusClient;

  /** The database the history is read from. */
  readonly db: Database;

  /** Where an address is turned into the row the history is keyed on. */
  readonly directory: EntityDirectory;
};

/** Each entity's points, and which of them lost their oldest. */
type Series<TPoint> = {
  readonly series: Record<EntityId, TPoint[]>;
  readonly truncated: EntityId[];
};

/**
 * Reads every entity of a request, each on its own, and gathers the answers.
 *
 * @param entityIds - The entities, as the request names them.
 * @param directory - Where their rows are found.
 * @param read - Reads one entity's points from its row.
 * @returns The points of each entity, oldest first.
 */
async function gather<TPoint>(
  entityIds: readonly EntityId[],
  directory: EntityDirectory,
  read: (
    rowId: string,
    entityId: EntityId,
  ) => Promise<{ readonly points: TPoint[]; readonly isTruncated: boolean }>,
): Promise<Series<TPoint>> {
  const unique = [...new Set(entityIds)];
  const answers = await Promise.all(
    unique.map(async (entityId) => {
      const record = directory.get(entityId);

      return record === undefined
        ? { entityId, points: [] as TPoint[], isTruncated: false }
        : { entityId, ...(await read(record.rowId, entityId)) };
    }),
  );

  const series: Record<EntityId, TPoint[]> = {};
  const truncated: EntityId[] = [];

  for (const answer of answers) {
    series[answer.entityId] = answer.points;

    if (answer.isTruncated) {
      truncated.push(answer.entityId);
    }
  }

  return { series, truncated };
}

/**
 * Serves the two history reads.
 *
 * @param options - The bus client, the database and the directory.
 * @returns The subscriptions, to unsubscribe on shutdown.
 */
export function startHistoryService(options: HistoryServiceOptions): BusSubscription[] {
  const { client, db, directory } = options;

  return [
    client.serve(
      busSubjects.service(CORE_SERVICE, CORE_HISTORY_STATES_METHOD),
      historyStatesRequestSchema,

      /**
       * Answers with each entity's changes in the window.
       *
       * @param request - The entities, the window and the limit.
       * @returns The changes, oldest first.
       */
      async (request): Promise<HistoryStatesReply> =>
        gather<StateHistoryPoint>(request.entityIds, directory, async (rowId, entityId) => {
          const read = await readStateWindow(db, rowId, request, request.limit);

          return {
            isTruncated: read.isTruncated,
            points: read.records.map((record) =>
              stateHistoryPointSchema.parse({
                time: record.time,
                entityId,
                state: record.state ?? {},
                previousState: record.previousState ?? null,
                attributes: record.attributes ?? {},
                isAvailable: record.isAvailable,
                source: record.source,
                context:
                  record.contextType === null
                    ? undefined
                    : {
                        type: record.contextType,
                        ...(record.contextId === null ? {} : { id: record.contextId }),
                      },
              }),
            ),
          };
        }),
    ),

    client.serve(
      busSubjects.service(CORE_SERVICE, CORE_HISTORY_TELEMETRY_METHOD),
      historyTelemetryRequestSchema,

      /**
       * Answers with each entity's readings in the window.
       *
       * @param request - The entities, the window, the resolution and the limit.
       * @returns The readings, oldest first.
       */
      async (request): Promise<HistoryTelemetryReply> => ({
        resolution: request.resolution,
        ...(await gather<TelemetryPoint>(request.entityIds, directory, async (rowId) => {
          const read = await readTelemetryWindow(
            db,
            rowId,
            request.resolution,
            request,
            request.limit,
          );

          return {
            isTruncated: read.isTruncated,
            points: read.records.map((record) => telemetryPointSchema.parse(record)),
          };
        })),
      }),
    ),
  ];
}
