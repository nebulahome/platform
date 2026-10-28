/**
 * The house's Bluetooth broker, read through and driven: `hub` holds it (ARCHITECTURE.md 4.2).
 *
 * Everything here is a question to the hub. What it adds is what removing a device means for the
 * house: the device is removed the way any device is - `hub` lets go, `core` deletes the rows -
 * and the broker forgets it with its instance.
 */
import type { z } from 'zod';

import {
  bluetoothAddReplySchema,
  bluetoothDevicesReplySchema,
  bluetoothFoundReplySchema,
  bluetoothIgnoreReplySchema,
  bluetoothMapSchema,
  bluetoothNearbyLeaseReplySchema,
  bluetoothNearbyReplySchema,
  bluetoothProxyCandidatesReplySchema,
  bluetoothProxyJobSchema,
  bluetoothProxyRemoveReplySchema,
  bluetoothScannerSchema,
  bluetoothScannersReplySchema,
  bluetoothStatusSchema,
  busSubjects,
  HUB_BLUETOOTH_ADD_METHOD,
  HUB_BLUETOOTH_DEVICES_METHOD,
  HUB_BLUETOOTH_FOUND_METHOD,
  HUB_BLUETOOTH_IGNORE_METHOD,
  HUB_BLUETOOTH_MAP_METHOD,
  HUB_BLUETOOTH_NEARBY_LEASE_METHOD,
  HUB_BLUETOOTH_NEARBY_METHOD,
  HUB_BLUETOOTH_PROXY_ADD_METHOD,
  HUB_BLUETOOTH_PROXY_CANDIDATES_METHOD,
  HUB_BLUETOOTH_PROXY_JOB_METHOD,
  HUB_BLUETOOTH_PROXY_MODE_METHOD,
  HUB_BLUETOOTH_PROXY_REMOVE_METHOD,
  HUB_BLUETOOTH_PROXY_UPDATE_METHOD,
  HUB_BLUETOOTH_SCANNERS_METHOD,
  HUB_BLUETOOTH_SETTINGS_METHOD,
  HUB_BLUETOOTH_STATUS_METHOD,
  HUB_SERVICE,
  NotFoundError,
  type BluetoothDevice,
  type BluetoothStatus,
} from '@nebulahome/contracts';

import { deleteDevice, type DevicesContext, type RemovedDevice } from './devices.js';
import { busOf, type IntegrationsContext } from './integrations.js';

/**
 * How long adding a device may take: the hub waits up to 15 s for the house to have it, which
 * the api's own discovery adoption does meanwhile.
 */
const ADD_TIMEOUT_MS = 20_000;

/**
 * How long a question one op to a proxy answers may take: the hub gives the device 10 s
 * (`apps/hub/src/bluetooth/broker.ts`), the candidates asking every one at once.
 */
const PROXY_OP_TIMEOUT_MS = 15_000;

/** How long changing a proxy's mode may take: its integration installs the script again, 60 s. */
const PROXY_INSTALL_TIMEOUT_MS = 65_000;

/**
 * Asks the hub one of the broker's methods.
 *
 * @param context - The request's collaborators.
 * @param method - The method.
 * @param body - What it is asked.
 * @param schema - What the answer must be.
 * @param timeoutMs - How long the hub has; the service's usual wait unless the method needs more.
 * @returns The answer.
 * @throws {DeviceUnavailableError} When the hub cannot be asked.
 */
export async function askBluetooth<TSchema extends z.ZodType>(
  context: IntegrationsContext,
  method: string,
  body: object,
  schema: TSchema,
  timeoutMs = context.timeoutMs,
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
export async function bluetoothStatus(context: IntegrationsContext): Promise<BluetoothStatus> {
  return askBluetooth(context, HUB_BLUETOOTH_STATUS_METHOD, {}, bluetoothStatusSchema);
}

/**
 * Saves the owner's settings.
 *
 * @param context - The request's collaborators.
 * @param settings - Them, checked.
 * @returns Where the broker stands then.
 */
export async function saveBluetoothSettings(
  context: IntegrationsContext,
  settings: object,
): Promise<BluetoothStatus> {
  return askBluetooth(context, HUB_BLUETOOTH_SETTINGS_METHOD, settings, bluetoothStatusSchema);
}

/**
 * The Bluetooth devices of the house, with who hears each and how well.
 *
 * @param context - The request's collaborators.
 * @returns Them.
 */
export async function bluetoothDevices(context: IntegrationsContext): Promise<BluetoothDevice[]> {
  return (
    await askBluetooth(context, HUB_BLUETOOTH_DEVICES_METHOD, {}, bluetoothDevicesReplySchema)
  ).items;
}

/**
 * Removes a Bluetooth device from the house; the broker forgets it with its instance.
 *
 * @param context - The request's collaborators.
 * @param deviceId - The device.
 * @returns What went.
 * @throws {NotFoundError} When it is not a Bluetooth device of the house.
 */
export async function removeBluetoothDevice(
  context: DevicesContext,
  deviceId: string,
): Promise<RemovedDevice> {
  const device = (await bluetoothDevices(context)).find((each) => each.deviceId === deviceId);

  if (device === undefined) {
    throw new NotFoundError('The house has no such Bluetooth device', { details: { deviceId } });
  }

  return deleteDevice(context, deviceId);
}

/**
 * Who hears what.
 *
 * @param context - The request's collaborators.
 * @returns The map.
 */
export async function bluetoothMap(context: IntegrationsContext) {
  return askBluetooth(context, HUB_BLUETOOTH_MAP_METHOD, {}, bluetoothMapSchema);
}

/**
 * Everything heard, the house's or not.
 *
 * @param context - The request's collaborators.
 * @returns It, the loudest first.
 */
export async function bluetoothNearby(context: IntegrationsContext) {
  return askBluetooth(context, HUB_BLUETOOTH_NEARBY_METHOD, {}, bluetoothNearbyReplySchema);
}

/**
 * Holds, renews or lets go of a Nearby lease.
 *
 * @param context - The request's collaborators.
 * @param request - The lease, and whether it is held.
 * @returns Whether proxies forward everything now, and until when the lease holds.
 */
export async function leaseBluetoothNearby(context: IntegrationsContext, request: object) {
  return askBluetooth(
    context,
    HUB_BLUETOOTH_NEARBY_LEASE_METHOD,
    request,
    bluetoothNearbyLeaseReplySchema,
  );
}

/**
 * The devices an integration recognises that the house does not have, and those ignored.
 *
 * @param context - The request's collaborators.
 * @returns Both.
 */
export async function bluetoothFound(context: IntegrationsContext) {
  return askBluetooth(context, HUB_BLUETOOTH_FOUND_METHOD, {}, bluetoothFoundReplySchema);
}

/**
 * Ignores an address, or stops ignoring it.
 *
 * @param context - The request's collaborators.
 * @param request - The address, and whether it is ignored.
 * @returns How many are ignored.
 */
export async function ignoreBluetooth(context: IntegrationsContext, request: object) {
  return askBluetooth(context, HUB_BLUETOOTH_IGNORE_METHOD, request, bluetoothIgnoreReplySchema);
}

/**
 * Adds a device heard, as the integration that recognises it.
 *
 * @param context - The request's collaborators.
 * @param request - The address, and the driver when several recognise it.
 * @returns The device added.
 * @throws {ConflictError} When the house has it, or it was not added in time.
 */
export async function addBluetoothDevice(context: IntegrationsContext, request: object) {
  return askBluetooth(
    context,
    HUB_BLUETOOTH_ADD_METHOD,
    request,
    bluetoothAddReplySchema,
    ADD_TIMEOUT_MS,
  );
}

/**
 * The scanners: the local adapter and every proxy.
 *
 * @param context - The request's collaborators.
 * @returns Them, the adapter first.
 */
export async function bluetoothScanners(context: IntegrationsContext) {
  return askBluetooth(context, HUB_BLUETOOTH_SCANNERS_METHOD, {}, bluetoothScannersReplySchema);
}

/**
 * The devices whose integration can make them proxies, each asked whether it can.
 *
 * @param context - The request's collaborators.
 * @param request - One device, or every one.
 * @returns The candidates, those that can first.
 */
export async function bluetoothProxyCandidates(context: IntegrationsContext, request: object) {
  return askBluetooth(
    context,
    HUB_BLUETOOTH_PROXY_CANDIDATES_METHOD,
    request,
    bluetoothProxyCandidatesReplySchema,
    PROXY_OP_TIMEOUT_MS,
  );
}

/**
 * Starts making a device a proxy.
 *
 * @param context - The request's collaborators.
 * @param request - The device, and how it scans.
 * @returns The job, running.
 */
export async function addBluetoothProxy(context: IntegrationsContext, request: object) {
  return askBluetooth(context, HUB_BLUETOOTH_PROXY_ADD_METHOD, request, bluetoothProxyJobSchema);
}

/**
 * Reads a proxy job.
 *
 * @param context - The request's collaborators.
 * @param jobId - The job.
 * @returns It.
 */
export async function bluetoothProxyJob(context: IntegrationsContext, jobId: string) {
  return askBluetooth(context, HUB_BLUETOOTH_PROXY_JOB_METHOD, { jobId }, bluetoothProxyJobSchema);
}

/**
 * Changes how a proxy scans: its integration installs the script again.
 *
 * @param context - The request's collaborators.
 * @param request - The proxy, and how it scans now.
 * @returns The proxy, as the Scanners tab lists it.
 * @throws {ConflictError} When its integration refused.
 */
export async function setBluetoothProxyMode(context: IntegrationsContext, request: object) {
  return askBluetooth(
    context,
    HUB_BLUETOOTH_PROXY_MODE_METHOD,
    request,
    bluetoothScannerSchema,
    PROXY_INSTALL_TIMEOUT_MS,
  );
}

/**
 * Installs the script the integration ships now over an outdated one, as a job.
 *
 * @param context - The request's collaborators.
 * @param deviceId - The proxy.
 * @returns The job, running.
 */
export async function updateBluetoothProxy(context: IntegrationsContext, deviceId: string) {
  return askBluetooth(
    context,
    HUB_BLUETOOTH_PROXY_UPDATE_METHOD,
    { deviceId },
    bluetoothProxyJobSchema,
  );
}

/**
 * Stops a device being a proxy: its script is removed.
 *
 * @param context - The request's collaborators.
 * @param deviceId - The proxy.
 * @throws {NotFoundError} When it is not one.
 * @throws {ConflictError} When its integration could not remove the script.
 */
export async function removeBluetoothProxy(
  context: IntegrationsContext,
  deviceId: string,
): Promise<void> {
  const reply = await askBluetooth(
    context,
    HUB_BLUETOOTH_PROXY_REMOVE_METHOD,
    { deviceId },
    bluetoothProxyRemoveReplySchema,
    PROXY_OP_TIMEOUT_MS,
  );

  if (!reply.isRemoved) {
    throw new NotFoundError('The device is not a Bluetooth proxy', { details: { deviceId } });
  }
}
