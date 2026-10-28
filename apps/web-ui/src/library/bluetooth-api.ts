/**
 * The house's Bluetooth broker, as its page reads and drives it (`/api/v1/brokers/bluetooth`):
 * the adapter and the proxies that listen for the house, the devices they hear, everything heard
 * nearby, and the jobs that make a device a proxy.
 */
import { z } from 'zod';

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
  bluetoothScannerSchema,
  bluetoothScannersReplySchema,
  bluetoothStatusSchema,
  type BluetoothDevice,
  type BluetoothMap,
  type BluetoothNearby,
  type BluetoothProxyCandidate,
  type BluetoothProxyJob,
  type BluetoothScanMode,
  type BluetoothScanner,
  type BluetoothSettings,
  type BluetoothStatus,
} from '@nebulahome/contracts';

import { apiRequest } from '@/lib/api-client';

/** The keys the broker is cached under: below `brokers`, so reading the brokers again reads it. */
export const BLUETOOTH_QUERY_KEYS = {
  status: ['brokers', 'bluetooth', 'status'] as const,
  devices: ['brokers', 'bluetooth', 'devices'] as const,
  map: ['brokers', 'bluetooth', 'map'] as const,
  nearby: ['brokers', 'bluetooth', 'nearby'] as const,
  found: ['brokers', 'bluetooth', 'found'] as const,
  scanners: ['brokers', 'bluetooth', 'scanners'] as const,
  candidates: ['brokers', 'bluetooth', 'candidates'] as const,
  job: ['brokers', 'bluetooth', 'job'] as const,
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
 * Reads where the broker stands.
 *
 * @param signal - Cancels the request.
 * @returns Its state, its adapter, its proxies and what they hear.
 */
export async function fetchBluetoothStatus(signal?: AbortSignal): Promise<BluetoothStatus> {
  return apiRequest('/brokers/bluetooth', bluetoothStatusSchema, readOptions(signal));
}

/**
 * Lists the house's Bluetooth devices.
 *
 * @param signal - Cancels the request.
 * @returns Them, with who hears each.
 */
export async function fetchBluetoothDevices(signal?: AbortSignal): Promise<BluetoothDevice[]> {
  return (
    await apiRequest('/brokers/bluetooth/devices', bluetoothDevicesReplySchema, readOptions(signal))
  ).items;
}

/**
 * Reads who hears what, for the map.
 *
 * @param signal - Cancels the request.
 * @returns The scanners, the devices, and the links between them.
 */
export async function fetchBluetoothMap(signal?: AbortSignal): Promise<BluetoothMap> {
  return apiRequest('/brokers/bluetooth/map', bluetoothMapSchema, readOptions(signal));
}

/**
 * Lists everything heard nearby.
 *
 * @param signal - Cancels the request.
 * @returns Each address heard.
 */
export async function fetchBluetoothNearby(signal?: AbortSignal): Promise<BluetoothNearby[]> {
  return (
    await apiRequest('/brokers/bluetooth/nearby', bluetoothNearbyReplySchema, readOptions(signal))
  ).items;
}

/**
 * Lists the devices an integration recognises that the house does not have.
 *
 * @param signal - Cancels the request.
 * @returns Them, and those ignored.
 */
export async function fetchBluetoothFound(signal?: AbortSignal) {
  return apiRequest('/brokers/bluetooth/found', bluetoothFoundReplySchema, readOptions(signal));
}

/**
 * Lists the scanners: the adapter and the proxies.
 *
 * @param signal - Cancels the request.
 * @returns Them.
 */
export async function fetchBluetoothScanners(signal?: AbortSignal): Promise<BluetoothScanner[]> {
  return (
    await apiRequest(
      '/brokers/bluetooth/scanners',
      bluetoothScannersReplySchema,
      readOptions(signal),
    )
  ).items;
}

/**
 * Holds the Nearby lease, or lets it go: while one is held the proxies forward everything.
 *
 * @param leaseId - This page's lease.
 * @param isHeld - Whether to hold it.
 * @returns Whether everything is forwarded, and until when.
 */
export async function leaseBluetoothNearby(leaseId: string, isHeld: boolean) {
  return apiRequest('/brokers/bluetooth/nearby/lease', bluetoothNearbyLeaseReplySchema, {
    method: 'PUT',
    body: { leaseId, isHeld },
  });
}

/**
 * Saves the broker's settings.
 *
 * @param settings - Them.
 * @returns Where the broker stands then.
 */
export async function saveBluetoothSettings(settings: BluetoothSettings): Promise<BluetoothStatus> {
  return apiRequest('/brokers/bluetooth/settings', bluetoothStatusSchema, {
    method: 'PUT',
    body: settings,
  });
}

/**
 * Ignores an address, or stops ignoring it.
 *
 * @param address - The address.
 * @param isIgnored - Whether to ignore it.
 * @returns How many are ignored.
 */
export async function ignoreBluetooth(address: string, isIgnored: boolean): Promise<number> {
  return (
    await apiRequest('/brokers/bluetooth/ignored', bluetoothIgnoreReplySchema, {
      method: 'PUT',
      body: { address, isIgnored },
    })
  ).count;
}

/**
 * Adds a device heard to the house.
 *
 * @param address - Its address.
 * @param kind - The driver, when several recognise it.
 * @returns The device's id.
 */
export async function addBluetoothDevice(address: string, kind?: string): Promise<string> {
  return (
    await apiRequest('/brokers/bluetooth/devices', bluetoothAddReplySchema, {
      method: 'POST',
      body: kind === undefined ? { address } : { address, kind },
    })
  ).deviceId;
}

/**
 * Lists the devices an integration can make proxies, eligible or not.
 *
 * @param deviceId - Only this one, for its device page.
 * @param signal - Cancels the request.
 * @returns Them.
 */
export async function fetchBluetoothProxyCandidates(
  deviceId?: string,
  signal?: AbortSignal,
): Promise<BluetoothProxyCandidate[]> {
  const query = deviceId === undefined ? '' : `?deviceId=${encodeURIComponent(deviceId)}`;

  return (
    await apiRequest(
      `/brokers/bluetooth/proxies/candidates${query}`,
      bluetoothProxyCandidatesReplySchema,
      readOptions(signal),
    )
  ).items;
}

/**
 * Makes a device a proxy.
 *
 * @param deviceId - The device.
 * @param mode - How it scans.
 * @returns The job.
 */
export async function addBluetoothProxy(
  deviceId: string,
  mode: BluetoothScanMode,
): Promise<BluetoothProxyJob> {
  return apiRequest('/brokers/bluetooth/proxies', bluetoothProxyJobSchema, {
    method: 'POST',
    body: { deviceId, mode },
  });
}

/**
 * Reads a proxy job.
 *
 * @param jobId - The job.
 * @param signal - Cancels the request.
 * @returns Where it stands.
 */
export async function fetchBluetoothProxyJob(
  jobId: string,
  signal?: AbortSignal,
): Promise<BluetoothProxyJob> {
  return apiRequest(
    `/brokers/bluetooth/proxies/jobs/${encodeURIComponent(jobId)}`,
    bluetoothProxyJobSchema,
    readOptions(signal),
  );
}

/**
 * Changes how a proxy scans.
 *
 * @param deviceId - The proxy.
 * @param mode - Passive or active.
 * @returns Its scanner.
 */
export async function setBluetoothProxyMode(
  deviceId: string,
  mode: BluetoothScanMode,
): Promise<BluetoothScanner> {
  return apiRequest(
    `/brokers/bluetooth/proxies/${encodeURIComponent(deviceId)}/mode`,
    bluetoothScannerSchema,
    { method: 'PUT', body: { mode } },
  );
}

/**
 * Updates a proxy's script to the one the integration ships.
 *
 * @param deviceId - The proxy.
 * @returns The job.
 */
export async function updateBluetoothProxy(deviceId: string): Promise<BluetoothProxyJob> {
  return apiRequest(
    `/brokers/bluetooth/proxies/${encodeURIComponent(deviceId)}/update`,
    bluetoothProxyJobSchema,
    { method: 'POST' },
  );
}

/**
 * Stops a device being a proxy: its script is removed.
 *
 * @param deviceId - The proxy.
 */
export async function removeBluetoothProxy(deviceId: string): Promise<void> {
  await apiRequest(`/brokers/bluetooth/proxies/${encodeURIComponent(deviceId)}`, z.undefined(), {
    method: 'DELETE',
  });
}
