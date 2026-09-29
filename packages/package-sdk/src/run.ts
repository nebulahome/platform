/**
 * The runner: the process the packet-manager starts for a `node` package.
 *
 * `node run.js <entry>`, with the package's environment: its id and version, its folders, its
 * settings, the bus. It connects to the bus as the package, loads the package's server module -
 * a file of the release the packet-manager unpacked and verified, never a path a person typed -
 * hands its `start` the context, announces the RPC methods it registered, and on `SIGTERM` stops
 * it and leaves. A `start` that throws ends the process with code 1, which the packet-manager
 * counts towards giving up on the package.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { z } from 'zod';

import { BusClient, connectBus } from '@nebula-home/bus';
import { loadConfigOrExit } from '@nebula-home/config';
import {
  busSubjects,
  EXIT_CODES,
  jsonObjectSchema,
  PACKET_MANAGER_METHODS,
  PACKET_MANAGER_SERVICE,
} from '@nebula-home/contracts';
import { createLogger } from '@nebula-home/logging';

import { createPackageContext } from './context.js';

import type { PackageDefinition, PackageStop } from './index.js';

/** How long stopping is given before the process ends regardless. */
const STOP_TIMEOUT_MS = 10_000;

/** What the packet-manager hands the process. */
const runnerEnvSchema = z.object({
  NEBULA_PACKAGE_ID: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
  NEBULA_PACKAGE_VERSION: z.string().min(1).max(64),
  NEBULA_PACKAGE_DATA_DIR: z.string().min(1),
  NEBULA_PACKAGE_CACHE_DIR: z.string().min(1),
  NEBULA_PACKAGE_SETTINGS: z
    .string()
    .default('{}')
    .transform((text) => jsonObjectSchema.parse(JSON.parse(text))),
  NATS_URL: z.string().min(1),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

/**
 * Says whether a module's default export is a package.
 *
 * @param value - The export.
 * @returns True when it has a `start`.
 */
function isDefinition(value: unknown): value is PackageDefinition {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { start?: unknown }).start === 'function'
  );
}

/**
 * Runs the package named on the command line until it is asked to stop.
 *
 * @returns Once it is running.
 */
async function run(): Promise<void> {
  const entry = process.argv[2];
  const env = loadConfigOrExit(runnerEnvSchema);
  const logger = createLogger({
    service: `pkg-${env.NEBULA_PACKAGE_ID}`,
    version: env.NEBULA_PACKAGE_VERSION,
    level: env.LOG_LEVEL,
  });

  if (entry === undefined) {
    logger.fatal('The runner is given no module to run');
    process.exit(EXIT_CODES.INVALID_CONFIGURATION);
  }

  const stopping = new AbortController();
  const bus = await connectBus({
    url: env.NATS_URL,
    name: `pkg-${env.NEBULA_PACKAGE_ID}`,
    logger,
    signal: AbortSignal.timeout(60_000),
  });
  const client = new BusClient({
    transport: bus.transport,
    source: env.NEBULA_PACKAGE_ID,
    logger,
  });

  // The release's own module, from the folder the packet-manager unpacked it to.
  const loaded: unknown = await import(pathToFileURL(path.resolve(entry)).href);
  const definition = (loaded as { default?: unknown }).default;

  if (!isDefinition(definition)) {
    logger.fatal({ entry }, 'The module does not default-export definePackage({ start })');
    process.exit(EXIT_CODES.INVALID_CONFIGURATION);
  }

  const handle = createPackageContext({
    client,
    id: env.NEBULA_PACKAGE_ID,
    version: env.NEBULA_PACKAGE_VERSION,
    settings: env.NEBULA_PACKAGE_SETTINGS,
    dataDir: env.NEBULA_PACKAGE_DATA_DIR,
    cacheDir: env.NEBULA_PACKAGE_CACHE_DIR,
    logger,
    signal: stopping.signal,
  });

  let stop: PackageStop | undefined;

  try {
    stop = await definition.start(handle.context);
  } catch (error: unknown) {
    logger.fatal({ err: error }, 'The package did not start');
    handle.close();
    await client.drain();
    process.exit(EXIT_CODES.UNHANDLED_ERROR);
  }

  try {
    await client.request(
      busSubjects.service(PACKET_MANAGER_SERVICE, PACKET_MANAGER_METHODS.announce),
      {
        packageId: env.NEBULA_PACKAGE_ID,
        version: env.NEBULA_PACKAGE_VERSION,
        rpcMethods: handle.rpcMethods(),
      },
      z.unknown(),
    );
  } catch (error: unknown) {
    // Run by hand, with no packet-manager: its pages cannot call it, the rest works.
    logger.warn({ err: error }, 'Could not announce the package to the packet-manager');
  }

  logger.info({ methods: handle.rpcMethods().length }, 'The package is running');

  let isStopping = false;

  /**
   * Stops the package and leaves.
   *
   * @param signal - Which signal asked for it.
   */
  const shutdown = (signal: string): void => {
    if (isStopping) {
      return;
    }

    isStopping = true;
    stopping.abort();
    logger.info({ signal }, 'Stopping the package');

    const timeout = setTimeout(() => {
      logger.error({ timeoutMs: STOP_TIMEOUT_MS }, 'The package did not stop in time');
      process.exit(EXIT_CODES.UNHANDLED_ERROR);
    }, STOP_TIMEOUT_MS);

    void (async (): Promise<void> => {
      try {
        await stop?.();
        handle.close();
        await client.drain();
      } catch (error: unknown) {
        logger.error({ err: error }, 'The package did not stop cleanly');
      } finally {
        clearTimeout(timeout);
        process.exit(EXIT_CODES.SUCCESS);
      }
    })();
  };

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      shutdown(signal);
    });
  }
}

await run();
