/**
 * The runner holds one advisory lock for the whole run, and lets go of it however the run ends.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it } from 'vitest';

import { applyMigrations } from './migrate.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/**
 * A connection that writes down what it is asked, and fails on a statement that says `fail`.
 *
 * @returns The connection, and what it was asked, in order.
 */
function fakeConnection(): { readonly sql: Sql; readonly asked: string[] } {
  const asked: string[] = [];
  /**
   * A tagged query: written down, and answered with no rows.
   *
   * @param strings - The query's text.
   * @returns No rows.
   */
  const query = async (strings: TemplateStringsArray): Promise<never[]> => {
    asked.push(strings.join('?').trim());

    return Promise.resolve([]);
  };
  const sql = Object.assign(query, {
    /**
     * A query in plain text.
     *
     * @param text - The SQL.
     * @returns What runs it.
     */
    unsafe: (text: string) => ({
      /**
       * Runs it.
       *
       * @returns Once run.
       * @throws {Error} When the text says `fail`.
       */
      simple: async (): Promise<void> => {
        asked.push(text.trim());

        if (text.includes('fail')) {
          throw new Error('The migration failed');
        }

        return Promise.resolve();
      },
    }),
    /**
     * A transaction, on the same connection.
     *
     * @param body - What it runs.
     * @returns What the body returns.
     */
    begin: async (body: (transaction: unknown) => Promise<unknown>): Promise<unknown> => body(sql),
  });

  return { sql: sql as unknown as Sql, asked };
}

/**
 * A migrations folder holding one file.
 *
 * @param text - The file's SQL.
 * @returns The folder.
 */
function migrations(text: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'nebula-migrations-'));

  directories.push(directory);
  writeFileSync(path.join(directory, '0001_first.sql'), text);

  return directory;
}

describe('applyMigrations', () => {
  it('takes the lock before reading anything and lets go of it last', async () => {
    const { sql, asked } = fakeConnection();

    await expect(applyMigrations(sql, migrations('-- Rollback: none\nSELECT 1;'))).resolves.toEqual(
      { applied: ['0001_first.sql'], skipped: [] },
    );
    expect(asked[0]).toBe('SELECT pg_advisory_lock(?)');
    expect(asked.at(-1)).toBe('SELECT pg_advisory_unlock(?)');
  });

  it('lets go of the lock when a migration fails', async () => {
    const { sql, asked } = fakeConnection();

    await expect(applyMigrations(sql, migrations('SELECT fail;'))).rejects.toThrow(
      'The migration failed',
    );
    expect(asked.at(-1)).toBe('SELECT pg_advisory_unlock(?)');
  });
});
