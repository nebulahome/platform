/**
 * `/brokers/bluetooth`: the house's Bluetooth broker, for its page on the Brokers screen.
 *
 * Reading it is reading devices (`device:read`), Nearby included, and so is holding the Nearby
 * lease that makes proxies forward everything while the page is open. Adding a device heard and
 * ignoring an address are `device:write`; removing a device removes it from the house
 * (`device:delete`). The settings, and making a device a proxy - installing, updating, changing
 * the mode of or removing the script it runs - change hardware and are configuring an integration
 * (`integration:configure`), each audited. A proxy job is answered at once, `202`, and the page
 * reads it until it ends.
 */
import { z } from 'zod';

import {
  bluetoothAddReplySchema,
  bluetoothAddRequestSchema,
  bluetoothDevicesReplySchema,
  bluetoothFoundReplySchema,
  bluetoothIgnoreReplySchema,
  bluetoothIgnoreRequestSchema,
  bluetoothMapSchema,
  bluetoothNearbyLeaseReplySchema,
  bluetoothNearbyLeaseRequestSchema,
  bluetoothNearbyReplySchema,
  bluetoothProxyAddRequestSchema,
  bluetoothProxyCandidatesReplySchema,
  bluetoothProxyCandidatesRequestSchema,
  bluetoothProxyJobSchema,
  bluetoothScannerSchema,
  bluetoothScannersReplySchema,
  bluetoothSettingsSchema,
  bluetoothStatusSchema,
  BLUETOOTH_SCAN_MODES,
  integrationIdSchema,
} from '@nebulahome/contracts';

import { requirePermission } from '../auth/permissions.js';
import type { ApiContext } from '../context.js';
import { defineRoute, type RouteEnvironment } from '../http/route.js';
import {
  addBluetoothDevice,
  addBluetoothProxy,
  bluetoothDevices,
  bluetoothFound,
  bluetoothMap,
  bluetoothNearby,
  bluetoothProxyCandidates,
  bluetoothProxyJob,
  bluetoothScanners,
  bluetoothStatus,
  ignoreBluetooth,
  leaseBluetoothNearby,
  removeBluetoothDevice,
  removeBluetoothProxy,
  saveBluetoothSettings,
  setBluetoothProxyMode,
  updateBluetoothProxy,
} from '../services/bluetooth.js';

import { forRequest } from './devices.js';

/** The status a proxy job is answered with: started, done later. */
const ACCEPTED_STATUS = 202;

/** Which device or proxy a request is about. */
const deviceParamsSchema = z.object({ deviceId: integrationIdSchema });

/** Which proxy job a request is about. */
const jobParamsSchema = z.object({ jobId: z.string().min(1).max(64) });

/**
 * Registers the Bluetooth broker's routes.
 *
 * @param environment - Where routes are registered and documented.
 * @param context - The service's collaborators.
 */
export function registerBluetoothRoutes(environment: RouteEnvironment, context: ApiContext): void {
  /**
   * Declares a read of the broker: `device:read`, the hub's answer as it is.
   *
   * @param url - What follows `/brokers/bluetooth`.
   * @param summary - The operation's line.
   * @param response - What it answers.
   * @param read - What the hub is asked.
   */
  const defineRead = (
    url: string,
    summary: string,
    response: z.ZodType,
    read: (traceId: string) => Promise<unknown>,
  ): void => {
    defineRoute(
      environment,
      {
        method: 'GET',
        url: `/brokers/bluetooth${url}`,
        summary,
        tag: 'Brokers',
        permission: 'device:read',
        response,
      },

      /**
       * Reads it.
       *
       * @param route - Who is asking.
       * @returns The hub's answer.
       */
      async (route) => {
        requirePermission(route.identity, 'device:read');

        return read(route.request.traceId);
      },
    );
  };

  defineRead('', "Where the house's Bluetooth broker stands", bluetoothStatusSchema, (traceId) =>
    bluetoothStatus(forRequest(context, traceId)),
  );
  defineRead(
    '/devices',
    "List the house's Bluetooth devices, with who hears each",
    bluetoothDevicesReplySchema,
    async (traceId) => ({ items: await bluetoothDevices(forRequest(context, traceId)) }),
  );
  defineRead(
    '/map',
    'Show who hears what: the server, its proxies and the devices',
    bluetoothMapSchema,
    (traceId) => bluetoothMap(forRequest(context, traceId)),
  );
  defineRead(
    '/nearby',
    'List everything Bluetooth heard, the house’s or not',
    bluetoothNearbyReplySchema,
    (traceId) => bluetoothNearby(forRequest(context, traceId)),
  );
  defineRead(
    '/found',
    'List the Bluetooth devices an integration recognises, and those ignored',
    bluetoothFoundReplySchema,
    (traceId) => bluetoothFound(forRequest(context, traceId)),
  );
  defineRead(
    '/scanners',
    "List Bluetooth's scanners: the server's adapter and every proxy",
    bluetoothScannersReplySchema,
    (traceId) => bluetoothScanners(forRequest(context, traceId)),
  );

  defineRoute(
    environment,
    {
      method: 'PUT',
      url: '/brokers/bluetooth/nearby/lease',
      summary: 'Hold, renew or let go of a Nearby lease: proxies forward everything while held',
      tag: 'Brokers',
      permission: 'device:read',
      body: bluetoothNearbyLeaseRequestSchema,
      response: bluetoothNearbyLeaseReplySchema,
    },

    /**
     * Holds the lease, or lets it go.
     *
     * @param route - The lease, and who is asking.
     * @returns Whether proxies forward everything now, and until when it holds.
     */
    async (route) => {
      requirePermission(route.identity, 'device:read');

      return leaseBluetoothNearby(forRequest(context, route.request.traceId), route.body);
    },
  );

  defineRoute(
    environment,
    {
      method: 'PUT',
      url: '/brokers/bluetooth/settings',
      summary: "Change the Bluetooth broker's settings",
      tag: 'Brokers',
      permission: 'integration:configure',
      body: bluetoothSettingsSchema,
      response: bluetoothStatusSchema,
    },

    /**
     * Saves the settings.
     *
     * @param route - The settings, and who is asking.
     * @returns Where the broker stands then.
     */
    async (route) => {
      requirePermission(route.identity, 'integration:configure');

      const status = await saveBluetoothSettings(
        forRequest(context, route.request.traceId),
        route.body,
      );

      await context.audit.record({
        action: 'bluetooth.settings',
        resourceType: 'bluetooth',
        resourceId: 'settings',
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { ...route.body },
      });

      return status;
    },
  );

  defineRoute(
    environment,
    {
      method: 'PUT',
      url: '/brokers/bluetooth/ignored',
      summary: 'Ignore a Bluetooth address found, or stop ignoring it',
      tag: 'Brokers',
      permission: 'device:write',
      body: bluetoothIgnoreRequestSchema,
      response: bluetoothIgnoreReplySchema,
    },

    /**
     * Ignores an address, or stops.
     *
     * @param route - The address, and who is asking.
     * @returns How many are ignored.
     */
    async (route) => {
      requirePermission(route.identity, 'device:write');

      return ignoreBluetooth(forRequest(context, route.request.traceId), route.body);
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/brokers/bluetooth/devices',
      summary: 'Add a Bluetooth device heard, as the integration that recognises it',
      tag: 'Brokers',
      permission: 'device:write',
      body: bluetoothAddRequestSchema,
      response: bluetoothAddReplySchema,
    },

    /**
     * Adds a device: answered once the house has it.
     *
     * @param route - The address, and who is asking.
     * @returns The device added.
     */
    async (route) => {
      requirePermission(route.identity, 'device:write');

      const added = await addBluetoothDevice(
        forRequest(context, route.request.traceId),
        route.body,
      );

      await context.audit.record({
        action: 'bluetooth.device.add',
        resourceType: 'bluetooth',
        resourceId: added.deviceId,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { address: route.body.address, kind: route.body.kind ?? null },
      });

      return added;
    },
  );

  defineRoute(
    environment,
    {
      method: 'DELETE',
      url: '/brokers/bluetooth/devices/:deviceId',
      summary: 'Remove a Bluetooth device from the house',
      tag: 'Brokers',
      permission: 'device:delete',
      params: deviceParamsSchema,
      successStatus: 204,
    },

    /**
     * Removes a device.
     *
     * @param route - The device, and who is asking.
     */
    async (route): Promise<void> => {
      requirePermission(route.identity, 'device:delete');

      const removed = await removeBluetoothDevice(
        forRequest(context, route.request.traceId),
        route.params.deviceId,
      );

      await context.audit.record({
        action: 'bluetooth.device.remove',
        resourceType: 'bluetooth',
        resourceId: route.params.deviceId,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { name: removed.name, entityIds: removed.entityIds },
      });
    },
  );

  registerProxyRoutes(environment, context);
}

/**
 * Registers the routes that make devices Bluetooth proxies.
 *
 * @param environment - Where routes are registered and documented.
 * @param context - The service's collaborators.
 */
function registerProxyRoutes(environment: RouteEnvironment, context: ApiContext): void {
  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/brokers/bluetooth/proxies/candidates',
      summary: 'List the devices that could be Bluetooth proxies, each asked whether it can',
      tag: 'Brokers',
      permission: 'device:read',
      query: bluetoothProxyCandidatesRequestSchema,
      response: bluetoothProxyCandidatesReplySchema,
    },

    /**
     * Lists the candidates.
     *
     * @param route - One device or every one, and who is asking.
     * @returns Them, those that can first.
     */
    async (route) => {
      requirePermission(route.identity, 'device:read');

      return bluetoothProxyCandidates(forRequest(context, route.request.traceId), route.query);
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/brokers/bluetooth/proxies/jobs/:jobId',
      summary: 'Read a job making a device a Bluetooth proxy',
      tag: 'Brokers',
      permission: 'device:read',
      params: jobParamsSchema,
      response: bluetoothProxyJobSchema,
    },

    /**
     * Reads the job.
     *
     * @param route - The job, and who is asking.
     * @returns It, as it now stands.
     */
    async (route) => {
      requirePermission(route.identity, 'device:read');

      return bluetoothProxyJob(forRequest(context, route.request.traceId), route.params.jobId);
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/brokers/bluetooth/proxies',
      summary: 'Make a device a Bluetooth proxy: its script installed, started, heard from',
      tag: 'Brokers',
      permission: 'integration:configure',
      body: bluetoothProxyAddRequestSchema,
      response: bluetoothProxyJobSchema,
      successStatus: ACCEPTED_STATUS,
    },

    /**
     * Starts the job.
     *
     * @param route - The device and its scan mode, and who is asking.
     * @returns The job, running.
     */
    async (route) => {
      requirePermission(route.identity, 'integration:configure');

      const job = await addBluetoothProxy(forRequest(context, route.request.traceId), route.body);

      await context.audit.record({
        action: 'bluetooth.proxy.install',
        resourceType: 'bluetooth',
        resourceId: route.body.deviceId,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { jobId: job.id, mode: route.body.mode },
      });

      return job;
    },
  );

  defineRoute(
    environment,
    {
      method: 'PUT',
      url: '/brokers/bluetooth/proxies/:deviceId/mode',
      summary: 'Change how a Bluetooth proxy scans',
      tag: 'Brokers',
      permission: 'integration:configure',
      params: deviceParamsSchema,
      body: z.object({ mode: z.enum(BLUETOOTH_SCAN_MODES) }),
      response: bluetoothScannerSchema,
    },

    /**
     * Changes the mode: the proxy's script is installed again in it.
     *
     * @param route - The proxy, its mode, and who is asking.
     * @returns The proxy, as the Scanners tab lists it.
     */
    async (route) => {
      requirePermission(route.identity, 'integration:configure');

      const scanner = await setBluetoothProxyMode(forRequest(context, route.request.traceId), {
        deviceId: route.params.deviceId,
        mode: route.body.mode,
      });

      await context.audit.record({
        action: 'bluetooth.proxy.mode',
        resourceType: 'bluetooth',
        resourceId: route.params.deviceId,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { mode: route.body.mode },
      });

      return scanner;
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/brokers/bluetooth/proxies/:deviceId/update',
      summary: "Install the script a proxy's integration ships now over an outdated one",
      tag: 'Brokers',
      permission: 'integration:configure',
      params: deviceParamsSchema,
      response: bluetoothProxyJobSchema,
      successStatus: ACCEPTED_STATUS,
    },

    /**
     * Starts the job.
     *
     * @param route - The proxy, and who is asking.
     * @returns The job, running.
     */
    async (route) => {
      requirePermission(route.identity, 'integration:configure');

      const job = await updateBluetoothProxy(
        forRequest(context, route.request.traceId),
        route.params.deviceId,
      );

      await context.audit.record({
        action: 'bluetooth.proxy.install',
        resourceType: 'bluetooth',
        resourceId: route.params.deviceId,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { jobId: job.id, mode: job.mode, isUpdate: true },
      });

      return job;
    },
  );

  defineRoute(
    environment,
    {
      method: 'DELETE',
      url: '/brokers/bluetooth/proxies/:deviceId',
      summary: 'Stop a device being a Bluetooth proxy: its script is removed',
      tag: 'Brokers',
      permission: 'integration:configure',
      params: deviceParamsSchema,
      successStatus: 204,
    },

    /**
     * Removes the proxy's script; the device stays in the house.
     *
     * @param route - The proxy, and who is asking.
     */
    async (route): Promise<void> => {
      requirePermission(route.identity, 'integration:configure');

      await removeBluetoothProxy(forRequest(context, route.request.traceId), route.params.deviceId);
      await context.audit.record({
        action: 'bluetooth.proxy.remove',
        resourceType: 'bluetooth',
        resourceId: route.params.deviceId,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: {},
      });
    },
  );
}
