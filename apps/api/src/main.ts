/**
 * Entry point of the `api` service.
 *
 * Three things must be true before it listens: the environment is valid, the database schema is
 * the version this build was written against, and the port is free. The first two are fail-fast
 * for the reasons ARCHITECTURE.md 11.2 gives - a gateway that starts half-configured hands out
 * tokens signed with a key nobody meant to use.
 *
 * The bus is deliberately not in that list. A broker that is down must not stop the interface
 * from showing a house (ARCHITECTURE.md 7.4), so `api` retries in the background and serves
 * everything it can read from the database in the meantime. Commands fail with
 * `DEVICE_UNAVAILABLE` while it is away, which is the truth.
 */
import { BusClient, connectBus, type BusConnection } from '@nebula-home/bus';
import { loadConfigOrExit } from '@nebula-home/config';
import { ERROR_CODES, EXIT_CODES, isNebulaError } from '@nebula-home/contracts';
import { assertSchemaVersion, createDatabase, secretsKeyFrom } from '@nebula-home/db';
import { createLogger, type PlatformLogger } from '@nebula-home/logging';

import { Authenticator } from './auth/authenticator.js';
import { ChallengeStore } from './auth/challenges.js';
import { apiEnvSchema, SERVICE_NAME, SERVICE_VERSION } from './config.js';
import type { ApiContext } from './context.js';
import { IdempotencyStore } from './http/idempotency.js';
import { buildServer } from './server.js';
import { AuditLog } from './services/audit.js';
import { EventFanout } from './services/events.js';

/** How long a graceful shutdown is given before the process ends regardless. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

/** Signals that mean "stop", and which the platform requires every service to honour. */
const SHUTDOWN_SIGNALS = ['SIGTERM', 'SIGINT'] as const;

/**
 * Strips the password out of a connection string before it is logged.
 *
 * The url is the most useful thing to name when a connection fails - it says which host was
 * tried - and it is also the one configuration value that carries a credential. RULES.md 10.1
 * forbids the second, so the host survives and the password does not.
 *
 * @param url - The connection string.
 * @returns The same url with any password replaced, or a placeholder if it will not parse.
 */
function redactCredentials(url: string): string {
  try {
    const parsed = new URL(url);

    if (parsed.password !== '') {
      parsed.password = '[redacted]';
    }

    return parsed.toString();
  } catch {
    return '[unparseable]';
  }
}

/**
 * Ends the process after a bounded wait, whatever the shutdown is doing.
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
 * @returns A promise that settles once the server is listening.
 */
async function start(): Promise<void> {
  const config = loadConfigOrExit(apiEnvSchema);

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

    // Anything else at this point is the database not being there at all. Left to escape, it
    // arrives as a driver stack trace about a query nobody wrote, which says nothing about the
    // thing that is actually wrong: Postgres is not running, or `DATABASE_URL` points somewhere
    // it is not. Unlike the bus, this one is fatal - `api` can neither authenticate anybody nor
    // read anything without it.
    logger.fatal(
      { err: error, url: redactCredentials(config.DATABASE_URL) },
      'Refusing to start: the database is not reachable',
    );

    await database.close();
    process.exit(EXIT_CODES.UNHANDLED_ERROR);
  }

  const startupAbort = new AbortController();

  for (const signal of SHUTDOWN_SIGNALS) {
    process.once(signal, () => {
      startupAbort.abort();
    });
  }

  let connection: BusConnection | undefined;
  let client: BusClient | undefined;

  try {
    connection = await connectBus({
      url: config.NATS_URL,
      name: SERVICE_NAME,
      logger,
      signal: startupAbort.signal,
    });

    client = new BusClient({
      transport: connection.transport,
      source: SERVICE_NAME,
      logger,
      requestTimeoutMs: config.API_BUS_TIMEOUT_MS,
    });
  } catch (error: unknown) {
    // Not fatal, by design. Everything readable comes from the database, and refusing to serve
    // it because the broker is down would turn one outage into two.
    logger.error({ err: error }, 'The bus is not reachable, serving without it');
  }

  const events = new EventFanout(logger);

  if (client !== undefined) {
    events.start(client);
  }

  const idempotency = new IdempotencyStore();

  idempotency.start();

  const context: ApiContext = {
    config,
    db: database.db,
    bus: client,
    logger,
    authenticator: new Authenticator({
      db: database.db,
      secret: new TextEncoder().encode(config.API_JWT_SECRET),
    }),
    challenges: new ChallengeStore(),
    idempotency,
    audit: new AuditLog(database.db, logger),
    events,
    jwtSecret: new TextEncoder().encode(config.API_JWT_SECRET),
    totpKey: Buffer.from(config.API_TOTP_ENCRYPTION_KEY, 'hex'),
    secretsKey: secretsKeyFrom(config.NEBULA_SECRETS_KEY),

    /**
     * Reads the wall clock.
     *
     * @returns The current moment.
     */
    now: (): Date => new Date(),
  };

  const server = await buildServer(context);

  await server.listen({ host: config.API_HOST, port: config.API_PORT });

  logger.info(
    { host: config.API_HOST, port: config.API_PORT, bus: client !== undefined },
    'Listening',
  );

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
        // The server first, so in-flight requests finish before their dependencies go away.
        await server.close();
        idempotency.stop();
        events.stop();
        await connection?.close();
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
