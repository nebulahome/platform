import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getTableColumns, getTableName, is, Table } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { readMigrations } from '../migrate.js';

import * as schema from './index.js';

/**
 * The namespaces the query builder is handed.
 *
 * Named explicitly rather than derived, so that adding a fifth PostgreSQL schema without adding
 * it here is a failing test rather than a namespace nobody ever checked.
 */
const NAMESPACES = ['auth', 'history', 'registry', 'system'] as const;

const migrationsDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'migrations',
);

const sql = (await readMigrations(migrationsDirectory)).map((file) => file.sql).join('\n');

/** A word that opens a table-level clause rather than a column definition. */
const CLAUSE_KEYWORDS = new Set(['constraint', 'unique', 'primary', 'check', 'foreign', 'exclude']);

/**
 * Reads the column definitions the migration gives one table.
 *
 * @param qualified - The table, as `schema.table`.
 * @returns One entry per column, as `[name, definition]`. Empty when the table is absent.
 */
function migrationColumns(qualified: string): [string, string][] {
  const opening = [`CREATE TABLE ${qualified} (`, `CREATE TABLE IF NOT EXISTS ${qualified} (`]
    .map((prefix) => sql.indexOf(prefix))
    .find((index) => index >= 0);

  if (opening === undefined) {
    return [];
  }

  const body = sql.slice(opening, sql.indexOf('\n);', opening));
  // Columns a later migration adds: `ALTER TABLE x` then `  ADD COLUMN name definition`.
  const added = [...sql.matchAll(new RegExp(`ALTER TABLE ${qualified}\\n([^;]*);`, 'g'))]
    .flatMap(([, clauses]) => [
      ...(clauses ?? '').matchAll(/^ {2}ADD COLUMN ([a-z_][a-z0-9_]*)\s+(\S.*?),?$/gm),
    ])
    .map(([, name, definition]): [string, string] => [name ?? '', definition ?? '']);

  return [
    ...[...body.matchAll(/^ {2}([a-z_][a-z0-9_]*)\s+(\S.*)$/gm)]
      .map(([, name, definition]): [string, string] => [name ?? '', definition ?? ''])
      .filter(([name]) => !CLAUSE_KEYWORDS.has(name)),
    ...added,
  ];
}

/**
 * Every Drizzle table, paired with the PostgreSQL schema it was exported under.
 *
 * @returns One entry per table, as `[qualifiedName, table]`.
 */
function drizzleTables(): [string, Table][] {
  return NAMESPACES.flatMap((namespace) =>
    Object.values(schema[namespace])
      .filter((value): value is Table => is(value, Table))
      .map((table): [string, Table] => [`${namespace}.${getTableName(table)}`, table]),
  );
}

describe('the Drizzle schema against the migration', () => {
  // The migration is the authority - it is what actually runs - and Drizzle is a hand-written
  // mirror of it, so the two drift silently. They already had: `devices.via_device_id` carried
  // its self-reference in SQL and not in Drizzle, and nothing failed. Comparing column names is
  // narrow enough to stay true (Drizzle deliberately omits composite keys and CHECKs) and wide
  // enough to catch a column added on one side only.
  it('mirrors every table the migration creates', () => {
    // The per-table check below iterates the Drizzle side, so a table present only in the
    // migration would pass by not being looked at.
    const inMigration = [...sql.matchAll(/^CREATE TABLE (?:IF NOT EXISTS )?(\w+\.\w+) \(/gm)].map(
      ([, name]) => name ?? '',
    );

    expect(
      drizzleTables()
        .map(([qualified]) => qualified)
        .sort(),
    ).toEqual(inMigration.sort());
  });

  it.each(drizzleTables())('gives %s the same columns as the migration', (qualified, table) => {
    const declared = Object.values(getTableColumns(table)).map((column) => column.name);

    expect(declared.sort()).toEqual(
      migrationColumns(qualified)
        .map(([name]) => name)
        .sort(),
    );
  });

  it.each(drizzleTables())('gives %s the same references as the migration', (qualified, table) => {
    // Names alone would not have caught the drift that prompted this: `via_device_id` and
    // `parent_id` both existed on the Drizzle side without the self-reference the migration
    // gives them, because a self-reference in Drizzle needs a return type annotation and is
    // easy to leave off. A missing reference is invisible until a relational query is written
    // against it years later.
    const referencing = migrationColumns(qualified)
      .filter(([, definition]) => definition.includes('REFERENCES'))
      .map(([name]) => name);

    const declared = getTableConfig(table).foreignKeys.flatMap((key) =>
      key.reference().columns.map((column) => column.name),
    );

    expect([...new Set(declared)].sort()).toEqual(referencing.sort());
  });
});

describe('the exported schema', () => {
  it('hands Drizzle objects it can inspect', () => {
    // Regression. `export * as auth from './auth.js'` produces a module namespace object whose
    // prototype is null, and Drizzle inspects every value it is given by reading
    // `Object.getPrototypeOf(value).constructor` - which throws on one. The symptom was that
    // `createDatabase` died before returning, and nothing caught it because the migrator uses
    // the raw driver and was the only thing touching the database.
    for (const name of NAMESPACES) {
      expect(Object.getPrototypeOf(schema[name])).not.toBeNull();
    }
  });

  it('keeps the SQL name and the TypeScript name matching', () => {
    // The reason the schemas are namespaced rather than flattened: table names repeat across
    // them by design, and flattening would force a rename.
    expect(schema.registry.entities).toBeDefined();
    expect(schema.auth.users).toBeDefined();
    expect(schema.history.stateHistory).toBeDefined();
    expect(schema.system.packages).toBeDefined();
  });

  it('still exports the shared column types', () => {
    expect(typeof schema.citext).toBe('function');
    expect(typeof schema.bytea).toBe('function');
  });
});
