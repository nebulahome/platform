/**
 * The Bluetooth adapters of the machine the hub runs on, as the host's BlueZ shows them over the
 * system D-Bus.
 *
 * BlueZ keeps one object per adapter (`org.bluez.Adapter1`, `/org/bluez/hci0`) and one per device
 * it heard (`org.bluez.Device1`, `/org/bluez/hci0/dev_AA_BB_…`), and says what changes through the
 * ObjectManager's `InterfacesAdded` and each object's `PropertiesChanged`. An advertisement is a
 * device object's properties as they stand when one of them changes: its signal, its manufacturer
 * and service data, its name. Active scanning is BlueZ's discovery, filtered to LE with every
 * duplicate reported; passive scanning registers an advertisement monitor, where BlueZ offers one.
 *
 * GATT is read, written and followed on the local adapter only: a device is connected for the
 * request, kept while notifications are on, and let go of when idle.
 *
 * Linux only, behind {@link BluetoothHost} so the broker's tests run on a fake. In a container the
 * host's bus is reached through `/run/dbus` mounted in; without it, or without BlueZ answering on
 * it, the host has no adapter and says which.
 */
import { access } from 'node:fs/promises';
import { createRequire } from 'node:module';

import {
  bluetoothAdvertSchema,
  type BluetoothAdvert,
  type BluetoothScanMode,
} from '@nebulahome/contracts';

/** An adapter BlueZ has. */
export type SeenBluetoothAdapter = {
  /** `hci0`. */
  readonly id: string;

  /** What BlueZ calls it: the alias the host gave it, usually its hostname. */
  readonly name: string | null;
  readonly address: string | null;
  readonly isPowered: boolean;

  /** The chip's maker and ids, from its modalias; null when BlueZ does not say. */
  readonly chip: string | null;

  /** Whether BlueZ can monitor advertisements on it without scanning actively. */
  readonly canPassive: boolean;
};

/** What the host sees: its adapters, or why it cannot see any. */
export type BluetoothAdapters = {
  readonly adapters: readonly SeenBluetoothAdapter[];

  /** No system bus in reach, or BlueZ not answering on it; null when BlueZ answered. */
  readonly problem: 'no-dbus' | 'no-bluez' | null;

  /** What D-Bus said, when it refused. */
  readonly error: string | null;
};

/** A scan running on one adapter. */
export type BluetoothHostScan = {
  /** How it listens: passive only where the adapter can, active otherwise. */
  readonly mode: BluetoothScanMode;
  readonly stop: () => Promise<void>;
};

/** The adapters of the machine. */
export type BluetoothHost = {
  /** Reads the adapters. Never throws: a machine without BlueZ has none, and says why. */
  adapters: () => Promise<BluetoothAdapters>;

  /**
   * Hears adapters come, go and power on or off, and the bus being lost.
   *
   * @returns Stops hearing.
   */
  watch: (onChange: () => void) => () => void;

  /**
   * Starts listening on an adapter: every advertisement it hears goes to `onAdvert`. A scan
   * started again on the same adapter replaces the first.
   *
   * @throws {Error} When BlueZ refuses: the adapter gone or off.
   */
  scan: (
    adapterId: string,
    mode: BluetoothScanMode,
    onAdvert: (advert: BluetoothAdvert) => void,
  ) => Promise<BluetoothHostScan>;

  /**
   * Reads a characteristic, connecting to the device first.
   *
   * @returns Its value, in hex.
   * @throws {Error} When the device cannot be connected to, or has no such characteristic.
   */
  read: (
    adapterId: string,
    address: string,
    service: string,
    characteristic: string,
  ) => Promise<string>;

  /**
   * Writes a characteristic, connecting to the device first.
   *
   * @throws {Error} When the device cannot be connected to, or refuses.
   */
  write: (
    adapterId: string,
    address: string,
    service: string,
    characteristic: string,
    data: string,
    withResponse: boolean,
  ) => Promise<void>;

  /**
   * Follows a characteristic's notifications, or stops when `listener` is null.
   *
   * @throws {Error} When the device cannot be connected to, or has no such characteristic.
   */
  notify: (
    adapterId: string,
    address: string,
    service: string,
    characteristic: string,
    listener: ((data: string) => void) | null,
  ) => Promise<void>;

  /** The addresses connected on an adapter now. */
  connected: (adapterId: string) => readonly string[];

  /** Stops every scan, lets go of every device and of the bus. */
  close: () => Promise<void>;
};

/**
 * How many LE connections an adapter is counted as holding.
 *
 * shortcut: BlueZ does not say how many its controller takes; most hold 5 to 7 LE links, so 5 is
 * the safe count - read the controller's own limit through the management socket if it matters.
 */
export const MAXIMUM_CONNECTIONS = 5;

/** A 128-bit UUID on the Bluetooth base: the 16- or 32-bit one it stands for. */
const BASE_UUID = /^([0-9a-f]{8})-0000-1000-8000-00805f9b34fb$/iu;

/**
 * A UUID as the house keys it: one on the Bluetooth base shortened to 16 bits (`fcd2`) or 32,
 * every one lower case.
 *
 * @param uuid - As BlueZ or a proxy wrote it.
 * @returns It, shortened where it can be.
 */
export function shortUuid(uuid: string): string {
  const lower = uuid.toLowerCase();
  const base = BASE_UUID.exec(lower)?.[1];

  if (base === undefined) {
    return lower;
  }

  return base.startsWith('0000') ? base.slice(4) : base;
}

/**
 * Bytes BlueZ handed over, in hex: a buffer, or a variant around one.
 *
 * @param value - The value.
 * @returns The hex, or null when it holds no bytes.
 */
function hexOf(value: unknown): string | null {
  const inner =
    value !== null && typeof value === 'object' && 'value' in value
      ? (value as { readonly value: unknown }).value
      : value;

  return inner instanceof Uint8Array ? Buffer.from(inner).toString('hex').slice(0, 510) : null;
}

/**
 * The entries of a dictionary property, its values in hex.
 *
 * @param value - `ManufacturerData` or `ServiceData`, as BlueZ hands it over.
 * @param keyOf - What each key becomes.
 * @returns The entries that hold bytes.
 */
function bytesByKey(value: unknown, keyOf: (key: string) => string): Record<string, string> {
  if (value === null || typeof value !== 'object') {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, each]) => {
      const hex = hexOf(each);

      return hex === null ? [] : [[keyOf(key), hex]];
    }),
  );
}

/**
 * The advertisement a device object's properties stand for now.
 *
 * @param props - Its `Device1` properties, unwrapped one level: `ManufacturerData` and
 * `ServiceData` still hold BlueZ's variants.
 * @param at - When it was heard.
 * @returns The advertisement, or null while BlueZ has no signal for it (a device it remembers).
 */
export function advertOf(
  props: Readonly<Record<string, unknown>>,
  at: Date,
): BluetoothAdvert | null {
  const { RSSI: rssi, Address: address, Name: name, UUIDs: uuids } = props;

  if (typeof rssi !== 'number' || typeof address !== 'string') {
    return null;
  }

  const parsed = bluetoothAdvertSchema.safeParse({
    address,
    addressType: props['AddressType'] === 'random' ? 'random' : 'public',
    rssi: Math.max(-127, Math.min(20, Math.round(rssi))),
    ...(typeof name === 'string' && name.length > 0 ? { name: name.slice(0, 248) } : {}),
    // Company ids come as numbers; the house keys them in decimal.
    manufacturerData: bytesByKey(props['ManufacturerData'], (key) => String(Number(key))),
    serviceData: bytesByKey(props['ServiceData'], shortUuid),
    serviceUuids: Array.isArray(uuids)
      ? uuids
          .filter((uuid): uuid is string => typeof uuid === 'string')
          .map(shortUuid)
          .slice(0, 64)
      : [],
    at,
  });

  return parsed.success ? parsed.data : null;
}

/** The USB vendors of the Bluetooth chips most servers carry, by their four hex digits. */
const CHIP_MAKERS: Readonly<Record<string, string>> = {
  '8087': 'Intel',
  '0bda': 'Realtek',
  '0a5c': 'Broadcom',
  '0a12': 'Cambridge Silicon Radio',
  '0cf3': 'Qualcomm Atheros',
  '13d3': 'IMC Networks',
  '04ca': 'Lite-On',
  '2357': 'TP-Link',
  '0b05': 'ASUS',
};

/**
 * The chip an adapter's modalias names: `usb:v8087p0029d0001` is an Intel, product 0029.
 *
 * shortcut: the maker only, from a handful of USB vendors, and the product id raw; read the USB
 * ids database if the page should name the model.
 *
 * @param modalias - `Modalias`, as BlueZ gives it.
 * @returns The chip, or null when BlueZ gives none.
 */
export function chipOf(modalias: unknown): string | null {
  const match = typeof modalias === 'string' ? /^usb:v(\w{4})p(\w{4})/iu.exec(modalias) : null;

  if (match === null) {
    return null;
  }

  const vendor = (match[1] ?? '').toLowerCase();
  const product = (match[2] ?? '').toLowerCase();

  return `${CHIP_MAKERS[vendor] ?? `USB ${vendor}`} (${vendor}:${product})`;
}

/** BlueZ's name on the bus, and the interfaces read here. */
const BLUEZ = 'org.bluez';
const ADAPTER = 'org.bluez.Adapter1';
const DEVICE = 'org.bluez.Device1';
const MONITOR_MANAGER = 'org.bluez.AdvertisementMonitorManager1';
const MONITOR = 'org.bluez.AdvertisementMonitor1';
const GATT_SERVICE = 'org.bluez.GattService1';
const GATT_CHARACTERISTIC = 'org.bluez.GattCharacteristic1';
const PROPERTIES = 'org.freedesktop.DBus.Properties';
const OBJECT_MANAGER = 'org.freedesktop.DBus.ObjectManager';

/** Where the hub's advertisement monitor lives on the bus, and the one monitor under it. */
const MONITOR_ROOT = '/org/nebulahome/bluetooth';
const MONITOR_PATH = `${MONITOR_ROOT}/monitor0`;

/** D-Bus message types, as the protocol numbers them. */
const METHOD_CALL = 1;
const SIGNAL = 4;

/** How long the bus may take to say hello, a device to connect and its services to resolve. */
const CONNECT_MS = 5000;
const DEVICE_CONNECT_MS = 30_000;
const SERVICES_MS = 15_000;

/** How long a device connected for a read or a write is kept with nothing following it. */
const IDLE_MS = 30_000;

/** The part of `@jellybrick/dbus-next` used here. */
type DbusMessage = {
  readonly type: number;
  readonly path: string;
  readonly interface: string;
  readonly member: string;
  readonly body: unknown[];
};

/** The bus, as `@jellybrick/dbus-next` connects to it. */
type DbusBus = {
  call: (message: unknown) => Promise<DbusMessage | null>;
  send: (message: unknown) => void;
  on: (event: string, listener: (...args: never[]) => void) => void;
  addMethodHandler: (handler: (message: DbusMessage) => boolean) => void;
  disconnect: () => void;
};

/** The module. */
type DbusNext = {
  systemBus: () => DbusBus;
  Message: (new (fields: object) => unknown) & {
    newMethodReturn: (call: DbusMessage, signature?: string, body?: unknown[]) => unknown;
  };
  Variant: new (signature: string, value: unknown) => unknown;
};

/** Every object BlueZ has, by path, then by interface, its properties unwrapped one level. */
type ManagedObjects = Map<string, Map<string, Record<string, unknown>>>;

/**
 * A dictionary of variants, each unwrapped.
 *
 * @param props - `a{sv}`, as the bus hands it over.
 * @returns The values.
 */
function plain(props: unknown): Record<string, unknown> {
  if (props === null || typeof props !== 'object') {
    return {};
  }

  return Object.fromEntries(
    Object.entries(props).map(([key, value]) => [
      key,
      value !== null && typeof value === 'object' && 'value' in value
        ? (value as { readonly value: unknown }).value
        : value,
    ]),
  );
}

/**
 * A failure in a sentence.
 *
 * @param error - Whatever was thrown.
 * @returns Its message.
 */
function messageOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 512);
}

/**
 * Settles, or fails once it took too long.
 *
 * @param promise - What is waited for.
 * @param ms - How long.
 * @param what - What took too long, for the message.
 * @returns What it settled with.
 */
async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${what} took longer than ${String(ms / 1000)} s`));
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** The system bus's socket, as the compose file mounts the host's `/run/dbus` in. */
const BUS_SOCKET = '/run/dbus/system_bus_socket';

/** A scan on one adapter, as the BlueZ host keeps it. */
type Scanning = {
  readonly mode: BluetoothScanMode;
  readonly onAdvert: (advert: BluetoothAdvert) => void;
};

/** The host's adapters, through BlueZ on the system bus. */
class BluezHost implements BluetoothHost {
  #dbus: DbusNext | undefined;
  #bus: Promise<DbusBus> | undefined;

  /** Every device object, by path: its `Device1` properties as they stand. */
  readonly #devices = new Map<string, Record<string, unknown>>();
  readonly #scans = new Map<string, Scanning>();
  readonly #watchers = new Set<() => void>();

  /** The listener of each characteristic followed, by its path. */
  readonly #notifications = new Map<string, (data: string) => void>();
  readonly #idle = new Map<string, NodeJS.Timeout>();

  /**
   * Reads the adapters.
   *
   * @returns Them, or why there are none.
   */
  async adapters(): Promise<BluetoothAdapters> {
    let bus: DbusBus;

    try {
      bus = await this.#connect();
    } catch (error: unknown) {
      return { adapters: [], problem: 'no-dbus', error: messageOf(error) };
    }

    try {
      const objects = await this.#objects(bus);

      return {
        adapters: [...objects.entries()].flatMap(([path, interfaces]) => {
          const adapter = interfaces.get(ADAPTER);

          if (adapter === undefined) {
            return [];
          }

          const types = interfaces.get(MONITOR_MANAGER)?.['SupportedMonitorTypes'];
          const name = adapter['Alias'] ?? adapter['Name'];

          return [
            {
              id: path.split('/').at(-1) ?? path,
              name: typeof name === 'string' ? name.slice(0, 128) : null,
              address: typeof adapter['Address'] === 'string' ? adapter['Address'] : null,
              isPowered: adapter['Powered'] === true,
              chip: chipOf(adapter['Modalias']),
              canPassive: Array.isArray(types) && types.includes('or_patterns'),
            },
          ];
        }),
        problem: null,
        error: null,
      };
    } catch (error: unknown) {
      // Not running on the host, or the policy does not let the hub talk to it.
      return { adapters: [], problem: 'no-bluez', error: messageOf(error) };
    }
  }

  /**
   * Hears adapters change.
   *
   * @param onChange - Called on each change.
   * @returns Stops hearing.
   */
  watch(onChange: () => void): () => void {
    this.#watchers.add(onChange);

    return () => this.#watchers.delete(onChange);
  }

  /**
   * Starts listening on an adapter.
   *
   * @param adapterId - `hci0`.
   * @param mode - How: passive where the adapter can, else active.
   * @param onAdvert - Called with each advertisement heard.
   * @returns The scan.
   */
  async scan(
    adapterId: string,
    mode: BluetoothScanMode,
    onAdvert: (advert: BluetoothAdvert) => void,
  ): Promise<BluetoothHostScan> {
    const bus = await this.#connect();
    const dbus = this.#module();
    const path = `/org/bluez/${adapterId}`;
    const canPassive = (await this.adapters()).adapters.some(
      (adapter) => adapter.id === adapterId && adapter.canPassive,
    );
    const used: BluetoothScanMode = mode === 'passive' && canPassive ? 'passive' : 'active';

    await this.#stopScan(adapterId);
    this.#scans.set(adapterId, { mode: used, onAdvert });

    try {
      if (used === 'passive') {
        await this.#call(bus, path, MONITOR_MANAGER, 'RegisterMonitor', 'o', [MONITOR_ROOT]);
      } else {
        // Every advertisement, not only the first of each device: a sensor's readings change.
        await this.#call(bus, path, ADAPTER, 'SetDiscoveryFilter', 'a{sv}', [
          { Transport: new dbus.Variant('s', 'le'), DuplicateData: new dbus.Variant('b', true) },
        ]);
        await this.#call(bus, path, ADAPTER, 'StartDiscovery').catch((error: unknown) => {
          // Already discovering for this connection: what was asked holds.
          if (!messageOf(error).includes('InProgress')) {
            throw error;
          }
        });
      }
    } catch (error: unknown) {
      this.#scans.delete(adapterId);
      throw error;
    }

    return {
      mode: used,

      /**
       * Stops the scan.
       *
       * @returns Once stopped.
       */
      stop: async () => this.#stopScan(adapterId),
    };
  }

  /**
   * Reads a characteristic.
   *
   * @param adapterId - The adapter.
   * @param address - The device.
   * @param service - Its service.
   * @param characteristic - The characteristic.
   * @returns The value, in hex.
   */
  async read(
    adapterId: string,
    address: string,
    service: string,
    characteristic: string,
  ): Promise<string> {
    const bus = await this.#connect();
    const device = await this.#connectDevice(bus, adapterId, address);
    const path = await this.#characteristic(bus, device, service, characteristic);
    const [value] = await this.#call(bus, path, GATT_CHARACTERISTIC, 'ReadValue', 'a{sv}', [{}]);

    this.#idleLater(bus, device);

    return hexOf(value) ?? '';
  }

  /**
   * Writes a characteristic.
   *
   * @param adapterId - The adapter.
   * @param address - The device.
   * @param service - Its service.
   * @param characteristic - The characteristic.
   * @param data - The bytes, in hex.
   * @param withResponse - Whether the device acknowledges it.
   * @returns Once written.
   */
  async write(
    adapterId: string,
    address: string,
    service: string,
    characteristic: string,
    data: string,
    withResponse: boolean,
  ): Promise<void> {
    const bus = await this.#connect();
    const dbus = this.#module();
    const device = await this.#connectDevice(bus, adapterId, address);
    const path = await this.#characteristic(bus, device, service, characteristic);

    await this.#call(bus, path, GATT_CHARACTERISTIC, 'WriteValue', 'aya{sv}', [
      Buffer.from(data, 'hex'),
      { type: new dbus.Variant('s', withResponse ? 'request' : 'command') },
    ]);
    this.#idleLater(bus, device);
  }

  /**
   * Follows a characteristic, or stops.
   *
   * @param adapterId - The adapter.
   * @param address - The device.
   * @param service - Its service.
   * @param characteristic - The characteristic.
   * @param listener - Called with each value; null stops.
   * @returns Once BlueZ took it.
   */
  async notify(
    adapterId: string,
    address: string,
    service: string,
    characteristic: string,
    listener: ((data: string) => void) | null,
  ): Promise<void> {
    const bus = await this.#connect();
    const device = await this.#connectDevice(bus, adapterId, address);
    const path = await this.#characteristic(bus, device, service, characteristic);

    if (listener === null) {
      this.#notifications.delete(path);
      await this.#call(bus, path, GATT_CHARACTERISTIC, 'StopNotify').catch(() => undefined);
      this.#idleLater(bus, device);

      return;
    }

    this.#notifications.set(path, listener);
    clearTimeout(this.#idle.get(device));
    await this.#call(bus, path, GATT_CHARACTERISTIC, 'StartNotify');
  }

  /**
   * The addresses connected on an adapter.
   *
   * @param adapterId - The adapter.
   * @returns Them.
   */
  connected(adapterId: string): readonly string[] {
    return [...this.#devices.entries()]
      .filter(
        ([path, props]) =>
          path.startsWith(`/org/bluez/${adapterId}/`) && props['Connected'] === true,
      )
      .flatMap(([, props]) => (typeof props['Address'] === 'string' ? [props['Address']] : []));
  }

  /**
   * Stops everything and lets go of the bus.
   *
   * @returns Once let go of.
   */
  async close(): Promise<void> {
    await Promise.all([...this.#scans.keys()].map(async (id) => this.#stopScan(id)));

    for (const timer of this.#idle.values()) {
      clearTimeout(timer);
    }

    const bus = await this.#bus?.catch(() => undefined);

    this.#bus = undefined;
    bus?.disconnect();
  }

  /**
   * The module, loaded the first time it is needed.
   *
   * @returns It.
   */
  #module(): DbusNext {
    // CommonJS, and its types declare another module's name: required, and typed here.
    this.#dbus ??= createRequire(import.meta.url)('@jellybrick/dbus-next') as DbusNext;

    return this.#dbus;
  }

  /**
   * Connects to the system bus once, follows BlueZ's signals and answers for the monitor.
   *
   * @returns The bus.
   */
  async #connect(): Promise<DbusBus> {
    this.#bus ??= this.#open().catch((error: unknown) => {
      this.#bus = undefined;
      throw error;
    });

    return this.#bus;
  }

  /**
   * Opens the bus.
   *
   * @returns It, said hello to.
   */
  async #open(): Promise<DbusBus> {
    await access(BUS_SOCKET).catch(() => {
      throw new Error(`There is no system bus at ${BUS_SOCKET}`);
    });

    const bus = this.#module().systemBus();

    await within(
      new Promise<void>((resolve, reject) => {
        bus.on('connect', () => {
          resolve();
        });
        bus.on('error', (error: unknown) => {
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      }),
      CONNECT_MS,
      'Connecting to the system bus',
    );
    bus.on('error', () => {
      this.#lost();
    });
    bus.on('message', (message: DbusMessage) => {
      this.#onSignal(message);
    });
    bus.addMethodHandler((message) => this.#onMonitorCall(bus, message));

    for (const rule of [
      `type='signal',sender='${BLUEZ}',interface='${OBJECT_MANAGER}'`,
      `type='signal',sender='${BLUEZ}',interface='${PROPERTIES}',member='PropertiesChanged'`,
    ]) {
      // eslint-disable-next-line no-await-in-loop -- two, once
      await this.#call(bus, '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'AddMatch', 's', [
        rule,
      ]).then(undefined, () => undefined);
    }

    // What BlueZ already knows: devices remembered, heard again only through property changes.
    for (const [path, interfaces] of await this.#objects(bus).catch(
      (): ManagedObjects => new Map(),
    )) {
      const device = interfaces.get(DEVICE);

      if (device !== undefined) {
        this.#devices.set(path, device);
      }
    }

    return bus;
  }

  /** Forgets the bus that was lost: the broker's next look connects again and scans again. */
  #lost(): void {
    this.#bus = undefined;
    this.#scans.clear();
    this.#notifications.clear();
    this.#changed();
  }

  /** Tells the watchers something about the adapters changed. */
  #changed(): void {
    for (const watcher of this.#watchers) {
      watcher();
    }
  }

  /**
   * Calls a method of BlueZ's, or of the bus.
   *
   * @param bus - The bus.
   * @param path - The object.
   * @param iface - The interface.
   * @param member - The method.
   * @param signature - Its arguments' signature.
   * @param body - Its arguments.
   * @returns What it answered.
   */
  async #call(
    bus: DbusBus,
    path: string,
    iface: string,
    member: string,
    signature?: string,
    body?: unknown[],
  ): Promise<unknown[]> {
    const dbus = this.#module();
    const reply = await bus.call(
      new dbus.Message({
        destination: path.startsWith('/org/freedesktop/') ? 'org.freedesktop.DBus' : BLUEZ,
        path,
        interface: iface,
        member,
        ...(signature === undefined ? {} : { signature, body }),
      }),
    );

    return reply?.body ?? [];
  }

  /**
   * Reads every object BlueZ has.
   *
   * @param bus - The bus.
   * @returns Them.
   */
  async #objects(bus: DbusBus): Promise<ManagedObjects> {
    const [objects] = await this.#call(bus, '/', OBJECT_MANAGER, 'GetManagedObjects');
    const managed: ManagedObjects = new Map();

    for (const [path, interfaces] of Object.entries((objects ?? {}) as Record<string, unknown>)) {
      managed.set(
        path,
        new Map(
          Object.entries((interfaces ?? {}) as Record<string, unknown>).map(([name, props]) => [
            name,
            plain(props),
          ]),
        ),
      );
    }

    return managed;
  }

  /**
   * Follows what BlueZ says changed: devices heard, adapters, notifications.
   *
   * @param message - A message the bus delivered.
   */
  #onSignal(message: DbusMessage): void {
    if (message.type !== SIGNAL) {
      return;
    }

    if (message.interface === OBJECT_MANAGER) {
      const [path, second] = message.body as [string, unknown];

      if (message.member === 'InterfacesAdded') {
        const interfaces = (second ?? {}) as Record<string, unknown>;

        if (interfaces[DEVICE] !== undefined) {
          this.#devices.set(path, plain(interfaces[DEVICE]));
          this.#heard(path);
        }

        if (interfaces[ADAPTER] !== undefined) {
          this.#changed();
        }
      } else if (message.member === 'InterfacesRemoved') {
        const names = Array.isArray(second) ? (second as unknown[]) : [];

        if (names.includes(DEVICE)) {
          this.#devices.delete(path);
        }

        if (names.includes(ADAPTER)) {
          this.#changed();
        }
      }

      return;
    }

    if (message.interface !== PROPERTIES || message.member !== 'PropertiesChanged') {
      return;
    }

    const [iface, changed, invalidated] = message.body as [string, unknown, unknown];
    const values = plain(changed);

    if (iface === DEVICE) {
      const props = { ...this.#devices.get(message.path), ...values };

      for (const name of Array.isArray(invalidated) ? (invalidated as string[]) : []) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- a property BlueZ dropped
        delete props[name];
      }

      this.#devices.set(message.path, props);

      if (['RSSI', 'ManufacturerData', 'ServiceData', 'Name'].some((name) => name in values)) {
        this.#heard(message.path);
      }
    } else if (iface === ADAPTER && 'Powered' in values) {
      this.#changed();
    } else if (iface === GATT_CHARACTERISTIC && 'Value' in values) {
      const hex = hexOf(values['Value']);

      if (hex !== null) {
        this.#notifications.get(message.path)?.(hex);
      }
    }
  }

  /**
   * Hands a device's advertisement to the scan of its adapter.
   *
   * @param path - The device's object.
   */
  #heard(path: string): void {
    const scanning = this.#scans.get(path.split('/')[3] ?? '');
    const props = this.#devices.get(path);
    const advert = props === undefined ? null : advertOf(props, new Date());

    if (scanning !== undefined && advert !== null) {
      scanning.onAdvert(advert);
    }
  }

  /**
   * Answers BlueZ about the hub's advertisement monitor: its objects, its properties, and the
   * calls it makes on it. Patterns on the advertising flags every advertisement carries match
   * every device, the way similar open-source implementations scan passively.
   *
   * @param bus - The bus.
   * @param message - A method call.
   * @returns Whether it was the monitor's.
   */
  #onMonitorCall(bus: DbusBus, message: DbusMessage): boolean {
    if (message.type !== METHOD_CALL || !message.path.startsWith(MONITOR_ROOT)) {
      return false;
    }

    const dbus = this.#module();
    const monitor = {
      Type: new dbus.Variant('s', 'or_patterns'),
      Patterns: new dbus.Variant('a(yyay)', [
        [0, 0x01, Buffer.from([0x06])],
        [0, 0x01, Buffer.from([0x1a])],
        [0, 0x01, Buffer.from([0x02])],
      ]),
    };

    if (message.interface === OBJECT_MANAGER && message.member === 'GetManagedObjects') {
      bus.send(
        dbus.Message.newMethodReturn(message, 'a{oa{sa{sv}}}', [
          { [MONITOR_PATH]: { [MONITOR]: monitor } },
        ]),
      );
    } else if (message.interface === PROPERTIES && message.member === 'GetAll') {
      bus.send(dbus.Message.newMethodReturn(message, 'a{sv}', [monitor]));
    } else if (message.interface === PROPERTIES && message.member === 'Get') {
      const name = message.body[1] === 'Patterns' ? 'Patterns' : 'Type';

      bus.send(dbus.Message.newMethodReturn(message, 'v', [monitor[name]]));
    } else {
      // Release, Activate, DeviceFound, DeviceLost: what is heard comes through the devices.
      bus.send(dbus.Message.newMethodReturn(message));
    }

    return true;
  }

  /**
   * Stops the scan on an adapter.
   *
   * @param adapterId - The adapter.
   * @returns Once stopped; a failure means it had stopped already.
   */
  async #stopScan(adapterId: string): Promise<void> {
    const scanning = this.#scans.get(adapterId);
    const bus = await this.#bus?.catch(() => undefined);

    this.#scans.delete(adapterId);

    if (scanning === undefined || bus === undefined) {
      return;
    }

    const path = `/org/bluez/${adapterId}`;

    await (
      scanning.mode === 'passive'
        ? this.#call(bus, path, MONITOR_MANAGER, 'UnregisterMonitor', 'o', [MONITOR_ROOT])
        : this.#call(bus, path, ADAPTER, 'StopDiscovery')
    ).catch(() => undefined);
  }

  /**
   * Connects to a device, unless it is connected with its services read.
   *
   * @param bus - The bus.
   * @param adapterId - The adapter.
   * @param address - The device.
   * @returns Its object.
   * @throws {Error} When every slot is in use, or it does not connect.
   */
  async #connectDevice(bus: DbusBus, adapterId: string, address: string): Promise<string> {
    const path = `/org/bluez/${adapterId}/dev_${address.toUpperCase().replaceAll(':', '_')}`;

    /**
     * Whether the device is connected with its services read.
     *
     * @returns True once it is.
     */
    const isReady = (): boolean =>
      this.#devices.get(path)?.['Connected'] === true &&
      this.#devices.get(path)?.['ServicesResolved'] === true;

    if (isReady()) {
      return path;
    }

    if (this.connected(adapterId).length >= MAXIMUM_CONNECTIONS) {
      throw new Error('Every connection the adapter holds is in use');
    }

    await within(this.#call(bus, path, DEVICE, 'Connect'), DEVICE_CONNECT_MS, 'Connecting');

    const deadline = Date.now() + SERVICES_MS;

    // Polled: the services resolve a moment after the connection, said by a property change.
    while (!isReady()) {
      if (Date.now() > deadline) {
        throw new Error(`${address} connected but did not list its services`);
      }

      // eslint-disable-next-line no-await-in-loop -- see above
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return path;
  }

  /**
   * Finds a characteristic of a connected device.
   *
   * @param bus - The bus.
   * @param device - The device's object.
   * @param service - The service's UUID, as the house keys it.
   * @param characteristic - The characteristic's.
   * @returns Its object.
   * @throws {Error} When the device has no such characteristic.
   */
  async #characteristic(
    bus: DbusBus,
    device: string,
    service: string,
    characteristic: string,
  ): Promise<string> {
    const objects = [...(await this.#objects(bus)).entries()];

    /**
     * The object under another of an interface with a UUID.
     *
     * @param under - The object it is under.
     * @param iface - The interface.
     * @param uuid - The UUID.
     * @returns Its path, or undefined.
     */
    const find = (under: string, iface: string, uuid: string): string | undefined =>
      objects.find(([path, interfaces]) => {
        const found = interfaces.get(iface)?.['UUID'];

        return (
          path.startsWith(`${under}/`) &&
          typeof found === 'string' &&
          shortUuid(found) === shortUuid(uuid)
        );
      })?.[0];
    const servicePath = find(device, GATT_SERVICE, service);
    const path =
      servicePath === undefined
        ? undefined
        : find(servicePath, GATT_CHARACTERISTIC, characteristic);

    if (path === undefined) {
      throw new Error(`The device has no characteristic ${characteristic} in service ${service}`);
    }

    return path;
  }

  /**
   * Lets go of a device a while after its last read or write, unless something is followed on it.
   *
   * @param bus - The bus.
   * @param device - The device's object.
   */
  #idleLater(bus: DbusBus, device: string): void {
    clearTimeout(this.#idle.get(device));

    if ([...this.#notifications.keys()].some((path) => path.startsWith(`${device}/`))) {
      return;
    }

    const timer = setTimeout(() => {
      this.#idle.delete(device);
      void this.#call(bus, device, DEVICE, 'Disconnect').catch(() => undefined);
    }, IDLE_MS);

    timer.unref();
    this.#idle.set(device, timer);
  }
}

/**
 * The host's adapters, through BlueZ on the system bus.
 *
 * @returns The host.
 */
export function createBluezHost(): BluetoothHost {
  return new BluezHost();
}
