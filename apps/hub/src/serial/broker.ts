/**
 * The house's Serial broker: the serial ports the server sees and the owner added on the network,
 * and who holds each one.
 *
 * A port is known by the path that stays - its `/dev/serial/by-id` link, its `/dev` node, or
 * `tcp://host:port` - so it keeps its id, its holder and its line while it is unplugged, and has
 * them back when it returns. It has exactly one holder: a device of an integration (its
 * instance, whose config's `serial` block names the port), a broker (Thread, for its radio), the
 * owner's console, or a managed container whose spec passes the port in, shown and never changed
 * from here. The broker opens a port at most once, for its holder, and refuses everyone else.
 *
 * Ports come and go with the {@link SerialHost}'s watch on `/dev`, and a scan every half minute
 * catches what a watch missed. A port is suggested - Use with… - by an integration whose
 * `discovery.json` `serial` rules match its USB strings, and as a Thread radio when it is one the
 * platform knows; the rules are read when asked, so an integration added or removed counts at once.
 */
import { randomUUID } from 'node:crypto';

import {
  ConflictError,
  NotFoundError,
  serialLineSchema,
  ValidationError,
  type BrokerState,
  type SerialBrokerHolder,
  type SerialClaim,
  type SerialConsole,
  type SerialConsoleChunk,
  type SerialDevice,
  type SerialDeviceConfig,
  type SerialHolder,
  type SerialLine,
  type SerialLineInput,
  type SerialNetworkAddress,
  type SerialNetworkPortSaveRequest,
  type SerialPort,
  type SerialSettings,
  type SerialStatus,
  type SerialUsb,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';
import {
  associateBroker,
  matchesBroker,
  type LoadedVendor,
  type SerialSession,
} from '@nebulahome/package-runtime';

import type { SerialInstance, SerialStore, StoredSerialPort } from '../persistence/serial.js';

import type { SeenSerialPort, SerialHost, SerialWatch } from './host.js';
import { openNetworkPort } from './network.js';

/** How often the ports are read again, beside the watch. */
const RESCAN_MS = 30_000;

/** How many chunks a console keeps for its page to read. */
const CONSOLE_CHUNKS = 1000;

/** The most bytes one chunk carries: the contract's 16 384 hex digits. */
const CHUNK_BYTES = 8192;

/** How long a console nobody reads stays open: its page went without closing it. */
const CONSOLE_IDLE_MS = 5 * 60_000;

/** The names the SDK's errors carry. */
type SerialFailure = 'SerialPortHeld' | 'SerialPortMissing' | 'SerialClosed';

/** A managed container's device, from the spec the hub hands the supervisor. */
export type ContainerPort = {
  /** The path of the host it is given: `/dev/serial/by-id/…`, `/dev/ttyACM0`. */
  readonly host: string;
  readonly vendorId: string;

  /** The container's name, as its tag says it. */
  readonly name: string;
};

/** What the broker needs. */
export type SerialBrokerOptions = {
  readonly store: SerialStore;
  readonly host: SerialHost;
  readonly logger: PlatformLogger;

  /** The vendors loaded: their `serial` rules. */
  readonly vendors: () => readonly LoadedVendor[];

  /** The devices of the house whose config names a port. */
  readonly instances: () => Promise<SerialInstance[]>;

  /** The devices the managed containers are given. */
  readonly containerPorts: () => Promise<readonly ContainerPort[]>;

  /** Whether Docker runs in Docker Desktop, which passes no USB; never asked when absent. */
  readonly isDesktop?: () => Promise<boolean>;

  /** How often the ports are read again; every 30 s, never when 0. */
  readonly rescanMs?: number;
};

/** A port opened, for whom, and how to close it from here. */
type OpenPort = {
  /** `device:<instance>`, `broker:thread`, `console:<id>`. */
  readonly holder: string;

  /** Closes it, telling its holder why; undefined while it is still opening. */
  end?: (reason: string) => Promise<void>;
};

/** The owner's console on a port. */
type Console = {
  readonly id: string;
  readonly portId: string;
  readonly line: SerialLine;
  readonly openedAt: Date;
  readonly session: SerialSession;
  readonly chunks: SerialConsoleChunk[];
  seq: number;
  isOpen: boolean;
  error: string | null;
  readAt: number;
};

/** The radios Thread takes that the platform knows by their USB strings. */
const THREAD_RADIOS: readonly {
  readonly vendorId: string;
  readonly productId: string;
  readonly product: RegExp | null;
  readonly model: string;
}[] = [
  // A CP210x is on countless boards: only the SkyConnect's and the ZBT-1's strings say radio.
  { vendorId: '10c4', productId: 'ea60', product: /SkyConnect|ZBT-1/iu, model: 'SkyConnect' },
  { vendorId: '1915', productId: 'cafe', product: null, model: 'nRF52840 Dongle' },
];

/**
 * An error the SDK names.
 *
 * @param name - Which.
 * @param message - Why, in a sentence.
 * @returns The error.
 */
function failure(name: SerialFailure, message: string): Error {
  return Object.assign(new Error(message), { name });
}

/**
 * A failure in a sentence, for the page.
 *
 * @param error - Whatever was thrown.
 * @returns Its message, cut.
 */
function messageOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 512);
}

/**
 * A port's name from what its adapter says: the maker and the product, once each.
 *
 * @param seen - The port.
 * @returns The name, or its node when the adapter says nothing.
 */
function nameOf(seen: SeenSerialPort): string {
  const maker = seen.usb?.manufacturer ?? null;
  const product = seen.usb?.product ?? null;
  const name =
    maker !== null && product !== null && !product.startsWith(maker)
      ? `${maker} ${product}`
      : (product ?? maker ?? seen.devicePath);

  return name.slice(0, 256);
}

/**
 * Whether the platform knows a port as a Thread radio.
 *
 * @param usb - What its adapter says.
 * @returns What it is, or null.
 */
function threadRadioOf(usb: SerialUsb): string | null {
  const radio = THREAD_RADIOS.find(
    (each) =>
      each.vendorId === usb.vendorId &&
      each.productId === usb.productId &&
      (each.product === null || each.product.test(usb.product ?? '')),
  );

  return radio === undefined ? null : (usb.product ?? radio.model).slice(0, 128);
}

/** The house's Serial broker. */
export class SerialBroker {
  readonly #options: SerialBrokerOptions;

  #state: BrokerState = 'starting';
  #error: string | null = null;
  #access: SerialStatus['access'] = 'none';
  #settings: SerialSettings = { showBuiltin: false };
  #ports = new Map<string, StoredSerialPort>();

  /** What the last scan found, by stable path. */
  #seen = new Map<string, SeenSerialPort>();
  #hasScanned = false;
  #lastChangeAt: Date | null = null;
  #containers: readonly ContainerPort[] = [];

  /** Whether each port on the network answered the last time it was opened. */
  readonly #reachable = new Map<string, boolean>();
  readonly #open = new Map<string, OpenPort>();
  readonly #consoles = new Map<string, Console>();
  readonly #pluggedListeners = new Set<(port: StoredSerialPort) => void>();
  #scans: Promise<void> = Promise.resolve();
  #watch: SerialWatch | undefined;
  #timer: NodeJS.Timeout | undefined;

  /** Whether Docker runs in Docker Desktop; undefined until the supervisor said. */
  #isDesktop: boolean | undefined;
  #askingDesktop = false;

  /**
   * Prepares the broker; nothing is read until it starts.
   *
   * @param options - What it needs.
   */
  constructor(options: SerialBrokerOptions) {
    this.#options = options;
  }

  /**
   * Reads what is kept, follows the ports and reads them. Never throws: a failure shows on the
   * Brokers page.
   *
   * @returns Once started, or failed.
   */
  async start(): Promise<void> {
    const { store, host } = this.#options;

    try {
      const [settings, kept] = await Promise.all([store.settings(), store.ports()]);

      this.#settings = settings;
      this.#ports = new Map(kept.map((port) => [port.id, port]));
      this.#state = 'running';
      this.#error = null;
      await this.refresh();
      await this.rescan();
      this.#watch = host.watch(() => {
        void this.rescan();
      });

      const every = this.#options.rescanMs ?? RESCAN_MS;

      if (every > 0) {
        this.#timer = setInterval(() => {
          void this.rescan();
          void this.#closeIdleConsoles();
        }, every);
        this.#timer.unref();
      }
    } catch (error: unknown) {
      this.#state = 'failed';
      this.#error = messageOf(error);
      this.#options.logger.error({ err: error }, 'The Serial broker could not read what it keeps');
    }
  }

  /**
   * Stops following the ports and closes every one opened.
   *
   * @returns Once closed.
   */
  async stop(): Promise<void> {
    clearInterval(this.#timer);
    this.#timer = undefined;
    this.#watch?.stop();
    this.#watch = undefined;
    this.#state = 'disabled';
    await Promise.all([...this.#open.keys()].map(async (id) => this.#closeOpen(id, 'Stopped')));
    this.#consoles.clear();
  }

  /**
   * Reads again which devices the managed containers are given: after a vendor's settings were
   * saved, or a vendor came or went.
   *
   * @returns Once read; a failure is logged.
   */
  async refresh(): Promise<void> {
    try {
      this.#containers = await this.#options.containerPorts();
    } catch (error: unknown) {
      this.#options.logger.warn({ err: error }, 'Could not read the containers’ serial ports');
    }
  }

  /**
   * Reads the ports now, one scan after another.
   *
   * @returns Once read.
   */
  async rescan(): Promise<void> {
    this.#scans = this.#scans.then(async () => this.#scan());
    await this.#scans;
  }

  /**
   * Hears a port held by a device or a broker come back, so its holder opens it again.
   *
   * @param listener - Called with the port.
   * @returns Stops hearing.
   */
  onPlugged(listener: (port: StoredSerialPort) => void): () => void {
    this.#pluggedListeners.add(listener);

    return () => this.#pluggedListeners.delete(listener);
  }

  /**
   * Where the broker stands.
   *
   * @returns Its status.
   */
  async status(): Promise<SerialStatus> {
    // A count on a card: a registry that cannot answer leaves the card standing.
    const instances = await this.#options.instances().catch((): SerialInstance[] => []);
    const listed = this.#listed(instances);

    return {
      state: this.#state,
      error: this.#error,
      access: this.#access,
      ports: {
        seen: listed.length,
        inUse: listed.filter(({ holder }) => holder !== null).length,
      },
      hotplug: { isWatching: this.#watch?.isWatching ?? false, lastChangeAt: this.#lastChangeAt },
      conflicts: this.#conflicts(instances),
      settings: this.#settings,
      devices: {
        total: instances.length,
        online: instances.filter((instance) => this.#isOnline(instance)).length,
      },
    };
  }

  /**
   * Every port the page lists: built-in ones only when the settings show them or one is held;
   * the plugged-in ones first, then by name.
   *
   * @returns The ports.
   */
  async ports(): Promise<SerialPort[]> {
    return this.#listed(await this.#options.instances())
      .map(({ port, holder }) => this.#viewOf(port, holder))
      .sort(
        (left, right) =>
          Number(right.isConnected) - Number(left.isConnected) ||
          left.name.localeCompare(right.name),
      );
  }

  /**
   * One port, as the page lists it.
   *
   * @param portId - The port.
   * @returns It.
   * @throws {NotFoundError} When there is no such port.
   */
  async port(portId: string): Promise<SerialPort> {
    const port = this.#require(portId);

    return this.#viewOf(port, this.#holderOf(port, await this.#options.instances()));
  }

  /**
   * The devices of the house reached through a port, by name.
   *
   * @returns Them.
   */
  async devices(): Promise<SerialDevice[]> {
    return (await this.#options.instances())
      .map((instance) => ({
        deviceId: instance.id,
        name: instance.name.slice(0, 256),
        vendorId: instance.kind.split('/')[0] ?? instance.kind,
        areaId: instance.areaId,
        portId: instance.config.portId,
        portName: this.#ports.get(instance.config.portId)?.name ?? 'Forgotten port',
        line: instance.config.line,
        isOnline: this.#isOnline(instance),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  /**
   * Saves the owner's settings.
   *
   * @param settings - The settings.
   * @returns Where the broker stands.
   */
  async saveSettings(settings: SerialSettings): Promise<SerialStatus> {
    await this.#options.store.saveSettings(settings);
    this.#settings = settings;

    return this.status();
  }

  /**
   * Ignores a port, so it is never suggested, or stops ignoring it.
   *
   * @param portId - The port.
   * @param isIgnored - Whether it is ignored now.
   * @returns It.
   * @throws {NotFoundError} When there is no such port.
   */
  async ignore(portId: string, isIgnored: boolean): Promise<SerialPort> {
    await this.#save({ ...this.#require(portId), isIgnored });

    return this.port(portId);
  }

  /**
   * Saves a port on the network, new or changed. One that moved is closed, so its holder opens
   * it at the new address.
   *
   * @param request - The port.
   * @returns It.
   * @throws {ConflictError} When another port is at the same address.
   * @throws {NotFoundError} When the port to change is not one on the network.
   */
  async saveNetworkPort(request: SerialNetworkPortSaveRequest): Promise<SerialPort> {
    const stablePath = `tcp://${request.host}:${String(request.port)}`;
    const kept = request.id === undefined ? undefined : this.#ports.get(request.id);

    if (request.id !== undefined && kept?.kind !== 'network') {
      throw new NotFoundError(`There is no network port ${request.id}`, {
        details: { portId: request.id },
      });
    }

    if ([...this.#ports.values()].some((port) => port.stablePath === stablePath && port !== kept)) {
      throw new ConflictError(`A port is already at ${stablePath}`, { details: { stablePath } });
    }

    const saved = await this.#save({
      id: kept?.id,
      stablePath,
      kind: 'network',
      name: request.name,
      usb: null,
      network: { host: request.host, port: request.port, protocol: request.protocol },
      holderIntegrationId: kept?.holderIntegrationId ?? null,
      holderBroker: kept?.holderBroker ?? null,
      line: kept?.line ?? null,
      isIgnored: kept?.isIgnored ?? false,
      lastSeenAt: kept?.lastSeenAt ?? null,
    });

    if (kept !== undefined && kept.stablePath !== stablePath) {
      this.#reachable.delete(saved.id);
      await this.#closeOpen(saved.id, 'The port moved');
    }

    this.#settle();

    return this.port(saved.id);
  }

  /**
   * Opens a socket to a port on the network once, leaving its line as it is.
   *
   * @param address - Where it is.
   * @returns Whether it answered, how fast, or why not.
   */
  async testNetworkPort(
    address: SerialNetworkAddress,
  ): Promise<{ isConnected: boolean; ms: number | null; error: string | null }> {
    const startedAt = performance.now();

    try {
      const session = await openNetworkPort(address, null);
      const ms = Math.round(performance.now() - startedAt);

      await session.close();

      return { isConnected: true, ms, error: null };
    } catch (error: unknown) {
      return { isConnected: false, ms: null, error: messageOf(error) };
    }
  }

  /**
   * Takes a port from its holder: a device stays in the house and goes offline, a broker lets go,
   * a console closes.
   *
   * @param portId - The port.
   * @returns It, free.
   * @throws {NotFoundError} When there is no such port.
   * @throws {ConflictError} When a managed container holds it: that is released from its page.
   */
  async release(portId: string): Promise<SerialPort> {
    const port = this.#require(portId);
    const holder = this.#holderOf(port, []);

    if (holder?.kind === 'container') {
      throw new ConflictError(
        `The container ${holder.name} holds this port: it is released from the container’s page`,
        { details: { portId } },
      );
    }

    const console = this.#consoleOn(portId);

    if (console !== undefined) {
      await this.closeConsole(console.id);
    }

    await this.#closeOpen(portId, 'Released by the owner');
    await this.#save({ ...port, holderIntegrationId: null, holderBroker: null, line: null });

    return this.port(portId);
  }

  /**
   * Forgets a port that is unplugged, or one on the network; its holder, if any, loses it.
   *
   * @param portId - The port.
   * @returns Whether there was one.
   * @throws {ConflictError} When it is plugged in: it would be back at the next scan.
   */
  async forget(portId: string): Promise<boolean> {
    const port = this.#ports.get(portId);

    if (port === undefined) {
      return false;
    }

    if (port.kind !== 'network' && this.#seen.has(port.stablePath)) {
      throw new ConflictError('The port is plugged in: unplug it before forgetting it', {
        details: { portId },
      });
    }

    const console = this.#consoleOn(portId);

    if (console !== undefined) {
      await this.closeConsole(console.id);
    }

    await this.#closeOpen(portId, 'Forgotten by the owner');

    const isRemoved = await this.#options.store.removePort(portId);

    this.#ports.delete(portId);
    this.#reachable.delete(portId);
    this.#settle();

    return isRemoved;
  }

  /**
   * Gives a free port to a device that is starting, as its config names it; the device that
   * holds it already keeps it, with the line its config says now.
   *
   * @param instanceId - The device.
   * @param config - Its config's `serial` block.
   * @returns Whether it holds the port; false when it is not there, or held by another.
   */
  async claim(instanceId: string, config: SerialDeviceConfig): Promise<boolean> {
    const port = this.#ports.get(config.portId);

    if (port === undefined) {
      return false;
    }

    const isOwn = port.holderIntegrationId === instanceId;

    if (!isOwn && this.#holderOf(port, []) !== null) {
      return false;
    }

    if (!isOwn || JSON.stringify(port.line) !== JSON.stringify(config.line)) {
      await this.#save({
        ...port,
        holderIntegrationId: instanceId,
        holderBroker: null,
        line: config.line,
      });
    }

    return true;
  }

  /**
   * Closes the ports a stopped device had open; it keeps holding them.
   *
   * @param instanceId - The device.
   * @returns Once closed.
   */
  async stopped(instanceId: string): Promise<void> {
    await Promise.all(
      [...this.#open.entries()]
        .filter(([, open]) => open.holder === `device:${instanceId}`)
        .map(async ([portId]) => this.#closeOpen(portId, 'The device stopped')),
    );
  }

  /**
   * Lets go of the ports a device removed from the house held.
   *
   * @param instanceId - The device.
   * @returns Once they are free.
   */
  async releaseInstance(instanceId: string): Promise<void> {
    await this.stopped(instanceId);

    for (const port of [...this.#ports.values()]) {
      if (port.holderIntegrationId === instanceId) {
        // One row at a time: a device holds one port, rarely two.
        // eslint-disable-next-line no-await-in-loop -- see above
        await this.#save({ ...port, holderIntegrationId: null, line: null });
      }
    }
  }

  /**
   * Gives a port to a broker - Thread, for its radio - which holds one port at a time: another it
   * held is let go of. The broker may run the port itself (OTBR opens the path) or open it here.
   *
   * @param broker - The broker.
   * @param portId - The port.
   * @param line - How the broker speaks it, when it says.
   * @returns The port's paths: the one that stays, and the node it is at now (null while
   * unplugged or on the network).
   * @throws {NotFoundError} When there is no such port.
   * @throws {ConflictError} When another holder has it.
   */
  async claimForBroker(
    broker: SerialBrokerHolder,
    portId: string,
    line: SerialLine | null = null,
  ): Promise<{ stablePath: string; devicePath: string | null }> {
    const port = this.#require(portId);
    const holder = this.#holderOf(port, await this.#options.instances());

    if (holder !== null && holder.broker !== broker) {
      throw new ConflictError(`${holder.name} holds this port`, { details: { portId } });
    }

    for (const other of this.#ports.values()) {
      if (other.holderBroker === broker && other.id !== portId) {
        // eslint-disable-next-line no-await-in-loop -- one, at most
        await this.#releaseFrom(other, broker);
      }
    }

    await this.#save({ ...port, holderIntegrationId: null, holderBroker: broker, line });

    return { stablePath: port.stablePath, devicePath: this.#devicePathOf(port) };
  }

  /**
   * Lets go of the port a broker holds.
   *
   * @param broker - The broker.
   * @returns Once free.
   */
  async releaseBroker(broker: SerialBrokerHolder): Promise<void> {
    for (const port of [...this.#ports.values()]) {
      if (port.holderBroker === broker) {
        // eslint-disable-next-line no-await-in-loop -- one, at most
        await this.#releaseFrom(port, broker);
      }
    }
  }

  /**
   * Opens the port a broker holds, as Thread's firmware probe does before the border router
   * takes the path.
   *
   * @param broker - The broker.
   * @param portId - The port.
   * @param line - How it is spoken.
   * @returns The open port.
   * @throws {Error} `SerialPortHeld` when the broker does not hold it or it is open already,
   * `SerialPortMissing` when it is gone.
   */
  async openForBroker(
    broker: SerialBrokerHolder,
    portId: string,
    line: SerialLine,
  ): Promise<SerialSession> {
    const port = this.#ports.get(portId);

    if (port === undefined) {
      throw failure('SerialPortMissing', 'There is no such serial port');
    }

    if (port.holderBroker !== broker) {
      throw failure('SerialPortHeld', `The ${broker} broker does not hold this port`);
    }

    return this.#openPort(port, `broker:${broker}`, line);
  }

  /**
   * Opens a port for a vendor's code, through `sdk.openSerial`: the port must be held by a device
   * of the vendor.
   *
   * shortcut: the SDK is the vendor's, not the instance's, so two devices of one vendor naming one
   * port race for its one open - the page shows them as a conflict; pass the instance through the
   * SDK if that ever matters.
   *
   * @param vendorId - The vendor whose code asks.
   * @param portId - The port.
   * @param input - How it is spoken.
   * @returns The open port.
   * @throws {Error} `SerialPortHeld` when another holds it or it is open already,
   * `SerialPortMissing` when it is gone or unplugged.
   * @throws {ValidationError} When the line is not one.
   */
  async openForVendor(
    vendorId: string,
    portId: string,
    input: SerialLineInput,
  ): Promise<SerialSession> {
    const line = serialLineSchema.safeParse(input);

    if (!line.success) {
      throw new ValidationError('The serial line is not one', { details: { portId } });
    }

    const port = this.#ports.get(portId);

    if (port === undefined) {
      throw failure('SerialPortMissing', 'There is no such serial port');
    }

    const holder = this.#holderOf(port, await this.#options.instances());

    if (holder?.kind !== 'device' || holder.vendorId !== vendorId) {
      throw failure(
        'SerialPortHeld',
        holder === null
          ? 'No device of this integration holds the port'
          : `${holder.name} holds the port`,
      );
    }

    return this.#openPort(port, `device:${holder.deviceId ?? ''}`, line.data);
  }

  /**
   * Opens the owner's console on a free port.
   *
   * @param portId - The port.
   * @param line - How it is spoken.
   * @returns The console.
   * @throws {NotFoundError} When there is no such port.
   * @throws {ConflictError} When the port is held, open, unplugged or will not open.
   */
  async openConsole(portId: string, line: SerialLine): Promise<SerialConsole> {
    const port = this.#require(portId);
    const holder = this.#holderOf(port, await this.#options.instances());

    if (holder !== null) {
      throw new ConflictError(`${holder.name} holds this port: the console opens a free one`, {
        details: { portId },
      });
    }

    const id = randomUUID();
    let session: SerialSession;

    try {
      session = await this.#openPort(port, `console:${id}`, line);
    } catch (error: unknown) {
      throw new ConflictError(messageOf(error), { details: { portId } });
    }

    const console: Console = {
      id,
      portId,
      line,
      openedAt: new Date(),
      session,
      chunks: [],
      seq: 0,
      isOpen: true,
      error: null,
      readAt: Date.now(),
    };

    this.#consoles.set(id, console);
    session.onData((bytes) => {
      for (let start = 0; start < bytes.length; start += CHUNK_BYTES) {
        this.#record(console, 'in', bytes.subarray(start, start + CHUNK_BYTES));
      }
    });
    session.onClose((reason) => {
      if (console.isOpen) {
        console.isOpen = false;
        console.error = reason.slice(0, 512);
      }
    });

    return { consoleId: id, portId, line, openedAt: console.openedAt };
  }

  /**
   * What a console's port said and was sent after a cursor.
   *
   * shortcut: polled by the page, move to the websocket topic if latency matters.
   *
   * @param consoleId - The console.
   * @param after - The cursor; from the oldest chunk kept when absent.
   * @returns The chunks, the cursor to hand back, and whether the port is still open.
   * @throws {NotFoundError} When there is no such console.
   */
  readConsole(
    consoleId: string,
    after: number | undefined,
  ): {
    chunks: SerialConsoleChunk[];
    cursor: number;
    isTruncated: boolean;
    isOpen: boolean;
    error: string | null;
  } {
    const console = this.#requireConsole(consoleId);
    const from = after ?? 0;
    const chunks = console.chunks.filter((chunk) => chunk.seq > from);

    console.readAt = Date.now();

    return {
      chunks,
      cursor: chunks.at(-1)?.seq ?? from,
      isTruncated: (console.chunks[0]?.seq ?? console.seq + 1) > from + 1,
      isOpen: console.isOpen,
      error: console.error,
    };
  }

  /**
   * Sends bytes through a console, and the line ending after them.
   *
   * @param consoleId - The console.
   * @param hex - The bytes, in hex.
   * @param lineEnding - What follows them.
   * @returns How many bytes went out.
   * @throws {NotFoundError} When there is no such console.
   * @throws {ConflictError} When its port went away.
   */
  async writeConsole(
    consoleId: string,
    hex: string,
    lineEnding: 'none' | 'lf' | 'crlf',
  ): Promise<number> {
    const console = this.#requireConsole(consoleId);

    if (!console.isOpen) {
      throw new ConflictError(console.error ?? 'The console is closed', { details: { consoleId } });
    }

    const ending = { none: '', lf: '\n', crlf: '\r\n' }[lineEnding];
    const bytes = Buffer.concat([Buffer.from(hex, 'hex'), Buffer.from(ending, 'latin1')]);

    await console.session.write(bytes);
    this.#record(console, 'out', bytes);

    return bytes.length;
  }

  /**
   * Closes a console and lets go of its port.
   *
   * @param consoleId - The console.
   * @returns Whether there was one.
   */
  async closeConsole(consoleId: string): Promise<boolean> {
    const console = this.#consoles.get(consoleId);

    if (console === undefined) {
      return false;
    }

    this.#consoles.delete(consoleId);
    console.isOpen = false;
    await console.session.close();

    return true;
  }

  /**
   * Reads the ports, keeps the new ones, and notes which came and went.
   *
   * @returns Once read; a failure fails the broker until the next scan.
   */
  async #scan(): Promise<void> {
    if (this.#state === 'disabled') {
      return;
    }

    try {
      const seen = new Map(
        (await this.#options.host.list()).map((each) => [each.stablePath, each]),
      );
      const byPath = new Map([...this.#ports.values()].map((port) => [port.stablePath, port]));
      const now = new Date();
      const plugged: StoredSerialPort[] = [];
      let isChanged = false;

      for (const each of seen.values()) {
        const kept = byPath.get(each.stablePath);

        if (kept === undefined || !this.#seen.has(each.stablePath)) {
          // One row at a time: ports come one or two at once. A port back keeps all it had.
          // eslint-disable-next-line no-await-in-loop -- see above
          const saved = await this.#save(
            kept === undefined
              ? {
                  stablePath: each.stablePath,
                  kind: each.kind,
                  name: nameOf(each),
                  usb: each.usb,
                  network: null,
                  holderIntegrationId: null,
                  holderBroker: null,
                  line: null,
                  isIgnored: false,
                  lastSeenAt: now,
                }
              : { ...kept, lastSeenAt: now },
          );

          isChanged = true;

          if (kept !== undefined && this.#hasScanned) {
            plugged.push(saved);
          }
        }
      }

      for (const port of this.#ports.values()) {
        if (this.#seen.has(port.stablePath) && !seen.has(port.stablePath)) {
          // eslint-disable-next-line no-await-in-loop -- see above
          await this.#closeOpen(port.id, 'Unplugged');
          // eslint-disable-next-line no-await-in-loop -- see above
          await this.#save({ ...port, lastSeenAt: now });
          isChanged = true;
        }
      }

      this.#seen = seen;

      if (isChanged && this.#hasScanned) {
        this.#lastChangeAt = now;
      }

      this.#hasScanned = true;
      this.#access = seen.size > 0 ? 'ok' : this.#isDesktop === true ? 'desktop' : 'none';

      if (seen.size === 0) {
        this.#askDesktop();
      }

      this.#error = null;
      this.#settle();

      for (const port of plugged) {
        for (const listener of this.#pluggedListeners) {
          listener(port);
        }
      }
    } catch (error: unknown) {
      this.#state = 'failed';
      this.#error = messageOf(error);
      this.#options.logger.warn({ err: error }, 'The Serial broker could not read the ports');
    }
  }

  /** Says whether the broker has anything to hold: a port reachable, or one on the network. */
  #settle(): void {
    if (this.#state === 'disabled' || this.#error !== null) {
      return;
    }

    const hasNetwork = [...this.#ports.values()].some((port) => port.kind === 'network');

    this.#state = this.#seen.size > 0 || hasNetwork ? 'running' : 'unavailable';
  }

  /**
   * Asks whether Docker runs in Docker Desktop, without waiting: a supervisor that is not up
   * holds no scan, and is asked again at the next one until it answers.
   */
  #askDesktop(): void {
    const ask = this.#options.isDesktop;

    if (ask === undefined || this.#isDesktop !== undefined || this.#askingDesktop) {
      return;
    }

    this.#askingDesktop = true;
    void ask()
      .then(
        (isDesktop) => {
          this.#isDesktop = isDesktop;

          if (isDesktop && this.#access === 'none') {
            this.#access = 'desktop';
          }
        },
        () => undefined,
      )
      .finally(() => {
        this.#askingDesktop = false;
      });
  }

  /**
   * Opens a port for its holder, at most once.
   *
   * @param port - The port.
   * @param holder - Who opens it: `device:<instance>`, `broker:thread`, `console:<id>`.
   * @param line - How it is spoken.
   * @returns The open port; closing it lets go of it.
   * @throws {Error} `SerialPortHeld` when it is open already, `SerialPortMissing` when it is not
   * plugged in or does not answer.
   */
  async #openPort(
    port: StoredSerialPort,
    holder: string,
    line: SerialLine,
  ): Promise<SerialSession> {
    if (this.#open.has(port.id)) {
      throw failure('SerialPortHeld', 'The port is open already');
    }

    const devicePath = this.#devicePathOf(port);

    if (port.kind !== 'network' && devicePath === null) {
      throw failure('SerialPortMissing', 'The port is not plugged in');
    }

    // Taken before the open is awaited, so two opens at once cannot both pass.
    const open: OpenPort = { holder };

    this.#open.set(port.id, open);

    let raw: SerialSession;

    try {
      if (port.network === null) {
        raw = await this.#options.host.open(devicePath ?? '', line);
      } else {
        try {
          raw = await openNetworkPort(port.network, line);
          this.#reachable.set(port.id, true);
        } catch (error: unknown) {
          this.#reachable.set(port.id, false);
          throw failure('SerialPortMissing', messageOf(error));
        }
      }
    } catch (error: unknown) {
      this.#open.delete(port.id);
      throw error;
    }

    const listeners = new Set<(reason: string) => void>();
    let isClosed = false;

    /**
     * Ends the session once, telling its holder why.
     *
     * @param reason - Why.
     */
    const finish = (reason: string): void => {
      if (isClosed) {
        return;
      }

      isClosed = true;

      if (this.#open.get(port.id) === open) {
        this.#open.delete(port.id);
      }

      for (const listener of listeners) {
        listener(reason);
      }
    };

    /**
     * Closes the port, telling its holder why.
     *
     * @param reason - Why.
     * @returns Once closed.
     */
    open.end = async (reason) => {
      finish(reason);
      await raw.close();
    };
    raw.onClose(finish);

    return {
      /**
       * Sends bytes.
       *
       * @param bytes - The bytes.
       * @returns Once the port took them.
       */
      write: async (bytes) => {
        if (isClosed) {
          throw failure('SerialClosed', 'The port is closed');
        }

        await raw.write(bytes);
      },

      /**
       * Hears what the port reads.
       *
       * @param listener - Called with each chunk.
       * @returns Stops hearing.
       */
      onData: (listener) => raw.onData(listener),

      /**
       * Hears the port go, once.
       *
       * @param listener - Called with why.
       * @returns Stops hearing.
       */
      onClose: (listener) => {
        listeners.add(listener);

        return () => listeners.delete(listener);
      },

      /**
       * Lets go of the port.
       *
       * @returns Once closed.
       */
      close: async () => open.end?.('Closed'),
    };
  }

  /**
   * Closes a port opened here, telling its holder why.
   *
   * @param portId - The port.
   * @param reason - Why.
   * @returns Once closed.
   */
  async #closeOpen(portId: string, reason: string): Promise<void> {
    await this.#open.get(portId)?.end?.(reason);
  }

  /**
   * Lets a broker's port go.
   *
   * @param port - The port.
   * @param broker - The broker.
   * @returns Once free.
   */
  async #releaseFrom(port: StoredSerialPort, broker: SerialBrokerHolder): Promise<void> {
    if (this.#open.get(port.id)?.holder === `broker:${broker}`) {
      await this.#closeOpen(port.id, `The ${broker} broker let go of it`);
    }

    await this.#save({ ...port, holderBroker: null, line: null });
  }

  /**
   * Keeps a port, and the copy here.
   *
   * @param port - The port, whole.
   * @returns It, saved.
   */
  async #save(
    port: Omit<StoredSerialPort, 'id'> & { readonly id?: string | undefined },
  ): Promise<StoredSerialPort> {
    const saved = await this.#options.store.savePort(port);

    this.#ports.set(saved.id, saved);

    return saved;
  }

  /**
   * Who holds a port: the console open on it, the container given it, its broker, its device.
   *
   * @param port - The port.
   * @param instances - The devices, for a device's name; without them it is named by its id.
   * @returns The holder, or null while it is free.
   */
  #holderOf(port: StoredSerialPort, instances: readonly SerialInstance[]): SerialHolder | null {
    const none = { deviceId: null, vendorId: null, broker: null, container: null };

    if (this.#consoleOn(port.id) !== undefined) {
      return { ...none, kind: 'console', name: 'Console' };
    }

    const devicePath = this.#devicePathOf(port);
    const container = this.#containers.find(
      (each) => each.host === port.stablePath || each.host === devicePath,
    );

    if (container !== undefined) {
      return {
        ...none,
        kind: 'container',
        vendorId: container.vendorId,
        container: container.name.slice(0, 128),
        name: container.name.slice(0, 256),
      };
    }

    if (port.holderBroker !== null) {
      return { ...none, kind: 'broker', broker: port.holderBroker, name: 'Thread broker' };
    }

    if (port.holderIntegrationId !== null) {
      const instance = instances.find((each) => each.id === port.holderIntegrationId);

      return {
        ...none,
        kind: 'device',
        deviceId: port.holderIntegrationId,
        vendorId: instance?.kind.split('/')[0] ?? null,
        name: (instance?.name ?? port.holderIntegrationId).slice(0, 256),
      };
    }

    return null;
  }

  /**
   * One port as the page lists it.
   *
   * @param port - The port.
   * @param holder - Who holds it.
   * @returns It.
   */
  #viewOf(port: StoredSerialPort, holder: SerialHolder | null): SerialPort {
    const line =
      holder?.kind === 'console'
        ? (this.#consoleOn(port.id)?.line ?? null)
        : holder === null || holder.kind === 'container'
          ? null
          : port.line;

    return {
      id: port.id,
      kind: port.kind,
      name: port.name,
      path: port.stablePath,
      devicePath: this.#devicePathOf(port),
      usb: port.usb,
      network: port.network,
      holder,
      line,
      isConnected: this.#isConnected(port),
      isIgnored: port.isIgnored,
      claims: this.#claimsOf(port),
      lastSeenAt: port.lastSeenAt,
    };
  }

  /**
   * The ports the page lists, each with its holder.
   *
   * @param instances - The devices, for their names.
   * @returns Them, unsorted.
   */
  #listed(
    instances: readonly SerialInstance[],
  ): { port: StoredSerialPort; holder: SerialHolder | null }[] {
    return [...this.#ports.values()]
      .map((port) => ({ port, holder: this.#holderOf(port, instances) }))
      .filter(
        ({ port, holder }) =>
          this.#settings.showBuiltin || port.kind !== 'builtin' || holder !== null,
      );
  }

  /**
   * Who would take a port: the integrations whose `serial` rules match its USB strings, then
   * Thread when it is a radio the platform knows.
   *
   * @param port - The port.
   * @returns The claims.
   */
  #claimsOf(port: StoredSerialPort): SerialClaim[] {
    const { usb } = port;

    if (usb === null) {
      return [];
    }

    const claims: SerialClaim[] = this.#options.vendors().flatMap((vendor): SerialClaim[] => {
      const plan = vendor.discovery?.plan;

      if (plan?.discovery.serial === undefined || !matchesBroker(plan, 'serial', usb)) {
        return [];
      }

      const association = associateBroker(plan, 'serial', usb);

      return [
        {
          kind: 'integration',
          vendorId: vendor.manifest.id,
          vendorName: vendor.manifest.name.slice(0, 128),
          driverKind: association === null ? null : `${vendor.manifest.id}/${association.driverId}`,
          model: association?.model?.slice(0, 128) ?? null,
        },
      ];
    });
    const radio = threadRadioOf(usb);

    if (radio !== null) {
      claims.push({ kind: 'broker', broker: 'thread', model: radio });
    }

    return claims.slice(0, 32);
  }

  /**
   * The ports two or more devices' configs name.
   *
   * @param instances - The devices.
   * @returns One conflict per such port.
   */
  #conflicts(instances: readonly SerialInstance[]): SerialStatus['conflicts'] {
    const wanted = new Map<string, SerialInstance[]>();

    for (const instance of instances) {
      wanted.set(instance.config.portId, [...(wanted.get(instance.config.portId) ?? []), instance]);
    }

    return [...wanted.entries()]
      .filter(([, devices]) => devices.length > 1)
      .map(([portId, devices]) => {
        const port = this.#ports.get(portId);
        const path = port === undefined ? portId : (this.#devicePathOf(port) ?? port.stablePath);

        return {
          portId,
          name: (port?.kind === 'network' ? port.name : (path.split('/').at(-1) ?? path)).slice(
            0,
            256,
          ),
          wantedBy: devices
            .slice(0, 32)
            .map((device) => ({ deviceId: device.id, name: device.name.slice(0, 256) })),
        };
      })
      .slice(0, 64);
  }

  /**
   * Whether a device runs with its port: its instance running, holding the port, plugged in.
   *
   * @param instance - The device.
   * @returns True when it does.
   */
  #isOnline(instance: SerialInstance): boolean {
    const port = this.#ports.get(instance.config.portId);

    return (
      instance.state === 'running' &&
      port?.holderIntegrationId === instance.id &&
      this.#isConnected(port)
    );
  }

  /**
   * Whether a port is there: plugged in, or answering on the network the last time it was opened.
   *
   * @param port - The port.
   * @returns True when it is.
   */
  #isConnected(port: StoredSerialPort): boolean {
    return port.kind === 'network'
      ? (this.#reachable.get(port.id) ?? true)
      : this.#seen.has(port.stablePath);
  }

  /**
   * The node a port is at now.
   *
   * @param port - The port.
   * @returns `/dev/ttyUSB0`; null on the network or unplugged.
   */
  #devicePathOf(port: StoredSerialPort): string | null {
    return this.#seen.get(port.stablePath)?.devicePath ?? null;
  }

  /**
   * The console open on a port.
   *
   * @param portId - The port.
   * @returns It, or undefined.
   */
  #consoleOn(portId: string): Console | undefined {
    return [...this.#consoles.values()].find(
      (console) => console.portId === portId && console.isOpen,
    );
  }

  /**
   * Keeps one chunk of a console, the oldest dropped once the ring is full.
   *
   * @param console - The console.
   * @param direction - Said by the port, or sent.
   * @param bytes - The bytes.
   */
  #record(console: Console, direction: 'in' | 'out', bytes: Uint8Array): void {
    console.seq += 1;
    console.chunks.push({
      seq: console.seq,
      at: new Date(),
      direction,
      data: Buffer.from(bytes).toString('hex'),
    });

    if (console.chunks.length > CONSOLE_CHUNKS) {
      console.chunks.shift();
    }
  }

  /**
   * Closes the consoles nobody has read for a while: their page went without closing them, and
   * would hold the port for good.
   *
   * @returns Once closed.
   */
  async #closeIdleConsoles(): Promise<void> {
    const before = Date.now() - CONSOLE_IDLE_MS;

    await Promise.all(
      [...this.#consoles.values()]
        .filter((console) => console.readAt < before)
        .map(async (console) => this.closeConsole(console.id)),
    );
  }

  /**
   * A port by id.
   *
   * @param portId - The port.
   * @returns It.
   * @throws {NotFoundError} When there is no such port.
   */
  #require(portId: string): StoredSerialPort {
    const port = this.#ports.get(portId);

    if (port === undefined) {
      throw new NotFoundError(`There is no serial port ${portId}`, { details: { portId } });
    }

    return port;
  }

  /**
   * A console by id.
   *
   * @param consoleId - The console.
   * @returns It.
   * @throws {NotFoundError} When there is no such console.
   */
  #requireConsole(consoleId: string): Console {
    const console = this.#consoles.get(consoleId);

    if (console === undefined) {
      throw new NotFoundError(`There is no serial console ${consoleId}`, {
        details: { consoleId },
      });
    }

    return console;
  }
}
