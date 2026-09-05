/**
 * The audit trail's vocabulary.
 *
 * Written after an `actor_type` of `anonymous` was refused by the database at runtime and
 * swallowed by the writer, exactly as designed: a full audit table must not stop people signing
 * in, so a failed write is logged rather than thrown. That is the right trade and it is also why
 * a wrong value could sit there emitting one error line per sign-in attempt and breaking nothing
 * visible.
 *
 * These two cases pin the enumerations to the check constraints in `0001_initial_schema.sql`.
 * They read the migration rather than restating it, so a change to either side without the other
 * fails here instead of in production.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ACTOR_TYPES, AUDIT_RESULTS } from './audit.js';

/** The initial migration, which is the authority on what the columns accept. */
const MIGRATION = readFileSync(
  fileURLToPath(
    new URL('../../../../packages/db/migrations/0001_initial_schema.sql', import.meta.url),
  ),
  'utf8',
);

/**
 * Reads the values one CHECK constraint allows.
 *
 * @param constraint - The constraint's name.
 * @returns The literals it lists, in the order the migration writes them.
 */
function allowedValues(constraint: string): string[] {
  const clause = new RegExp(`CONSTRAINT ${constraint} CHECK \\([^)]*IN \\(([^)]*)\\)`).exec(
    MIGRATION,
  );

  return [...(clause?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((match) => match[1] ?? '');
}

describe('the audit vocabulary', () => {
  it('uses exactly the actor types the database accepts', () => {
    expect([...ACTOR_TYPES].sort()).toEqual(allowedValues('audit_log_actor_type').sort());
  });

  it('uses exactly the results the database accepts', () => {
    expect([...AUDIT_RESULTS].sort()).toEqual(allowedValues('audit_log_result').sort());
  });

  it('reads a real constraint, so an empty match would not pass silently', () => {
    expect(allowedValues('audit_log_actor_type').length).toBeGreaterThan(0);
    expect(allowedValues('audit_log_result').length).toBeGreaterThan(0);
  });
});
