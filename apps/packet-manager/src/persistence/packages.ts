/**
 * `system.packages`: the one table the packet-manager writes.
 *
 * A row per installed package: its release, how it runs, where it came from, where it stands,
 * its manifest as it was installed and the settings the owner saved - secrets sealed.
 */
import { eq } from 'drizzle-orm';

import type {
  JsonObject,
  PackageManifest,
  PackageRuntime,
  PackageSource,
  PackageState,
} from '@nebula-home/contracts';
import { schema, type Database } from '@nebula-home/db';

/** One installed package, as its row holds it. */
export type PackageRow = {
  readonly id: string;
  readonly version: string;
  readonly runtime: PackageRuntime;
  readonly state: PackageState;
  readonly source: PackageSource;
  readonly isSystem: boolean;
  readonly manifest: JsonObject;
  readonly config: JsonObject;
  readonly previousVersion: string | null;
  readonly lastStartedAt: Date | null;
  readonly lastError: string | null;
  readonly installedAt: Date;
  readonly updatedAt: Date;
};

/** What the service reads and writes the table through: the database, or a fake in a test. */
export type PackageStore = {
  readonly list: () => Promise<PackageRow[]>;
  readonly insert: (row: {
    readonly id: string;
    readonly manifest: PackageManifest;
    readonly source: PackageSource;
    readonly isSystem: boolean;
    readonly state: PackageState;
  }) => Promise<void>;
  readonly update: (
    id: string,
    fields: Partial<
      Pick<
        PackageRow,
        | 'version'
        | 'runtime'
        | 'state'
        | 'config'
        | 'previousVersion'
        | 'lastStartedAt'
        | 'lastError'
      > & { readonly manifest: PackageManifest }
    >,
  ) => Promise<void>;
  readonly remove: (id: string) => Promise<void>;
};

/**
 * The table, over a database.
 *
 * @param db - The database, connected as `nebula_packet_manager`.
 * @returns The store.
 */
export function databasePackageStore(db: Database): PackageStore {
  const { packages } = schema.system;

  return {
    /**
     * Every row.
     *
     * @returns The rows.
     */
    list: async () => {
      const rows = await db.select().from(packages);

      return rows.map((row) => ({
        id: row.id,
        version: row.version,
        runtime: row.runtime as PackageRuntime,
        state: row.state as PackageState,
        source: row.source as PackageSource,
        isSystem: row.isSystem,
        manifest: row.manifest as JsonObject,
        config: row.config as JsonObject,
        previousVersion: row.previousVersion,
        lastStartedAt: row.lastStartedAt,
        lastError: row.lastError,
        installedAt: row.installedAt,
        updatedAt: row.updatedAt,
      }));
    },

    /**
     * Writes a new row.
     *
     * @param row - What it holds.
     */
    insert: async (row) => {
      await db.insert(packages).values({
        id: row.id,
        version: row.manifest.version,
        runtime: row.manifest.runtime,
        state: row.state,
        source: row.source,
        isSystem: row.isSystem,
        manifest: row.manifest,
      });
    },

    /**
     * Changes a row.
     *
     * @param id - The package.
     * @param fields - What changes.
     */
    update: async (id, fields) => {
      await db
        .update(packages)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(packages.id, id));
    },

    /**
     * Deletes a row.
     *
     * @param id - The package.
     */
    remove: async (id) => {
      await db.delete(packages).where(eq(packages.id, id));
    },
  };
}
