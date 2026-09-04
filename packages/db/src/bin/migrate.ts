/**
 * `pnpm db:migrate` - applies every migration the database has not run yet.
 *
 * Deliberately a separate process from any service. A service that migrated on startup would
 * race every other service starting at the same moment, and would hold the schema hostage to
 * whichever one happened to boot first.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { databaseEnvSchema, loadConfigOrExit } from '@nebula-home/config';
import { EXIT_CODES, isNebulaError } from '@nebula-home/contracts';
import { createLogger } from '@nebula-home/logging';
import postgres from 'postgres';

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
  const logger = createLogger({ service: 'db-migrate', version: '0.0.0', level: 'info' });

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
      // A driver error carries what actually went wrong in fields pino does not serialise from
      // an Error by default: without these, a failed migration reports only a numeric SQLSTATE
      // and a byte offset into a thousand-line file.
      const driverError = error as Partial<
        Record<'message' | 'detail' | 'hint' | 'position' | 'where' | 'code', string>
      >;

      logger.fatal(
        {
          code: driverError.code,
          detail: driverError.detail,
          hint: driverError.hint,
          position: driverError.position,
          where: driverError.where,
        },
        driverError.message ?? 'Migration failed',
      );
    }

    return EXIT_CODES.UNHANDLED_ERROR;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

process.exit(await main());
