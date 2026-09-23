/**
 * Reading and changing the settings an owner controls while the system runs.
 *
 * Two things happen here that must not be spread across the route.
 *
 * **A value is validated by the schema its own key names.** The catalogue in
 * `@nebula-home/contracts` pairs each key with a schema and a default, and this is the only
 * place that pairing is applied, so `system.settings.value` is never written unvalidated.
 *
 * **The retention keys are validated as a group, not one at a time.** Each rung of the ladder is
 * individually plausible and the four of them together can still be wrong: a tier kept for less
 * time than the one below it has its rows dropped before the aggregate above has read them, and
 * TimescaleDB reports nothing - the coarser tier simply ends up with a hole in it. So a change
 * to one rung is checked against the other three as they will be after the write.
 *
 * Rows are updated, never inserted. `nebula_api` holds `SELECT, UPDATE` on `system.settings` and
 * nothing else (DATABASE.md 12), and every key in the catalogue is seeded by the initial
 * migration - so a key with no row is a database that does not match this build, which is worth
 * saying out loud rather than papering over with an insert the role would be refused anyway.
 */
import { asc, eq } from 'drizzle-orm';

import {
  InternalError,
  RETENTION_LADDER_FIELDS,
  SETTINGS,
  ValidationError,
  retentionLadderSchema,
  settingViewSchema,
  type JsonValue,
  type SettingDefinition,
  type SettingView,
} from '@nebula-home/contracts';
import { schema, type Database } from '@nebula-home/db';

/** Every setting the platform knows about, by key. */
const DEFINITIONS: ReadonlyMap<string, SettingDefinition> = new Map(
  SETTINGS.map((definition) => [definition.key, definition]),
);

/** One rejected change, as reported back to the caller. */
export type SettingIssue = {
  /** Which setting. */
  readonly key: string;

  /** What is wrong with it. */
  readonly message: string;
};

/** One change, as recorded in the audit trail. */
export type AuditableChange = {
  /** Which setting was changed. */
  readonly key: string;

  /**
   * What it was changed to. No setting holds personal data - where the house is lives on the
   * house area, not here - so every value is recorded.
   */
  readonly value: JsonValue;
};

/**
 * Reads every setting, with its default and who last changed it.
 *
 * Driven by the catalogue rather than by the table: a row the code knows nothing about is a
 * leftover from an older build, and showing it would invite somebody to edit it.
 *
 * @param db - The database.
 * @returns Every known setting, in catalogue order.
 * @throws {InternalError} When a key in the catalogue has no row, which means the database was
 * not built by the migration this code expects.
 */
export async function readSettings(db: Database): Promise<SettingView[]> {
  const rows = await db
    .select({
      key: schema.system.settings.key,
      value: schema.system.settings.value,
      updatedAt: schema.system.settings.updatedAt,
      authorId: schema.auth.users.id,
      authorName: schema.auth.users.displayName,
    })
    .from(schema.system.settings)
    .leftJoin(schema.auth.users, eq(schema.auth.users.id, schema.system.settings.updatedBy))
    .orderBy(asc(schema.system.settings.key));

  const stored = new Map(rows.map((row) => [row.key, row]));

  return SETTINGS.map((definition) => {
    const row = stored.get(definition.key);

    if (row === undefined) {
      throw new InternalError('A setting this build knows about has no row', {
        details: { key: definition.key },
      });
    }

    return settingViewSchema.parse({
      key: definition.key,
      value: row.value,
      defaultValue: definition.defaultValue,
      description: definition.description,
      updatedAt: row.updatedAt,
      updatedBy:
        row.authorId === null || row.authorName === null
          ? null
          : { id: row.authorId, displayName: row.authorName },
    });
  });
}

/**
 * Checks the retention ladder as it will be once the changes are applied.
 *
 * @param current - Every setting as it is now.
 * @param changes - The values being written.
 * @returns What is wrong with the resulting ladder, or an empty list.
 */
function ladderIssues(
  current: ReadonlyMap<string, unknown>,
  changes: ReadonlyMap<string, JsonValue>,
): SettingIssue[] {
  const touched = Object.keys(RETENTION_LADDER_FIELDS).filter((key) => changes.has(key));

  if (touched.length === 0) {
    return [];
  }

  const ladder = Object.fromEntries(
    Object.entries(RETENTION_LADDER_FIELDS).map(([key, field]) => [
      field,
      changes.has(key) ? changes.get(key) : current.get(key),
    ]),
  );

  const parsed = retentionLadderSchema.safeParse(ladder);

  if (parsed.success) {
    return [];
  }

  // Reported against the keys the caller actually sent. A refusal that names
  // `tier1hRetentionDays` when the caller wrote `history.telemetry.tier_1h_retention_days` is a
  // refusal they cannot act on.
  return touched.map((key) => ({
    key,
    message: parsed.error.issues.map((issue) => issue.message).join('; '),
  }));
}

/**
 * Validates a set of changes against the catalogue, and against each other.
 *
 * Every problem is reported at once. A form with four fields should not have to be submitted
 * four times to find out about all of them.
 *
 * @param current - Every setting as it is now, by key.
 * @param changes - What the caller asked to change, straight from the body.
 * @returns The validated values, by key.
 * @throws {ValidationError} When a key is unknown, a value does not satisfy its schema, or the
 * resulting retention ladder would leave a tier with nothing to roll up from.
 */
export function validateSettingChanges(
  current: ReadonlyMap<string, unknown>,
  changes: Readonly<Record<string, JsonValue>>,
): Map<string, JsonValue> {
  const issues: SettingIssue[] = [];
  const accepted = new Map<string, JsonValue>();

  for (const [key, value] of Object.entries(changes)) {
    const definition = DEFINITIONS.get(key);

    if (definition === undefined) {
      issues.push({ key, message: 'No such setting' });
      continue;
    }

    const parsed = definition.schema.safeParse(value);

    if (parsed.success) {
      accepted.set(key, value);
    } else {
      issues.push({ key, message: parsed.error.issues.map((issue) => issue.message).join('; ') });
    }
  }

  // Only once every value is individually sound: a ladder built partly from values that failed
  // their own schema would produce a second, more confusing complaint about the first one.
  if (issues.length === 0) {
    issues.push(...ladderIssues(current, accepted));
  }

  if (issues.length > 0) {
    throw new ValidationError('These settings were not changed', { details: { issues } });
  }

  return accepted;
}

/**
 * Reads the current value of every setting.
 *
 * @param db - The database.
 * @returns The values, by key.
 */
export async function readSettingValues(db: Database): Promise<Map<string, unknown>> {
  const rows = await db
    .select({ key: schema.system.settings.key, value: schema.system.settings.value })
    .from(schema.system.settings);

  return new Map(rows.map((row) => [row.key, row.value]));
}

/**
 * Writes validated values.
 *
 * One statement per key rather than one for all of them: there are twelve settings in total,
 * their values have four different shapes, and hand-building a `CASE` over a `jsonb` column to
 * save a dozen round trips on a screen nobody opens twice a day would be the wrong trade.
 *
 * `updated_at` is left alone deliberately - `settings_touch_updated_at` maintains it, and
 * writing it here would be a second answer to the same question.
 *
 * @param db - The database.
 * @param values - What to write, by key.
 * @param userId - Who is writing.
 * @throws {InternalError} When a key matched no row, which cannot happen after validation unless
 * the row was deleted between the two.
 */
export async function writeSettings(
  db: Database,
  values: ReadonlyMap<string, JsonValue>,
  userId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const [key, value] of values) {
      // A transaction is one connection, and one connection cannot run two statements at once.
      // `Promise.all` here would not make these concurrent; it would hand the driver work it has
      // to serialise anyway, having first thrown away the order.
      // eslint-disable-next-line no-await-in-loop -- see above
      const updated = await tx
        .update(schema.system.settings)
        .set({ value, updatedBy: userId })
        .where(eq(schema.system.settings.key, key))
        .returning({ key: schema.system.settings.key });

      if (updated.length === 0) {
        throw new InternalError('A setting this build knows about has no row', {
          details: { key },
        });
      }
    }
  });
}

/**
 * Shapes a set of changes for the audit trail.
 *
 * @param values - What was written.
 * @returns One entry per key, carrying the new value.
 */
export function auditableChanges(values: ReadonlyMap<string, JsonValue>): AuditableChange[] {
  return [...values.entries()].map(([key, value]) => ({ key, value }));
}
