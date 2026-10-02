/**
 * Entry point of the `backup` service.
 *
 * The same order as every service: the environment, the schema version, the bus - retried until
 * it is there - then the work. It runs as root in the container, and only there does it restore
 * or mount a share; elsewhere it still backs up to a folder, and says what it cannot do.
 */
import { BusClient, connectBus } from '@nebulahome/bus';
import { loadConfigOrExit } from '@nebulahome/config';
import { ERROR_CODES, EXIT_CODES, isNebulaError } from '@nebulahome/contracts';
import { assertSchemaVersion, createDatabase } from '@nebulahome/db';
import { createLogger, type PlatformLogger } from '@nebulahome/logging';

import { serveBackup } from './bus-service.js';
import { backupEnvSchema, SERVICE_NAME, SERVICE_VERSION } from './config.js';
import { BackupService } from './service.js';

/** How long a graceful shutdown is given before the process ends regardless. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

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
  const config = loadConfigOrExit(backupEnvSchema);
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
  const service = new BackupService({ config, db: database.db, client, logger });

  await service.start(() => serveBackup(client, service));
  logger.info('Backup is serving');

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

    // Deliberately not awaited: a signal handler cannot be async without turning a failed
    // shutdown into an unhandled rejection.
    void (async (): Promise<void> => {
      try {
        service.stop();
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
