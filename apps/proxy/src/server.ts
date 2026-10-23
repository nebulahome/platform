/**
 * The front door: the built web-ui, and `api` behind `/api`.
 *
 * One origin for the page and the API, as the web-ui expects - it calls `/api/v1` and opens its
 * WebSockets on the host it was loaded from. The page's files are served with the cache headers
 * their names allow: the hashed assets for a year, `index.html` never from a cache, so a new build
 * is picked up on the next load. A path the files do not have is a route of the single-page app,
 * and gets `index.html` too. Everything under `/api` goes to `api` as it came, WebSocket upgrades
 * included, uncompressed: `api` answers JSON, camera frames and streams, and compressing a stream
 * of frames only delays them.
 *
 * TLS, when it is on, is the same server listening a second time (main.ts).
 */
import compress from '@fastify/compress';
import helmet from '@fastify/helmet';
import httpProxy from '@fastify/http-proxy';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';

/** Where the API is reached, on the proxy and on `api` alike. */
const API_PREFIX = '/api';

/** How long a hashed asset may be kept: its name changes with its content. */
const ASSET_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/**
 * What the page may load, and from where: only this origin, with the exceptions the page needs -
 * inline styles for the colours it computes (RULES.md 15.3), `data:` and `blob:` images for icons,
 * camera stills and the house map, and WebSockets back to this host.
 */
const CONTENT_SECURITY_POLICY = {
  useDefaults: false,
  directives: {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'blob:'],
    mediaSrc: ["'self'", 'blob:'],
    fontSrc: ["'self'", 'data:'],
    connectSrc: ["'self'", 'ws:', 'wss:'],
    workerSrc: ["'self'", 'blob:'],
    objectSrc: ["'none'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
  },
} as const;

/** What the server needs. */
export type ProxyServerOptions = {
  /** The built web-ui. */
  readonly webRoot: string;

  /** Where `api` listens. */
  readonly upstream: string;

  /** The certificate and key, when this is the HTTPS server. */
  readonly https?: { readonly cert: Buffer; readonly key: Buffer };
};

/**
 * Builds the server.
 *
 * @param options - See {@link ProxyServerOptions}.
 * @returns The instance, configured but not listening.
 */
export async function buildProxyServer(options: ProxyServerOptions): Promise<FastifyInstance> {
  const { webRoot, upstream, https } = options;
  // The HTTPS server is the same server over TLS; its instance type differs only in the socket.
  const server =
    https === undefined
      ? Fastify({ logger: false })
      : (Fastify({
          logger: false,
          https: { cert: https.cert, key: https.key },
        }) as unknown as FastifyInstance);

  await server.register(helmet, {
    contentSecurityPolicy: CONTENT_SECURITY_POLICY,
    // Served on plain HTTP too, by address on the LAN: neither may push the browser to HTTPS.
    strictTransportSecurity: false,
  });

  // Before the compression plugin sees the routes: what goes to `api` is passed on as it is.
  server.addHook('onRoute', (route) => {
    if (route.url.startsWith(API_PREFIX)) {
      route.compress = false;
    }
  });

  await server.register(compress, { global: true, encodings: ['br', 'gzip'] });

  server.get('/healthz', () => ({ status: 'ok' }));

  await server.register(httpProxy, {
    upstream,
    prefix: API_PREFIX,
    rewritePrefix: API_PREFIX,
    websocket: true,
    replyOptions: {
      /**
       * Tells `api` who called: the address on this socket, in place of any the caller wrote.
       * `api` trusts the header, so one passed through would let a caller from the internet
       * claim to be at home - and a webhook kept on the house's network answer it.
       *
       * @param request - The call.
       * @param headers - Its headers, as they go on.
       * @returns The headers with `x-forwarded-for` set.
       */
      rewriteRequestHeaders: (request, headers) => ({
        ...headers,
        'x-forwarded-for': request.socket.remoteAddress ?? '',
      }),
    },
  });

  await server.register(fastifyStatic, {
    root: webRoot,
    prefix: '/',
    /**
     * Sets how long a file may be kept.
     *
     * @param response - The reply being sent.
     * @param filePath - The file it sends.
     */
    setHeaders: (response, filePath) => {
      response.header(
        'cache-control',
        /[\\/]assets[\\/]/u.test(filePath)
          ? `public, max-age=${String(ASSET_MAX_AGE_SECONDS)}, immutable`
          : 'no-cache',
      );
    },
  });

  // A path the files do not have is one of the page's own routes: it gets the page.
  server.setNotFoundHandler(async (request, reply) => {
    const isPage =
      (request.method === 'GET' || request.method === 'HEAD') &&
      !request.url.startsWith(`${API_PREFIX}/`) &&
      request.url !== API_PREFIX;

    if (!isPage) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'No such path' } });
    }

    return reply.header('cache-control', 'no-cache').sendFile('index.html');
  });

  return server;
}
