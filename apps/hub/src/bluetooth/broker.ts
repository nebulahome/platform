/**
 * The house's Bluetooth broker: the server's own adapter, the devices of integrations that listen
 * for the house (proxies), and everything they hear.
 *
 * Every advertisement heard is kept by address and by scanner - how loud, when - so the broker
 * knows which scanner hears each device best, how busy each scanner is, and what was heard in the
 * last five minutes; an address not heard for the owner's `forgetAfterDays` is dropped. Nothing
 * heard is written down: it is heard again after a restart.
 *
 * An address is recognised by an integration whose `discovery.json` `bluetooth` rules hold of what
 * it advertises, or by the platform itself when it carries BTHome service data. Recognised and not
 * in the house, it is Found; the owner adds it, or ignores it. Added, it is proposed to discovery
 * as the driver that recognised it, which adds it at once, as Modbus devices are; its instance
 * then reaches it over the platform transport `bluetooth`, which follows its address.
 *
 * A proxy is a device whose profile declares `bluetoothProxy`. The hub drives it through the
 * reserved `bluetooth-proxy.*` ops on its own instance's connection - installing the script as a
 * job, changing its mode, removing it - and tells it what to forward: the house's devices and what
 * a rule recognises, or everything while a Nearby page holds a lease. What it hears comes back
 * through the SDK's scanner, as heard by it.
 *
 * Only the local adapter connects to a device (GATT); proxies only listen. Matter pairs over the
 * same adapter, through BlueZ too, and says so here while it does.
 */
import { randomUUID } from 'node:crypto';

import semver from 'semver';
import type { z } from 'zod';

import {
  BLUETOOTH_HEARD_WINDOW_MS,
  BLUETOOTH_NEARBY_LEASE_MS,
  BLUETOOTH_PROXY_OPS,
  BLUETOOTH_PROXY_STEPS,
  BLUETOOTH_TRANSPORT,
  BLUETOOTH_VENDOR,
  BTHOME_SERVICE_UUID,
  bluetoothAddressSchema,
  bluetoothAdvertSchema,
  bluetoothGattNotifyArgsSchema,
  bluetoothGattReadArgsSchema,
  bluetoothGattWriteArgsSchema,
  bluetoothProxyStateSchema,
  ConflictError,
  NotFoundError,
  ValidationError,
  type BluetoothAdapterProblem,
  type BluetoothAdvert,
  type BluetoothAdvertInput,
  type BluetoothClaim,
  type BluetoothDevice,
  type BluetoothFound,
  type BluetoothHearing,
  type BluetoothMap,
  type BluetoothNearby,
  type BluetoothProxyCandidate,
  type BluetoothProxyJob,
  type BluetoothProxyState,
  type BluetoothScanMode,
  type BluetoothScanner,
  type BluetoothSettings,
  type BluetoothStatus,
  type BrokerState,
  type JsonObject,
  type MATTER_BLE_PROBLEMS,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';
import {
  associateBroker,
  decodeBthome,
  matchesBroker,
  type BluetoothDeviceSnapshot,
  type BluetoothScanner as SdkScanner,
  type BluetoothScannerOptions,
  type LoadedVendor,
  type TransportRequest,
} from '@nebulahome/package-runtime';

import type {
  BluetoothInstance,
  BluetoothStore,
  StoredBluetoothProxy,
  StoredBluetoothIgnored,
} from '../persistence/bluetooth.js';

import {
  MAXIMUM_CONNECTIONS,
  shortUuid,
  type BluetoothHost,
  type BluetoothHostScan,
  type SeenBluetoothAdapter,
} from './host.js';

/** How often the adapter is looked at again, forgotten addresses dropped and filters sent. */
const REFRESH_MS = 30_000;

/** How long an add waits for its device to be in the house, and how often it looks. */
const ADD_WAIT_MS = 15_000;
const ADD_POLL_MS = 500;

/** How long a proxy may take to answer an op, to install its script, and to report first. */
const OP_TIMEOUT_MS = 10_000;
const INSTALL_TIMEOUT_MS = 60_000;
const FIRST_REPORT_MS = 60_000;

/** How many times, a second apart, a proxy is asked whether the script it installed runs. */
const START_TRIES = 10;
const START_ASK_MS = 1000;

/** How long a proxy that said nothing still counts as reporting. */
const REPORTING_MS = 2 * 60_000;

/** How often a proxy is sent its filter even when it did not change: it may have restarted. */
const FILTER_AGAIN_MS = 5 * 60_000;

/** How often a device's advertisement is delivered when it carries nothing new. */
const DELIVER_AGAIN_MS = 60_000;

/** How long an ended job is kept for its page to read. */
const JOB_KEEP_MS = 60 * 60_000;

/** A day. */
const DAY_MS = 24 * 60 * 60_000;

/** What the adapter's scanner is called where the page says who hears a device. */
const SERVER_NAME = 'This server';

/** What the platform's own claim says it is recognised by: "Recognised by Nebula · BTHome". */
const PLATFORM_NAME = 'Nebula';

/** How many advertisements a scanner's minute keeps count of, at most. */
const MAXIMUM_PER_MINUTE = 100_000;

/** The makers of the company ids heard most, as Nearby names them. */
const MAKERS: Readonly<Record<number, string>> = {
  6: 'Microsoft',
  76: 'Apple',
  89: 'Nordic Semiconductor',
  117: 'Samsung',
  135: 'Garmin',
  224: 'Google',
  369: 'Amazon',
  911: 'Xiaomi',
  1177: 'Ruuvi',
  2985: 'Shelly',
};

/** Why Matter's New device cannot pair over Bluetooth. */
export type MatterBleProblem = (typeof MATTER_BLE_PROBLEMS)[number];

/** An address added, as discovery and identification take it: the driver it is read as. */
export type BluetoothSighting = {
  readonly deviceKey: string;
  readonly device: BluetoothDeviceSnapshot;
};

/** How the broker reaches the devices of the house that play a role for it. */
export type BluetoothRoles = {
  /**
   * Sends an op to a device over its instance's connection.
   *
   * @throws {Error} When the device is not running, or its integration refused.
   */
  send: (deviceId: string, op: string, args: JsonObject, timeoutMs: number) => Promise<unknown>;

  /** The device a scanner names: its instance, by its connection and its device key. */
  deviceOf: (connectionKey: string, deviceKey: string) => string | undefined;
};

/** What the broker needs. */
export type BluetoothBrokerOptions = {
  readonly store: BluetoothStore;
  readonly host: BluetoothHost;
  readonly logger: PlatformLogger;

  /** The vendors loaded: their `bluetooth` rules, and the profiles that declare proxies. */
  readonly vendors: () => readonly LoadedVendor[];

  /** The instances of the house. */
  readonly instances: () => Promise<BluetoothInstance[]>;
  readonly roles: BluetoothRoles;

  /** Whether Docker runs in Docker Desktop, which passes no D-Bus; never asked when absent. */
  readonly isDesktop?: () => Promise<boolean>;

  /** How often the adapter is looked at again; every 30 s, never when 0. */
  readonly refreshMs?: number;

  /** How long an add waits for its device; 15 s unless a test says. */
  readonly addWaitMs?: number;

  /** How long a proxy job waits for the first report; a minute unless a test says. */
  readonly firstReportMs?: number;

  /** The clock, in milliseconds. */
  readonly now?: () => number;
};

/** One scanner hearing an address. */
type Hearing = { readonly rssi: number; readonly at: number };

/** An address heard. */
type Heard = {
  readonly address: string;

  /** Everything it advertised, merged: what the rules read. */
  identity: BluetoothAdvert;
  readonly firstAt: number;
  lastAt: number;
  readonly hearings: Map<string, Hearing>;

  /** What was last delivered to the transport, and when. */
  delivered: { readonly signature: string; readonly at: number } | null;
};

/** What a scanner heard lately. */
type ScannerNote = { readonly times: number[]; lastAt: number | null };

/** What the broker knows of a proxy beyond its row. */
type ProxyNote = {
  /** What it last said it is. */
  state: BluetoothProxyState | null;

  /** The filter it was last sent, and when; null to send it again. */
  filter: string | null;
  filterAt: number;
};

/** A job, as the broker changes it. */
type Job = {
  -readonly [Key in keyof BluetoothProxyJob]: BluetoothProxyJob[Key];
};

/** A step of a proxy job. */
type StepId = (typeof BLUETOOTH_PROXY_STEPS)[number];

/** An SDK scanner open. */
type OpenScanner = { readonly options: BluetoothScannerOptions; isOpen: boolean };

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
 * Whether an address is private: random, and not static (its two top bits not both set), so a
 * phone or a watch makes up a new one every few minutes.
 *
 * @param address - The address, upper case.
 * @param addressType - How it is.
 * @returns True when it is private.
 */
export function isPrivateAddress(address: string, addressType: string): boolean {
  return addressType === 'random' && (Number.parseInt(address.slice(0, 2), 16) & 0xc0) !== 0xc0;
}

/**
 * How strong a signal is, as the map draws a link.
 *
 * @param rssi - The signal, in dBm; null when unknown.
 * @returns The strength.
 */
function strengthOf(rssi: number | null): 'strong' | 'medium' | 'weak' | 'unknown' {
  if (rssi === null) {
    return 'unknown';
  }

  return rssi >= -70 ? 'strong' : rssi >= -85 ? 'medium' : 'weak';
}

/**
 * Arguments the contract takes, or a validation error.
 *
 * @param schema - What they must be.
 * @param args - What was sent.
 * @param op - The op, for the message.
 * @returns The arguments.
 * @throws {ValidationError} When they are not.
 */
function argsOf<TSchema extends z.ZodType>(
  schema: TSchema,
  args: unknown,
  op: string,
): z.output<TSchema> {
  const parsed = schema.safeParse(args);

  if (!parsed.success) {
    throw new ValidationError(`The arguments of ${op} are not ones it takes`, { details: { op } });
  }

  return parsed.data;
}

/** The house's Bluetooth broker. */
export class BluetoothBroker {
  readonly #options: BluetoothBrokerOptions;

  #state: BrokerState = 'starting';
  #error: string | null = null;
  #settings: BluetoothSettings = {
    localEnabled: true,
    adapterId: null,
    localScanMode: 'active',
    proxyScanMode: 'passive',
    forgetAfterDays: 7,
    showPrivate: false,
  };

  /** What the host has, and the adapter scanning. */
  #adapters: readonly SeenBluetoothAdapter[] = [];
  #adapter: SeenBluetoothAdapter | null = null;
  #adapterProblem: BluetoothAdapterProblem | null = null;
  #hostError: string | null = null;
  #scan: BluetoothHostScan | undefined;
  #scanKey = '';

  readonly #heard = new Map<string, Heard>();
  readonly #scanners = new Map<string, ScannerNote>();
  #proxies = new Map<string, StoredBluetoothProxy>();
  readonly #proxyNotes = new Map<string, ProxyNote>();
  #ignored = new Map<string, StoredBluetoothIgnored>();

  /** The addresses being added, as the driver each is added as. */
  readonly #adding = new Map<string, BluetoothDeviceSnapshot>();

  /** The addresses the transport follows: the house's devices that run. */
  #followed: ReadonlySet<string> = new Set();
  readonly #leases = new Map<string, number>();
  readonly #jobs = new Map<string, Job>();
  readonly #reportWaiters = new Map<string, Set<() => void>>();
  readonly #openScanners = new Map<string, OpenScanner>();
  readonly #advertListeners = new Set<(advert: BluetoothAdvert) => void>();
  readonly #deviceListeners = new Set<() => void>();
  readonly #offListeners = new Set<() => void>();
  #pairing = 0;

  #refreshing: Promise<void> = Promise.resolve();
  #filtering: Promise<void> = Promise.resolve();
  #unwatch: (() => void) | undefined;
  #timer: NodeJS.Timeout | undefined;
  #leaseTimer: NodeJS.Timeout | undefined;

  /** Whether Docker runs in Docker Desktop; undefined until the supervisor said. */
  #isDesktop: boolean | undefined;
  #askingDesktop = false;

  /** Whether the broker was stopped: the owner turning the adapter off is not that. */
  #isStopped = false;

  /**
   * Prepares the broker; nothing is read until it starts.
   *
   * @param options - What it needs.
   */
  constructor(options: BluetoothBrokerOptions) {
    this.#options = options;
  }

  /**
   * Reads what is kept, starts the adapter and tells the proxies what to forward. Never throws: a
   * failure shows on the Brokers page.
   *
   * @returns Once started, or failed.
   */
  async start(): Promise<void> {
    const { store, host } = this.#options;

    try {
      const [settings, proxies, ignored] = await Promise.all([
        store.settings(),
        store.proxies(),
        store.ignored(),
      ]);

      this.#settings = settings;
      this.#proxies = new Map(proxies.map((proxy) => [proxy.integrationId, proxy]));
      this.#ignored = new Map(ignored.map((each) => [each.address, each]));
      this.#state = 'running';
      this.#error = null;
    } catch (error: unknown) {
      this.#state = 'failed';
      this.#error = messageOf(error);
      this.#options.logger.error(
        { err: error },
        'The Bluetooth broker could not read what it keeps',
      );

      return;
    }

    this.#unwatch = host.watch(() => {
      // Something changed under the scan - power, an adapter, the bus lost: started again.
      this.#scanKey = '';
      void this.#refresh();
    });
    await this.#refresh();

    const every = this.#options.refreshMs ?? REFRESH_MS;

    if (every > 0) {
      this.#timer = setInterval(() => {
        void this.#tick();
      }, every);
      this.#timer.unref();
    }

    void this.#pushFilters();
  }

  /**
   * Stops scanning and lets go of the host.
   *
   * @returns Once stopped.
   */
  async stop(): Promise<void> {
    clearInterval(this.#timer);
    clearTimeout(this.#leaseTimer);
    this.#timer = undefined;
    this.#unwatch?.();
    this.#unwatch = undefined;
    this.#state = 'disabled';
    this.#isStopped = true;
    await this.#refreshing;
    await this.#scan?.stop().catch(() => undefined);
    this.#scan = undefined;
    this.#adapter = null;
    await this.#options.host.close();
  }

  /**
   * Where the broker stands.
   *
   * @returns Its status.
   */
  async status(): Promise<BluetoothStatus> {
    // A count on a card: a registry that cannot answer leaves the card standing.
    const instances = await this.#options.instances().catch((): BluetoothInstance[] => []);
    const house = this.#house(instances);
    const now = this.#now();
    const adapter = this.#adapter;

    return {
      state: this.#state,
      error: this.#error ?? (this.#adapterProblem === 'no-bluez' ? this.#hostError : null) ?? null,
      adapter:
        adapter === null
          ? null
          : {
              id: adapter.id,
              name: adapter.chip ?? adapter.name,
              address: adapter.address,
              isPowered: adapter.isPowered,
              scanMode: this.#scan?.mode ?? this.#settings.localScanMode,
              canPassive: adapter.canPassive,
              connections: this.#connections(),
            },
      adapters: this.#adapters.slice(0, 16).map((each) => ({
        id: each.id,
        name: each.chip ?? each.name,
        address: each.address,
        isPowered: each.isPowered,
      })),
      adapterProblem: this.#adapterProblem,
      proxies: {
        total: this.#proxies.size,
        reporting: [...this.#proxies.keys()].filter((id) => this.#isReporting(id, now)).length,
      },
      heard: {
        devices: [...this.#heard.values()].filter((entry) => this.#isFresh(entry.lastAt, now))
          .length,
        advertsPerMinute: [...this.#scanners.keys()].reduce(
          (sum, id) => sum + this.#perMinute(id, now),
          0,
        ),
      },
      isMatterPairing: this.#pairing > 0,
      isForwardingAll: this.#isForwardingAll(),
      settings: this.#settings,
      devices: {
        total: house.length,
        online: house.filter((instance) => {
          const entry = this.#heard.get(instance.externalId ?? '');

          return entry !== undefined && this.#isFresh(entry.lastAt, now);
        }).length,
      },
    };
  }

  /**
   * Saves the owner's settings: the adapter is started or stopped as they say.
   *
   * @param settings - The settings.
   * @returns Where the broker stands.
   */
  async saveSettings(settings: BluetoothSettings): Promise<BluetoothStatus> {
    await this.#options.store.saveSettings(settings);
    this.#settings = settings;
    await this.#refresh();
    this.#forget();

    return this.status();
  }

  /**
   * The Bluetooth devices of the house, by name.
   *
   * @returns Them, with who hears each and how well.
   */
  async devices(): Promise<BluetoothDevice[]> {
    const instances = await this.#options.instances();
    const names = this.#scannerNames(instances);
    const connected = new Set(this.#connectedAddresses());
    const now = this.#now();

    return this.#house(instances)
      .map((instance): BluetoothDevice => {
        const address = instance.externalId ?? '';
        const entry = this.#heard.get(address);
        const heardBy = entry === undefined ? [] : this.#hearingsOf(entry, names, now, true);

        return {
          deviceId: instance.id,
          name: instance.name.slice(0, 256),
          vendorId: instance.kind.split('/')[0] ?? instance.kind,
          areaId: instance.areaId,
          address,
          rssi: heardBy[0]?.rssi ?? null,
          heardBy: heardBy.slice(0, 64),
          lastHeardAt: entry === undefined ? null : new Date(entry.lastAt),
          link: connected.has(address) ? 'connected' : 'listening',
          addedAt: instance.createdAt,
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  /**
   * Who hears what: this server, its adapter and proxies, and each device of the house on the
   * scanner that hears it best.
   *
   * @returns The map.
   */
  async map(): Promise<BluetoothMap> {
    const instances = await this.#options.instances();
    const byId = new Map(instances.map((instance) => [instance.id, instance]));
    const now = this.#now();
    const nodes: BluetoothMap['nodes'] = [
      {
        id: 'server',
        kind: 'server',
        name: SERVER_NAME,
        deviceId: null,
        address: null,
        isOnline: true,
      },
    ];
    const links: BluetoothMap['links'] = [];
    const adapter = this.#adapter;

    if (adapter !== null) {
      nodes.push({
        id: this.#adapterScannerId(adapter),
        kind: 'adapter',
        name: adapter.chip ?? adapter.id,
        deviceId: null,
        address: adapter.address,
        isOnline: true,
      });
      // The adapter is in the server: drawn beside it, as strong as a link gets.
      links.push({
        source: this.#adapterScannerId(adapter),
        target: 'server',
        network: 'ble',
        strength: 'strong',
        rssi: null,
      });
    }

    for (const deviceId of this.#proxies.keys()) {
      const instance = byId.get(deviceId);
      const isOnline = this.#isReporting(deviceId, now);

      nodes.push({
        id: deviceId,
        kind: 'proxy',
        name: (instance?.name ?? deviceId).slice(0, 256),
        deviceId,
        address: null,
        isOnline,
      });
      links.push({
        source: deviceId,
        target: 'server',
        network: 'wifi',
        strength: isOnline ? 'unknown' : 'none',
        rssi: null,
      });
    }

    const scanners = new Set(nodes.map((node) => node.id));

    for (const instance of this.#house(instances)) {
      const address = instance.externalId ?? '';
      const entry = this.#heard.get(address);
      const best = entry === undefined ? undefined : this.#best(entry, now);

      nodes.push({
        id: address,
        kind: 'device',
        name: instance.name.slice(0, 256),
        deviceId: instance.id,
        address,
        isOnline: best !== undefined,
      });

      if (best !== undefined && scanners.has(best.scannerId)) {
        links.push({
          source: address,
          target: best.scannerId,
          network: 'ble',
          strength: strengthOf(best.rssi),
          rssi: best.rssi,
        });
      }
    }

    const last = Math.max(0, ...[...this.#heard.values()].map((entry) => entry.lastAt));

    return {
      collectedAt: last === 0 ? null : new Date(last),
      nodes: nodes.slice(0, 2048),
      links: links.slice(0, 8192),
    };
  }

  /**
   * Everything heard in the last five minutes, the loudest first; private addresses only when the
   * settings say so.
   *
   * @returns The addresses.
   */
  async nearby(): Promise<BluetoothNearby[]> {
    const instances = await this.#options.instances();
    const names = this.#scannerNames(instances);
    const house = new Map(this.#house(instances).map((each) => [each.externalId ?? '', each.id]));
    const now = this.#now();

    return [...this.#heard.values()]
      .flatMap((entry): BluetoothNearby[] => {
        const { identity } = entry;
        const isPrivate = isPrivateAddress(entry.address, identity.addressType);
        const heardBy = this.#hearingsOf(entry, names, now, true);
        const [best] = heardBy;

        if (best === undefined || (isPrivate && !this.#settings.showPrivate)) {
          return [];
        }

        const companyKey = Object.keys(identity.manufacturerData ?? {})[0];
        const companyId = companyKey === undefined ? null : Number(companyKey);

        return [
          {
            address: entry.address,
            addressType: identity.addressType,
            isPrivate,
            name: identity.name ?? null,
            maker: companyId === null ? null : (MAKERS[companyId] ?? null),
            companyId,
            serviceUuids: identity.serviceUuids ?? [],
            rssi: best.rssi,
            heardBy: heardBy.slice(0, 64),
            lastHeardAt: new Date(entry.lastAt),
            claims: this.#claimsOf(identity),
            deviceId: house.get(entry.address) ?? null,
            isIgnored: this.#ignored.has(entry.address),
            manufacturerData: identity.manufacturerData ?? {},
            serviceData: identity.serviceData ?? {},
          },
        ];
      })
      .sort((left, right) => right.rssi - left.rssi)
      .slice(0, 4096);
  }

  /**
   * Holds or renews a Nearby lease, or lets go of it: while one is held, proxies forward
   * everything they hear.
   *
   * @param leaseId - The page's lease.
   * @param isHeld - Whether it holds it now.
   * @returns Whether proxies forward everything, and until when this lease holds.
   */
  nearbyLease(
    leaseId: string,
    isHeld: boolean,
  ): { isForwardingAll: boolean; expiresAt: Date | null } {
    const wasAll = this.#isForwardingAll();
    const expiresAt = this.#now() + BLUETOOTH_NEARBY_LEASE_MS;

    if (isHeld) {
      this.#leases.set(leaseId, expiresAt);
    } else {
      this.#leases.delete(leaseId);
    }

    this.#armLeases();

    if (wasAll !== this.#isForwardingAll()) {
      void this.#pushFilters();
    }

    return {
      isForwardingAll: this.#isForwardingAll(),
      expiresAt: isHeld ? new Date(expiresAt) : null,
    };
  }

  /**
   * The devices an integration recognises that the house does not have, and those ignored.
   *
   * @returns Both.
   */
  async found(): Promise<{ items: BluetoothFound[]; ignored: StoredBluetoothIgnored[] }> {
    const instances = await this.#options.instances();
    const names = this.#scannerNames(instances);
    const house = new Set(this.#house(instances).map((each) => each.externalId));
    const now = this.#now();

    return {
      items: [...this.#heard.values()]
        .flatMap((entry): BluetoothFound[] => {
          const claims = this.#claimsOf(entry.identity);
          const [best] = this.#hearingsOf(entry, names, now, false);

          if (
            claims.length === 0 ||
            best === undefined ||
            house.has(entry.address) ||
            this.#ignored.has(entry.address)
          ) {
            return [];
          }

          return [
            {
              address: entry.address,
              name: entry.identity.name ?? null,
              rssi: best.rssi,
              scannerName: best.scannerName,
              claims,
              foundAt: new Date(entry.firstAt),
            },
          ];
        })
        .sort((left, right) => right.rssi - left.rssi),
      ignored: [...this.#ignored.values()],
    };
  }

  /**
   * Ignores an address, so it is never offered again, or stops ignoring it.
   *
   * @param address - The address.
   * @param isIgnored - Which way.
   * @returns How many addresses are ignored.
   */
  async ignore(address: string, isIgnored: boolean): Promise<number> {
    const name = this.#heard.get(address)?.identity.name ?? null;

    await this.#options.store.setIgnored(address, name, isIgnored);

    if (isIgnored) {
      this.#ignored.set(address, { address, name, at: new Date(this.#now()) });
    } else {
      this.#ignored.delete(address);
    }

    void this.#pushFilters();

    return this.#ignored.size;
  }

  /**
   * Adds a device heard, as the driver that recognises it: it is proposed to discovery, which
   * adds it at once, and answered once it is in the house.
   *
   * @param address - The address.
   * @param kind - The driver, when more than one recognises it.
   * @returns The device added.
   * @throws {NotFoundError} When the address was not heard.
   * @throws {ValidationError} When no driver, or more than one and none named, recognises it.
   * @throws {ConflictError} When it is in the house already, or was not added in time.
   */
  async add(address: string, kind: string | undefined): Promise<{ deviceId: string }> {
    const entry = this.#heard.get(address);

    if (entry === undefined) {
      throw new NotFoundError(`${address} was not heard`, { details: { address } });
    }

    const kinds = this.#claimsOf(entry.identity).flatMap((claim) =>
      claim.kind === null ? [] : [claim.kind],
    );
    const chosen = kind ?? (kinds.length === 1 ? kinds[0] : undefined);

    if (chosen === undefined || !kinds.includes(chosen)) {
      throw new ValidationError(
        kinds.length === 0
          ? `No integration recognises ${address}`
          : `Say which driver adds ${address}: ${kinds.join(', ')}`,
        { details: { address, kinds } },
      );
    }

    // shortcut: encrypted BTHome needs its key, which nothing asks for yet; take one in the add
    // request when sensors with encryption turn up in houses.
    if (
      decodeBthome(entry.identity.serviceData?.[BTHOME_SERVICE_UUID] ?? '')?.isEncrypted === true
    ) {
      throw new ValidationError(`${address} encrypts its readings: Nebula cannot read them yet`, {
        details: { address },
      });
    }

    const already = await this.#instanceOf(address);

    if (already !== undefined) {
      throw new ConflictError(`${address} is in the house already`, {
        details: { address, deviceId: already },
      });
    }

    const name = (entry.identity.name ?? this.#claimsOf(entry.identity)[0]?.model ?? address).slice(
      0,
      256,
    );

    this.#adding.set(address, { deviceKey: address, kind: chosen, name, advert: entry.identity });
    this.#changed();
    void this.#pushFilters();

    try {
      const deadline = this.#now() + (this.#options.addWaitMs ?? ADD_WAIT_MS);

      // Polled: discovery proposes it, `api` adds it, and only the registry says when.
      for (;;) {
        // eslint-disable-next-line no-await-in-loop -- see above
        const deviceId = await this.#instanceOf(address);

        if (deviceId !== undefined) {
          return { deviceId };
        }

        if (this.#now() > deadline) {
          throw new ConflictError(
            `${address} was not added in time: its integration may need setting up`,
            {
              details: { address, kind: chosen },
            },
          );
        }

        // eslint-disable-next-line no-await-in-loop -- see above
        await new Promise((resolve) => setTimeout(resolve, ADD_POLL_MS));
      }
    } finally {
      this.#adding.delete(address);
      this.#changed();
    }
  }

  /**
   * The addresses being added, as discovery proposes them.
   *
   * @returns Them.
   */
  sightings(): BluetoothSighting[] {
    return [...this.#adding.values()].map((device) => ({ deviceKey: device.deviceKey, device }));
  }

  /**
   * Every address as each driver that recognises it, for identification to take the one an
   * instance is bound to: those being added, and every one recognised.
   *
   * @returns The devices.
   */
  snapshots(): BluetoothDeviceSnapshot[] {
    const recognised = [...this.#heard.values()].flatMap((entry) =>
      this.#claimsOf(entry.identity).flatMap((claim): BluetoothDeviceSnapshot[] =>
        claim.kind === null || this.#adding.has(entry.address)
          ? []
          : [
              {
                deviceKey: entry.address,
                kind: claim.kind,
                name: (entry.identity.name ?? claim.model ?? entry.address).slice(0, 256),
                advert: entry.identity,
              },
            ],
      ),
    );

    return [...this.#adding.values(), ...recognised];
  }

  /**
   * Says when the addresses being added change.
   *
   * @param listener - Called after each change.
   * @returns Stops it.
   */
  onDevices(listener: () => void): () => void {
    this.#deviceListeners.add(listener);

    return () => this.#deviceListeners.delete(listener);
  }

  /**
   * Hears every advertisement worth delivering: one carrying something new, or one a minute.
   *
   * @param listener - Called with each.
   * @returns Stops hearing.
   */
  onAdvert(listener: (advert: BluetoothAdvert) => void): () => void {
    this.#advertListeners.add(listener);

    return () => this.#advertListeners.delete(listener);
  }

  /**
   * Notes the addresses the transport follows: the house's devices whose instances run.
   *
   * @param addresses - Them.
   */
  follow(addresses: ReadonlySet<string>): void {
    const isChanged =
      addresses.size !== this.#followed.size ||
      [...addresses].some((address) => !this.#followed.has(address));

    this.#followed = addresses;

    if (isChanged) {
      void this.#pushFilters();
    }
  }

  /**
   * Reads, writes or follows a characteristic on the local adapter, for the transport.
   *
   * @param request - A `gatt.*` op.
   * @param deliver - Where a followed characteristic's values go.
   * @returns What the op answers: `{ data }` for a read, null otherwise.
   * @throws {ConflictError} When the adapter cannot connect, or only proxies hear the device.
   * @throws {ValidationError} When the op is not a GATT op, or its arguments are not.
   */
  async gatt(request: TransportRequest, deliver: (payload: JsonObject) => void): Promise<unknown> {
    const adapter = this.#adapter;
    const address = bluetoothAddressSchema.safeParse(request.deviceKey);

    if (!address.success) {
      throw new ValidationError(`${request.deviceKey} is not a Bluetooth address`, {
        details: { deviceKey: request.deviceKey },
      });
    }

    if (adapter === null) {
      throw new ConflictError(
        `The server’s Bluetooth adapter cannot connect (${this.#adapterProblem ?? 'no adapter'})`,
        { details: { address: address.data } },
      );
    }

    const entry = this.#heard.get(address.data);

    if (
      entry !== undefined &&
      entry.hearings.size > 0 &&
      !entry.hearings.has(this.#adapterScannerId(adapter))
    ) {
      throw new ConflictError(
        `Only proxies hear ${address.data}, and proxies listen without connecting`,
        { details: { address: address.data } },
      );
    }

    const { host } = this.#options;

    switch (request.op) {
      case 'gatt.read': {
        const args = argsOf(bluetoothGattReadArgsSchema, request.args, request.op);

        return {
          data: await host.read(adapter.id, address.data, args.service, args.characteristic),
        };
      }

      case 'gatt.write': {
        const args = argsOf(bluetoothGattWriteArgsSchema, request.args, request.op);

        await host.write(
          adapter.id,
          address.data,
          args.service,
          args.characteristic,
          args.data,
          args.withResponse,
        );

        return null;
      }

      case 'gatt.notify': {
        const args = argsOf(bluetoothGattNotifyArgsSchema, request.args, request.op);

        await host.notify(
          adapter.id,
          address.data,
          args.service,
          args.characteristic,
          args.isOn
            ? (data) => {
                deliver({ service: args.service, characteristic: args.characteristic, data });
              }
            : null,
        );

        return null;
      }

      default:
        throw new ValidationError(`The ${BLUETOOTH_TRANSPORT} transport has no ${request.op} op`, {
          details: { op: request.op },
        });
    }
  }

  /**
   * The scanners: the local adapter first, then the proxies by name.
   *
   * @returns Them.
   */
  async scanners(): Promise<BluetoothScanner[]> {
    const instances = await this.#options.instances();
    const names = this.#scannerNames(instances);
    const byId = new Map(instances.map((instance) => [instance.id, instance]));
    const now = this.#now();
    const adapter =
      this.#adapter ??
      this.#adapters.find((each) => each.id === (this.#settings.adapterId ?? each.id));
    const local: BluetoothScanner[] =
      adapter === undefined
        ? []
        : [
            {
              id: this.#adapterScannerId(adapter),
              kind: 'adapter',
              name: SERVER_NAME,
              deviceId: null,
              vendorId: null,
              areaId: null,
              address: adapter.address,
              chip: adapter.chip ?? adapter.name,
              isOnline: this.#adapter !== null,
              isEnabled: this.#settings.localEnabled,
              scanMode: this.#scan?.mode ?? this.#settings.localScanMode,
              canPassive: adapter.canPassive,
              advertsPerMinute: this.#perMinute(this.#adapterScannerId(adapter), now),
              connections: this.#connections(),
              forwarding: null,
              lastReportAt: this.#lastAt(this.#adapterScannerId(adapter)),
              script: null,
              hearsBest: this.#hearsBest(this.#adapterScannerId(adapter), instances, now),
            },
          ];
    const proxies = [...this.#proxies.values()]
      .map((proxy): BluetoothScanner => {
        const instance = byId.get(proxy.integrationId);
        const shipped = this.#shippedOf(proxy.integrationId);

        return {
          id: proxy.integrationId,
          kind: 'proxy',
          name: (names.get(proxy.integrationId) ?? proxy.integrationId).slice(0, 256),
          deviceId: proxy.integrationId,
          vendorId: instance?.kind.split('/')[0] ?? null,
          areaId: instance?.areaId ?? null,
          address: null,
          chip: null,
          isOnline: this.#isReporting(proxy.integrationId, now),
          isEnabled: true,
          scanMode: proxy.scanMode,
          canPassive: this.#modesOf(instance?.kind ?? '').includes('passive'),
          advertsPerMinute: this.#perMinute(proxy.integrationId, now),
          connections: null,
          forwarding: this.#isForwardingAll() ? 'everything' : 'house',
          lastReportAt: this.#lastAt(proxy.integrationId),
          script: {
            version: proxy.scriptVersion,
            shipped,
            isOutdated: isOutdated(proxy.scriptVersion, shipped),
          },
          hearsBest: this.#hearsBest(proxy.integrationId, instances, now),
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name));

    return [...local, ...proxies];
  }

  /**
   * The devices whose integration can make them proxies, asked whether they can be one: those
   * that can first.
   *
   * shortcut: `wifiRssi` is not read; read the device's signal-strength sensor when the picker
   * needs it.
   *
   * @param deviceId - One device, as its own page asks; every one when absent.
   * @returns The candidates.
   */
  async proxyCandidates(deviceId?: string): Promise<BluetoothProxyCandidate[]> {
    const candidates = (await this.#options.instances()).filter(
      (instance) =>
        (deviceId === undefined || instance.id === deviceId) &&
        this.#modesOf(instance.kind).length > 0,
    );
    const views = await Promise.all(
      candidates.map(async (instance): Promise<BluetoothProxyCandidate> => {
        const isOnline = instance.state === 'running';

        return {
          deviceId: instance.id,
          name: instance.name.slice(0, 256),
          vendorId: instance.kind.split('/')[0] ?? instance.kind,
          areaId: instance.areaId,
          isOnline,
          wifiRssi: null,
          proxy: isOnline ? await this.#askState(instance.id) : null,
          modes: this.#modesOf(instance.kind),
        };
      }),
    );

    return views.sort(
      (left, right) =>
        Number(right.proxy?.eligible === true) - Number(left.proxy?.eligible === true) ||
        left.name.localeCompare(right.name),
    );
  }

  /**
   * Starts making a device a proxy: the script installed, started, its first report.
   *
   * @param deviceId - The device.
   * @param mode - How it scans.
   * @returns The job, running; the one running already for the device.
   * @throws {NotFoundError} When the device's integration cannot make it a proxy.
   * @throws {ValidationError} When it cannot scan so.
   */
  async addProxy(deviceId: string, mode: BluetoothScanMode): Promise<BluetoothProxyJob> {
    await this.#requireModes(deviceId, mode);

    return this.#startJob(deviceId, mode);
  }

  /**
   * Installs the script the integration ships now over the one on a proxy, as a job.
   *
   * @param deviceId - The proxy.
   * @returns The job.
   * @throws {NotFoundError} When the device is not a proxy.
   */
  updateScript(deviceId: string): BluetoothProxyJob {
    return this.#startJob(deviceId, this.#requireProxy(deviceId).scanMode);
  }

  /**
   * Reads a proxy job.
   *
   * @param jobId - The job.
   * @returns It.
   * @throws {NotFoundError} When there is no such job.
   */
  job(jobId: string): BluetoothProxyJob {
    const job = this.#jobs.get(jobId);

    if (job === undefined) {
      throw new NotFoundError(`There is no Bluetooth proxy job ${jobId}`, { details: { jobId } });
    }

    return { ...job, steps: job.steps.map((step) => ({ ...step })) };
  }

  /**
   * Changes how a proxy scans: its integration installs the script again in the new mode.
   *
   * @param deviceId - The proxy.
   * @param mode - How it scans now.
   * @returns The proxy, as the Scanners tab lists it.
   * @throws {NotFoundError} When the device is not a proxy.
   * @throws {ValidationError} When it cannot scan so.
   * @throws {ConflictError} When its integration refused.
   */
  async setProxyMode(deviceId: string, mode: BluetoothScanMode): Promise<BluetoothScanner> {
    const proxy = this.#requireProxy(deviceId);

    await this.#requireModes(deviceId, mode);

    try {
      await this.#options.roles.send(
        deviceId,
        BLUETOOTH_PROXY_OPS.install,
        { mode },
        INSTALL_TIMEOUT_MS,
      );
    } catch (error: unknown) {
      throw new ConflictError(messageOf(error), { details: { deviceId } });
    }

    await this.#saveProxy({ ...proxy, scanMode: mode });

    const view = (await this.scanners()).find((scanner) => scanner.id === deviceId);

    if (view === undefined) {
      throw new NotFoundError(`${deviceId} is not a Bluetooth proxy`, { details: { deviceId } });
    }

    return view;
  }

  /**
   * Stops a device being a proxy: its script is removed, then its row.
   *
   * @param deviceId - The proxy.
   * @returns Whether it was one.
   * @throws {ConflictError} When its integration could not remove the script: it stays a proxy.
   */
  async removeProxy(deviceId: string): Promise<boolean> {
    if (!this.#proxies.has(deviceId)) {
      return false;
    }

    try {
      await this.#options.roles.send(deviceId, BLUETOOTH_PROXY_OPS.remove, {}, OP_TIMEOUT_MS);
    } catch (error: unknown) {
      throw new ConflictError(messageOf(error), { details: { deviceId } });
    }

    const isRemoved = await this.#options.store.removeProxy(deviceId);

    this.releaseInstance(deviceId);
    this.#settle();

    return isRemoved;
  }

  /**
   * Forgets what is kept here of a device removed from the house; its proxy row goes with its
   * instance's.
   *
   * @param deviceId - The device.
   */
  releaseInstance(deviceId: string): void {
    this.#proxies.delete(deviceId);
    this.#proxyNotes.delete(deviceId);
    this.#scanners.delete(deviceId);

    for (const entry of this.#heard.values()) {
      entry.hearings.delete(deviceId);
    }
  }

  /**
   * Opens a proxy's scanner, for a vendor's code through the SDK. One per proxy: opening it
   * again replaces the first.
   *
   * @param vendorId - The vendor whose code opens it.
   * @param options - The proxy: its connection and its device key.
   * @returns The scanner.
   */
  scanner(vendorId: string, options: BluetoothScannerOptions): SdkScanner {
    const key = `${vendorId}\n${options.key}\n${options.deviceKey}`;
    const open: OpenScanner = { options, isOpen: true };
    const previous = this.#openScanners.get(key);

    if (previous !== undefined) {
      previous.isOpen = false;
    }

    this.#openScanners.set(key, open);

    // Opened as the proxy's connection comes up: it may have restarted, so it is told again what
    // to forward, and asked which script it runs.
    const deviceId = this.#options.roles.deviceOf(options.key, options.deviceKey);

    if (deviceId !== undefined && this.#proxies.has(deviceId)) {
      this.#noteOf(deviceId).filter = null;
      void this.#pushFilters();
      void this.#askState(deviceId);
    }

    return {
      /**
       * Takes what the proxy heard.
       *
       * @param adverts - The advertisements; one that does not hold is dropped.
       */
      report: (adverts: readonly BluetoothAdvertInput[]) => {
        if (open.isOpen) {
          this.#report(options, adverts);
        }
      },

      /** Stops taking what it hears. */
      close: () => {
        open.isOpen = false;

        if (this.#openScanners.get(key) === open) {
          this.#openScanners.delete(key);
        }
      },
    };
  }

  /**
   * Whether Matter can pair a device over the local adapter now, and why not.
   *
   * @returns The answer, with the reason Matter's status gives.
   */
  canConnect(): { isAvailable: boolean; reason: MatterBleProblem | null } {
    if (this.#adapter !== null) {
      return { isAvailable: true, reason: null };
    }

    const problem = this.#adapterProblem;

    if (problem === 'desktop') {
      return { isAvailable: false, reason: 'desktop' };
    }

    if (problem === 'powered-off' || problem === 'disabled') {
      return { isAvailable: false, reason: 'adapter-off' };
    }

    return { isAvailable: false, reason: this.#proxies.size > 0 ? 'proxies-only' : 'no-adapter' };
  }

  /**
   * Notes that Matter is pairing a device over the local adapter, or stopped.
   *
   * @param isPairing - Which.
   */
  markPairing(isPairing: boolean): void {
    this.#pairing = Math.max(0, this.#pairing + (isPairing ? 1 : -1));
  }

  /**
   * Hears the local adapter stop being usable: turned off by the owner, powered off, gone.
   *
   * @param listener - Called on each such change.
   * @returns Stops hearing.
   */
  onAdapterOff(listener: () => void): () => void {
    this.#offListeners.add(listener);

    return () => this.#offListeners.delete(listener);
  }

  /**
   * Reads the integrations' rules again: one added or removed recognises other devices, so
   * proxies are told again what to forward.
   */
  reidentify(): void {
    this.#changed();
    void this.#pushFilters();
  }

  /**
   * Looks at the adapter now, one look after another.
   *
   * @returns Once looked.
   */
  async #refresh(): Promise<void> {
    this.#refreshing = this.#refreshing.then(async () => this.#refreshAdapter());
    await this.#refreshing;
  }

  /**
   * Picks the adapter the settings say, and scans on it in their mode when it can; otherwise
   * says why not.
   *
   * @returns Once done; a failure is logged.
   */
  async #refreshAdapter(): Promise<void> {
    if (this.#isStopped || this.#state === 'failed') {
      return;
    }

    const wasUsable = this.#adapter !== null;
    const { host, logger } = this.#options;

    try {
      const seen = await host.adapters();
      const chosen =
        this.#settings.adapterId === null
          ? seen.adapters[0]
          : seen.adapters.find((each) => each.id === this.#settings.adapterId);
      let problem: BluetoothAdapterProblem | null = null;

      this.#adapters = seen.adapters;
      this.#hostError = seen.error;

      if (!this.#settings.localEnabled) {
        problem = 'disabled';
      } else if (seen.problem !== null || chosen === undefined) {
        problem = this.#isDesktop === true ? 'desktop' : (seen.problem ?? 'no-adapter');
        this.#askDesktop();
      } else if (!chosen.isPowered) {
        problem = 'powered-off';
      }

      if (problem !== null || chosen === undefined) {
        await this.#stopScan();
      } else {
        const key = `${chosen.id}/${this.#settings.localScanMode}`;

        if (this.#scan === undefined || this.#scanKey !== key) {
          await this.#stopScan();

          const scannerId = this.#adapterScannerId(chosen);

          try {
            this.#scan = await host.scan(chosen.id, this.#settings.localScanMode, (advert) => {
              this.#hear(scannerId, advert);
            });
            this.#scanKey = key;
          } catch (error: unknown) {
            problem = 'no-adapter';
            this.#hostError = messageOf(error);
            logger.warn({ err: error, adapter: chosen.id }, 'The Bluetooth adapter would not scan');
          }
        }
      }

      this.#adapter = problem === null && chosen !== undefined ? chosen : null;
      this.#adapterProblem = problem;
    } catch (error: unknown) {
      logger.warn({ err: error }, 'Could not look at the Bluetooth adapter');
    }

    this.#settle();

    if (wasUsable && this.#adapter === null) {
      for (const listener of this.#offListeners) {
        listener();
      }
    }
  }

  /**
   * Stops the adapter's scan.
   *
   * @returns Once stopped.
   */
  async #stopScan(): Promise<void> {
    const scan = this.#scan;

    this.#scan = undefined;
    this.#scanKey = '';
    await scan?.stop().catch(() => undefined);
  }

  /** Says whether the broker has anything to listen with: the adapter, or a proxy. */
  #settle(): void {
    if (this.#isStopped || this.#state === 'failed') {
      return;
    }

    this.#state =
      this.#adapter !== null || this.#proxies.size > 0
        ? 'running'
        : this.#adapterProblem === 'disabled'
          ? 'disabled'
          : 'unavailable';
  }

  /**
   * Asks whether Docker runs in Docker Desktop, without waiting: a supervisor that is not up holds
   * nothing, and is asked again at the next look until it answers.
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

          if (isDesktop && this.#adapter === null && this.#adapterProblem !== 'disabled') {
            this.#adapterProblem = 'desktop';
          }
        },
        () => undefined,
      )
      .finally(() => {
        this.#askingDesktop = false;
      });
  }

  /**
   * Looks at the adapter again, drops what was not heard for too long, sends filters, and lets go
   * of old jobs.
   *
   * @returns Once done.
   */
  async #tick(): Promise<void> {
    await this.#refresh();
    this.#forget();
    await this.#pushFilters();

    const before = this.#now() - JOB_KEEP_MS;

    for (const [id, job] of this.#jobs) {
      if (job.finishedAt !== null && job.finishedAt.getTime() < before) {
        this.#jobs.delete(id);
      }
    }
  }

  /** Drops the addresses not heard for the owner's number of days. */
  #forget(): void {
    const before = this.#now() - this.#settings.forgetAfterDays * DAY_MS;

    for (const [address, entry] of this.#heard) {
      if (entry.lastAt < before) {
        this.#heard.delete(address);
      }
    }
  }

  /**
   * Takes what a proxy reported, as heard by it.
   *
   * @param options - The proxy's scanner.
   * @param adverts - What it heard.
   */
  #report(options: BluetoothScannerOptions, adverts: readonly BluetoothAdvertInput[]): void {
    const deviceId = this.#options.roles.deviceOf(options.key, options.deviceKey);

    // A device not made a proxy here - its row removed, the script left on it - is not listened to.
    if (deviceId === undefined || !this.#proxies.has(deviceId)) {
      return;
    }

    for (const advert of adverts.slice(0, 1024)) {
      const parsed = bluetoothAdvertSchema.safeParse(advert);

      if (parsed.success) {
        this.#hear(deviceId, {
          ...parsed.data,
          // A proxy may write a 16-bit UUID on the Bluetooth base in full.
          ...(parsed.data.serviceData === undefined
            ? {}
            : {
                serviceData: Object.fromEntries(
                  Object.entries(parsed.data.serviceData).map(([uuid, hex]) => [
                    shortUuid(uuid),
                    hex,
                  ]),
                ),
              }),
          ...(parsed.data.serviceUuids === undefined
            ? {}
            : { serviceUuids: parsed.data.serviceUuids.map(shortUuid) }),
        });
      }
    }

    // Counted as reporting even when it heard nothing: it said so.
    this.#noteScanner(deviceId, false);

    for (const waiter of this.#reportWaiters.get(deviceId) ?? []) {
      waiter();
    }

    this.#reportWaiters.delete(deviceId);
  }

  /**
   * Keeps one advertisement a scanner heard, and delivers it when it carries something new.
   *
   * @param scannerId - Who heard it.
   * @param advert - What.
   */
  #hear(scannerId: string, advert: BluetoothAdvert): void {
    const now = this.#now();
    const kept = this.#heard.get(advert.address);
    const name = advert.name ?? kept?.identity.name;
    const identity: BluetoothAdvert = {
      ...advert,
      ...(name === undefined ? {} : { name }),
      manufacturerData: { ...kept?.identity.manufacturerData, ...advert.manufacturerData },
      serviceData: { ...kept?.identity.serviceData, ...advert.serviceData },
      serviceUuids: [
        ...new Set([...(kept?.identity.serviceUuids ?? []), ...(advert.serviceUuids ?? [])]),
      ].slice(0, 64),
    };
    const entry: Heard = kept ?? {
      address: advert.address,
      identity,
      firstAt: now,
      lastAt: now,
      hearings: new Map(),
      delivered: null,
    };

    entry.identity = identity;
    entry.lastAt = now;
    entry.hearings.set(scannerId, { rssi: advert.rssi, at: now });
    this.#heard.set(advert.address, entry);
    this.#noteScanner(scannerId, true);

    const signature = JSON.stringify([advert.name, advert.manufacturerData, advert.serviceData]);

    if (entry.delivered?.signature !== signature || now - entry.delivered.at >= DELIVER_AGAIN_MS) {
      entry.delivered = { signature, at: now };

      for (const listener of this.#advertListeners) {
        listener(advert);
      }
    }
  }

  /**
   * Notes that a scanner said something.
   *
   * @param scannerId - The scanner.
   * @param isAdvert - Whether it was an advertisement, which counts towards its minute.
   */
  #noteScanner(scannerId: string, isAdvert: boolean): void {
    const now = this.#now();
    const note = this.#scanners.get(scannerId) ?? { times: [], lastAt: null };

    note.lastAt = now;

    if (isAdvert) {
      note.times.push(now);

      if (note.times.length > MAXIMUM_PER_MINUTE) {
        note.times.splice(0, note.times.length - MAXIMUM_PER_MINUTE);
      }
    }

    this.#scanners.set(scannerId, note);
  }

  /**
   * How many advertisements a scanner heard in the last minute.
   *
   * @param scannerId - The scanner.
   * @param now - The time now.
   * @returns The count.
   */
  #perMinute(scannerId: string, now: number): number {
    const times = this.#scanners.get(scannerId)?.times;

    if (times === undefined) {
      return 0;
    }

    const first = times.findIndex((at) => at > now - 60_000);

    times.splice(0, first === -1 ? times.length : first);

    return times.length;
  }

  /**
   * When a scanner last said something.
   *
   * @param scannerId - The scanner.
   * @returns The time, or null.
   */
  #lastAt(scannerId: string): Date | null {
    const at = this.#scanners.get(scannerId)?.lastAt ?? null;

    return at === null ? null : new Date(at);
  }

  /**
   * Whether a proxy reported lately.
   *
   * @param deviceId - The proxy.
   * @param now - The time now.
   * @returns True when it did.
   */
  #isReporting(deviceId: string, now: number): boolean {
    const at = this.#scanners.get(deviceId)?.lastAt ?? null;

    return at !== null && now - at < REPORTING_MS;
  }

  /**
   * Whether something heard at a time counts as heard now.
   *
   * @param at - When.
   * @param now - The time now.
   * @returns True within the last five minutes.
   */
  #isFresh(at: number, now: number): boolean {
    return now - at <= BLUETOOTH_HEARD_WINDOW_MS;
  }

  /**
   * The scanners hearing an address, the best first: the loudest, then the latest.
   *
   * @param entry - The address.
   * @param names - The scanners' names.
   * @param now - The time now.
   * @param isFreshOnly - Whether only the last five minutes count; else the fresh ones first.
   * @returns The hearings.
   */
  #hearingsOf(
    entry: Heard,
    names: ReadonlyMap<string, string>,
    now: number,
    isFreshOnly: boolean,
  ): BluetoothHearing[] {
    return [...entry.hearings.entries()]
      .filter(([, hearing]) => !isFreshOnly || this.#isFresh(hearing.at, now))
      .sort(
        ([, left], [, right]) =>
          Number(this.#isFresh(right.at, now)) - Number(this.#isFresh(left.at, now)) ||
          right.rssi - left.rssi ||
          right.at - left.at,
      )
      .map(([scannerId, hearing]) => ({
        scannerId,
        scannerName: (names.get(scannerId) ?? scannerId).slice(0, 256),
        rssi: hearing.rssi,
        at: new Date(hearing.at),
      }));
  }

  /**
   * The scanner hearing an address best now.
   *
   * @param entry - The address.
   * @param now - The time now.
   * @returns It and how loud, or undefined when nobody heard it lately.
   */
  #best(entry: Heard, now: number): { scannerId: string; rssi: number } | undefined {
    const [best] = this.#hearingsOf(entry, new Map(), now, true);

    return best === undefined ? undefined : { scannerId: best.scannerId, rssi: best.rssi };
  }

  /**
   * The addresses a scanner hears best of every scanner: where a new proxy would help.
   *
   * @param scannerId - The scanner.
   * @param instances - The house, for each address's device.
   * @param now - The time now.
   * @returns Them, the loudest first.
   */
  #hearsBest(
    scannerId: string,
    instances: readonly BluetoothInstance[],
    now: number,
  ): BluetoothScanner['hearsBest'] {
    const house = new Map(this.#house(instances).map((each) => [each.externalId ?? '', each]));

    return [...this.#heard.values()]
      .flatMap((entry) => {
        const best = this.#best(entry, now);
        const device = house.get(entry.address);

        return best?.scannerId === scannerId
          ? [
              {
                address: entry.address,
                name: (device?.name ?? entry.identity.name ?? null)?.slice(0, 256) ?? null,
                deviceId: device?.id ?? null,
                rssi: best.rssi,
              },
            ]
          : [];
      })
      .sort((left, right) => right.rssi - left.rssi)
      .slice(0, 4096);
  }

  /**
   * The scanners' names: the server's, and each proxy's device's.
   *
   * @param instances - The house.
   * @returns The names, by scanner id.
   */
  #scannerNames(instances: readonly BluetoothInstance[]): Map<string, string> {
    const names = new Map(
      instances
        .filter((instance) => this.#proxies.has(instance.id))
        .map((instance) => [instance.id, instance.name]),
    );

    for (const adapter of this.#adapters) {
      names.set(this.#adapterScannerId(adapter), SERVER_NAME);
    }

    return names;
  }

  /**
   * The Bluetooth devices of the house: instances on the transport, identified by an address.
   *
   * @param instances - Every instance.
   * @returns Theirs.
   */
  #house(instances: readonly BluetoothInstance[]): BluetoothInstance[] {
    return instances.filter(
      (instance) =>
        instance.transport === BLUETOOTH_TRANSPORT &&
        instance.externalId !== null &&
        bluetoothAddressSchema.safeParse(instance.externalId).success,
    );
  }

  /**
   * The device of the house an address is.
   *
   * @param address - The address.
   * @returns Its instance, or undefined.
   */
  async #instanceOf(address: string): Promise<string | undefined> {
    return this.#house(await this.#options.instances()).find(
      (instance) => instance.externalId?.toUpperCase() === address,
    )?.id;
  }

  /**
   * The integrations whose `bluetooth` rules recognise what an address advertised - the
   * platform's own BTHome among them - with the driver each would add it as.
   *
   * @param identity - What it advertised, merged.
   * @returns The claims.
   */
  #claimsOf(identity: BluetoothAdvert): BluetoothClaim[] {
    return this.#options
      .vendors()
      .flatMap((vendor): BluetoothClaim[] => {
        const plan = vendor.discovery?.plan;

        if (
          plan?.discovery.bluetooth === undefined ||
          !matchesBroker(plan, 'bluetooth', identity)
        ) {
          return [];
        }

        const association = associateBroker(plan, 'bluetooth', identity);

        return [
          {
            vendorId: vendor.manifest.id,
            vendorName: (vendor.manifest.id === BLUETOOTH_VENDOR
              ? PLATFORM_NAME
              : vendor.manifest.name
            ).slice(0, 128),
            kind: association === null ? null : `${vendor.manifest.id}/${association.driverId}`,
            model: association?.model?.slice(0, 128) ?? null,
          },
        ];
      })
      .slice(0, 16);
  }

  /**
   * The scan modes a driver's profile says its devices can proxy in.
   *
   * @param kind - The driver, `vendor/driver`.
   * @returns The modes; none for a driver whose devices are not proxies.
   */
  #modesOf(kind: string): BluetoothScanMode[] {
    const [vendorId] = kind.split('/');
    const vendor = this.#options.vendors().find((each) => each.manifest.id === vendorId);

    return [
      ...(vendor?.drivers.find((driver) => driver.manifest.id === kind)?.bluetoothProxy?.modes ??
        []),
    ];
  }

  /**
   * Checks that a device can proxy in a mode.
   *
   * @param deviceId - The device.
   * @param mode - The mode.
   * @returns Once checked.
   * @throws {NotFoundError} When its integration cannot make it a proxy.
   * @throws {ValidationError} When it cannot scan so.
   */
  async #requireModes(deviceId: string, mode: BluetoothScanMode): Promise<void> {
    const instance = (await this.#options.instances()).find((each) => each.id === deviceId);
    const modes = this.#modesOf(instance?.kind ?? '');

    if (modes.length === 0) {
      throw new NotFoundError(`${deviceId} cannot be a Bluetooth proxy`, { details: { deviceId } });
    }

    if (!modes.includes(mode)) {
      throw new ValidationError(`${deviceId} cannot scan ${mode}`, { details: { deviceId, mode } });
    }
  }

  /**
   * A proxy by its device.
   *
   * @param deviceId - The device.
   * @returns Its row.
   * @throws {NotFoundError} When it is not a proxy.
   */
  #requireProxy(deviceId: string): StoredBluetoothProxy {
    const proxy = this.#proxies.get(deviceId);

    if (proxy === undefined) {
      throw new NotFoundError(`${deviceId} is not a Bluetooth proxy`, { details: { deviceId } });
    }

    return proxy;
  }

  /**
   * Asks a device whether it can be a proxy and whether it is, and keeps the answer.
   *
   * @param deviceId - The device.
   * @returns What it said; null when it did not answer, or not as the contract says.
   */
  async #askState(deviceId: string): Promise<BluetoothProxyState | null> {
    try {
      const answer = await this.#options.roles.send(
        deviceId,
        BLUETOOTH_PROXY_OPS.state,
        {},
        OP_TIMEOUT_MS,
      );
      const parsed = bluetoothProxyStateSchema.safeParse(answer);

      if (!parsed.success) {
        this.#options.logger.warn(
          { deviceId },
          'A proxy answered its state not as the contract says',
        );

        return null;
      }

      this.#noteOf(deviceId).state = parsed.data;

      return parsed.data;
    } catch (error: unknown) {
      this.#options.logger.debug(
        { err: error, deviceId },
        'A device did not say whether it proxies',
      );

      return null;
    }
  }

  /**
   * The script version a proxy's integration ships now, as the proxy last said.
   *
   * @param deviceId - The proxy.
   * @returns It, or null while it did not say.
   */
  #shippedOf(deviceId: string): string | null {
    const state = this.#proxyNotes.get(deviceId)?.state;

    return state?.eligible === true ? state.shipped : null;
  }

  /**
   * What the broker knows of a proxy beyond its row.
   *
   * @param deviceId - The proxy.
   * @returns Its note, made when missing.
   */
  #noteOf(deviceId: string): ProxyNote {
    const note = this.#proxyNotes.get(deviceId) ?? { state: null, filter: null, filterAt: 0 };

    this.#proxyNotes.set(deviceId, note);

    return note;
  }

  /**
   * Keeps a proxy, and the copy here.
   *
   * @param proxy - The proxy.
   * @returns Once kept.
   */
  async #saveProxy(proxy: StoredBluetoothProxy): Promise<void> {
    const saved = await this.#options.store.saveProxy(proxy);

    this.#proxies.set(saved.integrationId, saved);
    this.#settle();
  }

  /**
   * Starts a proxy job, unless one runs for the device already.
   *
   * @param deviceId - The device.
   * @param mode - How it scans.
   * @returns The job.
   */
  #startJob(deviceId: string, mode: BluetoothScanMode): BluetoothProxyJob {
    const running = [...this.#jobs.values()].find(
      (each) => each.deviceId === deviceId && each.state === 'running',
    );

    if (running !== undefined) {
      return this.job(running.id);
    }

    const job: Job = {
      id: randomUUID(),
      state: 'running',
      startedAt: new Date(this.#now()),
      finishedAt: null,
      error: null,
      deviceId,
      mode,
      steps: BLUETOOTH_PROXY_STEPS.map((id) => ({ id, state: 'pending', message: null })),
    };

    this.#jobs.set(job.id, job);
    void this.#runJob(job);

    return this.job(job.id);
  }

  /**
   * Runs a proxy job: installs the script, checks it started, waits for its first report. A
   * failure stops on its step with what the integration said.
   *
   * @param job - The job.
   * @returns Once it ended.
   */
  async #runJob(job: Job): Promise<void> {
    const { roles } = this.#options;
    let current: StepId = 'installing';

    /**
     * Moves a step on.
     *
     * @param id - The step.
     * @param state - Where it stands now.
     * @param message - What it found.
     */
    const step = (
      id: StepId,
      state: BluetoothProxyJob['steps'][number]['state'],
      message: string | null = null,
    ): void => {
      job.steps = job.steps.map((each) => (each.id === id ? { ...each, state, message } : each));
    };

    try {
      step('installing', 'running');
      await roles.send(
        job.deviceId,
        BLUETOOTH_PROXY_OPS.install,
        { mode: job.mode },
        INSTALL_TIMEOUT_MS,
      );

      let state = await this.#askState(job.deviceId);

      // A script just installed may take a moment to say it runs.
      for (
        let tries = 1;
        state?.eligible === true && !state.running && tries < START_TRIES;
        tries += 1
      ) {
        // eslint-disable-next-line no-await-in-loop -- one ask a second, by design
        await new Promise((resolve) => setTimeout(resolve, START_ASK_MS));
        // eslint-disable-next-line no-await-in-loop -- see above
        state = await this.#askState(job.deviceId);
      }

      const version = state?.eligible === true ? (state.version ?? null) : null;

      await this.#saveProxy({
        integrationId: job.deviceId,
        scanMode: job.mode,
        scriptVersion: version,
        installedAt: new Date(this.#now()),
      });
      step('installing', 'done', version === null ? null : `Script ${version}`);
      current = 'started';
      step('started', 'running');

      if (state?.eligible !== true || !state.running) {
        throw new Error(
          state?.eligible === false
            ? `The device cannot be a proxy (${state.reason})`
            : 'The script was installed but is not running',
        );
      }

      step('started', 'done');
      this.#noteOf(job.deviceId).filter = null;
      void this.#pushFilters();
      current = 'first-report';
      step('first-report', 'running');
      await this.#firstReport(job.deviceId, job.startedAt.getTime());
      step('first-report', 'done');
      job.state = 'succeeded';
    } catch (error: unknown) {
      const message = messageOf(error);

      step(current, 'failed', message);
      job.state = 'failed';
      job.error = message;
      this.#options.logger.warn(
        { deviceId: job.deviceId, step: current, err: error },
        'A Bluetooth proxy job failed',
      );
    }

    job.finishedAt = new Date(this.#now());
  }

  /**
   * Waits for a proxy's first report since a time.
   *
   * @param deviceId - The proxy.
   * @param since - The time.
   * @returns Once it reported.
   * @throws {Error} When it said nothing in time.
   */
  async #firstReport(deviceId: string, since: number): Promise<void> {
    if ((this.#scanners.get(deviceId)?.lastAt ?? 0) >= since) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const waiters = this.#reportWaiters.get(deviceId) ?? new Set();

      /** Settles once it reported. */
      const heard = (): void => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        waiters.delete(heard);
        reject(new Error('The proxy has not reported anything yet'));
      }, this.#options.firstReportMs ?? FIRST_REPORT_MS);

      waiters.add(heard);
      this.#reportWaiters.set(deviceId, waiters);
    });
  }

  /**
   * Whether a Nearby lease is held now; the ones run out are dropped.
   *
   * @returns True while one is.
   */
  #isForwardingAll(): boolean {
    const now = this.#now();

    for (const [leaseId, expiresAt] of this.#leases) {
      if (expiresAt <= now) {
        this.#leases.delete(leaseId);
      }
    }

    return this.#leases.size > 0;
  }

  /** Sets a timer for the first lease to run out, when proxies go back to the house's devices. */
  #armLeases(): void {
    clearTimeout(this.#leaseTimer);

    if (!this.#isForwardingAll()) {
      return;
    }

    const next = Math.min(...this.#leases.values());

    this.#leaseTimer = setTimeout(
      () => {
        if (this.#isForwardingAll()) {
          this.#armLeases();
        } else {
          void this.#pushFilters();
        }
      },
      Math.max(10, next - this.#now() + 10),
    );
    this.#leaseTimer.unref();
  }

  /**
   * Tells each proxy what to forward, when it changed or was not said for a while: everything
   * while a Nearby lease is held, else the house's devices, those being added, and what a rule
   * recognises. One push after another.
   *
   * @returns Once each proxy was told, or failed to be.
   */
  async #pushFilters(): Promise<void> {
    this.#filtering = this.#filtering.then(async () => this.#pushFiltersNow());
    await this.#filtering;
  }

  /**
   * See {@link BluetoothBroker.#pushFilters}.
   *
   * @returns Once done.
   */
  async #pushFiltersNow(): Promise<void> {
    if (this.#proxies.size === 0 || this.#state !== 'running') {
      return;
    }

    const addresses = this.#isForwardingAll() ? 'all' : await this.#forwarded();
    const signature = JSON.stringify(addresses);
    const now = this.#now();

    await Promise.all(
      [...this.#proxies.keys()].map(async (deviceId) => {
        const note = this.#noteOf(deviceId);

        if (note.filter === signature && now - note.filterAt < FILTER_AGAIN_MS) {
          return;
        }

        try {
          await this.#options.roles.send(
            deviceId,
            BLUETOOTH_PROXY_OPS.filter,
            { addresses },
            OP_TIMEOUT_MS,
          );
          note.filter = signature;
          note.filterAt = now;
        } catch (error: unknown) {
          // Not running now: told when its scanner opens again, or at the next look.
          note.filter = null;
          this.#options.logger.debug(
            { err: error, deviceId },
            'Could not tell a proxy what to forward',
          );
        }
      }),
    );
  }

  /**
   * The addresses proxies forward outside Nearby.
   *
   * @returns Them, sorted.
   */
  async #forwarded(): Promise<string[]> {
    const instances = await this.#options.instances().catch((): BluetoothInstance[] => []);
    const recognised = [...this.#heard.values()]
      .filter(
        (entry) => !this.#ignored.has(entry.address) && this.#claimsOf(entry.identity).length > 0,
      )
      .map((entry) => entry.address);

    return [
      ...new Set([
        ...this.#house(instances).map((instance) => instance.externalId?.toUpperCase() ?? ''),
        ...this.#followed,
        ...this.#adding.keys(),
        ...recognised,
      ]),
    ]
      .toSorted()
      .slice(0, 4096);
  }

  /**
   * The local adapter's connections.
   *
   * @returns How many it holds, of how many it can.
   */
  #connections(): { used: number; max: number } {
    return { used: this.#connectedAddresses().length, max: MAXIMUM_CONNECTIONS };
  }

  /**
   * The addresses the local adapter is connected to.
   *
   * @returns Them, upper case.
   */
  #connectedAddresses(): string[] {
    return this.#adapter === null
      ? []
      : this.#options.host.connected(this.#adapter.id).map((address) => address.toUpperCase());
  }

  /**
   * The id an adapter's scanner goes by.
   *
   * @param adapter - The adapter.
   * @returns `adapter:hci0`.
   */
  #adapterScannerId(adapter: SeenBluetoothAdapter): string {
    return `adapter:${adapter.id}`;
  }

  /** Tells the listeners the addresses being added changed. */
  #changed(): void {
    for (const listener of this.#deviceListeners) {
      listener();
    }
  }

  /**
   * The time now.
   *
   * @returns Milliseconds since the epoch.
   */
  #now(): number {
    return (this.#options.now ?? Date.now)();
  }
}

/**
 * Whether a proxy's script is behind the one its integration ships: by semantic version when
 * both are one, else whenever they differ.
 *
 * @param version - The one on the device.
 * @param shipped - The one shipped.
 * @returns True when an update would install a newer one.
 */
export function isOutdated(version: string | null, shipped: string | null): boolean {
  if (version === null || shipped === null) {
    return false;
  }

  const [have, want] = [semver.valid(version), semver.valid(shipped)];

  return have !== null && want !== null ? semver.lt(have, want) : version !== shipped;
}
