/**
 * The Bluetooth broker on the bus: what the Brokers page reads and asks, through `api`.
 *
 * `svc.hub.bluetooth_status`, `bluetooth_devices`, `bluetooth_map`, `bluetooth_nearby`,
 * `bluetooth_found` and `bluetooth_scanners` read; `bluetooth_settings` saves the owner's settings;
 * `bluetooth_nearby_lease` holds the lease under which proxies forward everything;
 * `bluetooth_ignore` ignores an address or stops; `bluetooth_add` adds a device heard and answers
 * once it is in the house. The `bluetooth_proxy_*` methods list the devices that could be proxies,
 * make one a proxy or update its script as a job read with `bluetooth_proxy_job`, change how it
 * scans, and stop it being one. Removing a Bluetooth device from the house is `api`'s ordinary
 * device removal.
 */
import { z } from 'zod';

import type { BusClient, BusSubscription } from '@nebulahome/bus';
import {
  bluetoothAddRequestSchema,
  bluetoothIgnoreRequestSchema,
  bluetoothNearbyLeaseRequestSchema,
  bluetoothProxyAddRequestSchema,
  bluetoothProxyCandidatesRequestSchema,
  bluetoothProxyDeviceRequestSchema,
  bluetoothProxyJobRequestSchema,
  bluetoothProxyModeRequestSchema,
  bluetoothSettingsSchema,
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
} from '@nebulahome/contracts';

import type { BluetoothBroker } from '../bluetooth/broker.js';

/**
 * Serves the Bluetooth broker's methods.
 *
 * @param client - The hub's bus client.
 * @param broker - The broker.
 * @returns The subscriptions, to drop on stop.
 */
export function serveBluetooth(client: BusClient, broker: BluetoothBroker): BusSubscription[] {
  /**
   * One method of the broker's.
   *
   * @param method - Its name.
   * @returns Its subject.
   */
  const subject = (method: string): string => busSubjects.service(HUB_SERVICE, method);

  return [
    client.serve(
      subject(HUB_BLUETOOTH_STATUS_METHOD),
      z.object({}),

      /**
       * Says where the broker stands.
       *
       * @returns Its status.
       */
      async () => broker.status(),
    ),

    client.serve(
      subject(HUB_BLUETOOTH_SETTINGS_METHOD),
      bluetoothSettingsSchema,

      /**
       * Saves the settings.
       *
       * @param settings - The settings.
       * @returns Where the broker stands.
       */
      async (settings) => broker.saveSettings(settings),
    ),

    client.serve(
      subject(HUB_BLUETOOTH_DEVICES_METHOD),
      z.object({}),

      /**
       * Lists the house's Bluetooth devices.
       *
       * @returns Each, with who hears it.
       */
      async () => ({ items: await broker.devices() }),
    ),

    client.serve(
      subject(HUB_BLUETOOTH_MAP_METHOD),
      z.object({}),

      /**
       * Says who hears what.
       *
       * @returns The map.
       */
      async () => broker.map(),
    ),

    client.serve(
      subject(HUB_BLUETOOTH_NEARBY_METHOD),
      z.object({}),

      /**
       * Lists everything heard lately.
       *
       * @returns The addresses.
       */
      async () => ({ items: await broker.nearby() }),
    ),

    client.serve(
      subject(HUB_BLUETOOTH_NEARBY_LEASE_METHOD),
      bluetoothNearbyLeaseRequestSchema,

      /**
       * Holds, renews or lets go of a Nearby lease.
       *
       * @param request - The lease, and whether it is held.
       * @returns Whether proxies forward everything, and until when the lease holds.
       */
      (request) => broker.nearbyLease(request.leaseId, request.isHeld),
    ),

    client.serve(
      subject(HUB_BLUETOOTH_FOUND_METHOD),
      z.object({}),

      /**
       * Lists the devices recognised and not in the house, and those ignored.
       *
       * @returns Both.
       */
      async () => broker.found(),
    ),

    client.serve(
      subject(HUB_BLUETOOTH_IGNORE_METHOD),
      bluetoothIgnoreRequestSchema,

      /**
       * Ignores an address, or stops.
       *
       * @param request - The address, and which way.
       * @returns How many are ignored.
       */
      async (request) => ({ count: await broker.ignore(request.address, request.isIgnored) }),
    ),

    client.serve(
      subject(HUB_BLUETOOTH_ADD_METHOD),
      bluetoothAddRequestSchema,

      /**
       * Adds a device heard, and answers once it is in the house.
       *
       * @param request - The address, and the driver when more than one recognises it.
       * @returns The device added.
       */
      async (request) => broker.add(request.address, request.kind),
    ),

    client.serve(
      subject(HUB_BLUETOOTH_SCANNERS_METHOD),
      z.object({}),

      /**
       * Lists the scanners.
       *
       * @returns The adapter, then the proxies.
       */
      async () => ({ items: await broker.scanners() }),
    ),

    client.serve(
      subject(HUB_BLUETOOTH_PROXY_CANDIDATES_METHOD),
      bluetoothProxyCandidatesRequestSchema,

      /**
       * Lists the devices that could be proxies, each asked whether it can.
       *
       * @param request - One device, or every one.
       * @returns The candidates.
       */
      async (request) => ({ items: await broker.proxyCandidates(request.deviceId) }),
    ),

    client.serve(
      subject(HUB_BLUETOOTH_PROXY_ADD_METHOD),
      bluetoothProxyAddRequestSchema,

      /**
       * Starts making a device a proxy.
       *
       * @param request - The device, and how it scans.
       * @returns The job, running.
       */
      async (request) => broker.addProxy(request.deviceId, request.mode),
    ),

    client.serve(
      subject(HUB_BLUETOOTH_PROXY_JOB_METHOD),
      bluetoothProxyJobRequestSchema,

      /**
       * Reads a proxy job.
       *
       * @param request - The job.
       * @returns It.
       */
      (request) => broker.job(request.jobId),
    ),

    client.serve(
      subject(HUB_BLUETOOTH_PROXY_MODE_METHOD),
      bluetoothProxyModeRequestSchema,

      /**
       * Changes how a proxy scans.
       *
       * @param request - The proxy, and the mode.
       * @returns The proxy, as the Scanners tab lists it.
       */
      async (request) => broker.setProxyMode(request.deviceId, request.mode),
    ),

    client.serve(
      subject(HUB_BLUETOOTH_PROXY_UPDATE_METHOD),
      bluetoothProxyDeviceRequestSchema,

      /**
       * Installs the script shipped now on a proxy.
       *
       * @param request - The proxy.
       * @returns The job, running.
       */
      (request) => broker.updateScript(request.deviceId),
    ),

    client.serve(
      subject(HUB_BLUETOOTH_PROXY_REMOVE_METHOD),
      bluetoothProxyDeviceRequestSchema,

      /**
       * Stops a device being a proxy.
       *
       * @param request - The proxy.
       * @returns Whether it was one.
       */
      async (request) => ({ isRemoved: await broker.removeProxy(request.deviceId) }),
    ),
  ];
}
