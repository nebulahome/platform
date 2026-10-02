/**
 * The accounts a vendor's devices are reached through, as `hub` keeps them.
 *
 * The one table of the registry `hub` writes whole: it runs the sign-in, so it is the one that
 * knows when an account signed in, what session the cloud gave, and when the cloud wants the
 * owner again. `credentials` arrive sealed from `api`, which checked them against the vendor's
 * fields, and are stored as they came; the session is sealed here, whole, since what it holds is
 * the cloud's business and all of it is a key to the account.
 */
import { and, eq } from 'drizzle-orm';

import type { AccountStatus, IntegrationAccountView, JsonObject } from '@nebulahome/contracts';
import { isSealed, openSecret, schema, sealSecret, type Database } from '@nebulahome/db';

/** One account: what it typed stays sealed, the session is opened. */
export type StoredAccount = {
  readonly vendorId: string;
  readonly id: string;
  readonly label: string;
  readonly status: AccountStatus;
  readonly credentials: JsonObject;
  readonly session: JsonObject;
  readonly lastError: string | null;
  readonly connectedAt: Date | null;
  readonly updatedAt: Date;
};

/** Where the sealed session is kept in its column. */
const SESSION_KEY = 'sealed';

const accounts = schema.registry.integrationAccounts;

/**
 * Seals a session whole.
 *
 * @param session - What the cloud gave.
 * @param secretsKey - The installation's key.
 * @returns The column's value.
 */
function sealSession(session: JsonObject, secretsKey: Buffer): JsonObject {
  return { [SESSION_KEY]: sealSecret(JSON.stringify(session), secretsKey) };
}

/**
 * Opens a sealed session.
 *
 * @param stored - The column's value.
 * @param secretsKey - The installation's key.
 * @returns The session; empty for a row that holds none.
 */
function openSession(stored: unknown, secretsKey: Buffer): JsonObject {
  const sealed = (stored as Record<string, unknown> | null)?.[SESSION_KEY];

  if (!isSealed(sealed)) {
    return {};
  }

  const value: unknown = JSON.parse(openSecret(sealed, secretsKey));

  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

/**
 * Reads a row into an account.
 *
 * @param row - The row.
 * @param secretsKey - The installation's key.
 * @returns The account, its session opened; what was typed stays sealed until a transport needs it.
 */
function accountOf(row: typeof accounts.$inferSelect, secretsKey: Buffer): StoredAccount {
  return {
    vendorId: row.vendorId,
    id: row.id,
    label: row.label,
    status: row.status as AccountStatus,
    credentials: row.credentials as JsonObject,
    session: openSession(row.session, secretsKey),
    lastError: row.lastError,
    connectedAt: row.connectedAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * An account as the interface lists it: nothing of what it signed in with.
 *
 * @param account - The account.
 * @returns The view.
 */
export function accountViewOf(
  account: Pick<
    StoredAccount,
    'vendorId' | 'id' | 'label' | 'status' | 'lastError' | 'connectedAt' | 'updatedAt'
  >,
): IntegrationAccountView {
  return {
    vendorId: account.vendorId,
    id: account.id,
    label: account.label,
    status: account.status,
    lastError: account.lastError,
    connectedAt: account.connectedAt,
    updatedAt: account.updatedAt,
  };
}

/**
 * Reads every account of a vendor.
 *
 * @param db - A connected database handle.
 * @param vendorId - The vendor.
 * @param secretsKey - The installation's key.
 * @returns Its accounts, in the order they were made.
 */
export async function loadAccounts(
  db: Database,
  vendorId: string,
  secretsKey: Buffer,
): Promise<StoredAccount[]> {
  const rows = await db
    .select()
    .from(accounts)
    .where(eq(accounts.vendorId, vendorId))
    .orderBy(accounts.createdAt);

  return rows.map((row) => accountOf(row, secretsKey));
}

/**
 * Keeps an account that just signed in: made, or signed in again.
 *
 * @param db - A connected database handle.
 * @param account - Who it is, what it signed in with (sealed), and the session.
 * @param account.vendorId - Its vendor.
 * @param account.id - Its id at the cloud.
 * @param account.label - What its card calls it.
 * @param account.credentials - What the owner typed, its secrets sealed.
 * @param account.session - What the cloud gave, sealed here.
 * @param secretsKey - The installation's key.
 * @returns The account as stored, its secrets opened.
 */
export async function saveSignedIn(
  db: Database,
  account: {
    readonly vendorId: string;
    readonly id: string;
    readonly label: string;
    readonly credentials: JsonObject;
    readonly session: JsonObject;
  },
  secretsKey: Buffer,
): Promise<StoredAccount> {
  const now = new Date();
  const values = {
    label: account.label.slice(0, 256),
    status: 'connected',
    credentials: account.credentials,
    session: sealSession(account.session, secretsKey),
    lastError: null,
    connectedAt: now,
  } as const;
  const [row] = await db
    .insert(accounts)
    .values({ vendorId: account.vendorId, id: account.id, ...values })
    .onConflictDoUpdate({ target: [accounts.vendorId, accounts.id], set: values })
    .returning();

  if (row === undefined) {
    throw new Error(`The account ${account.id} of ${account.vendorId} was not stored`);
  }

  return accountOf(row, secretsKey);
}

/**
 * Keeps a renewed session.
 *
 * @param db - A connected database handle.
 * @param vendorId - The vendor.
 * @param id - The account.
 * @param session - The new session.
 * @param secretsKey - The installation's key.
 * @returns Once it is stored.
 */
export async function saveSession(
  db: Database,
  vendorId: string,
  id: string,
  session: JsonObject,
  secretsKey: Buffer,
): Promise<void> {
  await db
    .update(accounts)
    .set({ session: sealSession(session, secretsKey) })
    .where(and(eq(accounts.vendorId, vendorId), eq(accounts.id, id)));
}

/**
 * Records where an account stands, and why.
 *
 * @param db - A connected database handle.
 * @param vendorId - The vendor.
 * @param id - The account.
 * @param status - Where it stands.
 * @param lastError - Why, when it is not signed in.
 * @returns Whether the account was there, and changed.
 */
export async function saveStatus(
  db: Database,
  vendorId: string,
  id: string,
  status: AccountStatus,
  lastError: string | null,
): Promise<boolean> {
  const updated = await db
    .update(accounts)
    .set({ status, lastError: lastError?.slice(0, 1024) ?? null })
    .where(and(eq(accounts.vendorId, vendorId), eq(accounts.id, id)))
    .returning({ id: accounts.id });

  return updated.length > 0;
}

/**
 * Forgets an account.
 *
 * @param db - A connected database handle.
 * @param vendorId - The vendor.
 * @param id - The account.
 * @returns Whether there was one to forget.
 */
export async function deleteAccount(db: Database, vendorId: string, id: string): Promise<boolean> {
  const deleted = await db
    .delete(accounts)
    .where(and(eq(accounts.vendorId, vendorId), eq(accounts.id, id)))
    .returning({ id: accounts.id });

  return deleted.length > 0;
}

/** Where the accounts are kept: the database, or a test's memory. */
export type AccountStore = {
  readonly load: (vendorId: string) => Promise<StoredAccount[]>;
  readonly saveSignedIn: (account: {
    readonly vendorId: string;
    readonly id: string;
    readonly label: string;
    readonly credentials: JsonObject;
    readonly session: JsonObject;
  }) => Promise<StoredAccount>;
  readonly saveSession: (vendorId: string, id: string, session: JsonObject) => Promise<void>;
  readonly saveStatus: (
    vendorId: string,
    id: string,
    status: AccountStatus,
    lastError: string | null,
  ) => Promise<boolean>;
  readonly delete: (vendorId: string, id: string) => Promise<boolean>;
};

/**
 * The accounts, kept in the registry.
 *
 * @param db - A connected database handle.
 * @param secretsKey - The installation's key.
 * @returns The store.
 */
export function databaseAccountStore(db: Database, secretsKey: Buffer): AccountStore {
  return {
    /**
     * Reads a vendor's accounts.
     *
     * @param vendorId - The vendor.
     * @returns Its accounts.
     */
    load: async (vendorId) => loadAccounts(db, vendorId, secretsKey),

    /**
     * Keeps an account that signed in.
     *
     * @param account - Who, what it typed, and the session.
     * @returns It, as stored.
     */
    saveSignedIn: async (account) => saveSignedIn(db, account, secretsKey),

    /**
     * Keeps a renewed session.
     *
     * @param vendorId - The vendor.
     * @param id - The account.
     * @param session - The session.
     * @returns Once it is stored.
     */
    saveSession: async (vendorId, id, session) =>
      saveSession(db, vendorId, id, session, secretsKey),

    /**
     * Records where an account stands.
     *
     * @param vendorId - The vendor.
     * @param id - The account.
     * @param status - Where it stands.
     * @param lastError - Why.
     * @returns Whether it changed.
     */
    saveStatus: async (vendorId, id, status, lastError) =>
      saveStatus(db, vendorId, id, status, lastError),

    /**
     * Forgets an account.
     *
     * @param vendorId - The vendor.
     * @param id - The account.
     * @returns Whether it was there.
     */
    delete: async (vendorId, id) => deleteAccount(db, vendorId, id),
  };
}
