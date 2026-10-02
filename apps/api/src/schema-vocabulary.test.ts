/**
 * Every fixed vocabulary this service writes into a constrained column.
 *
 * Written after two of them turned out to be wrong in production and in different ways. An
 * `actor_type` the audit table does not allow was swallowed, because a failed audit write is
 * logged rather than thrown - it emitted one error line per sign-in and broke nothing visible. A
 * `revoked_reason` the sessions table does not allow was not swallowed, and surfaced as a 500 on
 * signing out, which had otherwise worked.
 *
 * Both are the same mistake: a set of strings invented in TypeScript that the database has its
 * own opinion about. The cases below read the migration and compare, so the next one fails here
 * instead of at three in the afternoon.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  AREA_KINDS,
  BACKUP_LOCATION_KINDS,
  BACKUP_LOCATION_RESULTS,
  BACKUP_RETENTION_MODES,
  BACKUP_RUN_KINDS,
  BACKUP_RUN_STATUSES,
  BACKUP_RUN_TRIGGERS,
  INTEGRATION_STATES,
  SETTINGS,
} from '@nebulahome/contracts';

import { SESSION_REVOKED_REASONS } from './auth/repository.js';
import { ACTOR_TYPES, AUDIT_RESULTS } from './services/audit.js';

/** The initial migration, which is the authority on what every column accepts. */
const MIGRATION = readFileSync(
  fileURLToPath(
    new URL('../../../packages/db/migrations/0001_initial_schema.sql', import.meta.url),
  ),
  'utf8',
);

/**
 * Reads the values one CHECK constraint allows.
 *
 * @param constraint - The constraint's name.
 * @returns The literals it lists.
 */
function allowedValues(constraint: string): string[] {
  const clause = new RegExp(
    `CONSTRAINT ${constraint}\\s*\\n?\\s*CHECK \\([^)]*IN \\(([^)]*)\\)`,
  ).exec(MIGRATION);

  return [...(clause?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((match) => match[1] ?? '');
}

describe('the vocabularies the database constrains', () => {
  it.each([
    ['audit_log_actor_type', ACTOR_TYPES],
    ['audit_log_result', AUDIT_RESULTS],
    ['sessions_revoked_reason', SESSION_REVOKED_REASONS],
    ['integrations_state', INTEGRATION_STATES],
    ['areas_kind', AREA_KINDS],
    ['backup_locations_kind', BACKUP_LOCATION_KINDS],
    ['backup_locations_retention_mode', BACKUP_RETENTION_MODES],
    ['backup_locations_last_result', BACKUP_LOCATION_RESULTS],
    ['backup_runs_kind', BACKUP_RUN_KINDS],
    ['backup_runs_trigger', BACKUP_RUN_TRIGGERS],
    ['backup_runs_status', BACKUP_RUN_STATUSES],
  ])('matches %s exactly', (constraint, values) => {
    expect([...values].sort()).toEqual(allowedValues(constraint).sort());
  });

  it('reads real constraints, so an empty match cannot pass silently', () => {
    for (const constraint of [
      'audit_log_actor_type',
      'audit_log_result',
      'sessions_revoked_reason',
      'integrations_state',
      'areas_kind',
    ]) {
      expect(allowedValues(constraint).length).toBeGreaterThan(0);
    }
  });
});

/**
 * Reads the rows the migration seeds into `system.settings`.
 *
 * @returns Each seeded key with the value it is seeded with.
 */
function seededSettings(): { key: string; value: unknown }[] {
  const block = /INSERT INTO system\.settings \(key, value, schema_ref\) VALUES([\s\S]*?);/.exec(
    MIGRATION,
  );

  return [...(block?.[1] ?? '').matchAll(/\('([a-z0-9_.]+)',\s*'(.*?)'::jsonb/g)].map((match) => ({
    key: match[1] ?? '',
    value: JSON.parse(match[2] ?? 'null') as unknown,
  }));
}

describe('the settings catalogue and the migration that seeds it', () => {
  it('seeds exactly the keys the code knows about', () => {
    expect(
      seededSettings()
        .map((row) => row.key)
        .sort(),
    ).toEqual(SETTINGS.map((definition) => definition.key).sort());
  });

  it('seeds each one with the default the code declares', () => {
    const seeded = new Map(seededSettings().map((row) => [row.key, row.value]));

    for (const definition of SETTINGS) {
      expect(seeded.get(definition.key), definition.key).toEqual(definition.defaultValue);
    }
  });

  it('reads real rows, so an empty match cannot pass silently', () => {
    expect(seededSettings().length).toBeGreaterThan(0);
  });
});
