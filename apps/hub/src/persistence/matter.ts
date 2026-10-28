/**
 * The Wi-Fi a new Matter device is given, in the registry's `matter_networks` row: the network's
 * name in the clear, its password sealed (`sealed.ts`) under the platform's key, so a dump or a
 * backup holds a marker and nothing it can use. `hub` seals as it writes and opens as it
 * commissions; it is the row's only writer.
 *
 * Behind an interface, so the broker's tests keep it in memory.
 */
import { eq } from 'drizzle-orm';

import { isSealed, openSecret, schema, sealSecret, type Database } from '@nebulahome/db';

/** The Wi-Fi saved, its password opened; null for none. */
export type MatterWifi = { readonly ssid: string; readonly password: string | null };

/** The Wi-Fi to save: a password left out keeps the one saved. */
export type MatterWifiSave = { readonly ssid: string; readonly password?: string | undefined };

/** What the broker keeps. */
export type MatterNetworksStore = {
  /** The Wi-Fi saved; null when none is. */
  wifi: () => Promise<MatterWifi | null>;

  /** Saves the Wi-Fi, or forgets it with null. */
  saveWifi: (wifi: MatterWifiSave | null) => Promise<void>;
};

/** The row's two columns, as kept. */
export type MatterWifiRow = {
  readonly wifiSsid: string | null;
  readonly wifiPasswordSealed: unknown;
};

/**
 * The row for a Wi-Fi to save: the password sealed, or the one kept when none is given and the
 * network is the same.
 *
 * @param wifi - What to save; null forgets it.
 * @param kept - The row as it is.
 * @param key - The platform's secrets key.
 * @returns The row.
 */
export function wifiRowOf(
  wifi: MatterWifiSave | null,
  kept: MatterWifiRow | undefined,
  key: Buffer,
): MatterWifiRow {
  if (wifi === null) {
    return { wifiSsid: null, wifiPasswordSealed: null };
  }

  return {
    wifiSsid: wifi.ssid,
    wifiPasswordSealed:
      wifi.password === undefined
        ? kept?.wifiSsid === wifi.ssid
          ? (kept.wifiPasswordSealed ?? null)
          : null
        : sealSecret(wifi.password, key),
  };
}

/**
 * The Wi-Fi a row holds, its password opened.
 *
 * @param row - The row.
 * @param key - The platform's secrets key.
 * @returns The Wi-Fi, or null when the row has none.
 * @throws {ConfigurationError} When the password was sealed under another key.
 */
export function wifiOf(row: MatterWifiRow | undefined, key: Buffer): MatterWifi | null {
  if (row?.wifiSsid === null || row?.wifiSsid === undefined) {
    return null;
  }

  return {
    ssid: row.wifiSsid,
    password: isSealed(row.wifiPasswordSealed) ? openSecret(row.wifiPasswordSealed, key) : null,
  };
}

const table = schema.registry.matterNetworks;

/**
 * The row in the registry.
 *
 * @param db - A connected database handle.
 * @param key - The platform's secrets key.
 * @returns The store.
 */
export function databaseMatterNetworksStore(db: Database, key: Buffer): MatterNetworksStore {
  /**
   * Reads the row.
   *
   * @returns It, or undefined when it is not there.
   */
  const read = async (): Promise<MatterWifiRow | undefined> =>
    (await db.select().from(table).where(eq(table.id, 1)))[0];

  return {
    /**
     * Reads the Wi-Fi, its password opened.
     *
     * @returns It, or null.
     */
    wifi: async () => wifiOf(await read(), key),

    /**
     * Saves the Wi-Fi, its password sealed, or forgets it.
     *
     * @param wifi - The Wi-Fi, or null.
     * @returns Once saved.
     */
    saveWifi: async (wifi) => {
      const row = wifiRowOf(wifi, await read(), key);

      await db
        .insert(table)
        .values({ id: 1, ...row })
        .onConflictDoUpdate({ target: table.id, set: row });
    },
  };
}

/**
 * The row in memory, sealed as the database's is, for tests.
 *
 * @param key - The key to seal with.
 * @returns The store, and the row as it would be kept.
 */
export function memoryMatterNetworksStore(
  key: Buffer = Buffer.alloc(32, 7),
): MatterNetworksStore & { readonly row: () => MatterWifiRow | undefined } {
  let row: MatterWifiRow | undefined;

  return {
    /**
     * Reads the Wi-Fi, its password opened.
     *
     * @returns It, or null.
     */
    wifi: async () => Promise.resolve(wifiOf(row, key)),

    /**
     * Saves the Wi-Fi, its password sealed, or forgets it.
     *
     * @param wifi - The Wi-Fi, or null.
     * @returns Once saved.
     */
    saveWifi: async (wifi) => {
      row = wifiRowOf(wifi, row, key);

      return Promise.resolve();
    },

    /**
     * The row as it would be kept.
     *
     * @returns It.
     */
    row: () => row,
  };
}
