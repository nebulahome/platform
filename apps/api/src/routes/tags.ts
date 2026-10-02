/**
 * Tags: the words an owner puts on devices and entities to pick a group of them at once.
 *
 * Four routes for the tags themselves. Putting a tag on a device or an entity is a change to
 * that device or entity - `PATCH /devices/:id` and `PATCH /entities/:id` take `tagIds` - and
 * needs that resource's own write permission; these need `tag:write`, which is about the
 * words, not about what carries them.
 */
import { z } from 'zod';

import {
  tagCreateSchema,
  tagUpdateSchema,
  tagViewSchema,
  type TagView,
} from '@nebulahome/contracts';

import { requirePermission } from '../auth/permissions.js';
import type { ApiContext } from '../context.js';
import { collectionSchema } from '../http/collection.js';
import { defineRoute, type RouteEnvironment } from '../http/route.js';
import { createTag, deleteTag, listTags, updateTag } from '../services/tags.js';

/** Which tag a request is about. */
const tagParamsSchema = z.object({ tagId: z.uuid() });

/**
 * Registers the tag routes.
 *
 * @param environment - Where routes are defined.
 * @param context - The service's collaborators.
 */
export function registerTagRoutes(environment: RouteEnvironment, context: ApiContext): void {
  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/tags',
      summary: 'List tags',
      tag: 'Tags',
      permission: 'tag:read',
      response: collectionSchema(tagViewSchema),
    },

    /**
     * Lists tags.
     *
     * @param route - Who is asking.
     * @returns Every tag, with how many devices and entities carry it.
     */
    async (route): Promise<{ items: TagView[] }> => {
      requirePermission(route.identity, 'tag:read');

      return { items: await listTags(context.db) };
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/tags',
      summary: 'Create a tag',
      tag: 'Tags',
      permission: 'tag:write',
      body: tagCreateSchema,
      response: tagViewSchema,
    },

    /**
     * Creates a tag from a name, a colour and perhaps an icon.
     *
     * @param route - The body and who is asking.
     * @returns The tag, on nothing yet.
     */
    async (route): Promise<TagView> => {
      requirePermission(route.identity, 'tag:write');

      const tag = await createTag(context.db, context.icons, route.body);

      await context.audit.record({
        action: 'tag.create',
        resourceType: 'tag',
        resourceId: tag.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { key: tag.key, name: tag.name, color: tag.color, icon: tag.icon },
      });

      return tag;
    },
  );

  defineRoute(
    environment,
    {
      method: 'PATCH',
      url: '/tags/:tagId',
      summary: 'Rename or recolour a tag',
      tag: 'Tags',
      permission: 'tag:write',
      params: tagParamsSchema,
      body: tagUpdateSchema,
      response: tagViewSchema,
    },

    /**
     * Changes a tag's name, colour or icon. Its key, and so its scope, stays.
     *
     * @param route - The body, the id and who is asking.
     * @returns The tag as it now stands.
     */
    async (route): Promise<TagView> => {
      requirePermission(route.identity, 'tag:write');

      const tag = await updateTag(context.db, context.icons, route.params.tagId, route.body);

      await context.audit.record({
        action: 'tag.update',
        resourceType: 'tag',
        resourceId: tag.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { changed: Object.keys(route.body) },
      });

      return tag;
    },
  );

  defineRoute(
    environment,
    {
      method: 'DELETE',
      url: '/tags/:tagId',
      summary: 'Remove a tag from everything, and delete it',
      tag: 'Tags',
      permission: 'tag:write',
      params: tagParamsSchema,
      successStatus: 204,
    },

    /**
     * Removes a tag.
     *
     * @param route - The id and who is asking.
     */
    async (route): Promise<void> => {
      requirePermission(route.identity, 'tag:write');

      await deleteTag(context.db, route.params.tagId);

      await context.audit.record({
        action: 'tag.delete',
        resourceType: 'tag',
        resourceId: route.params.tagId,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: {},
      });
    },
  );
}
