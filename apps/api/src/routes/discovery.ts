/**
 * `/discovery`: the devices the hub heard announce themselves, adopting one, and looking now.
 *
 * A list and one action on each entry. The list is the hub's, read through; adopting is adding a
 * device with the answers discovery already has, and it is audited as the addition it is. Looking
 * now asks the hub to ask the network again instead of at its next scheduled question.
 */
import { z } from 'zod';

import {
  deviceViewSchema,
  discoveredReplySchema,
  discoverReplySchema,
  discoverRequestSchema,
  discoveryAdoptSchema,
  type DeviceView,
  type DiscoveredReply,
  type DiscoverReply,
} from '@nebula-home/contracts';

import { requirePermission } from '../auth/permissions.js';
import type { ApiContext } from '../context.js';
import { defineRoute, type RouteEnvironment } from '../http/route.js';
import { adoptDiscovered, listDiscovered, requestScan } from '../services/discovery.js';

import { forRequest } from './devices.js';

/** The status a scan is answered with: asked for, answers still to come. */
const SCAN_ACCEPTED_STATUS = 202;

/** Which proposed device a request is about, as the hub listed it. */
const candidateParamsSchema = z.object({ candidateId: z.string().regex(/^[a-f0-9]{16,64}$/) });

/**
 * Registers the discovery routes.
 *
 * @param environment - Where routes are registered and documented.
 * @param context - The service's collaborators.
 */
export function registerDiscoveryRoutes(environment: RouteEnvironment, context: ApiContext): void {
  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/discovery',
      summary: 'List the devices found on the network and not yet added',
      tag: 'Devices',
      permission: 'device:read',
      response: discoveredReplySchema,
    },

    /**
     * Lists what the hub proposes.
     *
     * @param route - Who is asking.
     * @returns Every device heard and not yet added; none when the hub is not there.
     */
    async (route): Promise<DiscoveredReply> => {
      requirePermission(route.identity, 'device:read');

      return { items: await listDiscovered(forRequest(context, route.request.traceId)) };
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/discovery/scan',
      summary: 'Look for devices on the network now',
      tag: 'Devices',
      permission: 'device:write',
      body: discoverRequestSchema,
      response: discoverReplySchema,
      successStatus: SCAN_ACCEPTED_STATUS,
    },

    /**
     * Asks the hub to look now, for one vendor or every one that can be found.
     *
     * Asked of whoever may add devices: looking is what comes before adding, and it makes the
     * hub talk to every device of the vendor on the network.
     *
     * @param route - Which vendor, if only one, and who is asking.
     * @returns The vendors being looked for.
     */
    async (route): Promise<DiscoverReply> => {
      requirePermission(route.identity, 'device:write');

      return {
        vendors: await requestScan(forRequest(context, route.request.traceId), route.body.vendorId),
      };
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/discovery/:candidateId/adopt',
      summary: 'Add a device found on the network',
      tag: 'Devices',
      permission: 'device:write',
      params: candidateParamsSchema,
      body: discoveryAdoptSchema,
      response: deviceViewSchema,
    },

    /**
     * Adds a device the hub found, with what it found filled in.
     *
     * @param route - Which device, what the owner decided, and who is asking.
     * @returns The device as it now stands.
     */
    async (route): Promise<DeviceView> => {
      requirePermission(route.identity, 'device:write');

      const { device, candidate } = await adoptDiscovered(
        forRequest(context, route.request.traceId),
        route.params.candidateId,
        route.body,
      );

      // As `POST /devices` records it, with where it came from: the field names only, since a
      // transport configuration carries credentials.
      await context.audit.record({
        action: 'device.create',
        resourceType: 'device',
        resourceId: device.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: {
          via: 'discovery',
          kind: device.kind,
          model: device.model,
          source: candidate.source,
          fields: Object.keys(route.body.transportConfig),
          options: Object.keys(route.body.options),
        },
      });

      return device;
    },
  );
}
