/**
 * Entry point of the `packet-manager` service.
 *
 * The same order as every service: the environment, the schema version, the bus - retried until it
 * is there - then the packages, read and started in order, and the methods served. On a signal
 * every package's process is stopped before the service leaves, so none is left behind with no
 * one to restart it.
 */
import { fileURLToPath } from 'node:url';

import { BusClient, connectBus } from '@nebula-home/bus';
import { loadConfigOrExit, resolveDataLayout } from '@nebula-home/config';
import { ERROR_CODES, EXIT_CODES, isNebulaError } from '@nebula-home/contracts';
import { assertSchemaVersion, createDatabase, secretsKeyFrom } from '@nebula-home/db';
import { createLogger, type PlatformLogger } from '@nebula-home/logging';

import { servePacketManager } from './bus-service.js';
import { packetManagerEnvSchema, SERVICE_NAME, SERVICE_VERSION } from './config.js';
import { databasePackageStore } from './persistence/packages.js';
import { PacketManager } from './service.js';
import { PackageIndexClient } from './services/index-client.js';

/** How long a graceful shutdown is given before the process ends regardless. */
const SHUTDOWN_TIMEOUT_MS = 20_000;

/** Signals that mean "stop". */
const SHUTDOWN_SIGNALS = ['SIGTERM', 'SIGINT'] as const;

/**
 * Ends the process after a bounded wait, whatever the shutdown is doing.
 *
 * @param logger - Where the timeout is reported.
 * @returns The timer, cleared on a clean shutdown.
 */
function armShutdownTimeout(logger: PlatformLogger): NodeJS.Timeout {
  return setTimeout(() => {
    logger.error({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, 'Shutdown did not finish in time, exiting');
    process.exit(EXIT_CODES.UNHANDLED_ERROR);
  }, SHUTDOWN_TIMEOUT_MS);
}

/**
 * Starts the service and keeps it running until it is asked to stop.
 *
 * @returns A promise that settles once the service is serving.
 */
async function start(): Promise<void> {
  const config = loadConfigOrExit(packetManagerEnvSchema);
  const logger = createLogger({
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    level: config.LOG_LEVEL,
    pretty: config.NODE_ENV === 'development',
  });
  const database = createDatabase({
    connectionString: config.DATABASE_URL,
    applicationName: SERVICE_NAME,
    maxConnections: 4,
  });

  try {
    await assertSchemaVersion(database.db);
  } catch (error: unknown) {
    if (isNebulaError(error) && error.code === ERROR_CODES.SCHEMA_VERSION_MISMATCH) {
      logger.fatal(
        { details: error.details },
        'Refusing to start: run `pnpm db:migrate` and start again',
      );
      await database.close();
      process.exit(EXIT_CODES.SCHEMA_VERSION_MISMATCH);
    }

    throw error;
  }

  const startupAbort = new AbortController();

  for (const signal of SHUTDOWN_SIGNALS) {
    process.once(signal, () => {
      startupAbort.abort();
    });
  }

  const bus = await connectBus({
    url: config.NATS_URL,
    name: SERVICE_NAME,
    logger,
    signal: startupAbort.signal,
  });
  const client = new BusClient({ transport: bus.transport, source: SERVICE_NAME, logger });
  const layout = resolveDataLayout(config);
  const service = new PacketManager({
    config,
    store: databasePackageStore(database.db),
    client,
    logger,
    index: new PackageIndexClient({
      url: config.PACKAGE_INDEX_URL,
      ttlMs: config.PACKET_MANAGER_INDEX_TTL_MS,
      logger,
    }),
    secretsKey: secretsKeyFrom(config.NEBULA_SECRETS_KEY),
    runner:
      config.PACKET_MANAGER_RUNNER ??
      fileURLToPath(import.meta.resolve('@nebula-home/package-sdk/run')),
    packagesDir: layout.packages,
    cacheDir: `${layout.cache}/packages`,
  });

  // Served before the packages start: each announces itself to the service as it comes up.
  const subscriptions = servePacketManager(client, service);

  await service.start();
  logger.info({ platform: service.platformVersion }, 'The packet-manager is serving');

  let isStopping = false;

  /**
   * Stops everything.
   *
   * @param signal - Which signal asked for it.
   */
  const shutdown = (signal: string): void => {
    if (isStopping) {
      return;
    }

    isStopping = true;
    logger.info({ signal }, 'Shutting down');

    const timeout = armShutdownTimeout(logger);

    void (async (): Promise<void> => {
      try {
        for (const subscription of subscriptions) {
          subscription.unsubscribe();
        }

        await service.stop();
        await client.drain();
        await database.close();
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
