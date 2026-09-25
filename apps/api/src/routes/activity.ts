/**
 * `/devices/:deviceId/activity`: what changed on one device, newest first.
 *
 * Read from the state history the platform already keeps; nothing is written for it. A device
 * that is not there is a 404. The page then holds what the caller may read of it: each entity is
 * checked for `entity:read` and `history:read` as the history endpoints check one, so a grant
 * scoped to a room shows that room's part of a device and nothing else.
 */
import {
  activityEntrySchema,
  pageQuerySchema,
  pageSchema,
  type ActivityEntry,
  type Page,
} from '@nebula-home/contracts';

import { requirePermission } from '../auth/permissions.js';
import type { ApiContext } from '../context.js';
import { defineRoute, type RouteEnvironment } from '../http/route.js';
import { readActivity, readableActivityEntities } from '../services/activity.js';
import { readDevice } from '../services/devices.js';
import { findEntities } from '../services/entities.js';

import { deviceParamsSchema, forRequest } from './devices.js';

/**
 * Registers the activity endpoint.
 *
 * @param environment - The server, the registry and the version prefix.
 * @param context - The service context.
 */
export function registerActivityRoutes(environment: RouteEnvironment, context: ApiContext): void {
  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/devices/:deviceId/activity',
      summary: "Read what changed on one device's entities, newest first",
      tag: 'Devices',
      permission: 'device:read',
      params: deviceParamsSchema,
      query: pageQuerySchema,
      response: pageSchema(activityEntrySchema),
    },

    /**
     * Reads one page of a device's activity.
     *
     * @param route - The device, the page, and who is asking.
     * @returns The page, newest first.
     */
    async (route): Promise<Page<ActivityEntry>> => {
      requirePermission(route.identity, 'device:read');

      const device = await readDevice(
        forRequest(context, route.request.traceId),
        route.params.deviceId,
      );
      const entities = readableActivityEntities(
        route.identity,
        await findEntities(context.db, device.entityIds),
      );

      return readActivity(context.db, entities, {
        limit: route.query.limit,
        ...(route.query.cursor === undefined ? {} : { cursor: route.query.cursor }),
      });
    },
  );
}
