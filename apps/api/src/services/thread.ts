/**
 * The house's Thread broker, read through and driven: `hub` holds it (ARCHITECTURE.md 4.2).
 *
 * Everything here is a question to the hub, which drives the border router - the platform's own
 * or the owner's - and asks the supervisor to start and stop it. Several questions wait on OTBR,
 * the leader or the supervisor, so each is asked with the time the hub says it needs
 * (`apps/hub/src/thread/broker.ts`). The network key and the dataset are read from OTBR each time
 * and never kept here.
 */
import type { z } from 'zod';

import {
  busSubjects,
  HUB_SERVICE,
  HUB_THREAD_BORDER_ROUTERS_METHOD,
  HUB_THREAD_DATASET_METHOD,
  HUB_THREAD_DEVICES_METHOD,
  HUB_THREAD_JOIN_METHOD,
  HUB_THREAD_NETWORK_KEY_METHOD,
  HUB_THREAD_RADIO_CHECK_METHOD,
  HUB_THREAD_RADIOS_METHOD,
  HUB_THREAD_REMOVE_METHOD,
  HUB_THREAD_RESTART_METHOD,
  HUB_THREAD_SETTINGS_METHOD,
  HUB_THREAD_SETUP_METHOD,
  HUB_THREAD_STATUS_METHOD,
  threadBorderRoutersReplySchema,
  threadDatasetReplySchema,
  threadDevicesReplySchema,
  threadNetworkKeyReplySchema,
  threadRadioCheckReplySchema,
  threadRadiosReplySchema,
  threadRemoveReplySchema,
  threadStatusSchema,
  type ThreadStatus,
} from '@nebulahome/contracts';

import { busOf, type IntegrationsContext } from './integrations.js';

/** How long a question that reads OTBR, asks a radio or the supervisor may take. */
const OTBR_TIMEOUT_MS = 10_000;

/** How long reading the network's nodes, its key or its dataset may take. */
const OTBR_READ_TIMEOUT_MS = 15_000;

/** How long a settings change may take: a channel change waits on the leader. */
const SETTINGS_TIMEOUT_MS = 40_000;

/** How long joining, restarting or removing may take: stopping the border router waits 20 s. */
const SERVICE_TIMEOUT_MS = 35_000;

/**
 * Asks the hub one of the broker's methods.
 *
 * @param context - The request's collaborators.
 * @param method - The method.
 * @param body - What it is asked.
 * @param schema - What the answer must be.
 * @param timeoutMs - How long the hub has.
 * @returns The answer.
 * @throws {DeviceUnavailableError} When the hub cannot be asked.
 */
export async function askThread<TSchema extends z.ZodType>(
  context: IntegrationsContext,
  method: string,
  body: object,
  schema: TSchema,
  timeoutMs: number,
): Promise<z.output<TSchema>> {
  return busOf(context).request(busSubjects.service(HUB_SERVICE, method), body, schema, {
    traceId: context.traceId,
    timeoutMs,
  });
}

/**
 * Where the broker stands.
 *
 * @param context - The request's collaborators.
 * @returns Its state.
 */
export async function threadStatus(context: IntegrationsContext): Promise<ThreadStatus> {
  return askThread(context, HUB_THREAD_STATUS_METHOD, {}, threadStatusSchema, OTBR_TIMEOUT_MS);
}

/**
 * The free serial ports a radio may be on.
 *
 * @param context - The request's collaborators.
 * @returns Them, the recognised radios first.
 */
export async function threadRadios(context: IntegrationsContext) {
  return askThread(context, HUB_THREAD_RADIOS_METHOD, {}, threadRadiosReplySchema, OTBR_TIMEOUT_MS);
}

/**
 * Asks a radio which firmware it runs.
 *
 * @param context - The request's collaborators.
 * @param portId - Its port.
 * @returns The firmware, or why it could not be asked.
 * @throws {ConflictError} While a setup runs, or when another holder has the port.
 */
export async function checkThreadRadio(context: IntegrationsContext, portId: string) {
  return askThread(
    context,
    HUB_THREAD_RADIO_CHECK_METHOD,
    { portId },
    threadRadioCheckReplySchema,
    OTBR_TIMEOUT_MS,
  );
}

/**
 * Starts setting Thread up; the job is in the status the page then reads.
 *
 * @param context - The request's collaborators.
 * @param request - The border router, the network, and the hand-off to Matter.
 * @returns Where the broker stands, setting up.
 * @throws {ConflictError} When a setup runs, or the server cannot run Thread.
 */
export async function setUpThread(context: IntegrationsContext, request: object) {
  return askThread(context, HUB_THREAD_SETUP_METHOD, request, threadStatusSchema, OTBR_TIMEOUT_MS);
}

/**
 * Saves the owner's settings; a channel change goes out as a pending dataset.
 *
 * @param context - The request's collaborators.
 * @param request - The network's name and channel, and the hand-off to Matter.
 * @returns Where the broker stands then.
 */
export async function saveThreadSettings(context: IntegrationsContext, request: object) {
  return askThread(
    context,
    HUB_THREAD_SETTINGS_METHOD,
    request,
    threadStatusSchema,
    SETTINGS_TIMEOUT_MS,
  );
}

/**
 * Joins another network by its dataset, leaving the current one.
 *
 * @param context - The request's collaborators.
 * @param request - The dataset.
 * @returns Where the broker stands then.
 */
export async function joinThread(context: IntegrationsContext, request: object) {
  return askThread(
    context,
    HUB_THREAD_JOIN_METHOD,
    request,
    threadStatusSchema,
    SERVICE_TIMEOUT_MS,
  );
}

/**
 * Restarts the platform's border router.
 *
 * @param context - The request's collaborators.
 * @returns Where the broker stands then.
 * @throws {ConflictError} For an external border router.
 */
export async function restartThread(context: IntegrationsContext) {
  return askThread(context, HUB_THREAD_RESTART_METHOD, {}, threadStatusSchema, SERVICE_TIMEOUT_MS);
}

/**
 * Removes the border router: Thread is not set up afterwards.
 *
 * @param context - The request's collaborators.
 * @returns Whether there was one.
 */
export async function removeThread(context: IntegrationsContext) {
  return askThread(
    context,
    HUB_THREAD_REMOVE_METHOD,
    {},
    threadRemoveReplySchema,
    SERVICE_TIMEOUT_MS,
  );
}

/**
 * Reads the network key from the border router.
 *
 * @param context - The request's collaborators.
 * @returns It.
 */
export async function threadNetworkKey(context: IntegrationsContext) {
  return askThread(
    context,
    HUB_THREAD_NETWORK_KEY_METHOD,
    {},
    threadNetworkKeyReplySchema,
    OTBR_READ_TIMEOUT_MS,
  );
}

/**
 * Reads the active dataset from the border router.
 *
 * @param context - The request's collaborators.
 * @returns It, as TLV hex.
 */
export async function threadDataset(context: IntegrationsContext) {
  return askThread(
    context,
    HUB_THREAD_DATASET_METHOD,
    {},
    threadDatasetReplySchema,
    OTBR_READ_TIMEOUT_MS,
  );
}

/**
 * The border routers heard on the network.
 *
 * @param context - The request's collaborators.
 * @returns Them, this server's first.
 */
export async function threadBorderRouters(context: IntegrationsContext) {
  return askThread(
    context,
    HUB_THREAD_BORDER_ROUTERS_METHOD,
    {},
    threadBorderRoutersReplySchema,
    OTBR_TIMEOUT_MS,
  );
}

/**
 * The nodes of the network.
 *
 * @param context - The request's collaborators.
 * @returns Them, the house's devices first.
 */
export async function threadDevices(context: IntegrationsContext) {
  return askThread(
    context,
    HUB_THREAD_DEVICES_METHOD,
    {},
    threadDevicesReplySchema,
    OTBR_READ_TIMEOUT_MS,
  );
}
