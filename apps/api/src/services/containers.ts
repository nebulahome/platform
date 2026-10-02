/**
 * The host's containers, as `api` serves them: everything is asked of the supervisor, which is
 * the one service that may reach Docker.
 *
 * A supervisor that is not running is not an error for the list: the page is the place that says
 * Docker cannot be seen, and why, so the list answers with Docker unavailable rather than a 503
 * the page would have to translate. Everything else - one container, its logs, an action - needs
 * the supervisor, and says so as a 503 when it is away.
 */
import type { BusClient } from '@nebulahome/bus';
import {
  busSubjects,
  composeDocumentSchema,
  composeValidationSchema,
  containerDetailSchema,
  containerListReplySchema,
  containerLogsReplySchema,
  containerSummarySchema,
  DeviceUnavailableError,
  imageDescriptionSchema,
  imageSearchReplySchema,
  imageTagsReplySchema,
  managedReplySchema,
  SUPERVISOR_METHODS,
  SUPERVISOR_SERVICE,
  supervisorAcknowledgementSchema,
  type ComposeDefinition,
  type ComposeDocument,
  type ComposeValidation,
  type ContainerAction,
  type ContainerDetail,
  type ContainerInstallRequest,
  type ContainerLogsReply,
  type ContainerSummary,
  type ContainersView,
  type ImageDescription,
  type ImageSearchReply,
  type ImageTagsReply,
  type ManagedStatus,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';

/** How long a read may take. */
const READ_TIMEOUT_MS = 10_000;

/** How long starting, stopping or restarting may take: a container is given twenty seconds to stop. */
const CONTROL_TIMEOUT_MS = 45_000;

/** How long a vendor's page waits for its containers' statuses before showing none. */
const STATUS_TIMEOUT_MS = 3_000;

/** How long asking a registry may take: Docker Hub, then the supervisor's reply. */
const REGISTRY_TIMEOUT_MS = 25_000;

/** How long checking a compose file may take: `docker compose config` reads it the way `up` will. */
const COMPOSE_TIMEOUT_MS = 30_000;

/** What asking the supervisor needs. */
export type ContainersContext = {
  readonly bus: BusClient | undefined;
  readonly traceId: string;
  readonly logger: PlatformLogger;
};

/**
 * Asks the supervisor one of its methods.
 *
 * @param context - The bus and the trace id.
 * @param method - The method.
 * @param payload - The request.
 * @param reply - The reply's schema.
 * @param timeoutMs - How long it may take.
 * @returns The reply.
 * @throws {DeviceUnavailableError} When the bus is away or the supervisor does not answer.
 */
async function askSupervisor<TReply>(
  context: ContainersContext,
  method: (typeof SUPERVISOR_METHODS)[keyof typeof SUPERVISOR_METHODS],
  payload: unknown,
  reply: { parse: (value: unknown) => TReply } & Parameters<BusClient['request']>[2],
  timeoutMs = READ_TIMEOUT_MS,
): Promise<TReply> {
  if (context.bus === undefined) {
    throw new DeviceUnavailableError('The message bus is not reachable', {
      details: { dependency: 'bus' },
    });
  }

  return (await context.bus.request(
    busSubjects.service(SUPERVISOR_SERVICE, method),
    payload,
    reply,
    {
      traceId: context.traceId,
      timeoutMs,
    },
  )) as TReply;
}

/**
 * Every container, and whether Docker can be seen at all.
 *
 * @param context - The bus.
 * @returns Docker's status and the containers; Docker unavailable, naming why, when the
 * supervisor does not answer.
 */
export async function listContainers(context: ContainersContext): Promise<ContainersView> {
  try {
    const reply = await askSupervisor(
      context,
      SUPERVISOR_METHODS.list,
      {},
      containerListReplySchema,
    );

    return {
      docker: reply.docker,
      items: reply.containers,
      installs: reply.installs,
      composeOperations: reply.composeOperations,
    };
  } catch (error: unknown) {
    context.logger.warn({ err: error }, 'The supervisor did not answer for the containers');

    return {
      docker: {
        isAvailable: false,
        version: null,
        apiVersion: null,
        reason: 'The supervisor is not running, so Docker cannot be asked',
        platformNetwork: null,
        composeVersion: null,
      },
      items: [],
      installs: [],
      composeOperations: [],
    };
  }
}

/**
 * One container, with everything its page shows.
 *
 * @param context - The bus.
 * @param name - Its name.
 * @returns The container.
 */
export async function readContainer(
  context: ContainersContext,
  name: string,
): Promise<ContainerDetail> {
  return askSupervisor(context, SUPERVISOR_METHODS.inspect, { name }, containerDetailSchema);
}

/**
 * The last lines a container wrote.
 *
 * @param context - The bus.
 * @param name - Its name.
 * @param tail - How many lines.
 * @param since - Only the lines after this cursor, which the last read answered.
 * @returns The lines, oldest first, and where the next read carries on.
 */
export async function readContainerLogs(
  context: ContainersContext,
  name: string,
  tail: number,
  since?: string,
): Promise<ContainerLogsReply> {
  return askSupervisor(
    context,
    SUPERVISOR_METHODS.logs,
    { name, tail, ...(since === undefined ? {} : { since }) },
    containerLogsReplySchema,
  );
}

/**
 * Starts, stops or restarts a container.
 *
 * @param context - The bus.
 * @param name - Its name.
 * @param action - What to do.
 * @returns The container as it now is.
 * @throws {ConflictError} When it is the platform's own, or an integration runs it.
 */
export async function controlContainer(
  context: ContainersContext,
  name: string,
  action: ContainerAction,
): Promise<ContainerSummary> {
  return askSupervisor(
    context,
    SUPERVISOR_METHODS.control,
    { name, action },
    containerSummarySchema,
    CONTROL_TIMEOUT_MS,
  );
}

/**
 * Starts updating a container to the newest image on offer.
 *
 * @param context - The bus.
 * @param name - Its name.
 */
export async function updateContainer(context: ContainersContext, name: string): Promise<void> {
  await askSupervisor(
    context,
    SUPERVISOR_METHODS.update,
    { name },
    supervisorAcknowledgementSchema,
  );
}

/**
 * Asks the registries now whether newer images are out.
 *
 * @param context - The bus.
 */
export async function checkContainerUpdates(context: ContainersContext): Promise<void> {
  await askSupervisor(
    context,
    SUPERVISOR_METHODS.checkUpdates,
    {},
    supervisorAcknowledgementSchema,
  );
}

/**
 * Looks for images on Docker Hub.
 *
 * @param context - The bus.
 * @param query - What to look for.
 * @returns What Docker Hub found.
 */
export async function searchImages(
  context: ContainersContext,
  query: string,
): Promise<ImageSearchReply> {
  return askSupervisor(
    context,
    SUPERVISOR_METHODS.searchImages,
    { query },
    imageSearchReplySchema,
    REGISTRY_TIMEOUT_MS,
  );
}

/**
 * The tags of an image worth offering.
 *
 * @param context - The bus.
 * @param image - The image, without a tag.
 * @returns The tags, the newest first.
 */
export async function imageTags(
  context: ContainersContext,
  image: string,
): Promise<ImageTagsReply> {
  return askSupervisor(
    context,
    SUPERVISOR_METHODS.imageTags,
    { image },
    imageTagsReplySchema,
    REGISTRY_TIMEOUT_MS,
  );
}

/**
 * What an image declares: its ports, its environment, its volumes.
 *
 * @param context - The bus.
 * @param image - The image, without a tag.
 * @param tag - The tag.
 * @returns What it declares.
 */
export async function describeImage(
  context: ContainersContext,
  image: string,
  tag: string,
): Promise<ImageDescription> {
  return askSupervisor(
    context,
    SUPERVISOR_METHODS.describeImage,
    { image, tag },
    imageDescriptionSchema,
    REGISTRY_TIMEOUT_MS,
  );
}

/**
 * Starts installing a container; the page follows it in the list's installs.
 *
 * @param context - The bus.
 * @param request - What the form said.
 */
export async function installContainer(
  context: ContainersContext,
  request: ContainerInstallRequest,
): Promise<void> {
  await askSupervisor(
    context,
    SUPERVISOR_METHODS.install,
    request,
    supervisorAcknowledgementSchema,
  );
}

/**
 * Forgets an install that failed.
 *
 * @param context - The bus.
 * @param name - The container's name.
 */
export async function dismissInstall(context: ContainersContext, name: string): Promise<void> {
  await askSupervisor(
    context,
    SUPERVISOR_METHODS.dismissInstall,
    { name },
    supervisorAcknowledgementSchema,
  );
}

/**
 * Stops and removes a container.
 *
 * @param context - The bus.
 * @param name - Its name.
 * @param removeVolumes - Also the volumes Docker made for it alone.
 * @throws {ConflictError} When it is a system container, or an integration runs it.
 */
export async function removeContainer(
  context: ContainersContext,
  name: string,
  removeVolumes: boolean,
): Promise<void> {
  await askSupervisor(
    context,
    SUPERVISOR_METHODS.remove,
    { name, removeVolumes },
    supervisorAcknowledgementSchema,
    CONTROL_TIMEOUT_MS,
  );
}

/**
 * Checks a compose file without running anything.
 *
 * @param context - The bus.
 * @param definition - The project, its file and its `.env`.
 * @returns What is wrong, and the services it declares.
 */
export async function validateCompose(
  context: ContainersContext,
  definition: ComposeDefinition,
): Promise<ComposeValidation> {
  return askSupervisor(
    context,
    SUPERVISOR_METHODS.composeValidate,
    definition,
    composeValidationSchema,
    COMPOSE_TIMEOUT_MS,
  );
}

/**
 * Keeps a compose file and brings its project up with it.
 *
 * @param context - The bus.
 * @param definition - The project, its file and its `.env`.
 * @throws {ValidationError} When the file cannot run, with the problems in `details.problems`.
 */
export async function deployCompose(
  context: ContainersContext,
  definition: ComposeDefinition,
): Promise<void> {
  await askSupervisor(
    context,
    SUPERVISOR_METHODS.composeDeploy,
    definition,
    supervisorAcknowledgementSchema,
    COMPOSE_TIMEOUT_MS,
  );
}

/**
 * The file and `.env` of a project deployed from here.
 *
 * @param context - The bus.
 * @param project - The project.
 * @returns Them.
 */
export async function readCompose(
  context: ContainersContext,
  project: string,
): Promise<ComposeDocument> {
  return askSupervisor(context, SUPERVISOR_METHODS.composeGet, { project }, composeDocumentSchema);
}

/**
 * Starts, stops, or pulls newer images for a project deployed from here.
 *
 * @param context - The bus.
 * @param project - The project.
 * @param action - What to do.
 */
export async function controlCompose(
  context: ContainersContext,
  project: string,
  action: 'start' | 'stop' | 'pull',
): Promise<void> {
  await askSupervisor(
    context,
    SUPERVISOR_METHODS.composeControl,
    { project, action },
    supervisorAcknowledgementSchema,
  );
}

/**
 * Takes a project deployed from here down, and forgets it.
 *
 * @param context - The bus.
 * @param project - The project.
 * @param removeVolumes - Also its volumes.
 * @param removeFiles - Also its folder.
 */
export async function removeCompose(
  context: ContainersContext,
  project: string,
  removeVolumes: boolean,
  removeFiles: boolean,
): Promise<void> {
  await askSupervisor(
    context,
    SUPERVISOR_METHODS.composeRemove,
    { project, removeVolumes, removeFiles },
    supervisorAcknowledgementSchema,
  );
}

/**
 * Where the containers a vendor depends on stand, for its page. Best effort: a supervisor that
 * does not answer leaves the page without them rather than without the vendor.
 *
 * @param context - The bus.
 * @param vendorId - The vendor.
 * @param count - How many containers it declares.
 * @returns One status per declared container, null each when the supervisor did not answer.
 */
export async function containerStatusesOf(
  context: ContainersContext,
  vendorId: string,
  count: number,
): Promise<(ManagedStatus | null)[]> {
  if (count === 0) {
    return [];
  }

  try {
    const reply = await askSupervisor(
      context,
      SUPERVISOR_METHODS.managed,
      { vendorId },
      managedReplySchema,
      STATUS_TIMEOUT_MS,
    );

    return Array.from({ length: count }, (unused, index) => reply.containers[index] ?? null);
  } catch (error: unknown) {
    context.logger.debug({ err: error, vendorId }, 'No container statuses for the vendor');

    return Array.from({ length: count }, () => null);
  }
}
