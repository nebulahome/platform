import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PERMISSIONS, SETTINGS } from '@nebula-home/contracts';

import { readMigrations } from './migrate.js';
import { EXPECTED_SCHEMA_VERSION } from './schema-version.js';

const migrationsDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
);

const files = await readMigrations(migrationsDirectory);
const initialSql = files[0]?.sql ?? '';

describe('the migration set', () => {
  it('matches the version every service checks at startup', () => {
    // The constant and the file count are edited in different places, and a service that starts
    // against the wrong schema is precisely what the check exists to prevent.
    expect(files.length).toBe(EXPECTED_SCHEMA_VERSION);
  });

  it('orders files by a four-digit prefix', () => {
    expect(files.map((file) => file.name)).toEqual([
      '0001_initial_schema.sql',
      '0002_user_avatars.sql',
    ]);
  });

  it('runs the initial schema in a single transaction', () => {
    // Verified against TimescaleDB 2.29: continuous aggregates and the policy calls all work
    // inside a transaction block, so a failure leaves no half-created database behind.
    expect(files[0]?.isTransactional).toBe(true);
  });

  it('gives every migration a header saying how to roll it back', () => {
    for (const file of files) {
      expect(file.sql).toMatch(/^--.*\n(--.*\n)*/);
      expect(file.sql).toContain('Rollback:');
    }
  });
});

describe('the initial schema', () => {
  it('creates every object DATABASE.md defines', () => {
    expect(initialSql.match(/^CREATE TABLE /gm)).toHaveLength(32);
    expect(initialSql.match(/^CREATE VIEW /gm)).toHaveLength(4);
    expect(initialSql.match(/create_hypertable\(/g)).toHaveLength(5);
  });

  it('attaches the updated_at trigger to every table that has the column', () => {
    const mutable = [...initialSql.matchAll(/CREATE TABLE (\w+)\.(\w+) \(([\s\S]*?)\n\);/g)].filter(
      ([, , , body]) => /^\s*updated_at\s/m.test(body ?? ''),
    );

    const triggers = initialSql.match(/^CREATE TRIGGER /gm) ?? [];

    expect(triggers).toHaveLength(mutable.length);

    for (const [, schema, table] of mutable) {
      expect(initialSql).toContain(`BEFORE UPDATE ON ${String(schema)}.${String(table)}`);
    }
  });

  it('never references a table it has not created yet', () => {
    // DATABASE.md presents the schemas in reading order, which is not a valid creation order:
    // foreign keys cross schema boundaries in both directions. This asserts the migration uses
    // the dependency order instead.
    const created = new Set<string>();
    const forwardReferences: string[] = [];

    for (const match of initialSql.matchAll(/CREATE TABLE (\w+\.\w+)|REFERENCES (\w+\.\w+)/g)) {
      const [, createdTable, referencedTable] = match;

      if (createdTable !== undefined) {
        created.add(createdTable);
      } else if (referencedTable !== undefined && !created.has(referencedTable)) {
        forwardReferences.push(referencedTable);
      }
    }

    expect(forwardReferences).toEqual([]);
  });

  it('creates each service role only when the cluster does not already have it', () => {
    // CREATE ROLE is cluster-wide, so a second database on the same cluster would otherwise
    // fail to migrate.
    expect(initialSql).toContain('SELECT 1 FROM pg_roles WHERE rolname = role_name');
  });

  it('ships no default administrator password', () => {
    expect(initialSql).not.toMatch(/INSERT INTO auth\.users/);
  });
});

describe('seed data against the contracts', () => {
  it('seeds exactly the permissions the code checks for', () => {
    const seeded = [...initialSql.matchAll(/^ {2}\('([a-z_]+:[a-z_]+)',/gm)].map(
      ([, key]) => key ?? '',
    );

    expect(seeded.sort()).toEqual(PERMISSIONS.map((permission) => permission.key).sort());
  });

  it('seeds exactly the settings the code defines', () => {
    const seeded = [...initialSql.matchAll(/^ {2}\('([a-z][a-z0-9_.]+)', '.*'::jsonb,/gm)].map(
      ([, key]) => key ?? '',
    );

    expect(seeded.sort()).toEqual(SETTINGS.map((setting) => setting.key).sort());
  });

  it('seeds the five built-in roles', () => {
    for (const role of ['owner', 'admin', 'member', 'guest', 'service']) {
      expect(initialSql).toContain(`('${role}',`);
    }
  });

  it('grants the owner every permission by construction, not by listing them', () => {
    // A listed set would silently miss any permission added by a later migration, in the one
    // role that must never lack one.
    expect(initialSql).toContain(
      "SELECT r.id, p.id FROM auth.roles r, auth.permissions p WHERE r.key = 'owner';",
    );
  });
});

describe('the telemetry ladder', () => {
  const aggregatesSql = initialSql;

  it('materialises three levels', () => {
    expect(aggregatesSql.match(/CREATE MATERIALIZED VIEW/g)).toHaveLength(3);
  });

  it('sets materialized_only explicitly on every level', () => {
    // The default has differed between TimescaleDB versions, and a silent change of behaviour
    // on upgrade is not acceptable in a table this central.
    expect(aggregatesSql.match(/timescaledb\.materialized_only = true/g)).toHaveLength(3);
  });

  it('rolls each level up from the one below it, never from the raw table', () => {
    // This is what makes dropping raw chunks safe: nothing downstream reads them.
    expect(aggregatesSql).toContain('FROM history.telemetry_1m');
    expect(aggregatesSql).toContain('FROM history.telemetry_1h');
    expect(aggregatesSql.match(/FROM history\.telemetry\n/g)).toHaveLength(1);
  });

  it('carries first and last through every level, which total_increasing entities need', () => {
    // Energy consumed over a day is last - first, not a sum of averages.
    expect(aggregatesSql.match(/AS first_value/g)).toHaveLength(3);
    expect(aggregatesSql.match(/AS last_value/g)).toHaveLength(3);
  });

  it('gives every level a refresh policy', () => {
    expect(aggregatesSql.match(/add_continuous_aggregate_policy/g)).toHaveLength(3);
  });

  it('keeps every source longer than the window the level above reads back into it', () => {
    // Raw data dropped before the one-minute aggregate has read it is gone from every level at
    // once, and TimescaleDB raises no error.
    expect(initialSql).toContain(
      "add_retention_policy('history.telemetry',       INTERVAL '30 days')",
    );
    expect(initialSql).toContain(
      "add_retention_policy('history.telemetry_1m',    INTERVAL '365 days')",
    );
    expect(initialSql).toContain(
      "add_retention_policy('history.telemetry_1h',    INTERVAL '1825 days')",
    );
  });

  it('leaves the daily level without a retention policy, so it is kept forever', () => {
    expect(aggregatesSql).not.toMatch(/add_retention_policy\('history\.telemetry_1d'/);
  });
});
