/**
 * Areas over HTTP: the tree read whole, the house, each floor and each room made, changed or
 * removed, and the map around the house fetched onto disk.
 *
 * One flat collection, like the tags: a home has tens of areas, and a cursor on a list that
 * fits in one response is ceremony. The tree is the client's to build from `parentId`.
 *
 * The map is a sub-resource of the house. Reading it says how much of the buffer around the
 * house is on disk; creating it fetches what is missing, and answers when that is done - some
 * seconds with the internet there, at once without it - so that the page can say which.
 */
import { z } from 'zod';

import {
  areaCreateSchema,
  areaUpdateSchema,
  areaViewSchema,
  tileCacheStatusSchema,
  tilePrefetchResultSchema,
  ValidationError,
  type AreaView,
  type TileCacheStatus,
  type TilePrefetchResult,
} from '@nebulahome/contracts';

import { requirePermission } from '../auth/permissions.js';
import type { ApiContext } from '../context.js';
import { collectionSchema } from '../http/collection.js';
import { defineRoute, type RouteEnvironment } from '../http/route.js';
import { createArea, deleteArea, listAreas, readArea, updateArea } from '../services/areas.js';
import { syncHouseOnCore } from '../services/automations-core.js';

/**
 * Reads the house an id names, placed, or says why the map cannot be had.
 *
 * @param context - The service's collaborators.
 * @param areaId - The id.
 * @returns The house's position.
 * @throws {ValidationError} When the area is not a house, or the house is not placed. When no
 * area has that id, `readArea` says so.
 */
async function placedHouse(
  context: ApiContext,
  areaId: string,
): Promise<{ latitude: number; longitude: number }> {
  const area = await readArea(context.db, areaId);

  if (area.kind !== 'house') {
    throw new ValidationError('Only the house has a map around it', {
      details: { id: areaId, kind: area.kind },
    });
  }

  if (area.latitude === null || area.longitude === null) {
    throw new ValidationError('The house has not been placed on the map yet', {
      details: { id: areaId },
    });
  }

  return { latitude: area.latitude, longitude: area.longitude };
}

/** Which area a request is about. */
const areaParamsSchema = z.object({ areaId: z.uuid() });

/**
 * Registers the area routes.
 *
 * @param environment - Where routes are defined.
 * @param context - The service's collaborators.
 */
export function registerAreaRoutes(environment: RouteEnvironment, context: ApiContext): void {
  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/areas',
      summary: 'List areas',
      tag: 'Areas',
      permission: 'area:read',
      response: collectionSchema(areaViewSchema),
    },

    /**
     * Lists areas.
     *
     * @param route - Who is asking.
     * @returns Every area, with how many devices and entities are in each.
     */
    async (route): Promise<{ items: AreaView[] }> => {
      requirePermission(route.identity, 'area:read');

      return { items: await listAreas(context.db) };
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/areas',
      summary: 'Create a house, a floor or a room',
      tag: 'Areas',
      permission: 'area:write',
      body: areaCreateSchema,
      response: areaViewSchema,
    },

    /**
     * Creates an area.
     *
     * @param route - The body and who is asking.
     * @returns The area, with nothing in it yet.
     */
    async (route): Promise<AreaView> => {
      requirePermission(route.identity, 'area:write');

      const area = await createArea(context.db, context.icons, route.body);

      await context.audit.record({
        action: 'area.create',
        resourceType: 'area',
        resourceId: area.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { key: area.key, name: area.name, kind: area.kind, parentId: area.parentId },
      });

      if (area.kind === 'house') {
        // Where the house stands is when the sun rises for its automations.
        await syncHouseOnCore({
          bus: context.bus,
          traceId: route.request.traceId,
          timeoutMs: context.config.API_BUS_TIMEOUT_MS,
          logger: context.logger,
        });
      }

      return area;
    },
  );

  defineRoute(
    environment,
    {
      method: 'PATCH',
      url: '/areas/:areaId',
      summary: 'Rename, redraw or move an area',
      tag: 'Areas',
      permission: 'area:write',
      params: areaParamsSchema,
      body: areaUpdateSchema,
      response: areaViewSchema,
    },

    /**
     * Changes an area's name, icon or position. Its kind and its key, and so its scope, stay.
     *
     * @param route - The body, the id and who is asking.
     * @returns The area as it now stands.
     */
    async (route): Promise<AreaView> => {
      requirePermission(route.identity, 'area:write');

      const area = await updateArea(context.db, context.icons, route.params.areaId, route.body);

      await context.audit.record({
        action: 'area.update',
        resourceType: 'area',
        resourceId: area.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { changed: Object.keys(route.body) },
      });

      if (area.kind === 'house' && ('latitude' in route.body || 'longitude' in route.body)) {
        // Where the house stands is when the sun rises for its automations.
        await syncHouseOnCore({
          bus: context.bus,
          traceId: route.request.traceId,
          timeoutMs: context.config.API_BUS_TIMEOUT_MS,
          logger: context.logger,
        });
      }

      return area;
    },
  );

  defineRoute(
    environment,
    {
      method: 'DELETE',
      url: '/areas/:areaId',
      summary: 'Remove an area and everything under it',
      tag: 'Areas',
      permission: 'area:write',
      params: areaParamsSchema,
      successStatus: 204,
    },

    /**
     * Removes an area.
     *
     * @param route - The id and who is asking.
     */
    async (route): Promise<void> => {
      requirePermission(route.identity, 'area:write');

      await deleteArea(context.db, route.params.areaId);

      await context.audit.record({
        action: 'area.delete',
        resourceType: 'area',
        resourceId: route.params.areaId,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: {},
      });
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/areas/:areaId/tiles',
      summary: 'Say how much of the map around the house is on disk',
      tag: 'Areas',
      permission: 'area:read',
      params: areaParamsSchema,
      response: tileCacheStatusSchema,
    },

    /**
     * Reads the state of the buffer around the house.
     *
     * @param route - The id and who is asking.
     * @returns How many tiles the buffer has, and how many are on disk.
     */
    async (route): Promise<TileCacheStatus> => {
      requirePermission(route.identity, 'area:read');

      const { latitude, longitude } = await placedHouse(context, route.params.areaId);

      return context.mapTiles.status(latitude, longitude);
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/areas/:areaId/tiles',
      summary: 'Fetch the map around the house onto disk',
      tag: 'Areas',
      permission: 'area:write',
      params: areaParamsSchema,
      response: tilePrefetchResultSchema,
    },

    /**
     * Fetches what the buffer around the house is missing.
     *
     * @param route - The id and who is asking.
     * @returns What the fetch did.
     */
    async (route): Promise<TilePrefetchResult> => {
      requirePermission(route.identity, 'area:write');

      const { latitude, longitude } = await placedHouse(context, route.params.areaId);
      const result = await context.mapTiles.prefetch(latitude, longitude);

      await context.audit.record({
        action: 'area.map.fetch',
        resourceType: 'area',
        resourceId: route.params.areaId,
        result: result.failed === 0 ? 'success' : 'failure',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { ...result },
      });

      return result;
    },
  );
}
