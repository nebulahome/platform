/**
 * `system.community_hub_installations`: the house's registration at each Community Hub it reported
 * an install to - the installation the Hub made of it, and the token it showed once, sealed.
 */
import { eq } from 'drizzle-orm';

import { isSealed, schema, type Database, type SealedValue } from '@nebulahome/db';

/** The house's registration at one Hub. */
export type HubInstallationRow = {
  readonly hubUrl: string;
  readonly installationId: string;

  /** The token, sealed under `NEBULA_SECRETS_KEY`. */
  readonly token: SealedValue;
  readonly registeredAt: Date;
};

/** What the reporter reads and writes the table through: the database, or a fake in a test. */
export type HubInstallationStore = {
  readonly get: (hubUrl: string) => Promise<HubInstallationRow | undefined>;
  readonly save: (row: Omit<HubInstallationRow, 'registeredAt'>) => Promise<void>;
  readonly remove: (hubUrl: string) => Promise<void>;
};

/**
 * The table, over a database.
 *
 * @param db - The database, connected as `nebula_packet_manager`.
 * @returns The store.
 */
export function databaseHubInstallationStore(db: Database): HubInstallationStore {
  const table = schema.system.communityHubInstallations;

  return {
    /**
     * The registration at one Hub.
     *
     * @param hubUrl - The Hub's address.
     * @returns It; undefined when the house is not registered there, or its token is unreadable.
     */
    get: async (hubUrl) => {
      const [row] = await db.select().from(table).where(eq(table.hubUrl, hubUrl)).limit(1);

      if (row === undefined || !isSealed(row.token)) {
        return undefined;
      }

      return {
        hubUrl: row.hubUrl,
        installationId: row.installationId,
        token: row.token,
        registeredAt: row.registeredAt,
      };
    },

    /**
     * Keeps a registration, in place of any the house had at that Hub.
     *
     * @param row - What the Hub gave.
     */
    save: async (row) => {
      await db
        .insert(table)
        .values({ hubUrl: row.hubUrl, installationId: row.installationId, token: row.token })
        .onConflictDoUpdate({
          target: table.hubUrl,
          set: { installationId: row.installationId, token: row.token, registeredAt: new Date() },
        });
    },

    /**
     * Forgets the registration at one Hub: its token is refused.
     *
     * @param hubUrl - The Hub's address.
     */
    remove: async (hubUrl) => {
      await db.delete(table).where(eq(table.hubUrl, hubUrl));
    },
  };
}
