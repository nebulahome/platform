/**
 * Share links: Settings › Calendar › Share, and the public address each link is read at.
 *
 * Making, changing and deleting a link needs `calendar:manage`. The file itself is at
 * `/api/calendar/<token>.ics`, outside `/api/v1` and public - the token is the credential - and
 * answers callers on the house's network only. A token that is not one, a link that does not
 * exist and a caller from outside all get the same 404, so the address never says whether a token
 * is valid. It is rate limited per address, being public.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  calendarFeedCreateSchema,
  calendarFeedSchema,
  calendarFeedTokenSchema,
  calendarFeedUpdateSchema,
  NotFoundError,
  type CalendarFeed,
} from '@nebulahome/contracts';

import { requirePermission } from '../auth/permissions.js';
import type { ApiContext } from '../context.js';
import { collectionSchema } from '../http/collection.js';
import { defineRoute, type RouteEnvironment } from '../http/route.js';
import { auditOrigin } from '../services/audit.js';
import {
  createFeed,
  deleteFeed,
  listFeeds,
  readFeedFile,
  updateFeed,
} from '../services/calendar-feeds.js';
import { isLocalAddress } from '../services/webhooks.js';

/** Where a share link is read: `/api/calendar/<token>.ics`. */
export const CALENDAR_FEED_PATH_PREFIX = '/api/calendar/';

/** How often one address may read share links: calendar apps poll every few minutes at most. */
const FEED_READS_PER_MINUTE = { max: 30, timeWindow: 60_000 } as const;

/** Which share link a request is about. */
const feedParamsSchema = z.object({ feedId: z.uuid() });

/**
 * Registers the routes that manage share links.
 *
 * @param environment - Where routes are defined.
 * @param context - The service's collaborators.
 */
export function registerCalendarFeedRoutes(
  environment: RouteEnvironment,
  context: ApiContext,
): void {
  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/calendar/feeds',
      summary: 'List the share links',
      tag: 'Calendar',
      permission: 'calendar:manage',
      response: collectionSchema(calendarFeedSchema),
    },

    /**
     * Lists the share links.
     *
     * @param route - Who is asking.
     * @returns The links, by name.
     */
    async (route): Promise<{ items: CalendarFeed[] }> => {
      requirePermission(route.identity, 'calendar:manage');

      return { items: await listFeeds(context.db) };
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/calendar/feeds',
      summary: 'Make a share link of some calendars',
      tag: 'Calendar',
      permission: 'calendar:manage',
      body: calendarFeedCreateSchema,
      response: calendarFeedSchema,
    },

    /**
     * Makes a share link with a new token.
     *
     * @param route - Its name, its calendars and who is asking.
     * @returns The link.
     */
    async (route): Promise<CalendarFeed> => {
      requirePermission(route.identity, 'calendar:manage');

      const feed = await createFeed(context.db, route.identity, route.body);

      await context.audit.record({
        action: 'calendar.feed.create',
        resourceType: 'calendar_feed',
        resourceId: feed.id,
        result: 'success',
        ...auditOrigin(route),
        details: { name: feed.name, calendarIds: feed.calendarIds },
      });

      return feed;
    },
  );

  defineRoute(
    environment,
    {
      method: 'PATCH',
      url: '/calendar/feeds/:feedId',
      summary: 'Rename a share link, change its calendars, or give it a new address',
      tag: 'Calendar',
      permission: 'calendar:manage',
      params: feedParamsSchema,
      body: calendarFeedUpdateSchema,
      response: calendarFeedSchema,
    },

    /**
     * Changes a share link; `newToken` kills the old address.
     *
     * @param route - The change, the id and who is asking.
     * @returns The link as it now stands.
     */
    async (route): Promise<CalendarFeed> => {
      requirePermission(route.identity, 'calendar:manage');

      const feed = await updateFeed(context.db, route.params.feedId, route.body);

      await context.audit.record({
        action: 'calendar.feed.update',
        resourceType: 'calendar_feed',
        resourceId: feed.id,
        result: 'success',
        ...auditOrigin(route),
        details: { changed: Object.keys(route.body) },
      });

      return feed;
    },
  );

  defineRoute(
    environment,
    {
      method: 'DELETE',
      url: '/calendar/feeds/:feedId',
      summary: 'Delete a share link',
      tag: 'Calendar',
      permission: 'calendar:manage',
      params: feedParamsSchema,
      successStatus: 204,
    },

    /**
     * Deletes a share link; its address stops working.
     *
     * @param route - The id and who is asking.
     */
    async (route): Promise<void> => {
      requirePermission(route.identity, 'calendar:manage');

      await deleteFeed(context.db, route.params.feedId);

      await context.audit.record({
        action: 'calendar.feed.delete',
        resourceType: 'calendar_feed',
        resourceId: route.params.feedId,
        result: 'success',
        ...auditOrigin(route),
        details: {},
      });
      void route.reply.status(204);
    },
  );
}

/**
 * Registers the public address share links are read at.
 *
 * @param server - The server.
 * @param context - The service context.
 */
export function registerCalendarFeedRoute(server: FastifyInstance, context: ApiContext): void {
  server.route({
    // HEAD comes with GET.
    method: 'GET',
    url: `${CALENDAR_FEED_PATH_PREFIX}:file`,
    config: { rateLimit: FEED_READS_PER_MINUTE },

    /**
     * Answers a share link's file to a caller at home.
     *
     * @param request - The read.
     * @param reply - Where the file goes.
     * @returns The reply, carrying the file.
     * @throws {NotFoundError} When the path is no token, no link has it, or the caller is not on
     * the house's network: one answer for the three, so a token is never confirmed.
     */
    handler: async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const { file } = request.params as { file?: unknown };
      const token = calendarFeedTokenSchema.safeParse(
        /^(.*)\.ics$/u.exec(typeof file === 'string' ? file : '')?.[1],
      );

      // shortcut: a tunnel or reverse proxy in front of `proxy` makes every call come from its
      // local address, so "local" share links answer the internet through it; read its header then.
      const body =
        token.success && isLocalAddress(request.ip)
          ? await readFeedFile(
              context.db,
              token.data,
              request.headers['user-agent'] ?? null,
              context.now(),
            )
          : null;

      if (body === null) {
        throw new NotFoundError('No share link has this address');
      }

      return reply
        .header('content-type', 'text/calendar; charset=utf-8')
        .header('cache-control', 'no-store')
        .send(body);
    },
  });
}
