/**
 * Linking: one device reached two ways, its readings each one entity.
 *
 * Every link and unlink says first what it will do, with `?preview=true`, which is what its dialog
 * lists for the owner to confirm, and then does it with the same request without the flag. The
 * suggestions are the house's offers to link two devices that look like one, which the owner can
 * set aside and take back.
 */
import { z } from 'zod';

import {
  deviceLinkRequestSchema,
  entityIdSchema,
  entityLinkRequestSchema,
  linkPreviewQuerySchema,
  linkPreviewSchema,
  linkSuggestionDismissSchema,
  linkSuggestionsReplySchema,
  linkSuggestionViewSchema,
  VENDOR_ID_PATTERN,
  type LinkPreview,
  type LinkSuggestionView,
} from '@nebulahome/contracts';

import { requirePermission } from '../auth/permissions.js';
import type { ApiContext } from '../context.js';
import { defineRoute, type RouteEnvironment } from '../http/route.js';
import {
  changeLink,
  listLinkSuggestions,
  setLinkSuggestionDismissed,
  suggestionOfDevice,
  type LinkAction,
} from '../services/links.js';

import { deviceParamsSchema, forRequest } from './devices.js';

/** Which entity a request is about. */
const entityParamsSchema = z.object({ entityId: entityIdSchema });

/** Which suggestion a request is about. */
const suggestionParamsSchema = z.object({ suggestionId: z.uuid() });

/** Which vendor a request is about. */
const vendorParamsSchema = z.object({ vendorId: z.string().regex(VENDOR_ID_PATTERN) });

/**
 * Registers the link routes.
 *
 * @param environment - Where routes are defined.
 * @param context - The service's collaborators.
 */
export function registerLinkRoutes(environment: RouteEnvironment, context: ApiContext): void {
  /**
   * Links or unlinks, says what that does, and audits what was done.
   *
   * @param route - The request.
   * @param route.request - Its trace and address.
   * @param route.request.traceId - The trace.
   * @param route.request.ip - Where it came from.
   * @param route.identity - Who asks.
   * @param action - What to do.
   * @param target - The device or entity.
   * @param other - The other side of a link.
   * @param isPreview - Whether only to say.
   * @returns What it does, or would do.
   */
  const run = async (
    route: {
      request: { traceId: string; ip: string };
      identity: Parameters<typeof requirePermission>[0];
    },
    action: LinkAction,
    target: string,
    other: string | undefined,
    isPreview: boolean,
  ): Promise<LinkPreview> => {
    requirePermission(route.identity, 'device:write');

    const preview = await changeLink(
      forRequest(context, route.request.traceId),
      action,
      target,
      other,
      isPreview,
    );

    if (!isPreview) {
      await context.audit.record({
        action: action.startsWith('device') ? 'device.update' : 'entity.update',
        resourceType: action.startsWith('device') ? 'device' : 'entity',
        resourceId: target,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { link: action, with: other ?? null, pairs: preview.pairs.length },
      });
    }

    return preview;
  };

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/devices/:deviceId/link',
      summary: 'Link a device to another way into it, or say what that does',
      tag: 'Devices',
      permission: 'device:write',
      params: deviceParamsSchema,
      query: linkPreviewQuerySchema,
      body: deviceLinkRequestSchema,
      response: linkPreviewSchema,
    },

    /**
     * Links two devices into one.
     *
     * @param route - The device, the other, and whether only to say.
     * @returns What it does.
     */
    async (route): Promise<LinkPreview> =>
      run(route, 'device-link', route.params.deviceId, route.body.with, route.query.preview),
  );

  defineRoute(
    environment,
    {
      method: 'DELETE',
      url: '/devices/:deviceId/link',
      summary: 'Unlink a device reached more than one way, or say what that does',
      tag: 'Devices',
      permission: 'device:write',
      params: deviceParamsSchema,
      query: linkPreviewQuerySchema,
      response: linkPreviewSchema,
    },

    /**
     * Makes a linked device two again.
     *
     * @param route - The device, and whether only to say.
     * @returns What it does.
     */
    async (route): Promise<LinkPreview> =>
      run(route, 'device-unlink', route.params.deviceId, undefined, route.query.preview),
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/entities/:entityId/link',
      summary: 'Link an entity to another that reads the same thing, or say what that does',
      tag: 'Entities',
      permission: 'device:write',
      params: entityParamsSchema,
      query: linkPreviewQuerySchema,
      body: entityLinkRequestSchema,
      response: linkPreviewSchema,
    },

    /**
     * Links two entities into one.
     *
     * @param route - The entity, the other, and whether only to say.
     * @returns What it does.
     */
    async (route): Promise<LinkPreview> =>
      run(route, 'entity-link', route.params.entityId, route.body.with, route.query.preview),
  );

  defineRoute(
    environment,
    {
      method: 'DELETE',
      url: '/entities/:entityId/link',
      summary: 'Unlink an entity, or say what that does',
      tag: 'Entities',
      permission: 'device:write',
      params: entityParamsSchema,
      query: linkPreviewQuerySchema,
      response: linkPreviewSchema,
    },

    /**
     * Gives each of a linked entity's sources its own entity again.
     *
     * @param route - The entity, and whether only to say.
     * @returns What it does.
     */
    async (route): Promise<LinkPreview> =>
      run(route, 'entity-unlink', route.params.entityId, undefined, route.query.preview),
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/integrations/vendors/:vendorId/suggestions',
      summary: "List an integration's offers to link two of its devices",
      tag: 'Integrations',
      permission: 'device:read',
      params: vendorParamsSchema,
      response: linkSuggestionsReplySchema,
    },

    /**
     * Lists the suggestions, offered and set aside.
     *
     * @param route - The vendor and who asks.
     * @returns The suggestions.
     */
    async (route): Promise<{ items: LinkSuggestionView[] }> => {
      requirePermission(route.identity, 'device:read');

      return {
        items: await listLinkSuggestions(
          forRequest(context, route.request.traceId),
          route.params.vendorId,
        ),
      };
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/devices/:deviceId/link-suggestion',
      summary: 'Read the offer to link a device just added to one the house has',
      tag: 'Devices',
      permission: 'device:read',
      params: deviceParamsSchema,
      response: z.object({ item: linkSuggestionViewSchema.nullable() }),
    },

    /**
     * Reads the suggestion the device is part of, still offered.
     *
     * @param route - The device and who asks.
     * @returns The suggestion, or null.
     */
    async (route): Promise<{ item: LinkSuggestionView | null }> => {
      requirePermission(route.identity, 'device:read');

      return {
        item:
          (await suggestionOfDevice(
            forRequest(context, route.request.traceId),
            route.params.deviceId,
          )) ?? null,
      };
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/link-suggestions/:suggestionId/dismiss',
      summary: 'Set an offer to link aside, or offer it again',
      tag: 'Integrations',
      permission: 'device:write',
      params: suggestionParamsSchema,
      body: linkSuggestionDismissSchema,
      successStatus: 204,
    },

    /**
     * Sets the suggestion aside, or back.
     *
     * @param route - The suggestion, the answer and who asks.
     */
    async (route): Promise<void> => {
      requirePermission(route.identity, 'device:write');

      await setLinkSuggestionDismissed(
        forRequest(context, route.request.traceId),
        route.params.suggestionId,
        route.body.isDismissed,
      );
    },
  );
}
