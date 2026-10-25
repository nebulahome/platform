/**
 * Settings › Maintenance (docs/releases-and-updates.md 4): the list of updates, a check, a round
 * of updates, and restarting or shutting down Nebula Home.
 *
 * `system:read` sees the list; `system:update` checks and updates; `system:power` restarts and
 * shuts down. Every action is in the audit log, refused or not.
 */
import { z } from 'zod';

import {
  isNebulaError,
  runSystemUpdatesBodySchema,
  systemUpdatesViewSchema,
  updateRoundSchema,
  type SystemUpdatesView,
  type UpdateRound,
} from '@nebulahome/contracts';

import { requirePermission } from '../auth/permissions.js';
import type { ApiContext } from '../context.js';
import { defineRoute, type RouteEnvironment } from '../http/route.js';
import {
  checkSystemUpdates,
  powerPlatform,
  runSystemUpdates,
  systemUpdates,
  type SystemUpdatesContext,
} from '../services/system-updates.js';

/** What the routes are handed for one request. */
type Route = {
  readonly identity: Parameters<ApiContext['audit']['record']>[0]['identity'];
  readonly request: { readonly ip: string; readonly traceId: string };
};

/**
 * The collaborators the service needs, for one request.
 *
 * @param context - The service's collaborators.
 * @param traceId - The request's trace id.
 * @returns Them.
 */
function updatesContext(context: ApiContext, traceId: string): SystemUpdatesContext {
  return { bus: context.bus, db: context.db, traceId, logger: context.logger };
}

/**
 * Does something and records it in the audit log, however it ended.
 *
 * @param context - The service's collaborators.
 * @param route - Who asked, from where.
 * @param action - What, `system.<action>`.
 * @param work - The doing.
 * @param details - What else is worth recording.
 * @returns What the work returned.
 */
async function audited<TResult>(
  context: ApiContext,
  route: Route,
  action: string,
  work: () => Promise<TResult>,
  details?: Record<string, unknown>,
): Promise<TResult> {
  /**
   * Writes the entry.
   *
   * @param result - How it ended.
   * @returns Once it is written.
   */
  const record = async (result: 'success' | 'denied' | 'failure'): Promise<void> =>
    context.audit.record({
      action: `system.${action}`,
      resourceType: 'system',
      result,
      identity: route.identity,
      ipAddress: route.request.ip,
      traceId: route.request.traceId,
      ...(details === undefined ? {} : { details }),
    });

  try {
    const result = await work();

    await record('success');

    return result;
  } catch (error: unknown) {
    await record(isNebulaError(error) && error.code === 'CONFLICT' ? 'denied' : 'failure');

    throw error;
  }
}

/**
 * Registers the routes.
 *
 * @param environment - Where routes are defined.
 * @param context - The service's collaborators.
 */
export function registerSystemUpdateRoutes(
  environment: RouteEnvironment,
  context: ApiContext,
): void {
  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/system/updates',
      summary: 'Everything that can update: Nebula Home, the packages, the integrations',
      tag: 'System',
      permission: 'system:read',
      response: systemUpdatesViewSchema,
    },

    /**
     * Gathers the list.
     *
     * @param route - Who is asking.
     * @returns The list, and the round running or last run.
     */
    async (route): Promise<SystemUpdatesView> => {
      requirePermission(route.identity, 'system:read');

      return systemUpdates(updatesContext(context, route.request.traceId));
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/system/updates/check',
      summary: "Ask GitHub now for Nebula Home's newest releases",
      tag: 'System',
      permission: 'system:update',
      successStatus: 202,
    },

    /**
     * Checks again.
     *
     * @param route - Who is asking.
     */
    async (route): Promise<void> => {
      requirePermission(route.identity, 'system:update');

      await checkSystemUpdates(updatesContext(context, route.request.traceId));
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/system/updates/run',
      summary: 'Update some rows, or every one: a backup first when the settings say',
      tag: 'System',
      permission: 'system:update',
      body: runSystemUpdatesBodySchema,
      response: z.object({ round: updateRoundSchema.nullable() }),
      successStatus: 202,
    },

    /**
     * Starts a round, answered before it ends.
     *
     * @param route - Who is asking, and what to update.
     * @returns The round as it starts; null when there was nothing to update.
     */
    async (route): Promise<{ round: UpdateRound | null }> => {
      requirePermission(route.identity, 'system:update');

      const round = await audited(
        context,
        route,
        'update',
        async () =>
          runSystemUpdates(updatesContext(context, route.request.traceId), route.body.items, {
            id: route.identity.userId,
            username: route.identity.username,
          }),
        { items: route.body.items ?? 'all' },
      );

      return { round };
    },
  );

  for (const action of ['restart', 'shutdown'] as const) {
    defineRoute(
      environment,
      {
        method: 'POST',
        url: `/system/${action}`,
        summary:
          action === 'restart'
            ? "Restart Nebula Home's container"
            : "Stop Nebula Home's container until it is started again",
        tag: 'System',
        permission: 'system:power',
        successStatus: 202,
      },

      /**
       * Asks the supervisor to do it.
       *
       * @param route - Who is asking.
       */
      async (route): Promise<void> => {
        requirePermission(route.identity, 'system:power');

        await audited(context, route, action, async () =>
          powerPlatform(updatesContext(context, route.request.traceId), action),
        );
      },
    );
  }
}
