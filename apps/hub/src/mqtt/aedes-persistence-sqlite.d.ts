/**
 * The two modules of `aedes-persistence-sqlite` the broker uses, which ship no types: its store,
 * and the asynchronous persistence aedes 1 speaks over it. Both are CommonJS modules whose one
 * export is a class, which is what their declarations say.
 */
/* eslint-disable import-x/no-default-export, @typescript-eslint/no-extraneous-class -- the modules' own shape: one default class each */
declare module 'aedes-persistence-sqlite/sqliteStore.js' {
  import type { DatabaseSync } from 'node:sqlite';

  /** A key-value store in one SQLite file. */
  export default class SqliteStore {
    /**
     * Opens the store.
     *
     * @param database - A file, `:memory:`, or an open database.
     */
    public constructor(database: string | DatabaseSync);
  }
}

declare module 'aedes-persistence-sqlite/asyncPersistence.js' {
  import type SqliteStore from 'aedes-persistence-sqlite/sqliteStore.js';

  /** aedes' persistence over a store. */
  export default class AsyncPersistence {
    /**
     * Wraps a store.
     *
     * @param store - The store.
     */
    public constructor(store: SqliteStore);

    /**
     * Closes the store's file.
     *
     * @returns Once closed.
     */
    public destroy(): Promise<void>;
  }
}
