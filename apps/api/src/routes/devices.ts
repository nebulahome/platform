/**
 * Finding devices and adopting them.
 *
 * Three routes around one dialog. A pass is started on an instance, what it finds is read while
 * it runs, and a candidate is adopted - at which point `core` writes the row, publishes the
 * device event, and the registry the list shows has one more thing in it. All three go through
 * the hub over the bus, so all three answer 503 while the bus is away rather than pretending.
 *
 * `GET /devices` itself stays with the registry reads: it is a read of a table, and these are
 * not.
 */
import {
  deviceAdoptReplySchema,
  deviceAdoptRequestSchema,
  deviceCandidatesReplySchema,
  deviceDiscoverReplySchema,
  deviceDiscoverRequestSchema,
  type DeviceAdoptReply,
  type DeviceCandidatesReply,
  type DeviceDiscoverReply,
} from '@nebula-home/contracts';

import { requirePermission } from '../auth/permissions.js';
import type { ApiContext } from '../context.js';
import { defineRoute, type RouteEnvironment } from '../http/route.js';
import {
  adoptCandidate,
  readCandidates,
  startDiscovery,
  type DevicesContext,
} from '../services/devices.js';

/**
 * What the relays need, for one request.
 *
 * @param context - The service's collaborators.
 * @param traceId - The request's trace id.
 * @returns The request-scoped view of them.
 */
function forRequest(context: ApiContext, traceId: string): DevicesContext {
  return {
    bus: context.bus,
    timeoutMs: context.config.API_BUS_TIMEOUT_MS,
    traceId,
  };
}

/**
 * Registers the device discovery routes.
 *
 * @param environment - Where routes are defined.
 * @param context - The service's collaborators.
 */
export function registerDeviceRoutes(environment: RouteEnvironment, context: ApiContext): void {
  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/devices/discover',
      summary: 'Start looking for devices',
      tag: 'Registry',
      permission: 'device:write',
      body: deviceDiscoverRequestSchema,
      response: deviceDiscoverReplySchema,
      successStatus: 202,
    },

    /**
     * Starts a discovery pass and answers at once; the pass runs on.
     *
     * @param route - Which instance, for how long, and who is asking.
     * @returns The pass identifier and the instances looking.
     */
    async (route): Promise<DeviceDiscoverReply> => {
      requirePermission(route.identity, 'device:write');

      const reply = await startDiscovery(forRequest(context, route.request.traceId), route.body);

      await context.audit.record({
        action: 'device.discover',
        resourceType: 'integration',
        resourceId: route.body.integrationId ?? '*',
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { scanId: reply.scanId, integrationIds: reply.integrationIds },
      });

      return reply;
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/devices/candidates',
      summary: 'What the current pass has found',
      tag: 'Registry',
      permission: 'device:write',
      response: deviceCandidatesReplySchema,
    },

    /**
     * Reads what the pass has found so far.
     *
     * @param route - Who is asking.
     * @returns The candidates, and whether the pass is still running.
     */
    async (route): Promise<DeviceCandidatesReply> => {
      requirePermission(route.identity, 'device:write');

      return readCandidates(forRequest(context, route.request.traceId));
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/devices/adopt',
      summary: 'Adopt a device the pass found',
      tag: 'Registry',
      permission: 'device:write',
      body: deviceAdoptRequestSchema,
      response: deviceAdoptReplySchema,
    },

    /**
     * Adopts one candidate: the hub describes it, `core` writes it.
     *
     * @param route - Which candidate, what to call it, and who is asking.
     * @returns The device row and its entities.
     */
    async (route): Promise<DeviceAdoptReply> => {
      requirePermission(route.identity, 'device:write');

      const reply = await adoptCandidate(forRequest(context, route.request.traceId), route.body);

      await context.audit.record({
        action: 'device.adopt',
        resourceType: 'device',
        resourceId: reply.deviceId,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { candidateId: route.body.candidateId, entityIds: reply.entityIds },
      });

      return reply;
    },
  );
}
