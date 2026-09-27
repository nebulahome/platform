/**
 * The host's containers, as `api` serves them: everything is asked of the supervisor, which is
 * the one service that may reach Docker.
 *
 * A supervisor that is not running is not an error for the list: the page is the place that says
 * Docker cannot be seen, and why, so the list answers with Docker unavailable rather than a 503
 * the page would have to translate. Everything else - one container, its logs, an action - needs
 * the supervisor, and says so as a 503 when it is away.
 */
import type { BusClient } from '@nebula-home/bus';
import {
  busSubjects,
  containerDetailSchema,
  containerListReplySchema,
  containerLogsReplySchema,
  containerSummarySchema,
  DeviceUnavailableError,
  managedReplySchema,
  SUPERVISOR_METHODS,
  SUPERVISOR_SERVICE,
  supervisorAcknowledgementSchema,
  type ContainerAction,
  type ContainerDetail,
  type ContainerLogsReply,
  type ContainerSummary,
  type ContainersView,
  type ManagedStatus,
} from '@nebula-home/contracts';
import type { PlatformLogger } from '@nebula-home/logging';

/** How long a read may take. */
const READ_TIMEOUT_MS = 10_000;

/** How long starting, stopping or restarting may take: a container is given twenty seconds to stop. */
const CONTROL_TIMEOUT_MS = 45_000;

/** How long a vendor's page waits for its containers' statuses before showing none. */
const STATUS_TIMEOUT_MS = 3_000;

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

    return { docker: reply.docker, items: reply.containers };
  } catch (error: unknown) {
    context.logger.warn({ err: error }, 'The supervisor did not answer for the containers');

    return {
      docker: {
        isAvailable: false,
        version: null,
        apiVersion: null,
        reason: 'The supervisor is not running, so Docker cannot be asked',
        platformNetwork: null,
      },
      items: [],
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
 * @returns The lines, oldest first.
 */
export async function readContainerLogs(
  context: ContainersContext,
  name: string,
  tail: number,
): Promise<ContainerLogsReply> {
  return askSupervisor(context, SUPERVISOR_METHODS.logs, { name, tail }, containerLogsReplySchema);
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
