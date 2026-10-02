/**
 * `pnpm db:migrate` - applies every migration the database has not run yet.
 *
 * Deliberately a separate process from any service. A service that migrated on startup would
 * race every other service starting at the same moment, and would hold the schema hostage to
 * whichever one happened to boot first.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

import { databaseEnvSchema, loadConfigOrExit } from '@nebulahome/config';
import { EXIT_CODES, isNebulaError } from '@nebulahome/contracts';
import { createLogger } from '@nebulahome/logging';

import { applyMigrations } from '../migrate.js';

/**
 * Discards a PostgreSQL notice.
 *
 * Every `IF NOT EXISTS` that was already satisfied emits one, so a re-run of the migration
 * produces dozens of notices around the single line that says what actually happened. They also
 * bypass the logger entirely, since the driver writes them itself.
 */
function ignoreNotice(): void {
  // Intentionally empty: see above.
}

/**
 * What a `postgres` driver error carries.
 *
 * These fields are not serialised from an `Error` by default, and they are the whole diagnosis:
 * without them a failed migration reports a numeric SQLSTATE and a byte offset into a
 * thousand-line file.
 */
type DriverError = Partial<
  Record<'message' | 'detail' | 'hint' | 'position' | 'where' | 'code' | 'name', string>
> & { readonly errors?: readonly { readonly message?: string }[] };

/**
 * Produces a message worth printing for a driver error.
 *
 * A failure to connect arrives as an `AggregateError` whose own `message` is the **empty
 * string**, with the real reason inside `errors`. Reporting `message` directly therefore prints
 * a line with a level, a timestamp and nothing else - which is what this function exists to
 * prevent, and why it treats an empty message as an absent one rather than only a missing one.
 *
 * @param error - The error the driver threw.
 * @returns The most specific description available, never an empty string.
 */
function describeDriverError(error: DriverError): string {
  const aggregated = (error.errors ?? [])
    .map((inner) => inner.message)
    .filter((message): message is string => message !== undefined && message.length > 0);

  if (aggregated.length > 0) {
    return `${error.name ?? 'Error'}: ${aggregated.join('; ')}`;
  }

  if (error.message !== undefined && error.message.length > 0) {
    return error.message;
  }

  return error.name ?? 'Migration failed';
}

const migrationsDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'migrations',
);

/**
 * Connects, applies pending migrations, and reports what ran.
 *
 * @returns The exit code the process should end with.
 */
async function main(): Promise<number> {
  const config = loadConfigOrExit(databaseEnvSchema);
  // Rendered rather than JSON: this is a command a person runs and reads, not a service whose
  // output is ingested by `logger`.
  const logger = createLogger({
    service: 'db-migrate',
    version: '0.0.0',
    level: 'info',
    pretty: true,
  });

  // A single connection, not a pool: migrations run one after another by definition, and the
  // non-transactional file must run on the same session throughout.
  const sql = postgres(config.DATABASE_URL, { max: 1, onnotice: ignoreNotice });

  try {
    const result = await applyMigrations(sql, migrationsDirectory);

    if (result.applied.length === 0) {
      logger.info({ alreadyApplied: result.skipped.length }, 'Database is already up to date');
    } else {
      logger.info(
        { applied: result.applied, alreadyApplied: result.skipped.length },
        'Migrations applied',
      );
    }

    return EXIT_CODES.SUCCESS;
  } catch (error: unknown) {
    if (isNebulaError(error)) {
      logger.fatal({ code: error.code, details: error.details }, error.message);
    } else {
      const driverError = error as DriverError;

      logger.fatal(
        {
          code: driverError.code,
          detail: driverError.detail,
          hint: driverError.hint,
          position: driverError.position,
          where: driverError.where,
        },
        describeDriverError(driverError),
      );
    }

    return EXIT_CODES.UNHANDLED_ERROR;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

process.exit(await main());
