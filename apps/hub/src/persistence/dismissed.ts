/**
 * The Found candidates the owner set aside, kept in `registry.discovery_dismissed` so a dismissal
 * outlives the candidate going quiet and the hub restarting. Written by `hub` and by nothing
 * else.
 */
import { and, eq, or } from 'drizzle-orm';

import { schema, type Database } from '@nebulahome/db';

const dismissed = schema.registry.discoveryDismissed;

/** One candidate set aside: its vendor and its identity, `externalId` or `@` and its address. */
export type StoredDismissal = {
  readonly vendorId: string;
  readonly key: string;
  readonly dismissedAt: Date;
};

/** Reads and writes the candidates set aside. */
export type DismissalStore = {
  /** Every candidate set aside. */
  readonly list: () => Promise<StoredDismissal[]>;

  /** Sets candidates aside, or brings them back. */
  readonly set: (
    entries: readonly { readonly vendorId: string; readonly key: string }[],
    isDismissed: boolean,
  ) => Promise<void>;
};

/**
 * The candidates set aside, in the registry.
 *
 * @param db - A connected database handle.
 * @returns The store.
 */
export function createDismissalStore(db: Database): DismissalStore {
  return {
    /**
     * Reads every candidate set aside.
     *
     * @returns Them.
     */
    list: async () =>
      (await db.select().from(dismissed)).map((row) => ({
        vendorId: row.vendorId,
        key: row.key,
        dismissedAt: row.dismissedAt,
      })),

    /**
     * Sets candidates aside, or brings them back.
     *
     * @param entries - The candidates, by vendor and key.
     * @param isDismissed - Whether they are set aside now.
     */
    set: async (entries, isDismissed) => {
      if (entries.length === 0) {
        return;
      }

      await (isDismissed
        ? db
            .insert(dismissed)
            .values(entries.map(({ vendorId, key }) => ({ vendorId, key })))
            .onConflictDoNothing()
        : db
            .delete(dismissed)
            .where(
              or(
                ...entries.map(({ vendorId, key }) =>
                  and(eq(dismissed.vendorId, vendorId), eq(dismissed.key, key)),
                ),
              ),
            ));
    },
  };
}
