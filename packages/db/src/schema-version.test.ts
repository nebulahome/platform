/**
 * The startup schema check, on the one database it had never met: an empty one.
 *
 * `readSchemaVersion` was written believing an empty database answers with no rows. It does not.
 * It has no `system.v_schema_version` to answer *from* - the initial migration is what creates
 * the view - so the query fails with `undefined_table`, and a fresh checkout on a new machine
 * died with a `DrizzleQueryError` stack trace two lines before the entry point would have said
 * "run `pnpm db:migrate`". The first cases here are that machine.
 *
 * The errors are built with drizzle's own class rather than a plain object, because the shape
 * that matters is the wrapping: the driver's `PostgresError` arrives as the `cause` of a
 * `DrizzleQueryError`, and a check that only looked at the top would pass a hand-made fixture
 * and fail the real thing.
 */
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { describe, expect, it } from 'vitest';

import { SchemaVersionMismatchError } from '@nebula-home/contracts';

import type { Database } from './client.js';
import { assertSchemaVersion, readSchemaVersion } from './schema-version.js';

/** The query the check runs, restated so a failure names it the way drizzle does. */
const QUERY = 'SELECT version, applied_at, latest_hash FROM system.v_schema_version';

/**
 * What `postgres` throws: an `Error` carrying the SQLSTATE in `code`.
 *
 * @param code - The five-character SQLSTATE.
 * @param message - What the server said.
 * @returns The error, shaped as the driver shapes it.
 */
function postgresError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

/**
 * A database whose every query does one thing.
 *
 * @param execute - What `db.execute` should do.
 * @returns A handle that satisfies the type and reaches nothing.
 */
function databaseThat(execute: () => Promise<unknown>): Database {
  return { execute } as unknown as Database;
}

/**
 * A database that has never been migrated, as drizzle reports it.
 *
 * @returns A handle whose one query fails the way the real one did.
 */
function neverMigrated(): Database {
  return databaseThat(async () =>
    Promise.reject(
      new DrizzleQueryError(
        QUERY,
        [],
        postgresError('42P01', 'relation "system.v_schema_version" does not exist'),
      ),
    ),
  );
}

describe('readSchemaVersion', () => {
  it('reads a database that has never been migrated as version zero', async () => {
    await expect(readSchemaVersion(neverMigrated())).resolves.toEqual({
      version: 0,
      appliedAt: null,
      latestHash: null,
    });
  });

  it('recognises the driver error without the wrapping too', async () => {
    // Nothing promises drizzle will always wrap; the code is what identifies the condition.
    const db = databaseThat(async () =>
      Promise.reject(postgresError('42P01', 'relation "system.v_schema_version" does not exist')),
    );

    await expect(readSchemaVersion(db)).resolves.toMatchObject({ version: 0 });
  });

  it('does not mistake any other failure for an empty database', async () => {
    // A refused password is not "version zero". Reporting it as one would send somebody to run
    // migrations against a database they cannot even sign in to.
    const db = databaseThat(async () =>
      Promise.reject(
        new DrizzleQueryError(
          QUERY,
          [],
          postgresError('28P01', 'password authentication failed for user "nebula_api"'),
        ),
      ),
    );

    await expect(readSchemaVersion(db)).rejects.toBeInstanceOf(DrizzleQueryError);
  });

  it('does not mistake a failure with no code at all', async () => {
    const db = databaseThat(async () => Promise.reject(new Error('connect ECONNREFUSED')));

    await expect(readSchemaVersion(db)).rejects.toThrow('ECONNREFUSED');
  });

  it('survives a cause chain that loops back on itself', async () => {
    const looped = postgresError('XX000', 'internal error');

    looped.cause = looped;

    const db = databaseThat(async () => Promise.reject(looped));

    await expect(readSchemaVersion(db)).rejects.toBe(looped);
  });

  it('reads a migrated database as what the view reports', async () => {
    const db = databaseThat(async () =>
      Promise.resolve([{ version: 3, applied_at: '1757000000000', latest_hash: 'abc' }]),
    );

    await expect(readSchemaVersion(db)).resolves.toEqual({
      version: 3,
      appliedAt: 1_757_000_000_000,
      latestHash: 'abc',
    });
  });
});

describe('assertSchemaVersion', () => {
  it('refuses a database that has never been migrated, naming both versions', async () => {
    // This is the message the entry points catch and turn into "run `pnpm db:migrate`". It is
    // the whole point of the read above returning a number instead of throwing.
    await expect(assertSchemaVersion(neverMigrated(), 1)).rejects.toMatchObject({
      code: 'SCHEMA_VERSION_MISMATCH',
      details: { expected: 1, actual: 0 },
    });
  });

  it('throws the platform error, which is what the entry points test for', async () => {
    await expect(assertSchemaVersion(neverMigrated(), 1)).rejects.toBeInstanceOf(
      SchemaVersionMismatchError,
    );
  });

  it('is satisfied by a database at the expected version', async () => {
    const db = databaseThat(async () =>
      Promise.resolve([{ version: 1, applied_at: '1757000000000', latest_hash: 'abc' }]),
    );

    await expect(assertSchemaVersion(db, 1)).resolves.toBeUndefined();
  });

  it('still refuses a database that is ahead of the build', async () => {
    const db = databaseThat(async () =>
      Promise.resolve([{ version: 2, applied_at: '1757000000000', latest_hash: 'abc' }]),
    );

    await expect(assertSchemaVersion(db, 1)).rejects.toMatchObject({
      details: { expected: 1, actual: 2 },
    });
  });
});
