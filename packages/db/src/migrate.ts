/**
 * The migration runner.
 *
 * Migrations are hand-written SQL rather than generated, because most of what the initial schema
 * needs - TimescaleDB hypertables, continuous aggregates, compression and retention policies,
 * PostgreSQL roles, grants and seed data - is invisible to a schema differ. The runner is here
 * rather than `drizzle-kit migrate` for one concrete reason: TimescaleDB refuses to create a
 * continuous aggregate inside a transaction block, and drizzle-kit wraps every file in one.
 *
 * State is recorded in `system.schema_migrations` in the same column shape drizzle-kit uses, so
 * moving back to it later needs no data change.
 *
 * Rules from RULES.md 13 that this enforces:
 *
 * - An applied migration is immutable. Editing one is caught here by hash, not only in CI.
 * - Migrations are forward-only. There is no `down`.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Sql } from 'postgres';

import { ConflictError, ValidationError } from '@nebula-home/contracts';

/**
 * Marker a migration file carries when it must not run inside a transaction.
 *
 * Only for statements PostgreSQL or TimescaleDB refuse to run transactionally. A file marked
 * this way that fails half-way leaves the database partially migrated and needs manual repair,
 * which is why it is opt-in and stated in the file itself rather than inferred.
 */
export const NO_TRANSACTION_MARKER = '-- nebula:no-transaction';

/** One migration file, read from disk. */
export type MigrationFile = {
  /** File name, such as `0001_initial_schema.sql`. */
  readonly name: string;

  /** The SQL to execute. */
  readonly sql: string;

  /** `sha256` of the contents, recorded so a later edit is detectable. */
  readonly hash: string;

  /** Whether this file has to run outside a transaction. */
  readonly isTransactional: boolean;
};

/** What a migration run did. */
export type MigrationResult = {
  /** Files applied by this run, in order. */
  readonly applied: readonly string[];

  /** Files that were already recorded as applied. */
  readonly skipped: readonly string[];
};

/**
 * Reads and orders the migration files in a directory.
 *
 * @param directory - The `migrations` directory.
 * @returns Every `.sql` file, ordered by name, which the four-digit prefix makes chronological.
 * @throws {ValidationError} When two files share the same numeric prefix, since their relative
 * order would then depend on the rest of the name and stop being obvious.
 */
export async function readMigrations(directory: string): Promise<MigrationFile[]> {
  const names = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();

  const prefixes = new Set<string>();

  for (const name of names) {
    const prefix = name.slice(0, 4);

    if (prefixes.has(prefix)) {
      throw new ValidationError(`Two migrations share the prefix ${prefix}`, {
        details: { directory, prefix },
      });
    }

    prefixes.add(prefix);
  }

  return Promise.all(
    names.map(async (name): Promise<MigrationFile> => {
      const sql = await readFile(path.join(directory, name), 'utf8');

      return {
        name,
        sql,
        hash: createHash('sha256').update(sql).digest('hex'),
        isTransactional: !sql.includes(NO_TRANSACTION_MARKER),
      };
    }),
  );
}

/**
 * Makes sure the bookkeeping table exists.
 *
 * It is created outside the migrations themselves because the first migration has to be able to
 * record that it ran, and it cannot record that into a table it is in the middle of creating.
 *
 * @param sql - An open connection.
 * @returns A promise that settles once the schema and table exist.
 */
async function ensureBookkeeping(sql: Sql): Promise<void> {
  await sql
    .unsafe(
      `
    CREATE SCHEMA IF NOT EXISTS system;
    CREATE TABLE IF NOT EXISTS system.schema_migrations (
      id         bigserial PRIMARY KEY,
      hash       text      NOT NULL,
      created_at bigint    NOT NULL
    );
  `,
    )
    .simple();
}

/**
 * Applies every migration that has not run yet.
 *
 * @param sql - An open connection, using a role allowed to create objects.
 * @param directory - The `migrations` directory.
 * @returns Which files were applied and which were already recorded.
 * @throws {ConflictError} When an already-applied migration's contents no longer match the hash
 * recorded for it. An applied migration is immutable: changing one means the database in front
 * of you and the file in the repository describe different schemas, and applying the difference
 * silently is how two installations of the same version stop being the same.
 * @throws {ValidationError} When the directory contains two files with the same prefix.
 */
export async function applyMigrations(sql: Sql, directory: string): Promise<MigrationResult> {
  await ensureBookkeeping(sql);

  const files = await readMigrations(directory);
  const recorded = await sql<{ hash: string }[]>`
    SELECT hash FROM system.schema_migrations ORDER BY id
  `;

  if (recorded.length > files.length) {
    throw new ConflictError('The database has more migrations applied than this build ships', {
      details: { applied: recorded.length, available: files.length },
    });
  }

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const [index, file] of files.entries()) {
    const previous = recorded[index];

    if (previous !== undefined) {
      if (previous.hash !== file.hash) {
        throw new ConflictError(`Migration ${file.name} was modified after being applied`, {
          details: { migration: file.name, expected: previous.hash, actual: file.hash },
        });
      }

      skipped.push(file.name);
      continue;
    }

    // Sequential on purpose: a migration may depend on the one before it, so these cannot run
    // concurrently. This is the one place `no-await-in-loop` is the wrong rule.
    // eslint-disable-next-line no-await-in-loop -- migrations are ordered and interdependent
    await runMigration(sql, file);
    applied.push(file.name);
  }

  return { applied, skipped };
}

/**
 * Runs one migration and records it.
 *
 * @param sql - An open connection.
 * @param file - The migration to apply.
 * @returns A promise that settles once the file has been applied and recorded.
 */
async function runMigration(sql: Sql, file: MigrationFile): Promise<void> {
  if (file.isTransactional) {
    await sql.begin(async (transaction) => {
      await transaction.unsafe(file.sql).simple();
      await recordMigration(transaction as unknown as Sql, file);
    });

    return;
  }

  // Outside a transaction: a failure here leaves the database partially migrated. The file says
  // so in its own header, and the marker exists precisely so this is a deliberate choice.
  await sql.unsafe(file.sql).simple();
  await recordMigration(sql, file);
}

/**
 * Records that a migration ran.
 *
 * Written on the same connection that applied the file, so that inside a transaction the record
 * and the schema change commit or roll back together. A record written on a second connection
 * could survive a rollback and mark a migration applied that never was.
 *
 * @param connection - The connection, or transaction, the migration was applied on.
 * @param file - The migration that ran.
 * @returns A promise that settles once the row is written.
 */
async function recordMigration(connection: Sql, file: MigrationFile): Promise<void> {
  await connection`
    INSERT INTO system.schema_migrations (hash, created_at)
    VALUES (${file.hash}, ${Date.now()})
  `;
}
