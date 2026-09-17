/**
 * The icon catalogue: read by every page that shows an icon, changed from Settings.
 *
 * Reading is a page of the catalogue - a search while somebody types in the picker, or the ids
 * of the rows on screen in one request. Changing is the settings page's: a custom icon added
 * from an uploaded drawing, a built-in one drawn afresh, either put back or removed. Writes
 * need the same permission the rest of the server's settings do, because an icon is seen by
 * everyone who opens the house.
 */
import { z } from 'zod';

import {
  iconCreateSchema,
  iconIdSchema,
  iconsQuerySchema,
  iconsResponseSchema,
  iconUpdateSchema,
  iconViewSchema,
  type IconsResponse,
  type IconView,
} from '@nebula-home/contracts';

import { requirePermission } from '../auth/permissions.js';
import type { ApiContext } from '../context.js';
import { defineRoute, type RouteEnvironment } from '../http/route.js';

/** Which icon a request is about. */
const iconParamsSchema = z.object({ iconId: iconIdSchema });

/**
 * Registers the icon routes.
 *
 * @param environment - Where routes are defined.
 * @param context - The service's collaborators.
 */
export function registerIconRoutes(environment: RouteEnvironment, context: ApiContext): void {
  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/icons',
      summary: 'Search the icon catalogue, or read some icons by id',
      tag: 'Icons',
      permission: 'device:read',
      query: iconsQuerySchema,
      response: iconsResponseSchema,
    },

    /**
     * Lists a page of the catalogue.
     *
     * @param route - The query and who is asking.
     * @returns The icons.
     */
    (route): Promise<IconsResponse> => {
      requirePermission(route.identity, 'device:read');

      return Promise.resolve({ items: context.icons.list(route.query) });
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/icons',
      summary: 'Add a custom icon',
      tag: 'Icons',
      permission: 'settings:write',
      body: iconCreateSchema,
      response: iconViewSchema,
    },

    /**
     * Adds a custom icon from an uploaded drawing.
     *
     * @param route - The body and who is asking.
     * @returns The icon as it is now served.
     */
    async (route): Promise<IconView> => {
      requirePermission(route.identity, 'settings:write');

      const icon = await context.icons.create(route.body);

      await context.audit.record({
        action: 'icon.create',
        resourceType: 'icon',
        resourceId: icon.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { name: icon.name },
      });

      return icon;
    },
  );

  defineRoute(
    environment,
    {
      method: 'PATCH',
      url: '/icons/:iconId',
      summary: 'Change an icon: redraw a built-in one, or change a custom one',
      tag: 'Icons',
      permission: 'settings:write',
      params: iconParamsSchema,
      body: iconUpdateSchema,
      response: iconViewSchema,
    },

    /**
     * Changes an icon.
     *
     * @param route - The body, the id and who is asking.
     * @returns The icon as it is now served.
     */
    async (route): Promise<IconView> => {
      requirePermission(route.identity, 'settings:write');

      const icon = await context.icons.update(route.params.iconId, route.body);

      await context.audit.record({
        action: 'icon.update',
        resourceType: 'icon',
        resourceId: icon.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { from: route.params.iconId, changed: Object.keys(route.body) },
      });

      return icon;
    },
  );

  defineRoute(
    environment,
    {
      method: 'DELETE',
      url: '/icons/:iconId',
      summary: "Remove a custom icon, or put a built-in icon's original drawing back",
      tag: 'Icons',
      permission: 'settings:write',
      params: iconParamsSchema,
      successStatus: 204,
    },

    /**
     * Removes an icon, or an override.
     *
     * @param route - The id and who is asking.
     */
    async (route): Promise<void> => {
      requirePermission(route.identity, 'settings:write');

      await context.icons.remove(route.params.iconId);

      await context.audit.record({
        action: 'icon.delete',
        resourceType: 'icon',
        resourceId: route.params.iconId,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: {},
      });
    },
  );
}
