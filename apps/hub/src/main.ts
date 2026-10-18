/**
 * Process entry point for `hub`.
 *
 * The same shape as every other service: validate the environment, refuse to start against a
 * schema this build was not written for, connect to the bus with retry, assemble, and honour a
 * shutdown signal within a bounded time.
 *
 * The order matters in one place. The schema check happens before anything else opens, because a
 * service that starts against the wrong schema is exactly what that check exists to prevent, and
 * a loud failure now beats writing to a column that does not exist.
 */
import { connectBus } from '@nebulahome/bus';
import { loadConfigOrExit } from '@nebulahome/config';
import { ERROR_CODES, EXIT_CODES, isNebulaError } from '@nebulahome/contracts';
import { assertSchemaVersion, createDatabase } from '@nebulahome/db';
import { createLogger, type PlatformLogger } from '@nebulahome/logging';

import { hubEnvSchema, SERVICE_NAME, SERVICE_VERSION } from './config.js';
import { openMatterFabric } from './matter/fabric.js';
import { HubService } from './service.js';
import { httpTransport } from './transports/http.js';
import { mqttTransport } from './transports/mqtt.js';

/** How long a graceful shutdown is given before the process ends regardless. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

/** Signals that mean "stop", and which the platform requires every service to honour. */
const SHUTDOWN_SIGNALS = ['SIGTERM', 'SIGINT'] as const;

/**
 * Ends the process if a shutdown stalls.
 *
 * @param logger - Where to say so before exiting.
 * @returns The timer, to clear once the shutdown finishes in time.
 */
function armShutdownTimeout(logger: PlatformLogger): NodeJS.Timeout {
  return setTimeout(() => {
    logger.error({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, 'Shutdown did not finish in time, exiting');
    process.exit(EXIT_CODES.UNHANDLED_ERROR);
  }, SHUTDOWN_TIMEOUT_MS);
}

/**
 * Starts the service and keeps it running until it is asked to shut down.
 *
 * @returns Nothing. Resolves once startup has completed.
 */
async function start(): Promise<void> {
  const config = loadConfigOrExit(hubEnvSchema);

  const logger = createLogger({
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    level: config.LOG_LEVEL,
    pretty: config.NODE_ENV === 'development',
  });

  const database = createDatabase({
    connectionString: config.DATABASE_URL,
    applicationName: SERVICE_NAME,
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

  // The transports this build ships with, listed here rather than discovered by import so that
  // what a deployment can speak is a decision somebody made and can read in one place.
  const service = new HubService({
    config,
    db: database.db,
    bus,
    logger,
    transports: [httpTransport, mqttTransport],
    matter: openMatterFabric,
  });

  await service.start();

  let isStopping = false;

  /**
   * Stops everything, in the order that loses the least.
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
    // shutdown into an unhandled rejection, which is a worse ending than a logged one.
    void (async (): Promise<void> => {
      try {
        await service.stop();
        await bus.close();
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
