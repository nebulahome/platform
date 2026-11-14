/**
 * The two process-level safety nets every service entry point installs.
 *
 * They live next to the logger because both exist to say something before the process ends, and
 * every service already depends on this package.
 */
import { EXIT_CODES } from '@nebulahome/contracts';

import type { PlatformLogger } from './create-logger.js';

/** What a promise nobody caught is logged as, unless a service words it its own way. */
const UNHANDLED_REJECTION_MESSAGE = 'A promise failed and nothing caught it';

/**
 * Ends the process after a bounded wait, whatever the shutdown is doing.
 *
 * A shutdown that hangs is worse than an abrupt one: an orchestrator that asked politely will
 * send SIGKILL anyway, and in the meantime nothing else can take the port or the durable
 * consumer.
 *
 * @param logger - Where the timeout is reported.
 * @param timeoutMs - How long the shutdown is given.
 * @returns A timer that ends the process, to be cleared on a clean shutdown.
 */
export function armShutdownTimeout(logger: PlatformLogger, timeoutMs: number): NodeJS.Timeout {
  return setTimeout(() => {
    logger.error({ timeoutMs }, 'Shutdown did not finish in time, exiting');
    process.exit(EXIT_CODES.UNHANDLED_ERROR);
  }, timeoutMs);
}

/**
 * Logs a promise nobody caught and keeps running, and ends the process on a throw nobody caught.
 *
 * A failed promise leaves the house running as it was, so the service survives it. A thrown error
 * leaves a state nobody can vouch for, so the process ends, said loudly, and the supervisor starts
 * it again.
 *
 * @param logger - Where both are reported.
 * @param exceptionMessage - The fatal line written before the process ends.
 * @param rejectionMessage - The error line written for a promise nobody caught.
 */
export function guardProcess(
  logger: PlatformLogger,
  exceptionMessage: string,
  rejectionMessage: string = UNHANDLED_REJECTION_MESSAGE,
): void {
  process.on('unhandledRejection', (error: unknown) => {
    logger.error({ err: error }, rejectionMessage);
  });
  process.on('uncaughtException', (error: unknown) => {
    logger.fatal({ err: error }, exceptionMessage);
    process.exit(EXIT_CODES.UNHANDLED_ERROR);
  });
}
