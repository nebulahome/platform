/**
 * Devices: one resource for the thing an owner adds, names, configures, lists and removes.
 *
 * Six routes around one form. The list shows every device with where it stands and what it
 * exposes; create writes the instance that reaches the device and the row that names it, and
 * asks the hub to start listening for it; change touches whichever half the change belongs to;
 * the probe says whether what was typed works, before anything is written; remove has the hub
 * let go and `core` release the rows. Everything that touches a configuration needs the hub,
 * because the hub holds the bundles and the bundles hold the shape of what is being written -
 * and while the bus is away those routes say so rather than storing what nothing could check.
 */
import { z } from 'zod';

import {
  deviceCreateSchema,
  deviceProbeReplySchema,
  deviceProbeRequestSchema,
  deviceUpdateSchema,
  deviceViewSchema,
  integrationIdSchema,
  type DeviceProbeReply,
  type DeviceView,
} from '@nebulahome/contracts';

import { requirePermission } from '../auth/permissions.js';
import type { ApiContext } from '../context.js';
import { defineRoute, type RouteEnvironment } from '../http/route.js';
import {
  createDevice,
  deleteDevice,
  listDevices,
  probeDevice,
  readDevice,
  updateDevice,
  type DevicesContext,
} from '../services/devices.js';

/** Which device a request is about. */
export const deviceParamsSchema = z.object({ deviceId: integrationIdSchema });

/**
 * What the device paths need, for one request.
 *
 * @param context - The service's collaborators.
 * @param traceId - The request's trace id.
 * @returns The request-scoped view of them.
 */
export function forRequest(context: ApiContext, traceId: string): DevicesContext {
  return {
    db: context.db,
    bus: context.bus,
    secretsKey: context.secretsKey,
    logger: context.logger,
    timeoutMs: context.config.API_BUS_TIMEOUT_MS,
    traceId,
    icons: context.icons,
  };
}

/**
 * Registers the device routes.
 *
 * @param environment - Where routes are defined.
 * @param context - The service's collaborators.
 */
export function registerDeviceRoutes(environment: RouteEnvironment, context: ApiContext): void {
  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/devices',
      summary: 'List devices',
      tag: 'Devices',
      permission: 'device:read',
      response: z.object({ items: z.array(deviceViewSchema) }),
    },

    /**
     * Lists every device, with where it stands and what it exposes.
     *
     * @param route - Who is asking.
     * @returns The devices.
     */
    async (route): Promise<{ items: DeviceView[] }> => {
      requirePermission(route.identity, 'device:read');

      return { items: await listDevices(forRequest(context, route.request.traceId)) };
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/devices/:deviceId',
      summary: 'Read one device',
      tag: 'Devices',
      permission: 'device:read',
      params: deviceParamsSchema,
      response: deviceViewSchema,
    },

    /**
     * Reads one device.
     *
     * @param route - The id and who is asking.
     * @returns The device.
     */
    async (route): Promise<DeviceView> => {
      requirePermission(route.identity, 'device:read');

      return readDevice(forRequest(context, route.request.traceId), route.params.deviceId);
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/devices',
      summary: 'Add a device',
      tag: 'Devices',
      permission: 'device:write',
      body: deviceCreateSchema,
      response: deviceViewSchema,
    },

    /**
     * Adds a device and asks the hub to start listening for it.
     *
     * @param route - The body and who is asking.
     * @returns The device as it now stands.
     */
    async (route): Promise<DeviceView> => {
      requirePermission(route.identity, 'device:write');

      const device = await createDevice(forRequest(context, route.request.traceId), route.body);

      // The field names, not the values: a transport configuration carries credentials, and an
      // audit detail reaches the log stream as well as the table.
      await context.audit.record({
        action: 'device.create',
        resourceType: 'device',
        resourceId: device.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: {
          kind: device.kind,
          model: device.model,
          fields: Object.keys(route.body.transportConfig),
          options: Object.keys(route.body.options),
        },
      });

      return device;
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/devices/probe',
      summary: 'Try a device configuration without saving it',
      tag: 'Devices',
      permission: 'device:write',
      body: deviceProbeRequestSchema,
      response: deviceProbeReplySchema,
      successStatus: 200,
    },

    /**
     * Tries a configuration and reports the verdict.
     *
     * A configuration that does not work is a `200` with `isReachable: false`: the owner pressed
     * the button to learn exactly that, and it is not an error in the request.
     *
     * @param route - The body and who is asking.
     * @returns The verdict and the hub's sentence about it.
     */
    async (route): Promise<DeviceProbeReply> => {
      requirePermission(route.identity, 'device:write');

      return probeDevice(forRequest(context, route.request.traceId), route.body);
    },
  );

  defineRoute(
    environment,
    {
      method: 'PATCH',
      url: '/devices/:deviceId',
      summary: 'Change a device',
      tag: 'Devices',
      permission: 'device:write',
      params: deviceParamsSchema,
      body: deviceUpdateSchema,
      response: deviceViewSchema,
    },

    /**
     * Changes a device's name, icon or configuration, and asks the hub to match the last.
     *
     * @param route - The body, the id and who is asking.
     * @returns The device as it now stands.
     */
    async (route): Promise<DeviceView> => {
      requirePermission(route.identity, 'device:write');

      const device = await updateDevice(
        forRequest(context, route.request.traceId),
        route.params.deviceId,
        route.body,
      );

      await context.audit.record({
        action: 'device.update',
        resourceType: 'device',
        resourceId: device.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { changed: Object.keys(route.body) },
      });

      return device;
    },
  );

  defineRoute(
    environment,
    {
      method: 'DELETE',
      url: '/devices/:deviceId',
      summary: 'Remove a device, its entities and their history of being configured',
      tag: 'Devices',
      permission: 'device:delete',
      params: deviceParamsSchema,
      successStatus: 204,
    },

    /**
     * Removes a device: the hub stops listening for it and `core` releases its rows.
     *
     * @param route - The id and who is asking.
     */
    async (route): Promise<void> => {
      requirePermission(route.identity, 'device:delete');

      const removed = await deleteDevice(
        forRequest(context, route.request.traceId),
        route.params.deviceId,
      );

      await context.audit.record({
        action: 'device.delete',
        resourceType: 'device',
        resourceId: route.params.deviceId,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { name: removed.name, kind: removed.kind, entities: removed.entityIds.length },
      });
    },
  );
}
