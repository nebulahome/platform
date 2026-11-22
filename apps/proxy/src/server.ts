/**
 * The front door: the built web-ui, and `api` behind `/api`.
 *
 * One origin for the page and the API, as the web-ui expects - it calls `/api/v1` and opens its
 * WebSockets on the host it was loaded from. The page's files are served with the cache headers
 * their names allow: the hashed assets for a year, `index.html` never from a cache, so a new build
 * is picked up on the next load. A path the files do not have is a route of the single-page app,
 * and gets `index.html` too - unless it is under `/assets`, where it is a build's file that is gone. Everything under `/api` goes to `api` as it came, WebSocket upgrades
 * included, uncompressed: `api` answers JSON, camera frames and streams, and compressing a stream
 * of frames only delays them.
 *
 * TLS, when it is on, is the same server listening a second time (main.ts), in HTTP/2 as well. Plain
 * HTTP sent to that port is redirected to HTTPS on it, instead of the connection being dropped
 * unanswered.
 */
import http from 'node:http';
import type { Server, Socket } from 'node:net';

import compress from '@fastify/compress';
import helmet from '@fastify/helmet';
import httpProxy from '@fastify/http-proxy';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';

/** Where the API is reached, on the proxy and on `api` alike. */
const API_PREFIX = '/api';

/** Where the build puts the files named by their content. */
const ASSETS_PREFIX = '/assets/';

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

/** The first byte of every TLS connection: a handshake record. */
const TLS_HANDSHAKE_RECORD = 0x16;

/** How long a new connection may stay silent before its first byte: a browser sends at once. */
const FIRST_BYTE_TIMEOUT_MS = 10_000;

/**
 * Has the HTTPS server answer plain HTTP on its port with a redirect to HTTPS - a browser sent
 * there by `http://` would otherwise get an empty response. Each connection's first byte tells
 * them apart; it is put back before the connection is handed on, so nothing is lost.
 *
 * @param server - The HTTPS server, before it listens.
 */
function redirectPlainHttp(server: Server): void {
  const tlsListeners = server.listeners('connection') as ((socket: Socket) => void)[];
  // The same host and port the browser asked for, now over TLS.
  const redirector = http.createServer((request, response) => {
    const host = request.headers.host;

    if (host === undefined) {
      response.writeHead(400, { connection: 'close' }).end();
      return;
    }

    response
      .writeHead(301, { location: `https://${host}${request.url ?? '/'}`, connection: 'close' })
      .end();
  });

  server.removeAllListeners('connection');
  server.on('connection', (socket: Socket) => {
    /** Drops a connection that fails before its first byte: no listener holds it yet. */
    const onError = (): void => {
      socket.destroy();
    };

    // Nor does anyone time it out yet: a connection that never says a word would stay forever.
    const silence = setTimeout(() => {
      socket.destroy();
    }, FIRST_BYTE_TIMEOUT_MS);

    socket.once('close', () => {
      clearTimeout(silence);
    });
    socket.once('error', onError);
    socket.once('readable', () => {
      clearTimeout(silence);

      const head = socket.read() as Buffer | null;

      if (head === null) {
        socket.destroy();
        return;
      }

      socket.unshift(head);
      socket.off('error', onError);

      if (head[0] === TLS_HANDSHAKE_RECORD) {
        for (const listener of tlsListeners) {
          listener.call(server, socket);
        }
      } else {
        redirector.emit('connection', socket);
      }
    });
  });
}

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
  // The HTTPS server is the same server over TLS, in HTTP/2 to a browser that offers it and HTTP/1.1
  // to anything else; its instance type differs only in the socket. HTTP/2 carries the whole page
  // on one connection. Over HTTP/1.1 a browser opens several, and on a certificate it does not trust
  // each new one fails its check and sends every request waiting back to the queue: a stylesheet
  // sent back 32 times is given up (ERR_TOO_MANY_RETRIES), and the page is drawn unstyled.
  const server =
    https === undefined
      ? Fastify({ logger: false })
      : (Fastify({
          logger: false,
          http2: true,
          https: { allowHTTP1: true, cert: https.cert, key: https.key },
        }) as unknown as FastifyInstance);

  if (https !== undefined) {
    redirectPlainHttp(server.server);
  }

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

  // The upgrade's own options: `replyOptions` covers plain requests only. Not in the plugin's
  // types, which take the `ws` client's, so declared apart rather than as a literal.
  const wsClientOptions = {
    // The plugin's own default, written out: the types accept the options only with a `ws` one.
    headers: {},

    /**
     * Tells `api` who opened a socket, as `replyOptions` does for a request; the cookie goes
     * on, as the plugin's own rewrite passes it.
     *
     * @param headers - The headers the socket to `api` is opened with.
     * @param request - The upgrade.
     * @returns The headers with `x-forwarded-for` set.
     */
    rewriteRequestHeaders: (
      headers: Record<string, string>,
      request: FastifyRequest,
    ): Record<string, string> => ({
      ...headers,
      ...(request.headers.cookie === undefined ? {} : { cookie: request.headers.cookie }),
      'x-forwarded-for': request.socket.remoteAddress ?? '',
    }),
  };

  await server.register(httpProxy, {
    upstream,
    prefix: API_PREFIX,
    rewritePrefix: API_PREFIX,
    websocket: true,
    wsClientOptions,
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
    // A range is answered from the file as it is on disk, a whole file compressed, under the same
    // validators: a browser resuming a download it had kept compressed would splice the two. The
    // page's files are small enough to be sent whole.
    acceptRanges: false,
    // The build writes each asset compressed beside it (`web-ui`'s `scripts/precompress.ts`): sent
    // as it is, with `Vary: accept-encoding`, rather than compressed again on every load - a hub
    // behind a certificate the browser does not trust is a browser that keeps nothing. The
    // compression plugin leaves alone a reply that already says its encoding; a file without a
    // compressed twin is compressed by it as before.
    preCompressed: true,
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

  // A path the files do not have is one of the page's own routes: it gets the page. Not a build's
  // file that is gone, though: the page in its place is refused as a stylesheet or a script without
  // a word, and the page is drawn unstyled or not at all, where a 404 says what went missing.
  server.setNotFoundHandler(async (request, reply) => {
    const isPage =
      (request.method === 'GET' || request.method === 'HEAD') &&
      !request.url.startsWith(`${API_PREFIX}/`) &&
      request.url !== API_PREFIX &&
      !request.url.startsWith(ASSETS_PREFIX);

    if (!isPage) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'No such path' } });
    }

    return reply.header('cache-control', 'no-cache').sendFile('index.html');
  });

  return server;
}
