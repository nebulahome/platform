/**
 * `/discovery`: the devices the hub heard announce themselves, and adopting one.
 *
 * A list and one action on each entry. The list is the hub's, read through; adopting is adding a
 * device with the answers discovery already has, and it is audited as the addition it is.
 */
import { z } from 'zod';

import {
  deviceViewSchema,
  discoveredReplySchema,
  discoveryAdoptSchema,
  type DeviceView,
  type DiscoveredReply,
} from '@nebula-home/contracts';

import { requirePermission } from '../auth/permissions.js';
import type { ApiContext } from '../context.js';
import { defineRoute, type RouteEnvironment } from '../http/route.js';
import { adoptDiscovered, listDiscovered } from '../services/discovery.js';

import { forRequest } from './devices.js';

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
