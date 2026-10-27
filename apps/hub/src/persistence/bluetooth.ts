/**
 * What the Bluetooth broker keeps: the owner's settings, the devices made proxies and the
 * addresses ignored, in the registry's `bluetooth_*` tables; and the instances of the house, read
 * for its Bluetooth devices and the devices that could be proxies.
 *
 * What is heard is not kept: it is heard again. `hub` is the tables' only writer: the owner's
 * changes reach it over the bus through `api`. Behind an interface, so the broker's tests keep them
 * in memory.
 */
import { eq } from 'drizzle-orm';

import {
  BLUETOOTH_SCAN_MODES,
  bluetoothSettingsSchema,
  type BluetoothScanMode,
  type BluetoothSettings,
} from '@nebulahome/contracts';
import { schema, type Database } from '@nebulahome/db';

/** A device made a proxy. */
export type StoredBluetoothProxy = {
  /** Its instance. */
  readonly integrationId: string;
  readonly scanMode: BluetoothScanMode;

  /** The script's version installed on it; null when it did not say. */
  readonly scriptVersion: string | null;
  readonly installedAt: Date | null;
};

/** An address the owner ignores. */
export type StoredBluetoothIgnored = {
  readonly address: string;
  readonly name: string | null;
  readonly at: Date;
};

/** An instance of the house, as far as the Bluetooth broker reads it. */
export type BluetoothInstance = {
  readonly id: string;

  /** Its driver, `vendor/driver`. */
  readonly kind: string;
  readonly transport: string;

  /** What identification found it to be: for a Bluetooth device, its address. */
  readonly externalId: string | null;

  /** The device's name; its driver's while the device has no row. */
  readonly name: string;
  readonly areaId: string | null;

  /** How its instance stands: `running`, `failed`… */
  readonly state: string;
  readonly createdAt: Date;
};

/** What the broker keeps. */
export type BluetoothStore = {
  settings: () => Promise<BluetoothSettings>;
  saveSettings: (settings: BluetoothSettings) => Promise<void>;
  proxies: () => Promise<StoredBluetoothProxy[]>;

  /**
   * Saves a proxy whole.
   *
   * @throws {Error} When its instance is not there.
   */
  saveProxy: (proxy: StoredBluetoothProxy) => Promise<StoredBluetoothProxy>;
  removeProxy: (integrationId: string) => Promise<boolean>;
  ignored: () => Promise<StoredBluetoothIgnored[]>;
  setIgnored: (address: string, name: string | null, isIgnored: boolean) => Promise<void>;
};

const settings = schema.registry.bluetoothSettings;
const proxies = schema.registry.bluetoothProxies;
const ignored = schema.registry.bluetoothIgnored;

/**
 * A scan mode as kept; one the contract no longer takes reads as passive.
 *
 * @param mode - The column.
 * @returns The mode.
 */
function modeOf(mode: string): BluetoothScanMode {
  return (BLUETOOTH_SCAN_MODES as readonly string[]).includes(mode)
    ? (mode as BluetoothScanMode)
    : 'passive';
}

/**
 * Reads a proxy row.
 *
 * @param row - The row.
 * @returns The proxy.
 */
function proxyOf(row: typeof proxies.$inferSelect): StoredBluetoothProxy {
  return {
    integrationId: row.integrationId,
    scanMode: modeOf(row.scanMode),
    scriptVersion: row.scriptVersion,
    installedAt: row.installedAt,
  };
}

/** The broker's tables in the registry. */
class DatabaseBluetoothStore implements BluetoothStore {
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
   * Reads the settings.
   *
   * @returns Them; the defaults when the row is missing, or holds what the contract refuses.
   */
  async settings(): Promise<BluetoothSettings> {
    const [row] = await this.#db.select().from(settings).where(eq(settings.id, 1));
    const parsed = bluetoothSettingsSchema.safeParse(row ?? {});

    return parsed.success ? parsed.data : bluetoothSettingsSchema.parse({});
  }

  /**
   * Saves the settings.
   *
   * @param next - The settings.
   * @returns Once saved.
   */
  async saveSettings(next: BluetoothSettings): Promise<void> {
    const values = {
      localEnabled: next.localEnabled,
      adapterId: next.adapterId,
      localScanMode: next.localScanMode,
      proxyScanMode: next.proxyScanMode,
      forgetAfterDays: next.forgetAfterDays,
      showPrivate: next.showPrivate,
    };

    await this.#db
      .insert(settings)
      .values({ id: 1, ...values })
      .onConflictDoUpdate({ target: settings.id, set: values });
  }

  /**
   * Reads every proxy.
   *
   * @returns The proxies.
   */
  async proxies(): Promise<StoredBluetoothProxy[]> {
    return (await this.#db.select().from(proxies)).map(proxyOf);
  }

  /**
   * Saves a proxy, new or changed.
   *
   * @param proxy - The proxy.
   * @returns It, saved.
   */
  async saveProxy(proxy: StoredBluetoothProxy): Promise<StoredBluetoothProxy> {
    const values = {
      scanMode: proxy.scanMode,
      scriptVersion: proxy.scriptVersion,
      installedAt: proxy.installedAt,
    };
    const [row] = await this.#db
      .insert(proxies)
      .values({ integrationId: proxy.integrationId, ...values })
      .onConflictDoUpdate({ target: proxies.integrationId, set: values })
      .returning();

    if (row === undefined) {
      throw new Error(`Could not keep ${proxy.integrationId} as a proxy`);
    }

    return proxyOf(row);
  }

  /**
   * Removes a proxy.
   *
   * @param integrationId - Its instance.
   * @returns Whether there was one.
   */
  async removeProxy(integrationId: string): Promise<boolean> {
    const removed = await this.#db
      .delete(proxies)
      .where(eq(proxies.integrationId, integrationId))
      .returning({ id: proxies.integrationId });

    return removed.length > 0;
  }

  /**
   * Reads the addresses ignored.
   *
   * @returns Them.
   */
  async ignored(): Promise<StoredBluetoothIgnored[]> {
    return (await this.#db.select().from(ignored)).map((row) => ({
      address: row.address,
      name: row.name,
      at: row.createdAt,
    }));
  }

  /**
   * Ignores an address, or stops ignoring it.
   *
   * @param address - The address, upper case.
   * @param name - What it advertised, for the Ignored fold.
   * @param isIgnored - Which way.
   * @returns Once kept.
   */
  async setIgnored(address: string, name: string | null, isIgnored: boolean): Promise<void> {
    await (isIgnored
      ? this.#db.insert(ignored).values({ address, name }).onConflictDoNothing()
      : this.#db.delete(ignored).where(eq(ignored.address, address)));
  }
}

/**
 * The broker's tables in the registry.
 *
 * @param db - A connected database handle.
 * @returns The store.
 */
export function databaseBluetoothStore(db: Database): BluetoothStore {
  return new DatabaseBluetoothStore(db);
}

/**
 * Reads every instance of the house, with its device's name, room and external id.
 *
 * @param db - A connected database handle.
 * @returns Them, oldest first.
 */
export async function loadBluetoothInstances(db: Database): Promise<BluetoothInstance[]> {
  const { integrations, devices } = schema.registry;
  const rows = await db
    .select({
      id: integrations.id,
      kind: integrations.kind,
      transport: integrations.transport,
      state: integrations.state,
      createdAt: integrations.createdAt,
      externalId: devices.externalId,
      name: devices.name,
      areaId: devices.areaId,
    })
    .from(integrations)
    .leftJoin(devices, eq(devices.integrationId, integrations.id))
    .orderBy(integrations.createdAt);

  return rows.map((row) => ({ ...row, name: row.name ?? row.kind }));
}

/** The broker's tables in memory, for tests. */
class MemoryBluetoothStore implements BluetoothStore {
  #saved: BluetoothSettings = bluetoothSettingsSchema.parse({});
  readonly #proxies = new Map<string, StoredBluetoothProxy>();
  readonly #ignored = new Map<string, StoredBluetoothIgnored>();

  /**
   * Reads the settings.
   *
   * @returns Them.
   */
  settings(): Promise<BluetoothSettings> {
    return Promise.resolve(this.#saved);
  }

  /**
   * Saves the settings.
   *
   * @param next - The settings.
   * @returns Once saved.
   */
  saveSettings(next: BluetoothSettings): Promise<void> {
    this.#saved = next;

    return Promise.resolve();
  }

  /**
   * Reads every proxy.
   *
   * @returns The proxies.
   */
  proxies(): Promise<StoredBluetoothProxy[]> {
    return Promise.resolve([...this.#proxies.values()]);
  }

  /**
   * Saves a proxy.
   *
   * @param proxy - The proxy.
   * @returns It.
   */
  saveProxy(proxy: StoredBluetoothProxy): Promise<StoredBluetoothProxy> {
    this.#proxies.set(proxy.integrationId, proxy);

    return Promise.resolve(proxy);
  }

  /**
   * Removes a proxy.
   *
   * @param integrationId - Its instance.
   * @returns Whether there was one.
   */
  removeProxy(integrationId: string): Promise<boolean> {
    return Promise.resolve(this.#proxies.delete(integrationId));
  }

  /**
   * Reads the addresses ignored.
   *
   * @returns Them.
   */
  ignored(): Promise<StoredBluetoothIgnored[]> {
    return Promise.resolve([...this.#ignored.values()]);
  }

  /**
   * Ignores an address, or stops.
   *
   * @param address - The address.
   * @param name - What it advertised.
   * @param isIgnored - Which way.
   * @returns Once kept.
   */
  setIgnored(address: string, name: string | null, isIgnored: boolean): Promise<void> {
    if (isIgnored) {
      this.#ignored.set(address, this.#ignored.get(address) ?? { address, name, at: new Date() });
    } else {
      this.#ignored.delete(address);
    }

    return Promise.resolve();
  }
}

/**
 * The broker's tables in memory, for tests.
 *
 * @returns The store.
 */
export function memoryBluetoothStore(): BluetoothStore {
  return new MemoryBluetoothStore();
}
