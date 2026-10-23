/**
 * Webhooks: the public address a call starts an automation through, and Settings › Webhooks.
 *
 * `/api/hooks/<hookId>` is outside `/api/v1` and public - the id is the credential - and is
 * registered on the server directly, in a scope of its own whose only body parser reads any body
 * and throws it away: a webhook may be sent anything, and nothing of it is passed on. `core`
 * decides the answer (`services/automation-engine.ts`), records the call, and starts the run; a
 * `core` that is away is a 503.
 *
 * The two lists read the automations and `history.webhook_calls`, for whoever may read automations.
 * The two settings the page changes go through the settings endpoint like every other.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  busSubjects,
  CORE_SERVICE,
  CORE_WEBHOOK_CALL_METHOD,
  DeviceUnavailableError,
  NotFoundError,
  pageSchema,
  webhookCallReplySchema,
  webhookCallSchema,
  webhookCallsQuerySchema,
  webhookIdSchema,
  webhookViewSchema,
  type Page,
  type WebhookCall,
  type WebhookCallReply,
  type WebhookView,
} from '@nebulahome/contracts';

import { requirePermission } from '../auth/permissions.js';
import type { ApiContext } from '../context.js';
import { collectionSchema } from '../http/collection.js';
import { defineRoute, type RouteEnvironment } from '../http/route.js';
import {
  isLocalAddress,
  listWebhookCalls,
  listWebhooks,
  loggedHeaders,
} from '../services/webhooks.js';

/** Where a webhook is called: `/api/hooks/<hookId>`. */
export const HOOK_PATH_PREFIX = '/api/hooks/';

/**
 * Registers the lists Settings › Webhooks reads.
 *
 * @param environment - The server, the registry and the version prefix.
 * @param context - The service context.
 */
export function registerWebhookRoutes(environment: RouteEnvironment, context: ApiContext): void {
  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/webhooks',
      summary: "List the automations' webhooks, with their calls of the last day",
      tag: 'Library',
      permission: 'automation:read',
      response: collectionSchema(webhookViewSchema),
    },

    /**
     * Lists every webhook trigger, paused automations' included.
     *
     * @param route - Who is asking.
     * @returns The webhooks.
     */
    async (route): Promise<{ items: WebhookView[] }> => {
      requirePermission(route.identity, 'automation:read');

      return { items: await listWebhooks(context.db, context.now()) };
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/webhooks/calls',
      summary: 'Read the calls webhook addresses received, newest first',
      tag: 'Library',
      permission: 'automation:read',
      query: webhookCallsQuerySchema,
      response: pageSchema(webhookCallSchema),
    },

    /**
     * Reads one page of calls, narrowed.
     *
     * @param route - The filter, the page and who is asking.
     * @returns The page.
     */
    async (route): Promise<Page<WebhookCall>> => {
      requirePermission(route.identity, 'automation:read');

      return listWebhookCalls(context.db, route.query, context.now());
    },
  );
}

/**
 * Registers the public address webhooks are called on.
 *
 * @param server - The server.
 * @param context - The service context.
 */
export async function registerHookRoute(
  server: FastifyInstance,
  context: ApiContext,
): Promise<void> {
  await server.register((scope, options, ready) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'buffer' }, (request, body, done) => {
      done(null, undefined);
    });

    scope.route({
      // HEAD comes with GET.
      method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      url: `${HOOK_PATH_PREFIX}:hookId`,

      /**
       * Hands a call to `core` and answers what it decided.
       *
       * @param request - The call.
       * @param reply - Where the answer goes.
       * @returns The answer: what became of the call, and the run it started.
       * @throws {NotFoundError} When the path is not a webhook id at all.
       * @throws {DeviceUnavailableError} When `core` cannot be reached.
       */
      handler: async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
        const hookId = webhookIdSchema.safeParse((request.params as { hookId?: unknown }).hookId);

        if (!hookId.success) {
          throw new NotFoundError('No webhook has this address');
        }

        if (context.bus === undefined) {
          throw new DeviceUnavailableError('The automation engine is not reachable');
        }

        let answer: WebhookCallReply;

        try {
          answer = await context.bus.request(
            busSubjects.service(CORE_SERVICE, CORE_WEBHOOK_CALL_METHOD),
            {
              hookId: hookId.data,
              method: request.method,
              // Without the query, which may carry what a credential is.
              path: (request.url.split('?')[0] ?? '').slice(0, 2_000),
              ip: request.ip,
              isLocal: isLocalAddress(request.ip),
              userAgent: request.headers['user-agent']?.slice(0, 500) ?? null,
              headers: loggedHeaders(request.headers),
            },
            webhookCallReplySchema,
            { traceId: request.traceId, timeoutMs: context.config.API_BUS_TIMEOUT_MS },
          );
        } catch (error: unknown) {
          throw new DeviceUnavailableError('The automation engine did not answer', {
            cause: error,
          });
        }

        return reply.code(answer.status).send({ outcome: answer.outcome, runId: answer.runId });
      },
    });
    ready();
  });
}
