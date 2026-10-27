/**
 * What the Serial broker keeps: the owner's settings, and every port it has seen or the owner
 * added on the network with who holds it, in the registry's `serial_*` tables; and the devices of
 * the house whose config names a port, read from the instances.
 *
 * `hub` is the tables' only writer: the owner's changes reach it over the bus through `api`.
 * Behind an interface, so the broker's tests keep them in memory.
 */
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import {
  SERIAL_BROKER_HOLDERS,
  SERIAL_PORT_KINDS,
  serialDeviceConfigSchema,
  serialLineSchema,
  serialNetworkAddressSchema,
  serialSettingsSchema,
  serialUsbSchema,
  type JsonObject,
  type SerialBrokerHolder,
  type SerialDeviceConfig,
  type SerialLine,
  type SerialNetworkAddress,
  type SerialPortKind,
  type SerialSettings,
  type SerialUsb,
} from '@nebulahome/contracts';
import { schema, type Database } from '@nebulahome/db';

/** A port, as kept. */
export type StoredSerialPort = {
  readonly id: string;

  /** `/dev/serial/by-id/…`, a `/dev` path, or `tcp://host:port`. */
  readonly stablePath: string;
  readonly kind: SerialPortKind;
  readonly name: string;
  readonly usb: SerialUsb | null;
  readonly network: SerialNetworkAddress | null;

  /** The device - its instance - that holds it; null for none. */
  readonly holderIntegrationId: string | null;

  /** The broker that holds it; null for none. */
  readonly holderBroker: SerialBrokerHolder | null;

  /** How its holder speaks it; null while it is free. */
  readonly line: SerialLine | null;
  readonly isIgnored: boolean;
  readonly lastSeenAt: Date | null;
};

/** A port to save: new when it has no id. */
export type NewSerialPort = Omit<StoredSerialPort, 'id'> & { readonly id?: string | undefined };

/** A device of the house whose config names a port: its instance, as the registry has it. */
export type SerialInstance = {
  readonly id: string;

  /** Its driver, `vendor/driver`. */
  readonly kind: string;

  /** The device's name; its driver's while the device has no row. */
  readonly name: string;
  readonly areaId: string | null;

  /** How its instance stands: `running`, `failed`… */
  readonly state: string;

  /** Its config's `serial` block. */
  readonly config: SerialDeviceConfig;
};

/** What the broker keeps. */
export type SerialStore = {
  settings: () => Promise<SerialSettings>;
  saveSettings: (settings: SerialSettings) => Promise<void>;
  ports: () => Promise<StoredSerialPort[]>;

  /**
   * Saves a port whole, new when it has no id.
   *
   * @throws {Error} When it is not there to change, or another port has its path.
   */
  savePort: (port: NewSerialPort) => Promise<StoredSerialPort>;
  removePort: (id: string) => Promise<boolean>;
};

const settings = schema.registry.serialSettings;
const ports = schema.registry.serialPorts;

/**
 * Reads a port row; what the contract no longer takes reads as missing, not as a failure.
 *
 * @param row - The row.
 * @returns The port.
 */
function portOf(row: typeof ports.$inferSelect): StoredSerialPort {
  const usb = serialUsbSchema.safeParse(row.usb);
  const network = serialNetworkAddressSchema.safeParse(row.network);
  const line = serialLineSchema.safeParse(row.line);

  return {
    id: row.id,
    stablePath: row.stablePath,
    kind: (SERIAL_PORT_KINDS as readonly string[]).includes(row.kind)
      ? (row.kind as SerialPortKind)
      : 'builtin',
    name: row.name,
    usb: usb.success ? usb.data : null,
    network: network.success ? network.data : null,
    holderIntegrationId: row.holderIntegrationId,
    holderBroker: (SERIAL_BROKER_HOLDERS as readonly (string | null)[]).includes(row.holderBroker)
      ? (row.holderBroker as SerialBrokerHolder)
      : null,
    line: line.success ? line.data : null,
    isIgnored: row.isIgnored,
    lastSeenAt: row.lastSeenAt,
  };
}

/** The broker's tables in the registry. */
class DatabaseSerialStore implements SerialStore {
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
   * @returns Them; the defaults when the row is missing.
   */
  async settings(): Promise<SerialSettings> {
    const [row] = await this.#db.select().from(settings).where(eq(settings.id, 1));

    return serialSettingsSchema.parse({ showBuiltin: row?.showBuiltin ?? false });
  }

  /**
   * Saves the settings.
   *
   * @param next - The settings.
   * @returns Once saved.
   */
  async saveSettings(next: SerialSettings): Promise<void> {
    await this.#db
      .insert(settings)
      .values({ id: 1, showBuiltin: next.showBuiltin })
      .onConflictDoUpdate({ target: settings.id, set: { showBuiltin: next.showBuiltin } });
  }

  /**
   * Reads every port.
   *
   * @returns The ports.
   */
  async ports(): Promise<StoredSerialPort[]> {
    return (await this.#db.select().from(ports)).map(portOf);
  }

  /**
   * Saves a port whole.
   *
   * @param port - The port.
   * @returns It, saved.
   * @throws {Error} When the port to change is not there.
   */
  async savePort(port: NewSerialPort): Promise<StoredSerialPort> {
    const values = {
      stablePath: port.stablePath,
      kind: port.kind,
      name: port.name,
      usb: port.usb,
      network: port.network,
      holderIntegrationId: port.holderIntegrationId,
      holderBroker: port.holderBroker,
      line: port.line,
      isIgnored: port.isIgnored,
      lastSeenAt: port.lastSeenAt,
    };
    const [row] =
      port.id === undefined
        ? await this.#db.insert(ports).values(values).returning()
        : await this.#db.update(ports).set(values).where(eq(ports.id, port.id)).returning();

    if (row === undefined) {
      throw new Error(`There is no serial port ${port.id ?? ''}`);
    }

    return portOf(row);
  }

  /**
   * Removes a port.
   *
   * @param id - Its row.
   * @returns Whether there was one.
   */
  async removePort(id: string): Promise<boolean> {
    const removed = await this.#db
      .delete(ports)
      .where(eq(ports.id, id))
      .returning({ id: ports.id });

    return removed.length > 0;
  }
}

/**
 * The broker's tables in the registry.
 *
 * @param db - A connected database handle.
 * @returns The store.
 */
export function databaseSerialStore(db: Database): SerialStore {
  return new DatabaseSerialStore(db);
}

/**
 * Reads the devices of the house whose config names a port: every instance whose transport
 * config has a `serial` block the contract takes.
 *
 * @param db - A connected database handle.
 * @returns Them, oldest first.
 */
export async function loadSerialInstances(db: Database): Promise<SerialInstance[]> {
  const { integrations, devices } = schema.registry;
  const rows = await db
    .select({
      id: integrations.id,
      kind: integrations.kind,
      state: integrations.state,
      transportConfig: integrations.transportConfig,
      name: devices.name,
      areaId: devices.areaId,
    })
    .from(integrations)
    .leftJoin(devices, eq(devices.integrationId, integrations.id))
    .orderBy(integrations.createdAt);

  return rows.flatMap((row) => {
    const config = serialDeviceConfigSchema.safeParse(
      (row.transportConfig as JsonObject | null)?.['serial'],
    );

    return config.success
      ? [
          {
            id: row.id,
            kind: row.kind,
            name: row.name ?? row.kind,
            areaId: row.areaId,
            state: row.state,
            config: config.data,
          },
        ]
      : [];
  });
}

/** The broker's tables in memory, for tests. */
class MemorySerialStore implements SerialStore {
  #saved: SerialSettings = serialSettingsSchema.parse({});
  readonly #rows = new Map<string, StoredSerialPort>();

  /**
   * Reads the settings.
   *
   * @returns Them.
   */
  settings(): Promise<SerialSettings> {
    return Promise.resolve(this.#saved);
  }

  /**
   * Saves the settings.
   *
   * @param next - The settings.
   * @returns Once saved.
   */
  saveSettings(next: SerialSettings): Promise<void> {
    this.#saved = next;

    return Promise.resolve();
  }

  /**
   * Reads every port.
   *
   * @returns The ports.
   */
  ports(): Promise<StoredSerialPort[]> {
    return Promise.resolve([...this.#rows.values()]);
  }

  /**
   * Saves a port whole.
   *
   * @param port - The port.
   * @returns It, saved.
   */
  savePort(port: NewSerialPort): Promise<StoredSerialPort> {
    const id = port.id ?? randomUUID();

    if (
      [...this.#rows.values()].some((row) => row.id !== id && row.stablePath === port.stablePath)
    ) {
      return Promise.reject(new Error(`A port is already at ${port.stablePath}`));
    }

    const row: StoredSerialPort = { ...port, id };

    this.#rows.set(id, row);

    return Promise.resolve(row);
  }

  /**
   * Removes a port.
   *
   * @param id - Its row.
   * @returns Whether there was one.
   */
  removePort(id: string): Promise<boolean> {
    return Promise.resolve(this.#rows.delete(id));
  }
}

/**
 * The broker's tables in memory, for tests.
 *
 * @returns The store.
 */
export function memorySerialStore(): SerialStore {
  return new MemorySerialStore();
}
