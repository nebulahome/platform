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

/**
 * The `registry.devices` table as the migration creates it.
 *
 * @returns The CREATE TABLE statement.
 */
function devicesTable(): string {
  const start = initialSql.indexOf('CREATE TABLE registry.devices (');

  return initialSql.slice(start, initialSql.indexOf('\n);', start));
}

/**
 * The body of the constraint that decides which columns an entity of each source may set.
 *
 * @returns The CHECK expression, or an empty string when the constraint is absent.
 */
function sourceConsistency(): string {
  const body = /CONSTRAINT entities_source_consistency CHECK \(([\s\S]*?)\n {2}\)/.exec(initialSql);

  return body?.[1] ?? '';
}

describe('the migration set', () => {
  it('matches the version every service checks at startup', () => {
    // The constant and the file count are edited in different places, and a service that starts
    // against the wrong schema is precisely what the check exists to prevent.
    expect(files.length).toBe(EXPECTED_SCHEMA_VERSION);
  });

  it('orders files by a four-digit prefix', () => {
    expect(files.map((file) => file.name)).toEqual(['0001_initial_schema.sql']);
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
    expect(initialSql.match(/^CREATE TABLE /gm)).toHaveLength(41);
    expect(initialSql.match(/^CREATE VIEW /gm)).toHaveLength(4);
    expect(initialSql.match(/create_hypertable\(/g)).toHaveLength(5);
  });

  it('attaches the updated_at trigger to every table that has the column', () => {
    const mutable = [...initialSql.matchAll(/CREATE TABLE (\w+)\.(\w+) \(([\s\S]*?)\n\);/g)].filter(
      ([, , , body]) => /^\s*updated_at\s/m.test(body ?? ''),
    );

    // Counted by the function they call rather than by `CREATE TRIGGER`, so that a trigger
    // added for some other purpose could not make this assertion pass for the wrong reason.
    const triggers = initialSql.match(/EXECUTE FUNCTION system\.touch_updated_at\(\)/g) ?? [];

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

describe('integration ownership', () => {
  it('makes an adapter device belong to exactly one of a package or an integration', () => {
    expect(devicesTable()).toContain(
      "(source = 'adapter' AND (package_id IS NOT NULL) <> (integration_id IS NOT NULL))",
    );
  });

  it('leaves the system device owned by neither, and allows one of it', () => {
    // The machine the platform runs on is a device `core` writes for itself: no instance
    // reaches it and no package installed it, and a second one would split its entities.
    expect(devicesTable()).toContain(
      "(source = 'system' AND package_id IS NULL AND integration_id IS NULL)",
    );
    expect(initialSql).toContain(
      "CREATE UNIQUE INDEX devices_one_system_idx ON registry.devices ((source)) WHERE source = 'system';",
    );
  });

  it('applies the same exclusivity to an adapter entity', () => {
    expect(sourceConsistency()).toContain(
      '(package_id IS NOT NULL) <> (integration_id IS NOT NULL)',
    );
  });

  it('leaves a derived entity owned by neither', () => {
    expect(sourceConsistency()).toContain(
      "(source = 'derived' AND device_id IS NULL AND package_id IS NULL AND integration_id IS NULL)",
    );
  });

  it('gives a package id and an integration id the same shape', () => {
    // Both tables feed `source`, the subject token `core` routes a command on, so the two ids
    // share one namespace and a collision would make two owners answer `svc.<id>.command`.
    // A CHECK cannot see another table and RULES.md 13 permits no trigger beyond the
    // `updated_at` touch, so the collision is refused by whoever writes the row. One shared
    // shape is what lets that check be a plain lookup rather than a normalisation.
    const shape = "CHECK (id ~ '^[a-z][a-z0-9-]{1,63}" + "$')";

    expect(initialSql).toContain('CONSTRAINT packages_id_format ' + shape);
    expect(initialSql).toContain('CONSTRAINT integrations_id_format ' + shape);
  });

  it('gives hub its configuration and the device rows to read, and no other registry table', () => {
    // The device row carries the claim an instance binds its device from on restart, so hub
    // reads it; it still writes neither table, which is what keeps core the single writer.
    expect(initialSql).toContain('GRANT SELECT ON registry.integrations TO nebula_hub');
    expect(initialSql).toContain('GRANT SELECT ON registry.devices TO nebula_hub');
    expect(initialSql).not.toMatch(/GRANT[^;]*ALL TABLES IN SCHEMA registry[^;]*nebula_hub/);
  });

  it('lets one instance own exactly one device, deleted with it', () => {
    // One instance is one device: the unique index is the 1:1, and the cascade is what makes
    // removing a device one delete rather than two in the right order.
    expect(initialSql).toMatch(
      /integration_id text\s+UNIQUE REFERENCES registry\.integrations \(id\) ON DELETE CASCADE/,
    );
    expect(initialSql).not.toContain('UNIQUE (integration_id, external_id)');
  });

  it('leaves a device without a serial until the hub has heard from it', () => {
    expect(devicesTable()).toMatch(/external_id\s+text,/);
    expect(devicesTable()).toMatch(/icon\s+text,/);
  });

  it('records identifying as a state, between starting and running', () => {
    expect(initialSql).toMatch(
      /integrations_state CHECK \(state IN \(\s*'stopped', 'starting', 'identifying', 'running', 'failed', 'disabled'\s*\)\)/,
    );
  });

  it('keeps the icons an owner added or replaced, each saying which it is', () => {
    expect(initialSql).toContain('CREATE TABLE registry.icons (');
    expect(initialSql).toContain("CONSTRAINT icons_kind CHECK (kind IN ('custom', 'override'))");
    expect(initialSql).toContain(
      "CONSTRAINT icons_id_format CHECK (id ~ '^[a-z0-9][a-z0-9-]{0,63}" + "$')",
    );
    expect(initialSql).toContain('CREATE TRIGGER icons_touch_updated_at');
  });

  it("keeps a vendor's shared settings beside its instances, under the same id shape", () => {
    // A cloud API key belongs to every device of the vendor, not to one connection, so it has
    // a row of its own; and the vendor id names a bundle directory the way an instance id names
    // a bus subject, so it is held to the same shape at the same place.
    const shape = "CHECK (id ~ '^[a-z][a-z0-9-]{1,63}" + "$')";

    expect(initialSql).toContain('CREATE TABLE registry.integration_vendors (');
    expect(initialSql).toContain('CONSTRAINT integration_vendors_id_format ' + shape);
  });

  it('gives a vendor row no runtime state, because a vendor does not run', () => {
    const table = initialSql.slice(
      initialSql.indexOf('CREATE TABLE registry.integration_vendors ('),
      initialSql.indexOf('\n);', initialSql.indexOf('CREATE TABLE registry.integration_vendors (')),
    );

    expect(table).not.toContain('state');
    expect(table).toContain('transport_config jsonb');
  });

  it('lets hub read the vendor settings it layers under an instance, and nothing more', () => {
    expect(initialSql).toContain('GRANT SELECT ON registry.integration_vendors TO nebula_hub');
    expect(initialSql).not.toMatch(/GRANT UPDATE[^;]*registry\.integration_vendors[^;]*nebula_hub/);
  });

  it("touches a vendor row's updated_at the way it touches an instance's", () => {
    expect(initialSql).toContain('BEFORE UPDATE ON registry.integration_vendors');
  });

  it('keeps the model the owner picked on the instance', () => {
    // The pick is display: which of the driver's six printers this row is. Nullable, because a
    // row written by hand or before there was a pick has none, and the interface falls back to
    // the driver's name rather than refusing to show the row.
    const table = initialSql.slice(
      initialSql.indexOf('CREATE TABLE registry.integrations ('),
      initialSql.indexOf('\n);', initialSql.indexOf('CREATE TABLE registry.integrations (')),
    );

    expect(table).toMatch(/^ {2}model\s+text,/m);
  });

  it('lets hub write the status columns it owns and none of the configuration', () => {
    // Runtime status belongs to the runtime, the way `system.packages.state` belongs to
    // `packet-manager`. The rest of the row is configuration the owner set through `api`, and
    // a blanket UPDATE would let a restart quietly overwrite it.
    expect(initialSql).toContain(
      'GRANT UPDATE (state, last_error, last_started_at) ON registry.integrations TO nebula_hub',
    );
  });
});

describe('tags', () => {
  it('stores a tag colour as a key into a fixed palette, never as a hex', () => {
    // The interface maps each key onto a token that is a different colour in each theme; a hex
    // would be one colour, wrong in one of the two.
    expect(initialSql).toMatch(
      /CONSTRAINT tags_color CHECK \(color IN \(\s+'red', 'orange', 'amber', 'yellow', 'lime', 'green',\s+'teal', 'cyan', 'blue', 'indigo', 'violet', 'pink'\s+\)\)/,
    );
    expect(initialSql).not.toMatch(/tags_color.*#\[0-9a-f\]/);
  });

  it('lets a tag sit on a device as well as on an entity, and go with either', () => {
    expect(initialSql).toContain('CREATE TABLE registry.device_tags (');
    expect(initialSql).toMatch(
      /device_id uuid NOT NULL REFERENCES registry\.devices \(id\) ON DELETE CASCADE,\s+tag_id\s+uuid NOT NULL REFERENCES registry\.tags \(id\) ON DELETE CASCADE,\s+PRIMARY KEY \(device_id, tag_id\)/,
    );
    expect(initialSql).toContain('CREATE TABLE registry.entity_tags (');
    expect(initialSql).not.toContain('registry.labels');
    expect(initialSql).not.toContain('registry.entity_labels');
  });

  it('narrows a scope to an area, an entity or a tag', () => {
    const scopes = initialSql.match(/scope ~ '\^\(area\|entity\|tag\)\\.\[a-z0-9_\.\]\+\$'/g) ?? [];

    expect(scopes).toHaveLength(2);
    expect(initialSql).not.toContain('(area|entity|label)');
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
