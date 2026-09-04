/**
 * Entry point of the `core` service.
 *
 * Four things have to be true before `core` serves anything: the environment is valid, the
 * database schema is the version this build was written against, the bus is reachable, and the
 * registry has been rebuilt. The first two are fail-fast - a service that cannot be configured
 * correctly must not start at all, and one writing to a schema it does not recognise corrupts
 * data days before anyone notices (ARCHITECTURE.md 11.2). The third is not: a broker that is
 * down must not cascade into a platform that will not start, so `core` retries with backoff
 * until it appears (ARCHITECTURE.md 7.4).
 */
import { connectBus } from '@nebula-home/bus';
import { loadConfigOrExit } from '@nebula-home/config';
import { EXIT_CODES, isNebulaError, ERROR_CODES } from '@nebula-home/contracts';
import { assertSchemaVersion, createDatabase } from '@nebula-home/db';
import { createLogger, type PlatformLogger } from '@nebula-home/logging';

import { coreEnvSchema, SERVICE_NAME, SERVICE_VERSION } from './config.js';
import { CoreService } from './service.js';

/** How long a graceful shutdown is given before the process ends regardless. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

/** Signals that mean "stop", and which the platform requires every service to honour. */
const SHUTDOWN_SIGNALS = ['SIGTERM', 'SIGINT'] as const;

/**
 * Ends the process after a bounded wait, whatever the shutdown is doing.
 *
 * A shutdown that hangs is worse than an abrupt one: an orchestrator that asked politely will
 * send SIGKILL anyway, and in the meantime nothing else can take the port or the durable
 * consumer.
 *
 * @param logger - Where the timeout is reported.
 * @returns A timer that ends the process, to be cleared on a clean shutdown.
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
 * @returns A promise that settles once the service is serving. The process then stays alive on
 * its subscriptions until a signal arrives.
 */
async function start(): Promise<void> {
  const config = loadConfigOrExit(coreEnvSchema);

  const logger = createLogger({
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    level: config.LOG_LEVEL,

    // Rendered lines in development, where a person reads them; JSON in production, where
    // `logger` parses them into the typed columns of `history.logs` (RULES.md 10.3).
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

  const service = new CoreService({ config, db: database.db, bus, logger });

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
