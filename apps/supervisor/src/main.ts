/**
 * Entry point of the supervisor.
 *
 * The same order as every service: the environment, the bus - retried until it is there - then
 * the work. No database: it has none. It runs as root in the container, the one process given
 * Docker's socket, which is root on the host; nothing else in the platform may reach Docker.
 */
import { BusClient, connectBus } from '@nebulahome/bus';
import { loadConfigOrExit } from '@nebulahome/config';
import { EXIT_CODES } from '@nebulahome/contracts';
import { createLogger, type PlatformLogger } from '@nebulahome/logging';

import { serveSupervisor } from './bus-service.js';
import { SERVICE_NAME, supervisorEnvSchema } from './config.js';
import { SupervisorService } from './service.js';

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
  const config = loadConfigOrExit(supervisorEnvSchema);
  const logger = createLogger({
    service: SERVICE_NAME,
    version: config.NEBULA_VERSION,
    level: config.LOG_LEVEL,
    pretty: config.NODE_ENV === 'development',
  });
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
  const service = new SupervisorService({ config, client, logger });
  const subscriptions = serveSupervisor(client, service);

  await service.start();
  logger.info('Supervisor is serving');

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

        for (const subscription of subscriptions) {
          subscription.unsubscribe();
        }

        await client.drain();
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
