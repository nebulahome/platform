/**
 * What the Thread broker keeps: whose border router - none, the platform's own on a radio, or an
 * external one by its URL - and whether its network is handed to Matter, in the registry's
 * `thread_settings` row. The network itself, its key among it, is never kept here: it stays in
 * the border router.
 *
 * `hub` is the table's only writer. Behind an interface, so the broker's tests keep it in memory.
 */
import { eq } from 'drizzle-orm';

import { THREAD_MODES, threadRestUrlSchema, type ThreadMode } from '@nebulahome/contracts';
import { schema, type Database } from '@nebulahome/db';

/** The broker's settings. */
export type ThreadSettings = {
  readonly mode: ThreadMode;

  /** The external border router's REST API; null unless the mode is external. */
  readonly externalUrl: string | null;

  /** The port the platform's border router's radio is on; null unless the mode is local. */
  readonly radioPortId: string | null;
  readonly useForMatter: boolean;
};

/** What the broker keeps. */
export type ThreadStore = {
  settings: () => Promise<ThreadSettings>;
  saveSettings: (settings: ThreadSettings) => Promise<void>;
};

/** Thread not set up. */
export const THREAD_DEFAULTS: ThreadSettings = {
  mode: 'none',
  externalUrl: null,
  radioPortId: null,
  useForMatter: true,
};

const table = schema.registry.threadSettings;

/** The broker's row in the registry. */
class DatabaseThreadStore implements ThreadStore {
  readonly #db: Database;

  /**
   * Keeps the handle.
   *
   * @param db - A connected database handle.
   */
  constructor(db: Database) {
    this.#db = db;
  }

  /**
   * Reads the settings; what the contract no longer takes reads as not set up.
   *
   * @returns Them; the defaults when the row is missing.
   */
  async settings(): Promise<ThreadSettings> {
    const [row] = await this.#db.select().from(table).where(eq(table.id, 1));

    if (row === undefined) {
      return THREAD_DEFAULTS;
    }

    const mode = (THREAD_MODES as readonly string[]).includes(row.mode)
      ? (row.mode as ThreadMode)
      : 'none';
    const url = threadRestUrlSchema.safeParse(row.externalUrl);

    return {
      mode: mode === 'external' && !url.success ? 'none' : mode,
      externalUrl: url.success ? url.data : null,
      radioPortId: row.radioPortId,
      useForMatter: row.useForMatter,
    };
  }

  /**
   * Saves the settings.
   *
   * @param next - The settings.
   * @returns Once saved.
   */
  async saveSettings(next: ThreadSettings): Promise<void> {
    const values = {
      mode: next.mode,
      externalUrl: next.externalUrl,
      radioPortId: next.radioPortId,
      useForMatter: next.useForMatter,
    };

    await this.#db
      .insert(table)
      .values({ id: 1, ...values })
      .onConflictDoUpdate({ target: table.id, set: values });
  }
}

/**
 * The broker's row in the registry.
 *
 * @param db - A connected database handle.
 * @returns The store.
 */
export function databaseThreadStore(db: Database): ThreadStore {
  return new DatabaseThreadStore(db);
}

/**
 * The broker's row in memory, for tests.
 *
 * @returns The store.
 */
export function memoryThreadStore(): ThreadStore {
  let saved = THREAD_DEFAULTS;

  return {
    /**
     * Reads the settings.
     *
     * @returns Them.
     */
    settings: async () => Promise.resolve(saved),

    /**
     * Saves the settings.
     *
     * @param next - The settings.
     * @returns Once saved.
     */
    saveSettings: async (next) => {
      saved = next;

      return Promise.resolve();
    },
  };
}
