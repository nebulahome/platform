/**
 * The startup schema check every service runs before serving anything.
 *
 * A service compares the number of applied migrations against a constant baked into its build
 * and **refuses to start** on a mismatch, exiting with code 79. The alternative - starting
 * anyway - means a service writing to columns that do not exist yet, or silently not writing to
 * columns that do, which surfaces as corrupted data days later rather than as a failure now.
 *
 * Defined in ARCHITECTURE.md 11.2.
 */
import { sql } from 'drizzle-orm';

import { SchemaVersionMismatchError } from '@nebulahome/contracts';

import type { Database } from './client.js';

/**
 * The number of migrations this build expects to find applied.
 *
 * **Increment this in the same commit that adds a migration.** Forgetting to is the failure
 * this whole mechanism exists to catch, so a mismatch names both numbers rather than saying
 * only that something is wrong.
 */
export const EXPECTED_SCHEMA_VERSION = 1;

/** What `system.v_schema_version` reports. */
export type SchemaVersion = {
  /** How many migrations have been applied. */
  readonly version: number;

  /** When the most recent one ran, as a millisecond timestamp, or null on an empty database. */
  readonly appliedAt: number | null;

  /** The hash of the most recent migration, or null on an empty database. */
  readonly latestHash: string | null;
};

/** What an empty database reports: nothing has ever been applied to it. */
const NEVER_MIGRATED: SchemaVersion = { version: 0, appliedAt: null, latestHash: null };

/**
 * PostgreSQL's `undefined_table`: the relation named in the query does not exist.
 *
 * On a database nobody has migrated, the thing that does not exist is `system.v_schema_version`
 * itself, because the initial migration is what creates it.
 */
const UNDEFINED_TABLE = '42P01';

/** How far down a chain of causes to look for the driver's error. Wrapping is one level deep. */
const MAXIMUM_CAUSE_DEPTH = 5;

/**
 * Says whether a failure is PostgreSQL reporting that a relation does not exist.
 *
 * The driver's error arrives wrapped - drizzle throws its own `DrizzleQueryError` with the
 * `PostgresError` as `cause` - so the chain is walked rather than the top checked. Bounded,
 * because a cause chain is whatever somebody constructed and nothing stops it being a cycle.
 *
 * @param error - Whatever was thrown.
 * @returns True when the code `42P01` is anywhere in the chain.
 */
function isUndefinedTable(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < MAXIMUM_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== 'object' || current === null) {
      return false;
    }

    if ('code' in current && current.code === UNDEFINED_TABLE) {
      return true;
    }

    current = 'cause' in current ? current.cause : undefined;
  }

  return false;
}

/**
 * Reads the applied schema version.
 *
 * A database that has never been migrated does not answer "zero": it has no
 * `system.v_schema_version` to ask, because the initial migration is what creates it, and the
 * query fails with `undefined_table`. That failure *is* the answer - version zero - and it is
 * turned into one here rather than escaping as a driver stack trace. Everything downstream is
 * built for the number: `assertSchemaVersion` names both versions, and every service's entry
 * point already knows to say "run `pnpm db:migrate`". None of that was reachable while the read
 * threw first, which is how a fresh checkout on a new machine met a `DrizzleQueryError` instead
 * of an instruction.
 *
 * @param db - A connected database handle.
 * @returns What the database reports about its own schema.
 */
export async function readSchemaVersion(db: Database): Promise<SchemaVersion> {
  let rows: readonly { version: number; applied_at: string | null; latest_hash: string | null }[];

  try {
    rows = await db.execute<{
      version: number;
      applied_at: string | null;
      latest_hash: string | null;
    }>(sql`SELECT version, applied_at, latest_hash FROM system.v_schema_version`);
  } catch (error: unknown) {
    if (isUndefinedTable(error)) {
      return NEVER_MIGRATED;
    }

    // Anything else - no connection, a refused role, a timeout - is not an answer about the
    // schema and is not turned into one.
    throw error;
  }

  const row = rows[0];

  return {
    version: row?.version ?? 0,
    appliedAt:
      row?.applied_at === null || row?.applied_at === undefined ? null : Number(row.applied_at),
    latestHash: row?.latest_hash ?? null,
  };
}

/**
 * Verifies the database is at the version this build was written against.
 *
 * @param db - A connected database handle.
 * @param expected - The version to require. Defaults to {@link EXPECTED_SCHEMA_VERSION}.
 * @returns A promise that settles when the versions match.
 * @throws {SchemaVersionMismatchError} When they do not. The caller exits with
 * `EXIT_CODES.SCHEMA_VERSION_MISMATCH` rather than attempting to migrate: a service that
 * migrates on startup is a service that races every other service starting at the same time.
 */
export async function assertSchemaVersion(
  db: Database,
  expected: number = EXPECTED_SCHEMA_VERSION,
): Promise<void> {
  const actual = await readSchemaVersion(db);

  if (actual.version !== expected) {
    throw new SchemaVersionMismatchError(
      `Database schema is at version ${String(actual.version)}, this build expects ${String(expected)}`,
      { details: { expected, actual: actual.version, latestHash: actual.latestHash } },
    );
  }
}
