/**
 * Reading the integration instances an owner configured, and reporting what became of them.
 *
 * The only database access `hub` has. Configuration is written by `api` on the owner's behalf and
 * read here; runtime status is written here and read by everyone else. The grant says the same
 * thing - `nebula_hub` may select from this table and update three columns of it - so a mistake
 * in this file fails against the database rather than quietly overwriting an owner's settings.
 */
import { and, eq } from 'drizzle-orm';

import {
  integrationStateSchema,
  type IntegrationState,
  type JsonObject,
  type ReloadReply,
} from '@nebulahome/contracts';
import { openSecrets, schema, type Database } from '@nebulahome/db';

/** One configured instance, as `hub` needs it. */
export type IntegrationInstance = {
  /** Also the `source` every entity of this instance carries. */
  readonly id: string;

  /** The bundle providing the driver. */
  readonly kind: string;
  readonly kindVersion: string;
  readonly transport: string;
  readonly transportConfig: JsonObject;
  readonly options: JsonObject;
  readonly isEnabled: boolean;
};

/** The columns an instance is built from. */
const INSTANCE_COLUMNS = {
  id: schema.registry.integrations.id,
  kind: schema.registry.integrations.kind,
  kindVersion: schema.registry.integrations.kindVersion,
  transport: schema.registry.integrations.transport,
  transportConfig: schema.registry.integrations.transportConfig,
  options: schema.registry.integrations.options,
  isEnabled: schema.registry.integrations.isEnabled,
};

/** One row, as {@link INSTANCE_COLUMNS} selects it. */
type InstanceRow = Omit<IntegrationInstance, 'transportConfig' | 'options'> & {
  readonly transportConfig: unknown;
  readonly options: unknown;
};

/**
 * Types one row's `jsonb` columns.
 *
 * @param row - As selected.
 * @returns The instance.
 */
function asInstance(row: InstanceRow): IntegrationInstance {
  return {
    ...row,
    transportConfig: row.transportConfig as JsonObject,
    options: row.options as JsonObject,
  };
}

/**
 * Reads every configured instance.
 *
 * Disabled ones are read too rather than filtered in SQL: `hub` reports a status for each, and an
 * instance that vanished from the list would leave whatever it last said standing in the
 * interface forever.
 *
 * @param db - A connected database handle.
 * @returns The instances, oldest first.
 */
export async function loadInstances(db: Database): Promise<IntegrationInstance[]> {
  const rows = await db
    .select(INSTANCE_COLUMNS)
    .from(schema.registry.integrations)
    .orderBy(schema.registry.integrations.createdAt);

  return rows.map(asInstance);
}

/**
 * Reads one configured instance.
 *
 * @param db - A connected database handle.
 * @param id - Which instance.
 * @returns The instance, or undefined when no row has that id - a row the owner deleted between
 * asking for a reload and the reload happening.
 */
export async function loadInstance(
  db: Database,
  id: string,
): Promise<IntegrationInstance | undefined> {
  const [row] = await db
    .select(INSTANCE_COLUMNS)
    .from(schema.registry.integrations)
    .where(eq(schema.registry.integrations.id, id))
    .limit(1);

  return row === undefined ? undefined : asInstance(row);
}

/**
 * Opens the secrets an instance was stored with.
 *
 * `api` seals a password before it reaches the row; the transport needs it as typed. This is the
 * one place the two meet, and it is called when an instance starts rather than when the rows are
 * read, so that a key which no longer opens one instance's secrets fails that instance - with a
 * message naming the key - and not the whole load.
 *
 * @param instance - As read from the registry.
 * @param secretsKey - The installation's key.
 * @returns The same instance with every sealed value replaced by what it held.
 * @throws {ConfigurationError} When a value was sealed with another key.
 */
export function openInstance(
  instance: IntegrationInstance,
  secretsKey: Buffer,
): IntegrationInstance {
  return {
    ...instance,
    transportConfig: openSecrets(instance.transportConfig, secretsKey),
    options: openSecrets(instance.options, secretsKey),
  };
}

/**
 * Reads back where an instance ended up.
 *
 * @param db - A connected database handle.
 * @param id - Which instance.
 * @returns Its state and last error - `stopped` and nothing when no row has that id.
 */
export async function readStatus(db: Database, id: string): Promise<ReloadReply> {
  const [row] = await db
    .select({
      state: schema.registry.integrations.state,
      lastError: schema.registry.integrations.lastError,
    })
    .from(schema.registry.integrations)
    .where(eq(schema.registry.integrations.id, id))
    .limit(1);

  return row === undefined
    ? { state: 'stopped', lastError: null }
    : { state: integrationStateSchema.parse(row.state), lastError: row.lastError };
}

/** How long a reason written next to the state may be: a sentence, not a stack trace. */
const MAXIMUM_REASON_LENGTH = 512;

/**
 * Records why an instance still listening has not heard its device, next to the state.
 *
 * Only while the row says `identifying`: a reason landing after the device was found, or after
 * the instance was stopped, would describe something that is no longer happening. The state is
 * left alone - the search goes on - and the next state written clears the reason.
 *
 * @param db - A connected database handle.
 * @param id - The instance.
 * @param reason - Why, in an owner's words.
 * @returns A promise that settles once the row is written, or found not listening.
 */
export async function recordListening(db: Database, id: string, reason: string): Promise<void> {
  await db
    .update(schema.registry.integrations)
    .set({ lastError: reason.slice(0, MAXIMUM_REASON_LENGTH) })
    .where(
      and(
        eq(schema.registry.integrations.id, id),
        eq(schema.registry.integrations.state, 'identifying'),
      ),
    );
}

/**
 * Records what became of an instance.
 *
 * @param db - A connected database handle.
 * @param id - The instance.
 * @param state - What it is doing now.
 * @param lastError - Why, when it failed. Cleared on any other state, so that a message from an
 * hour ago cannot be read as describing what is happening now.
 * @returns A promise that settles once the row is written.
 */
export async function recordStatus(
  db: Database,
  id: string,
  state: IntegrationState,
  lastError?: string,
): Promise<void> {
  await db
    .update(schema.registry.integrations)
    .set({
      state: integrationStateSchema.parse(state),
      lastError: state === 'failed' ? (lastError ?? 'Failed for an unrecorded reason') : null,
      ...(state === 'running' ? { lastStartedAt: new Date() } : {}),
    })
    .where(eq(schema.registry.integrations.id, id));
}
