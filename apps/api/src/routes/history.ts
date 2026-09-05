/**
 * Reading the past.
 *
 * Both endpoints require the entity to be named. An unbounded read across every entity is a scan
 * of a hypertable that grows forever, and offering it would mean the first person to click it
 * takes the database down.
 */
import {
  NotFoundError,
  historyQuerySchema,
  pageQuerySchema,
  pageSchema,
  stateHistoryPointSchema,
  telemetryPointSchema,
  telemetryQuerySchema,
  type Page,
  type StateHistoryPoint,
  type TelemetryPoint,
} from '@nebula-home/contracts';

import { requirePermission } from '../auth/permissions.js';
import type { ApiContext } from '../context.js';
import { defineRoute, type RouteEnvironment } from '../http/route.js';
import { findEntity } from '../services/entities.js';
import { readStateHistory, readTelemetry, resolveWindow } from '../services/history.js';

/**
 * Checks that the caller may read the named entity's past.
 *
 * Two permissions, both required: `history:read` says they may look at history at all, and
 * `entity:read` scoped to this entity says they may look at *this* one. Checking only the first
 * would let a guest with history access read a room they cannot otherwise see.
 *
 * @param context - The service context.
 * @param identity - Who is asking.
 * @param entityId - Whose past.
 * @throws {NotFoundError} When the entity does not exist or the caller may not see it.
 * @throws {PermissionError} When they may see the entity but hold no history permission.
 */
async function authoriseHistory(
  context: ApiContext,
  identity: Parameters<typeof requirePermission>[0],
  entityId: string,
): Promise<void> {
  const found = await findEntity(context.db, entityId);

  if (found === undefined) {
    throw new NotFoundError(`No entity ${entityId}`, { details: { entityId } });
  }

  try {
    requirePermission(identity, 'entity:read', found.scopes);
  } catch {
    throw new NotFoundError(`No entity ${entityId}`, { details: { entityId } });
  }

  requirePermission(identity, 'history:read', found.scopes);
}

/**
 * Registers the history endpoints.
 *
 * @param environment - The server, the registry and the version prefix.
 * @param context - The service context.
 */
export function registerHistoryRoutes(environment: RouteEnvironment, context: ApiContext): void {
  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/history/state',
      summary: 'Read recorded state changes for one entity',
      tag: 'History',
      permission: 'history:read',
      query: historyQuerySchema.extend(pageQuerySchema.shape),
      response: pageSchema(stateHistoryPointSchema),
    },

    /**
     * Reads state history.
     *
     * @param route - The parsed query and who is asking.
     * @returns A page of changes, newest first.
     */
    async (route): Promise<Page<StateHistoryPoint>> => {
      await authoriseHistory(context, route.identity, route.query.entityId);

      const window = resolveWindow(route.query.from, route.query.to, context.now());
      const result = await readStateHistory(context.db, route.query.entityId, window, {
        limit: route.query.limit,
        ...(route.query.cursor === undefined ? {} : { cursor: route.query.cursor }),
      });

      return result.nextCursor === undefined
        ? { items: result.items }
        : { items: result.items, nextCursor: result.nextCursor };
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/history/telemetry',
      summary: 'Read numeric readings for one entity, raw or rolled up',
      tag: 'History',
      permission: 'history:read',
      query: telemetryQuerySchema.extend(pageQuerySchema.shape),
      response: pageSchema(telemetryPointSchema),
    },

    /**
     * Reads telemetry.
     *
     * @param route - The parsed query and who is asking.
     * @returns A page of readings, newest first.
     */
    async (route): Promise<Page<TelemetryPoint>> => {
      await authoriseHistory(context, route.identity, route.query.entityId);

      const window = resolveWindow(route.query.from, route.query.to, context.now());
      const result = await readTelemetry(
        context.db,
        route.query.entityId,
        route.query.resolution,
        window,
        {
          limit: route.query.limit,
          ...(route.query.cursor === undefined ? {} : { cursor: route.query.cursor }),
        },
      );

      return result.nextCursor === undefined
        ? { items: result.items }
        : { items: result.items, nextCursor: result.nextCursor };
    },
  );
}
