/**
 * What a dump without the history leaves out, against the development database: every chunk of
 * the history, none of the audit trail's. Everything is written inside a transaction that is
 * rolled back, so the database is left as it was found.
 *
 * Needs the development stack (`pnpm infra:up`, `pnpm db:migrate`); its `nebula` role is the
 * superuser the backup service dumps as.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { connectAdmin, historyExclusions, type AdminSql } from '@/database/admin.js';

const DATABASE_URL = 'postgres://nebula:nebula@localhost:5432/nebula';

/** Thrown to roll a transaction back once the test has looked. */
class RollBack extends Error {}

const sql = connectAdmin(DATABASE_URL);

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

/**
 * Turns a `pg_dump` table pattern into a regular expression for the table's name.
 *
 * @param pattern - A pattern such as `_timescaledb_internal._hyper_(3|4)_*_chunk`.
 * @returns What matches the names it covers.
 */
function tablePatternOf(pattern: string): RegExp {
  const table = pattern.slice(pattern.indexOf('.') + 1);

  return new RegExp(`^${table.replaceAll('*', '.*')}$`, 'u');
}

/**
 * Runs checks with rows written, then takes the rows away again.
 *
 * @param check - What to look at, given the transaction.
 * @returns A promise that settles once the transaction is rolled back.
 */
async function withRows(check: (transaction: AdminSql) => Promise<void>): Promise<void> {
  await sql
    .begin(async (transaction) => {
      const within = transaction as unknown as AdminSql;

      await within`
        INSERT INTO history.logs (time, level, service, message)
        VALUES (now(), 30, 'backup-test', 'a line')`;
      await within`
        INSERT INTO system.audit_log (actor_type, actor_label, action, result)
        VALUES ('system', 'backup-test', 'backup.test', 'success')`;
      await check(within);

      throw new RollBack();
    })
    .catch((error: unknown) => {
      if (!(error instanceof RollBack)) {
        throw error;
      }
    });
}

describe('a dump without the history', () => {
  it('never compresses the audit trail, which the exclusions rely on', async () => {
    const rows = await sql<{ compression_enabled: boolean }[]>`
      SELECT compression_enabled FROM timescaledb_information.hypertables
      WHERE hypertable_schema = 'system' AND hypertable_name = 'audit_log'`;

    expect(rows).toEqual([{ compression_enabled: false }]);
  });

  it('leaves out every chunk of the history and keeps the audit trail', async () => {
    await withRows(async (transaction) => {
      const patterns = await historyExclusions(transaction);
      const chunks = await transaction<{ schema: string; name: string }[]>`
        SELECT hypertable_schema AS schema, chunk_name AS name
        FROM timescaledb_information.chunks
        WHERE hypertable_schema IN ('history', 'system')`;
      /**
       * Says whether the dump leaves a chunk's rows out.
       *
       * @param name - The chunk.
       * @returns True when a pattern covers it.
       */
      const covered = (name: string): boolean =>
        patterns.some((pattern) => tablePatternOf(pattern).test(name));
      const history = chunks.filter((chunk) => chunk.schema === 'history');
      const audit = chunks.filter((chunk) => chunk.schema === 'system');

      expect(patterns).toContain('_timescaledb_internal.compress_hyper_*');
      expect(history.length).toBeGreaterThan(0);
      expect(audit.length).toBeGreaterThan(0);
      expect(history.filter((chunk) => !covered(chunk.name))).toEqual([]);
      expect(audit.filter((chunk) => covered(chunk.name))).toEqual([]);
    });
  });
});
