/**
 * The host's containers: the list, one container, its logs, and what can be done to it.
 *
 * Two permissions, because seeing what the machine runs and changing it are different trust:
 * `container:read` for the page, `container:control` for starting, stopping, restarting and
 * updating. The platform's own container and the ones an integration runs are refused by the
 * supervisor with a `409` whose `reason` says which - the API does not decide that twice.
 *
 * Every action is recorded in the audit log, refused or not: a container stopped from here is a
 * service of the house stopped, and who did it is worth knowing.
 */
import { z } from 'zod';

import {
  CONTAINER_ACTIONS,
  containerDetailSchema,
  containerLogsQuerySchema,
  containerLogsReplySchema,
  containerNameSchema,
  containersViewSchema,
  containerSummarySchema,
  isNebulaError,
  type ContainerAction,
  type ContainerDetail,
  type ContainerLogsReply,
  type ContainersView,
  type ContainerSummary,
} from '@nebula-home/contracts';

import { requirePermission } from '../auth/permissions.js';
import type { ApiContext } from '../context.js';
import { defineRoute, type RouteEnvironment } from '../http/route.js';
import {
  checkContainerUpdates,
  controlContainer,
  listContainers,
  readContainer,
  readContainerLogs,
  updateContainer,
  type ContainersContext,
} from '../services/containers.js';

/** The path parameters of one container. */
const containerParamsSchema = z.object({ name: containerNameSchema });

/**
 * What asking the supervisor needs, for one request.
 *
 * @param context - The service's collaborators.
 * @param traceId - The request's trace id.
 * @returns The context.
 */
function supervisorContext(context: ApiContext, traceId: string): ContainersContext {
  return { bus: context.bus, traceId, logger: context.logger };
}

/**
 * Registers the container routes.
 *
 * @param environment - Where routes are defined.
 * @param context - The service's collaborators.
 */
export function registerContainerRoutes(environment: RouteEnvironment, context: ApiContext): void {
  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/containers',
      summary: 'List the containers the machine runs, and whether Docker can be seen',
      tag: 'Containers',
      permission: 'container:read',
      response: containersViewSchema,
    },

    /**
     * Lists the containers.
     *
     * @param route - Who is asking.
     * @returns Docker's status and every container.
     */
    async (route): Promise<ContainersView> => {
      requirePermission(route.identity, 'container:read');

      return listContainers(supervisorContext(context, route.request.traceId));
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/containers/:name',
      summary: 'Read one container: its image, its settings, its network, its storage',
      tag: 'Containers',
      permission: 'container:read',
      params: containerParamsSchema,
      response: containerDetailSchema,
    },

    /**
     * Reads one container.
     *
     * @param route - Who is asking, and which container.
     * @returns The container.
     */
    async (route): Promise<ContainerDetail> => {
      requirePermission(route.identity, 'container:read');

      return readContainer(supervisorContext(context, route.request.traceId), route.params.name);
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/containers/:name/logs',
      summary: 'Read the last lines a container wrote',
      tag: 'Containers',
      permission: 'container:read',
      params: containerParamsSchema,
      query: containerLogsQuerySchema,
      response: containerLogsReplySchema,
    },

    /**
     * Reads a container's logs.
     *
     * @param route - Who is asking, which container and how many lines.
     * @returns The lines, oldest first.
     */
    async (route): Promise<ContainerLogsReply> => {
      requirePermission(route.identity, 'container:read');

      return readContainerLogs(
        supervisorContext(context, route.request.traceId),
        route.params.name,
        route.query.tail,
      );
    },
  );

  for (const action of CONTAINER_ACTIONS) {
    registerAction(environment, context, action);
  }

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/containers/:name/update',
      summary: 'Pull the newest image and make the container again on it',
      tag: 'Containers',
      permission: 'container:control',
      successStatus: 202,
      params: containerParamsSchema,
    },

    /**
     * Starts an update; its progress is the container's image entity.
     *
     * @param route - Who is asking, and which container.
     */
    async (route): Promise<void> => {
      requirePermission(route.identity, 'container:control');

      await audited(context, route, 'update', route.params.name, async () =>
        updateContainer(supervisorContext(context, route.request.traceId), route.params.name),
      );
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/containers/check-updates',
      summary: 'Ask the registries now whether newer images are out',
      tag: 'Containers',
      permission: 'container:control',
      successStatus: 202,
    },

    /**
     * Starts a check.
     *
     * @param route - Who is asking.
     */
    async (route): Promise<void> => {
      requirePermission(route.identity, 'container:control');

      await checkContainerUpdates(supervisorContext(context, route.request.traceId));
    },
  );
}

/**
 * Registers one of start, stop and restart.
 *
 * @param environment - Where routes are defined.
 * @param context - The service's collaborators.
 * @param action - Which one.
 */
function registerAction(
  environment: RouteEnvironment,
  context: ApiContext,
  action: ContainerAction,
): void {
  defineRoute(
    environment,
    {
      method: 'POST',
      url: `/containers/:name/${action}`,
      summary: `${action.charAt(0).toUpperCase()}${action.slice(1)} a container`,
      tag: 'Containers',
      permission: 'container:control',
      successStatus: 200,
      params: containerParamsSchema,
      response: containerSummarySchema,
    },

    /**
     * Does it.
     *
     * @param route - Who is asking, and which container.
     * @returns The container as it now is.
     */
    async (route): Promise<ContainerSummary> => {
      requirePermission(route.identity, 'container:control');

      return audited(context, route, action, route.params.name, async () =>
        controlContainer(
          supervisorContext(context, route.request.traceId),
          route.params.name,
          action,
        ),
      );
    },
  );
}

/**
 * Does something to a container and records it, whether it worked or was refused.
 *
 * @param context - The service's collaborators.
 * @param route - The request.
 * @param route.identity - Who asked.
 * @param route.request - The request, for its address and trace id.
 * @param route.request.ip - Where from.
 * @param route.request.traceId - Its trace id.
 * @param action - What was asked.
 * @param name - Which container.
 * @param work - The work.
 * @returns What the work returned.
 */
async function audited<TResult>(
  context: ApiContext,
  route: {
    readonly identity: Parameters<ApiContext['audit']['record']>[0]['identity'];
    readonly request: { readonly ip: string; readonly traceId: string };
  },
  action: string,
  name: string,
  work: () => Promise<TResult>,
): Promise<TResult> {
  try {
    const result = await work();

    await context.audit.record({
      action: `container.${action}`,
      resourceType: 'container',
      resourceId: name,
      result: 'success',
      identity: route.identity,
      ipAddress: route.request.ip,
      traceId: route.request.traceId,
    });

    return result;
  } catch (error: unknown) {
    await context.audit.record({
      action: `container.${action}`,
      resourceType: 'container',
      resourceId: name,
      result: isNebulaError(error) && error.code === 'CONFLICT' ? 'denied' : 'failure',
      identity: route.identity,
      ipAddress: route.request.ip,
      traceId: route.request.traceId,
      details: { message: error instanceof Error ? error.message.slice(0, 500) : 'unknown' },
    });

    throw error;
  }
}
