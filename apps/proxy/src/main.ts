/**
 * Entry point of the `proxy` service.
 *
 * Serves the built web-ui and forwards `/api` to `api` (server.ts), on plain HTTP and - when TLS
 * is on and the certificate is there - on HTTPS as well. It holds no connection to the database
 * or the bus: it is the one service a browser reaches, and it knows nothing a browser should not.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';

import { loadConfigOrExit, resolveDataLayout } from '@nebulahome/config';
import { EXIT_CODES } from '@nebulahome/contracts';
import { createLogger, type PlatformLogger } from '@nebulahome/logging';

import { proxyEnvSchema, SERVICE_NAME, type ProxyConfig } from './config.js';
import { buildProxyServer } from './server.js';

/** How long a graceful shutdown is given before the process ends regardless. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

/** Signals that mean "stop", and which the platform requires every service to honour. */
const SHUTDOWN_SIGNALS = ['SIGTERM', 'SIGINT'] as const;

/** The self-signed certificate and its key, in `proxy/tls` of the data directory. */
export const SELF_SIGNED_FILES = { cert: 'self-signed.crt', key: 'self-signed.key' } as const;

/**
 * Reads the certificate HTTPS is served with, when TLS is on and it is there.
 *
 * @param config - The configuration.
 * @param logger - Where a missing certificate is reported.
 * @returns The certificate and key, or undefined for plain HTTP only.
 */
function readCertificate(
  config: ProxyConfig,
  logger: PlatformLogger,
): { readonly cert: Buffer; readonly key: Buffer } | undefined {
  if (config.PROXY_TLS_MODE === 'off') {
    return undefined;
  }

  const directory = resolveDataLayout(config).proxyTls;
  const cert = path.join(directory, SELF_SIGNED_FILES.cert);
  const key = path.join(directory, SELF_SIGNED_FILES.key);

  if (!existsSync(cert) || !existsSync(key)) {
    logger.warn({ directory }, 'No certificate to serve HTTPS with, serving plain HTTP only');

    return undefined;
  }

  return { cert: readFileSync(cert), key: readFileSync(key) };
}

/**
 * Starts the service and keeps it running until it is asked to stop.
 *
 * @returns A promise that settles once the service is listening.
 */
async function start(): Promise<void> {
  const config = loadConfigOrExit(proxyEnvSchema);
  const logger = createLogger({
    service: SERVICE_NAME,
    version: config.NEBULA_VERSION,
    level: config.LOG_LEVEL,
    pretty: config.NODE_ENV === 'development',
  });

  if (!existsSync(path.join(config.PROXY_WEB_ROOT, 'index.html'))) {
    logger.fatal(
      { webRoot: config.PROXY_WEB_ROOT },
      'Refusing to start: there is no built web-ui to serve (pnpm build)',
    );
    process.exit(EXIT_CODES.INVALID_CONFIGURATION);
  }

  const servers: FastifyInstance[] = [];
  const plain = await buildProxyServer({
    webRoot: config.PROXY_WEB_ROOT,
    upstream: config.PROXY_UPSTREAM_URL,
  });

  await plain.listen({ host: config.PROXY_HOST, port: config.PROXY_HTTP_PORT });
  servers.push(plain);

  const certificate = readCertificate(config, logger);

  if (certificate !== undefined) {
    const secure = await buildProxyServer({
      webRoot: config.PROXY_WEB_ROOT,
      upstream: config.PROXY_UPSTREAM_URL,
      https: certificate,
    });

    await secure.listen({ host: config.PROXY_HOST, port: config.PROXY_HTTPS_PORT });
    servers.push(secure);
  }

  logger.info(
    {
      host: config.PROXY_HOST,
      http: config.PROXY_HTTP_PORT,
      https: certificate === undefined ? null : config.PROXY_HTTPS_PORT,
      upstream: config.PROXY_UPSTREAM_URL,
    },
    'Listening',
  );

  let isStopping = false;

  /**
   * Stops listening, letting what is in flight finish.
   *
   * @param signal - Which signal asked for it.
   */
  const shutdown = (signal: string): void => {
    if (isStopping) {
      return;
    }

    isStopping = true;
    logger.info({ signal }, 'Shutting down');

    const timeout = setTimeout(() => {
      logger.error({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, 'Shutdown did not finish in time, exiting');
      process.exit(EXIT_CODES.UNHANDLED_ERROR);
    }, SHUTDOWN_TIMEOUT_MS);

    // Deliberately not awaited: a signal handler cannot be async without turning a failed
    // shutdown into an unhandled rejection.
    void (async (): Promise<void> => {
      try {
        await Promise.all(servers.map((server) => server.close()));
      } catch (error: unknown) {
        logger.error({ err: error }, 'Shutdown did not complete cleanly');
      } finally {
        clearTimeout(timeout);
        process.exit(EXIT_CODES.SUCCESS);
      }
    })();
  };

  for (const signal of SHUTDOWN_SIGNALS) {
    process.once(signal, () => {
      shutdown(signal);
    });
  }
}

await start();
