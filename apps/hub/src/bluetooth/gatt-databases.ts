/**
 * What the broker remembers of each device's GATT database, so that a proxy connecting to it again
 * can skip the search: the database belongs to the device, so it holds whichever proxy reaches it.
 *
 * A database is trusted while its Database Hash - read at each connect that uses it - is the one
 * read when it was found; a device without one, or whose hash cannot be read, has it for 24 h. Any
 * failure on a link that used it forgets it. Kept in memory only: after a restart each device is
 * searched once again.
 */
import type { BluetoothGattDatabase } from '@nebulahome/contracts';

import { shortUuid } from './host.js';

/** How long a database without a readable hash is trusted. */
export const DATABASE_TTL_MS = 24 * 60 * 60 * 1000;

/** How many devices' databases are kept; the one used longest ago goes first. */
const MAXIMUM_DATABASES = 512;

/** The standard service and characteristic of the Database Hash. */
const GATT_SERVICE = '1801';
const DATABASE_HASH = '2b2a';

/** A device's database, as remembered. */
export type KnownDatabase = {
  readonly database: BluetoothGattDatabase;

  /** When it was found. */
  readonly at: number;

  /** Its Database Hash, in hex; null when the device has none or it could not be read. */
  hash: string | null;
};

/**
 * Whether a database lists the Database Hash.
 *
 * @param database - The database.
 * @returns Whether.
 */
export function hasDatabaseHash(database: BluetoothGattDatabase): boolean {
  return database.some(
    (service) =>
      shortUuid(service.uuid) === GATT_SERVICE &&
      service.characteristics.some(
        (characteristic) => shortUuid(characteristic.uuid) === DATABASE_HASH,
      ),
  );
}

/** Where the Database Hash is read, as a `gatt.read` names it. */
export const DATABASE_HASH_TARGET = { service: GATT_SERVICE, characteristic: DATABASE_HASH };

/** The databases the broker remembers, by address. */
export class GattDatabases {
  readonly #known = new Map<string, KnownDatabase>();

  /**
   * The database still trusted for an address.
   *
   * @param address - The device.
   * @returns It; undefined when there is none, or it is too old to trust without a hash.
   */
  trusted(address: string): KnownDatabase | undefined {
    const known = this.#known.get(address);

    if (known === undefined) {
      return undefined;
    }

    this.#known.delete(address);

    if (known.hash === null && Date.now() - known.at >= DATABASE_TTL_MS) {
      return undefined;
    }

    // Used last, so dropped last.
    this.#known.set(address, known);

    return known;
  }

  /**
   * Remembers a database just found, until a hash read says otherwise.
   *
   * @param address - The device.
   * @param database - What the proxy found.
   * @returns What is remembered.
   */
  keep(address: string, database: BluetoothGattDatabase): KnownDatabase {
    const known: KnownDatabase = { database, at: Date.now(), hash: null };

    this.#known.delete(address);
    this.#known.set(address, known);

    for (const oldest of this.#known.keys()) {
      if (this.#known.size <= MAXIMUM_DATABASES) {
        break;
      }

      this.#known.delete(oldest);
    }

    return known;
  }

  /**
   * Forgets an address's database: the next connect searches again.
   *
   * @param address - The device.
   */
  forget(address: string): void {
    this.#known.delete(address);
  }
}
