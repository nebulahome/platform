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

import { SchemaVersionMismatchError } from '@nebula-home/contracts';

import type { Database } from './client.js';

/**
 * The number of migrations this build expects to find applied.
 *
 * **Increment this in the same commit that adds a migration.** Forgetting to is the failure
 * this whole mechanism exists to catch, so a mismatch names both numbers rather than saying
 * only that something is wrong.
 */
export const EXPECTED_SCHEMA_VERSION = 2;

/** What `system.v_schema_version` reports. */
export type SchemaVersion = {
  /** How many migrations have been applied. */
  readonly version: number;

  /** When the most recent one ran, as a millisecond timestamp, or null on an empty database. */
  readonly appliedAt: number | null;

  /** The hash of the most recent migration, or null on an empty database. */
  readonly latestHash: string | null;
};

/**
 * Reads the applied schema version.
 *
 * @param db - A connected database handle.
 * @returns What the database reports about its own schema.
 */
export async function readSchemaVersion(db: Database): Promise<SchemaVersion> {
  const rows = await db.execute<{
    version: number;
    applied_at: string | null;
    latest_hash: string | null;
  }>(sql`SELECT version, applied_at, latest_hash FROM system.v_schema_version`);

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
