/**
 * Assembling the HTTP server.
 *
 * The order the plugins go on matters and is not arbitrary: security headers and CORS before
 * anything reads a body, the rate limiter before authentication so an unauthenticated flood is
 * cheap to refuse, and authentication as a hook rather than per route so that a new route is
 * protected by default instead of by remembering.
 *
 * `buildServer` returns the instance without listening. That is what lets a test stand the whole
 * service up, drive it through `inject`, and tear it down without a port.
 */
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';

import { CURRENT_API_VERSION, MaintenanceError } from '@nebula-home/contracts';

import { readBearer } from './auth/authenticator.js';
import type { ApiContext } from './context.js';
import { registerTracing } from './http/context.js';
import { createErrorHandler, handleNotFound } from './http/errors.js';
import { RouteRegistry, type RouteEnvironment } from './http/route.js';
import { registerActivityRoutes } from './routes/activity.js';
import { registerAreaRoutes } from './routes/areas.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerBackupRoutes } from './routes/backup.js';
import { registerCameraRoutes } from './routes/cameras.js';
import { registerContainerRoutes } from './routes/containers.js';
import { registerDashboardRoutes } from './routes/dashboards.js';
import { registerDeviceRoutes } from './routes/devices.js';
import { registerDiscoveryRoutes } from './routes/discovery.js';
import { registerEntityRoutes } from './routes/entities.js';
import { registerHistoryRoutes } from './routes/history.js';
import { registerIconRoutes } from './routes/icons.js';
import { registerIntegrationRoutes } from './routes/integrations.js';
import { registerMapRoutes } from './routes/map.js';
import { registerMetaRoutes } from './routes/meta.js';
import { registerRegistryRoutes } from './routes/registry.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerSetupRoutes } from './routes/setup.js';
import { registerSystemRoutes } from './routes/system.js';
import { registerTagRoutes } from './routes/tags.js';
import { registerUserRoutes } from './routes/users.js';
import { registerWebSocket } from './routes/ws.js';

/** Paths that are reachable without a credential. */
const PUBLIC_PATHS = new Set([
  '/healthz',
  '/readyz',
  '/api/versions',
  '/api/v1/openapi.json',
  '/api/v1/auth/login',
  '/api/v1/auth/two-factor',
  '/api/v1/auth/refresh',

  // Both halves of the first-boot flow. They refuse themselves once an account exists, which
  // is a check they have to make anyway - a credential requirement here would mean needing an
  // account in order to create the first one.
  '/api/v1/setup',

  // Whether a restore is running: the screen that waits on one has nobody signed in.
  '/api/v1/system/maintenance',
]);

/**
 * Paths answered while the installation is being restored: whether it still is, and whether the
 * process is alive. Everything else would read a database about to be replaced.
 */
const MAINTENANCE_PATHS = new Set(['/healthz', '/readyz', '/api/v1/system/maintenance']);

/**
 * Says whether a path may be reached without a credential.
 *
 * A set of exact paths rather than a prefix match. `/api/v1/auth/` as a prefix would have made
 * every future endpoint under it public by default, which is the wrong default for the one part
 * of the API that issues credentials.
 *
 * @param url - The request path, query string included.
 * @returns True when no credential is required.
 */
function isPublicPath(url: string): boolean {
  const path = url.split('?')[0] ?? '';

  return PUBLIC_PATHS.has(path) || path === `/api/${CURRENT_API_VERSION}/ws`;
}

/**
 * Builds the server.
 *
 * @param context - Everything the routes reach.
 * @returns The instance, configured but not listening.
 */
export async function buildServer(context: ApiContext): Promise<FastifyInstance> {
  const server = Fastify({
    logger: false,
    bodyLimit: context.config.API_BODY_LIMIT_BYTES,

    // `proxy` terminates TLS and forwards, so the address a rate limit and an audit entry should
    // record is the one in `X-Forwarded-For`, not the proxy's own.
    trustProxy: true,
  });

  const startedAt = context.now();
  const registry = new RouteRegistry();

  registerTracing(server);
  server.setErrorHandler(createErrorHandler(context.logger));
  server.setNotFoundHandler(handleNotFound);

  await server.register(helmet, {
    // The API serves JSON, never a document, so a content security policy on it protects nothing
    // and only makes the headers longer. `proxy` sets the policy for the page that calls it.
    contentSecurityPolicy: false,
  });

  await server.register(cors, {
    origin: context.config.API_CORS_ORIGINS.length === 0 ? false : context.config.API_CORS_ORIGINS,
    credentials: true,
  });

  await server.register(rateLimit, {
    max: context.config.API_RATE_LIMIT_MAX,
    timeWindow: context.config.API_RATE_LIMIT_WINDOW_MS,

    /**
     * Counts per credential where there is one, and per address otherwise.
     *
     * Counting only by address would let one signed-in client on a shared network exhaust the
     * budget for everyone behind that address, which in a home is everyone.
     *
     * @param request - The request being counted.
     * @returns The key to count under.
     */
    keyGenerator: (request: FastifyRequest): string => request.identity?.userId ?? request.ip,
  });

  await server.register(websocket);

  server.addHook(
    'onRequest',

    /**
     * Refuses everything while a restore swaps the data, but what says how it goes.
     *
     * Before the credential is checked: during a restore the sessions are about to be replaced,
     * and the answer is the same for everybody.
     *
     * @param request - The request being handled.
     * @returns Once it may go on.
     * @throws {MaintenanceError} While a restore runs.
     */
    async (request: FastifyRequest): Promise<void> => {
      if (
        context.maintenance.isRestoring &&
        !MAINTENANCE_PATHS.has(request.url.split('?')[0] ?? '')
      ) {
        const { phase, runId } = context.maintenance.state;

        throw new MaintenanceError('The installation is being restored from a backup', {
          details: { phase, runId },
        });
      }

      return Promise.resolve();
    },
  );

  server.addHook(
    'onRequest',

    /**
     * Verifies the credential on every request that needs one.
     *
     * A hook rather than a per-route check: a route added tomorrow is protected because it is a
     * route, not because somebody remembered.
     *
     * @param request - The request being handled.
     */
    async (request: FastifyRequest): Promise<void> => {
      if (isPublicPath(request.url)) {
        return;
      }

      request.identity = await context.authenticator.authenticate(
        readBearer(request.headers.authorization),
      );
    },
  );

  server.addHook(
    'onResponse',

    /**
     * Logs one line per request, once the outcome is known.
     *
     * @param request - What was asked.
     * @param reply - What was answered.
     * @param done - Called to let the response continue.
     */
    (request: FastifyRequest, reply: FastifyReply, done: () => void): void => {
      context.logger.info(
        {
          traceId: request.traceId,
          method: request.method,
          path: request.url,
          status: reply.statusCode,
          durationMs: Math.round(reply.elapsedTime),
          userId: request.identity?.userId,
        },
        'Request handled',
      );
      done();
    },
  );

  const environment: RouteEnvironment = {
    server,
    registry,
    basePath: `/api/${CURRENT_API_VERSION}`,
  };

  registerSetupRoutes(environment, context);
  registerAuthRoutes(environment, context);
  registerEntityRoutes(environment, context);
  registerRegistryRoutes(environment, context);
  registerAreaRoutes(environment, context);
  registerDashboardRoutes(environment, context);
  registerTagRoutes(environment, context);
  registerDeviceRoutes(environment, context);
  registerDiscoveryRoutes(environment, context);
  registerIntegrationRoutes(environment, context);
  registerIconRoutes(environment, context);
  registerHistoryRoutes(environment, context);
  registerActivityRoutes(environment, context);
  registerUserRoutes(environment, context);
  registerSettingsRoutes(environment, context);
  registerSystemRoutes(environment, context);
  registerBackupRoutes(environment, context);
  registerContainerRoutes(environment, context);
  registerMapRoutes(server, context, environment.basePath);
  registerCameraRoutes(server, context, environment.basePath);
  registerWebSocket(server, context, environment.basePath);
  registerMetaRoutes(server, context, registry, startedAt);

  return server;
}
