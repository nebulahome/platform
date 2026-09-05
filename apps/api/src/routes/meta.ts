/**
 * The endpoints that are not part of any version: discovery, health, and the generated contract.
 *
 * `GET /api/versions` sits outside `/api/v1` deliberately. It is how a client finds out which
 * versions exist, so putting it inside one of them would mean having to know a version in order
 * to ask which versions there are.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  API_VERSIONS,
  CURRENT_API_VERSION,
  apiVersionsResponseSchema,
  healthResponseSchema,
  type ApiVersionsResponse,
  type HealthResponse,
} from '@nebula-home/contracts';

import type { ApiContext } from '../context.js';
import { buildOpenApiDocument } from '../http/openapi.js';
import type { RouteRegistry } from '../http/route.js';

/** The header naming a deprecated version's removal date. */
const SUNSET_HEADER = 'sunset';

/** The header marking a response as coming from a deprecated version. */
const DEPRECATION_HEADER = 'deprecation';

/**
 * Registers version discovery, health and the OpenAPI document.
 *
 * @param server - The instance to register on.
 * @param context - The service context.
 * @param registry - Every route, for generating the contract.
 * @param startedAt - When the process came up, for the uptime figure.
 */
export function registerMetaRoutes(
  server: FastifyInstance,
  context: ApiContext,
  registry: RouteRegistry,
  startedAt: Date,
): void {
  server.get(
    '/api/versions',

    /**
     * Lists the versions this build serves.
     *
     * @returns The versions and which one is current.
     */
    (): ApiVersionsResponse =>
      apiVersionsResponseSchema.parse({
        versions: API_VERSIONS,
        current: CURRENT_API_VERSION,
      }),
  );

  server.get(
    '/healthz',

    /**
     * Says whether the process is alive.
     *
     * Deliberately does not touch the database or the bus: a liveness probe that fails when a
     * dependency is down gets the container killed and restarted, which fixes nothing and loses
     * the in-flight requests. That question is `/readyz`.
     *
     * @returns The health of this process.
     */
    (): HealthResponse =>
      healthResponseSchema.parse({
        status: 'ok',
        service: 'api',
        version: context.config.NODE_ENV,
        uptimeSeconds: (context.now().getTime() - startedAt.getTime()) / 1000,
        dependencies: {},
      }),
  );

  server.get(
    '/readyz',

    /**
     * Says whether the process can serve requests.
     *
     * @param request - Unused; present because Fastify hands it to every handler.
     * @param reply - Set to 503 when a dependency is missing, so a load balancer takes this
     * instance out rather than sending it traffic it cannot serve.
     * @returns The health of this process and its dependencies.
     */
    async (request: FastifyRequest, reply: FastifyReply): Promise<HealthResponse> => {
      let isDatabaseReachable = false;

      try {
        await context.db.execute('SELECT 1');
        isDatabaseReachable = true;
      } catch (error: unknown) {
        context.logger.warn({ err: error }, 'Readiness check could not reach the database');
      }

      const isBusReachable = context.bus !== undefined;
      const isReady = isDatabaseReachable && isBusReachable;

      if (!isReady) {
        void reply.status(503);
      }

      return healthResponseSchema.parse({
        status: isReady ? 'ok' : 'degraded',
        service: 'api',
        version: context.config.NODE_ENV,
        uptimeSeconds: (context.now().getTime() - startedAt.getTime()) / 1000,
        dependencies: { database: isDatabaseReachable, bus: isBusReachable },
      });
    },
  );

  server.get(
    '/api/v1/openapi.json',

    /**
     * Serves the generated contract.
     *
     * Unauthenticated on purpose: it describes the shape of the API, not its contents. A client
     * generator needs it before it has any credentials to present.
     *
     * @returns The OpenAPI 3.1 document.
     */
    (): Record<string, unknown> => buildOpenApiDocument(registry, CURRENT_API_VERSION),
  );

  server.addHook(
    'onSend',

    /**
     * Marks responses served by a deprecated version.
     *
     * ARCHITECTURE.md 11.1 requires `Deprecation` and `Sunset` on every response a retiring
     * version serves, so that a client learns it is on borrowed time from traffic it is already
     * making rather than from an endpoint it has to remember to poll.
     *
     * The callback form, and not a three-argument function that returns the payload. Fastify
     * hands `onSend` a fourth argument and continues the send when it is called or when the
     * hook returns a promise; a synchronous return is neither, so the response is built, the
     * headers are set, and nothing is ever written. Every request on the server hangs, with no
     * error anywhere - which is exactly how this was found.
     *
     * @param request - The request being answered.
     * @param reply - The reply to mark.
     * @param payload - Passed through untouched.
     * @param done - Continues the send.
     */
    (
      request: FastifyRequest,
      reply: FastifyReply,
      payload: unknown,
      done: (error: Error | null, payload?: unknown) => void,
    ): void => {
      const version = API_VERSIONS.find((entry) => request.url.startsWith(`${entry.basePath}/`));

      if (version?.status === 'deprecated' && version.sunsetAt !== null) {
        void reply.header(DEPRECATION_HEADER, 'true');
        void reply.header(SUNSET_HEADER, new Date(version.sunsetAt).toUTCString());
      }

      done(null, payload);
    },
  );
}
