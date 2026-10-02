/**
 * The host's containers: the list, one container, its logs, and what can be done to it; and what
 * the owner adds - a container installed from a registry, a compose project written here.
 *
 * Three permissions, because seeing what the machine runs, changing what runs, and putting new
 * things on it are different trust: `container:read` for the page, `container:control` for
 * starting, stopping, restarting and updating, `container:install` for installing, removing and
 * deploying - a container can be handed any folder of the machine, which is the machine's root.
 * The platform's own containers and the ones an integration runs are refused by the supervisor
 * with a `409` whose `reason` says which - the API does not decide that twice.
 *
 * Every action is recorded in the audit log, refused or not: a container stopped from here is a
 * service of the house stopped, and who did it is worth knowing.
 */
import { z } from 'zod';

import {
  composeDefinitionSchema,
  composeDocumentSchema,
  composeProjectNameSchema,
  composeValidationSchema,
  CONTAINER_ACTIONS,
  containerDetailSchema,
  containerInstallRequestSchema,
  containerLogsQuerySchema,
  containerLogsReplySchema,
  containerNameSchema,
  containersViewSchema,
  containerSummarySchema,
  imageDescribeRequestSchema,
  imageDescriptionSchema,
  imageRepositorySchema,
  imageSearchReplySchema,
  imageTagsReplySchema,
  isNebulaError,
  type ComposeDocument,
  type ComposeValidation,
  type ContainerAction,
  type ContainerDetail,
  type ContainerLogsReply,
  type ContainersView,
  type ContainerSummary,
  type ImageDescription,
  type ImageSearchReply,
  type ImageTagsReply,
} from '@nebulahome/contracts';

import { requirePermission } from '../auth/permissions.js';
import type { ApiContext } from '../context.js';
import { defineRoute, type RouteEnvironment } from '../http/route.js';
import {
  checkContainerUpdates,
  controlCompose,
  controlContainer,
  deployCompose,
  describeImage,
  dismissInstall,
  imageTags,
  installContainer,
  listContainers,
  readCompose,
  readContainer,
  readContainerLogs,
  removeCompose,
  removeContainer,
  searchImages,
  updateContainer,
  validateCompose,
  type ContainersContext,
} from '../services/containers.js';

/** The path parameters of one container. */
const containerParamsSchema = z.object({ name: containerNameSchema });

/** The path parameters of one compose project. */
const composeParamsSchema = z.object({ project: composeProjectNameSchema });

/** `GET /container-images/search`. */
const imageSearchQuerySchema = z.object({ q: z.string().trim().min(1).max(128) });

/** `GET /container-images/tags`. */
const imageTagsQuerySchema = z.object({ image: imageRepositorySchema });

/** `DELETE /containers/:name`: whether the volumes Docker made for it alone go too. */
const removeContainerQuerySchema = z.object({ volumes: z.stringbool().default(false) });

/** `DELETE /compose-projects/:project`: whether its volumes and its folder go too. */
const removeComposeQuerySchema = z.object({
  volumes: z.stringbool().default(false),
  files: z.stringbool().default(false),
});

/** `PUT /compose-projects/:project`: the new file and `.env`. */
const composeUpdateSchema = composeDefinitionSchema.omit({ project: true });

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
     * @param route - Who is asking, which container, how many lines and after which cursor.
     * @returns The lines, oldest first, and where the next read carries on.
     */
    async (route): Promise<ContainerLogsReply> => {
      requirePermission(route.identity, 'container:read');

      return readContainerLogs(
        supervisorContext(context, route.request.traceId),
        route.params.name,
        route.query.tail,
        route.query.since,
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

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/container-images/search',
      summary: 'Look for images on Docker Hub',
      tag: 'Containers',
      permission: 'container:install',
      query: imageSearchQuerySchema,
      response: imageSearchReplySchema,
    },

    /**
     * Looks for images.
     *
     * @param route - Who is asking, and what for.
     * @returns What Docker Hub found.
     */
    async (route): Promise<ImageSearchReply> => {
      requirePermission(route.identity, 'container:install');

      return searchImages(supervisorContext(context, route.request.traceId), route.query.q);
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/container-images/tags',
      summary: 'List the tags of an image worth offering, the newest first',
      tag: 'Containers',
      permission: 'container:install',
      query: imageTagsQuerySchema,
      response: imageTagsReplySchema,
    },

    /**
     * Lists an image's tags.
     *
     * @param route - Who is asking, and which image.
     * @returns The tags.
     */
    async (route): Promise<ImageTagsReply> => {
      requirePermission(route.identity, 'container:install');

      return imageTags(supervisorContext(context, route.request.traceId), route.query.image);
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/container-images/describe',
      summary: 'Read what an image declares: its ports, its environment and its volumes',
      tag: 'Containers',
      permission: 'container:install',
      query: imageDescribeRequestSchema,
      response: imageDescriptionSchema,
    },

    /**
     * Reads what an image declares.
     *
     * @param route - Who is asking, which image and which tag.
     * @returns What it declares.
     */
    async (route): Promise<ImageDescription> => {
      requirePermission(route.identity, 'container:install');

      return describeImage(
        supervisorContext(context, route.request.traceId),
        route.query.image,
        route.query.tag,
      );
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/containers',
      summary: 'Pull an image and run a container of it',
      tag: 'Containers',
      permission: 'container:install',
      successStatus: 202,
      body: containerInstallRequestSchema,
    },

    /**
     * Starts an install; the list's installs follow it.
     *
     * @param route - Who is asking, and what the form said.
     */
    async (route): Promise<void> => {
      requirePermission(route.identity, 'container:install');

      await audited(context, route, 'install', route.body.name, async () =>
        installContainer(supervisorContext(context, route.request.traceId), route.body),
      );
    },
  );

  defineRoute(
    environment,
    {
      method: 'DELETE',
      url: '/container-installs/:name',
      summary: 'Forget an install that failed',
      tag: 'Containers',
      permission: 'container:install',
      successStatus: 204,
      params: containerParamsSchema,
    },

    /**
     * Forgets it.
     *
     * @param route - Who is asking, and which container.
     */
    async (route): Promise<void> => {
      requirePermission(route.identity, 'container:install');

      await dismissInstall(supervisorContext(context, route.request.traceId), route.params.name);
    },
  );

  defineRoute(
    environment,
    {
      method: 'DELETE',
      url: '/containers/:name',
      summary: 'Stop and remove a container',
      tag: 'Containers',
      permission: 'container:install',
      successStatus: 204,
      params: containerParamsSchema,
      query: removeContainerQuerySchema,
    },

    /**
     * Removes it.
     *
     * @param route - Who is asking, which container, and whether its own volumes go too.
     */
    async (route): Promise<void> => {
      requirePermission(route.identity, 'container:install');

      await audited(context, route, 'remove', route.params.name, async () =>
        removeContainer(
          supervisorContext(context, route.request.traceId),
          route.params.name,
          route.query.volumes,
        ),
      );
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/compose-projects/validate',
      summary: 'Check a compose file without running anything',
      tag: 'Containers',
      permission: 'container:install',
      successStatus: 200,
      body: composeDefinitionSchema,
      response: composeValidationSchema,
    },

    /**
     * Checks it.
     *
     * @param route - Who is asking, and the file.
     * @returns What is wrong, and the services it declares.
     */
    async (route): Promise<ComposeValidation> => {
      requirePermission(route.identity, 'container:install');

      return validateCompose(supervisorContext(context, route.request.traceId), route.body);
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/compose-projects',
      summary: 'Keep a compose file and bring its project up',
      tag: 'Containers',
      permission: 'container:install',
      successStatus: 202,
      body: composeDefinitionSchema,
    },

    /**
     * Deploys it; the list's compose operations follow it.
     *
     * @param route - Who is asking, and the file.
     */
    async (route): Promise<void> => {
      requirePermission(route.identity, 'container:install');

      await audited(
        context,
        route,
        'deploy',
        route.body.project,
        async () => deployCompose(supervisorContext(context, route.request.traceId), route.body),
        'compose_project',
      );
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/compose-projects/:project',
      summary: 'Read the file and the .env of a compose project deployed from here',
      tag: 'Containers',
      permission: 'container:install',
      params: composeParamsSchema,
      response: composeDocumentSchema,
    },

    /**
     * Reads them.
     *
     * @param route - Who is asking, and which project.
     * @returns The file and the `.env`.
     */
    async (route): Promise<ComposeDocument> => {
      requirePermission(route.identity, 'container:install');

      return readCompose(supervisorContext(context, route.request.traceId), route.params.project);
    },
  );

  defineRoute(
    environment,
    {
      method: 'PUT',
      url: '/compose-projects/:project',
      summary: 'Change the file of a compose project deployed from here, and bring it up again',
      tag: 'Containers',
      permission: 'container:install',
      successStatus: 202,
      params: composeParamsSchema,
      body: composeUpdateSchema,
    },

    /**
     * Deploys the new file.
     *
     * @param route - Who is asking, which project, and the file.
     */
    async (route): Promise<void> => {
      requirePermission(route.identity, 'container:install');

      await audited(
        context,
        route,
        'deploy',
        route.params.project,
        async () =>
          deployCompose(supervisorContext(context, route.request.traceId), {
            project: route.params.project,
            ...route.body,
          }),
        'compose_project',
      );
    },
  );

  for (const action of ['start', 'stop', 'pull'] as const) {
    defineRoute(
      environment,
      {
        method: 'POST',
        url: `/compose-projects/:project/${action}`,
        summary:
          action === 'pull'
            ? 'Pull the newest images of a compose project and bring it up on them'
            : `${action === 'start' ? 'Start' : 'Stop'} every service of a compose project`,
        tag: 'Containers',
        permission: action === 'pull' ? 'container:install' : 'container:control',
        successStatus: 202,
        params: composeParamsSchema,
      },

      /**
       * Does it.
       *
       * @param route - Who is asking, and which project.
       */
      async (route): Promise<void> => {
        requirePermission(
          route.identity,
          action === 'pull' ? 'container:install' : 'container:control',
        );

        await audited(
          context,
          route,
          action,
          route.params.project,
          async () =>
            controlCompose(
              supervisorContext(context, route.request.traceId),
              route.params.project,
              action,
            ),
          'compose_project',
        );
      },
    );
  }

  defineRoute(
    environment,
    {
      method: 'DELETE',
      url: '/compose-projects/:project',
      summary: 'Take a compose project deployed from here down, and forget it',
      tag: 'Containers',
      permission: 'container:install',
      successStatus: 202,
      params: composeParamsSchema,
      query: removeComposeQuerySchema,
    },

    /**
     * Removes it.
     *
     * @param route - Who is asking, which project, and how much of it goes.
     */
    async (route): Promise<void> => {
      requirePermission(route.identity, 'container:install');

      await audited(
        context,
        route,
        'remove',
        route.params.project,
        async () =>
          removeCompose(
            supervisorContext(context, route.request.traceId),
            route.params.project,
            route.query.volumes,
            route.query.files,
          ),
        'compose_project',
      );
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
 * @param name - Which container, or which compose project.
 * @param work - The work.
 * @param resourceType - What `name` names.
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
  resourceType: 'container' | 'compose_project' = 'container',
): Promise<TResult> {
  try {
    const result = await work();

    await context.audit.record({
      action: `${resourceType}.${action}`,
      resourceType,
      resourceId: name,
      result: 'success',
      identity: route.identity,
      ipAddress: route.request.ip,
      traceId: route.request.traceId,
    });

    return result;
  } catch (error: unknown) {
    await context.audit.record({
      action: `${resourceType}.${action}`,
      resourceType,
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
