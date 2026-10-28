/**
 * The house's Thread network, as its page reads and drives it (`/api/v1/brokers/thread`): the
 * border router and its radio, the network's credentials, the devices on it, the border routers
 * heard, and the jobs that set it up, join another network or take it down.
 */
import {
  threadBorderRoutersReplySchema,
  threadDatasetReplySchema,
  threadDevicesReplySchema,
  threadNetworkKeyReplySchema,
  threadRadioCheckReplySchema,
  threadRadiosReplySchema,
  threadRemoveReplySchema,
  threadStatusSchema,
  type ThreadBorderRouter,
  type ThreadDevice,
  type ThreadRadio,
  type ThreadSetupRequest,
  type ThreadStatus,
} from '@nebulahome/contracts';

import { apiRequest } from '@/lib/api-client';

/** The keys the network is cached under: below `brokers`, so reading the brokers again reads it. */
export const THREAD_QUERY_KEYS = {
  status: ['brokers', 'thread', 'status'] as const,
  radios: ['brokers', 'thread', 'radios'] as const,
  devices: ['brokers', 'thread', 'devices'] as const,
  borderRouters: ['brokers', 'thread', 'border-routers'] as const,
};

/**
 * The options of a read: its abort signal, when it has one.
 *
 * @param signal - Cancels the request.
 * @returns The options.
 */
function readOptions(signal: AbortSignal | undefined) {
  return signal === undefined ? {} : { signal };
}

/**
 * Reads where the network stands.
 *
 * @param signal - Cancels the request.
 * @returns Its state, border router, radio, network and setup job.
 */
export async function fetchThreadStatus(signal?: AbortSignal): Promise<ThreadStatus> {
  return apiRequest('/brokers/thread', threadStatusSchema, readOptions(signal));
}

/**
 * Lists the ports a radio could be on: free ones, recognised radios first.
 *
 * @param signal - Cancels the request.
 * @returns Them.
 */
export async function fetchThreadRadios(signal?: AbortSignal): Promise<ThreadRadio[]> {
  return (await apiRequest('/brokers/thread/radios', threadRadiosReplySchema, readOptions(signal)))
    .items;
}

/**
 * Lists the devices on the network, unknown nodes too.
 *
 * @param signal - Cancels the request.
 * @returns Them, the house's first.
 */
export async function fetchThreadDevices(signal?: AbortSignal): Promise<ThreadDevice[]> {
  return (
    await apiRequest('/brokers/thread/devices', threadDevicesReplySchema, readOptions(signal))
  ).items;
}

/**
 * Lists the border routers heard on the network.
 *
 * @param signal - Cancels the request.
 * @returns Them, this server first.
 */
export async function fetchThreadBorderRouters(
  signal?: AbortSignal,
): Promise<ThreadBorderRouter[]> {
  return (
    await apiRequest(
      '/brokers/thread/border-routers',
      threadBorderRoutersReplySchema,
      readOptions(signal),
    )
  ).items;
}

/**
 * Asks a port which firmware its radio runs.
 *
 * @param portId - The port.
 * @returns The firmware, its version, or why it could not be asked.
 */
export async function checkThreadRadio(portId: string) {
  return apiRequest(
    `/brokers/thread/radios/${encodeURIComponent(portId)}/check`,
    threadRadioCheckReplySchema,
    { method: 'POST' },
  );
}

/**
 * Sets the network up, or tries again with the same request.
 *
 * @param request - The border router, the network and whether Matter uses it.
 * @returns Where it stands, the job in `setup`.
 */
export async function setUpThread(
  request: Omit<ThreadSetupRequest, 'useForMatter'> & { readonly useForMatter?: boolean },
): Promise<ThreadStatus> {
  return apiRequest('/brokers/thread/setup', threadStatusSchema, {
    method: 'POST',
    body: request,
  });
}

/**
 * Changes the network's name or channel, or whether Matter uses it.
 *
 * @param settings - What changes.
 * @param settings.name - The network's name.
 * @param settings.channel - Its channel.
 * @param settings.useForMatter - Whether new Matter devices join it.
 * @returns Where it stands then.
 */
export async function saveThreadSettings(settings: {
  readonly name?: string;
  readonly channel?: number;
  readonly useForMatter?: boolean;
}): Promise<ThreadStatus> {
  return apiRequest('/brokers/thread/settings', threadStatusSchema, {
    method: 'PUT',
    body: settings,
  });
}

/**
 * Leaves the network for another one, by its dataset.
 *
 * @param dataset - The other network's dataset, as hex.
 * @returns Where it stands then.
 */
export async function joinThread(dataset: string): Promise<ThreadStatus> {
  return apiRequest('/brokers/thread/join', threadStatusSchema, {
    method: 'POST',
    body: { dataset },
  });
}

/**
 * Restarts the border router.
 *
 * @returns Where it stands then.
 */
export async function restartThread(): Promise<ThreadStatus> {
  return apiRequest('/brokers/thread/restart', threadStatusSchema, { method: 'POST' });
}

/**
 * Removes the border router: Thread goes back to not set up.
 *
 * @returns Whether it was there.
 */
export async function removeThread(): Promise<boolean> {
  return (
    await apiRequest('/brokers/thread/border-router', threadRemoveReplySchema, {
      method: 'DELETE',
    })
  ).isRemoved;
}

/**
 * Reads the network key, written down in the audit.
 *
 * @returns The key, as hex.
 */
export async function fetchThreadNetworkKey(): Promise<string> {
  return (await apiRequest('/brokers/thread/network-key', threadNetworkKeyReplySchema, {}))
    .networkKey;
}

/**
 * Reads the active dataset, written down in the audit.
 *
 * @returns The dataset, as hex.
 */
export async function fetchThreadDataset(): Promise<string> {
  return (await apiRequest('/brokers/thread/dataset', threadDatasetReplySchema, {})).dataset;
}
