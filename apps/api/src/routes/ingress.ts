/**
 * A managed container's own web page, served to the house's users at `/api/ingress/<container>/`:
 * Zigbee2MQTT's, which no port of the machine publishes.
 *
 * The browser shows the page in a frame or a tab of its own, where nothing can put the
 * `Authorization` header on the page's own requests - its scripts, its pictures, its WebSocket -
 * so the access token travels in a cookie only these paths receive: set by
 * `POST /ingress/session`, `HttpOnly`, `SameSite=Strict`, and taken off before a request goes on
 * to the container. The page shares the platform's origin, and with it the powers of whoever
 * opens it (RULES.md): only one who may configure its integration, or its package, does.
 *
 * Plain requests are streamed to the container as they come; a WebSocket is answered here and
 * joined to one opened to the container, since `@fastify/websocket` answers every upgrade this
 * server receives.
 */
import replyFrom from '@fastify/reply-from';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import WebSocket from 'ws';

import {
  ACCESS_TOKEN_TTL_SECONDS,
  containerNameSchema,
  DeviceUnavailableError,
  INGRESS_PREFIX,
  ingressReplySchema,
  NotFoundError,
  SUPERVISOR_METHODS,
  SUPERVISOR_SERVICE,
  type IngressReply,
} from '@nebulahome/contracts';

import { readBearer } from '../auth/authenticator.js';
import { requirePermission } from '../auth/permissions.js';
import type { ApiContext } from '../context.js';
import { requireSession } from '../http/guard.js';
import { defineRoute, type RouteEnvironment } from '../http/route.js';
import { askService } from '../services/ask-service.js';

/** The cookie the access token travels in to a container's page. */
export const INGRESS_COOKIE = 'nebula_ingress';

/** The cookie a sign-out sends: the pages are closed to this browser with its session. */
export const CLEARED_INGRESS_COOKIE = `${INGRESS_COOKIE}=; Path=${INGRESS_PREFIX}; HttpOnly; SameSite=Strict; Max-Age=0`;

/** What each owner's container asks: the rights over its integration, or over its package. */
const REQUIRED = {
  vendor: ['integration:read', 'integration:configure'],
  package: ['package:read', 'package:configure'],
} as const;

/** How long the supervisor's answer is kept: an address changes only with the container. */
const TARGET_TTL_MS = 30_000;

/** Lets the page be framed by the platform's own: added to whatever policy the page sends. */
const FRAME_POLICY = "frame-ancestors 'self'";

/** The close codes a WebSocket may send on: what arrived as "no code" or "dropped" goes on as 1000. */
const SENDABLE_CLOSE = /^(?:100[0-3]|100[7-9]|101[0-4]|[34]\d{3})$/u;

/** Where one request goes: the container's address, and the path it came under. */
type Target = {
  readonly name: string;
  readonly url: string;
  readonly prefix: string;
};

/**
 * One cookie's value.
 *
 * @param header - The `Cookie` header.
 * @param name - The cookie.
 * @returns Its value, or undefined when it is not there.
 */
function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');

    if (key === name) {
      return value.join('=');
    }
  }

  return undefined;
}

/**
 * What a request takes on to the container: no credential of the platform's, and the path the
 * page is served under, for one that writes its links out whole.
 *
 * @param headers - The request's headers.
 * @param prefix - `/api/ingress/<container>`.
 * @returns The headers to send.
 */
function upstreamHeaders(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  prefix: string,
): Record<string, string | string[]> {
  const kept: Record<string, string | string[]> = {};

  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && name !== 'authorization' && name !== 'cookie') {
      kept[name] = value;
    }
  }

  const cookie = (typeof headers['cookie'] === 'string' ? headers['cookie'] : '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part !== '' && !part.startsWith(`${INGRESS_COOKIE}=`))
    .join('; ');

  return {
    ...kept,
    ...(cookie === '' ? {} : { cookie }),
    'x-forwarded-prefix': prefix,
    'x-ingress-path': prefix,
  };
}

/**
 * Declares `POST /ingress/session`: puts the caller's access token in the cookie the pages read.
 *
 * @param environment - The server, the registry and the prefix.
 */
export function registerIngressSessionRoute(environment: RouteEnvironment): void {
  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/ingress/session',
      summary: "Let this browser open the containers' own pages",
      tag: 'Containers',
      permission: null,
      successStatus: 204,
    },

    /**
     * Sets the cookie: the token the call came with, for as long as such a token lives.
     *
     * @param route - Who is asking.
     * @returns Once the cookie is set.
     * @throws {AuthenticationError} With a personal access token, which never goes in a cookie.
     */
    async (route): Promise<void> => {
      requireSession(route.identity);

      const token = readBearer(route.request.headers.authorization) ?? '';
      const secure = route.request.protocol === 'https' ? '; Secure' : '';

      void route.reply.header(
        'set-cookie',
        `${INGRESS_COOKIE}=${token}; Path=${INGRESS_PREFIX}; HttpOnly; SameSite=Strict; Max-Age=${String(ACCESS_TOKEN_TTL_SECONDS)}${secure}`,
      );

      return Promise.resolve();
    },
  );
}

/**
 * Serves the containers' pages at `/api/ingress/<container>/`.
 *
 * @param server - The server.
 * @param context - The authenticator, the bus and the clock.
 */
export async function registerIngressRoutes(
  server: FastifyInstance,
  context: ApiContext,
): Promise<void> {
  const known = new Map<
    string,
    { readonly target: NonNullable<IngressReply['target']>; readonly at: number }
  >();
  const resolved = new WeakMap<FastifyRequest, Target>();

  /**
   * Where a container's page is, as the supervisor last said.
   *
   * @param name - The container.
   * @param traceId - The request's trace.
   * @returns The address and whose container it is, or null for none with a page.
   */
  const targetOf = async (name: string, traceId: string): Promise<IngressReply['target']> => {
    const cached = known.get(name);
    const now = context.now().getTime();

    if (cached !== undefined && now - cached.at < TARGET_TTL_MS) {
      return cached.target;
    }

    const { target } = await askService(
      { bus: context.bus, traceId },
      SUPERVISOR_SERVICE,
      SUPERVISOR_METHODS.ingress,
      { name },
      ingressReplySchema,
    );

    if (target !== null) {
      known.set(name, { target, at: now });
    }

    return target;
  };

  /**
   * Lets a request through to a page: the cookie's token, a container that has one, and the
   * rights over what declares it.
   *
   * @param request - The request.
   * @throws {AuthenticationError} Without a valid cookie.
   * @throws {NotFoundError} For a container with no page.
   * @throws {PermissionError} For one who may not configure what declares it.
   */
  const admit = async (request: FastifyRequest): Promise<void> => {
    const identity = await context.authenticator.authenticate(
      readCookie(request.headers.cookie, INGRESS_COOKIE),
    );

    request.identity = identity;

    const name = containerNameSchema.safeParse((request.params as { name?: unknown }).name);
    const target = name.success ? await targetOf(name.data, request.traceId) : null;

    if (!name.success || target === null) {
      throw new NotFoundError('No container of this name has a page');
    }

    for (const key of REQUIRED[target.ownerKind]) {
      requirePermission(identity, key);
    }

    resolved.set(request, {
      name: name.data,
      url: target.url,
      prefix: `${INGRESS_PREFIX}${name.data}`,
    });
  };

  /**
   * Streams a request to the container and its answer back.
   *
   * @param request - The request.
   * @param reply - Where the answer goes.
   * @returns The reply.
   * @throws {NotFoundError} For a request `admit` did not let through, which cannot happen.
   */
  const forward = (request: FastifyRequest, reply: FastifyReply): FastifyReply => {
    const target = resolved.get(request);

    if (target === undefined) {
      throw new NotFoundError('No container of this name has a page');
    }

    return reply.from(`${target.url}${request.url.slice(target.prefix.length)}`, {
      /**
       * Takes the platform's credentials off.
       *
       * @param unused - The request.
       * @param headers - Its headers.
       * @returns What the container receives.
       */
      rewriteRequestHeaders: (unused, headers) => upstreamHeaders(headers, target.prefix),

      /**
       * Lets the platform's own page frame the answer, beside whatever policy it has.
       *
       * @param headers - The container's headers.
       * @returns What the browser receives.
       */
      rewriteHeaders: (headers) => {
        const policy = headers['content-security-policy'];

        return {
          ...headers,
          'content-security-policy':
            policy === undefined ? FRAME_POLICY : [policy, FRAME_POLICY].flat(),
        };
      },
      /**
       * Says the page does not answer, and asks the supervisor again next time: the container
       * may have been made again at another address.
       *
       * @param failed - The reply.
       */
      onError: (failed) => {
        known.delete(target.name);
        void failed.send(
          new DeviceUnavailableError("The container's page does not answer", {
            details: { container: target.name },
          }),
        );
      },
    });
  };

  /**
   * Joins the page's WebSocket to one opened to the container, each message passed on as it came.
   *
   * @param socket - The page's.
   * @param request - Its upgrade, let through by `admit`.
   */
  const join = (socket: WebSocket, request: FastifyRequest): void => {
    const target = resolved.get(request);

    if (target === undefined) {
      socket.close(1011);

      return;
    }

    const protocols = (request.headers['sec-websocket-protocol'] ?? '')
      .split(',')
      .map((each) => each.trim())
      .filter((each) => each !== '');
    const upstream = new WebSocket(
      `${target.url.replace(/^http/u, 'ws')}${request.url.slice(target.prefix.length)}`,
      protocols,
      {
        headers: upstreamHeaders(
          {
            ...(request.headers.origin === undefined ? {} : { origin: request.headers.origin }),
            ...(request.headers.cookie === undefined ? {} : { cookie: request.headers.cookie }),
          },
          target.prefix,
        ),
      },
    );
    // What the page says before the container has answered.
    const early: [WebSocket.RawData, boolean][] = [];

    socket.on('message', (data, isBinary) => {
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(data, { binary: isBinary });
      } else {
        early.push([data, isBinary]);
      }
    });
    upstream.on('open', () => {
      for (const [data, isBinary] of early.splice(0)) {
        upstream.send(data, { binary: isBinary });
      }
    });
    upstream.on('message', (data, isBinary) => {
      socket.send(data, { binary: isBinary });
    });
    socket.on('close', (code, reason) => {
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.close(SENDABLE_CLOSE.test(String(code)) ? code : 1000, reason);
      } else {
        upstream.terminate();
      }
    });
    upstream.on('close', (code, reason) => {
      socket.close(SENDABLE_CLOSE.test(String(code)) ? code : 1000, reason);
    });
    upstream.on('error', (error) => {
      known.delete(target.name);
      context.logger.debug({ err: error, container: target.name }, "A page's WebSocket failed");
      socket.close(1011);
    });
    socket.on('error', () => {
      upstream.terminate();
    });
  };

  await server.register(async (scope) => {
    // Whatever the page sends goes on as it is, at any size: the container judges it.
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', (request, payload, done) => {
      done(null, payload);
    });
    await scope.register(replyFrom);
    scope.addHook('onRequest', admit);

    const options = { config: { rateLimit: false } } as const;

    // The page's own address without its slash: its relative links would climb out of it.
    scope.get(`${INGRESS_PREFIX}:name`, options, async (request, reply) => {
      const [path, query] = request.url.split('?');

      return reply.redirect(`${path ?? ''}/${query === undefined ? '' : `?${query}`}`);
    });
    scope.route({
      ...options,
      method: 'GET',
      url: `${INGRESS_PREFIX}:name/*`,
      handler: forward,
      wsHandler: join,
    });
    scope.route({
      ...options,
      method: ['DELETE', 'OPTIONS', 'PATCH', 'POST', 'PUT'],
      url: `${INGRESS_PREFIX}:name/*`,
      handler: forward,
    });
  });
}
