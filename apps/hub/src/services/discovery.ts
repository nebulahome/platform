/**
 * Discovery: the devices that announce themselves, proposed for an owner to adopt.
 *
 * Every vendor with a `discovery.json` is heard the same way, in the six steps the runtime's
 * `discovery.ts` describes: listen, match, probe, identify, associate, propose. The listening is
 * the platform's mDNS browser for the services the vendors declared, and each vendor's own module
 * for a protocol the platform does not speak; everything after that is the same for every vendor.
 *
 * **Discovery proposes; it never adds.** A candidate is held in memory, with nothing written: the
 * owner adopts it through the API, which adds the device the way it adds one typed in by hand, and
 * the hub then identifies it the way it identifies any device. One instance is still one device.
 *
 * **Nothing is swept.** The hub listens, asks mDNS the question mDNS exists to answer, and probes
 * only an address a device announced - and a given address at most once in a while, however often
 * it announces itself, with a few probes in flight at a time. A device already added, by its id or
 * by its address, is not proposed again; one not heard from for a while is forgotten.
 */
import { createHash } from 'node:crypto';

import {
  DISCOVERY_NEW_FOR_MS,
  MATTER_VENDOR,
  MODBUS_VENDOR,
  MQTT_VENDOR,
  normalizeMac,
  type DiscoveredDevice,
  type DiscoverReply,
  type DiscoverySource,
  type JsonObject,
  type PassedOverDevice,
  type VendorListener,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';
import {
  associateBroker,
  associateModel,
  identifySighting,
  matchesAnnouncement,
  matchesBroker,
  nameOf,
  type Association,
  type BrokerSource,
  type Discovered,
  type DiscoveryProbe,
  type Integration,
  type AccountHandle,
  type ListenerStatus,
  type MdnsAnnouncement,
  type PassedOverSighting,
  type Registry,
  type Sighting,
  type Transport,
} from '@nebulahome/package-runtime';

import { isPrivateIpv4, type MdnsSource } from '../discovery/mdns-source.js';
import { addressOf as reachedAt, NOTHING_TAKEN, type TakenDevices } from '../domain/taken.js';
import type { MatterSighting } from '../matter/broker.js';
import type { ModbusSighting } from '../modbus/broker.js';
import type { MqttSighting } from '../mqtt/broker.js';

import type { LoadedDiscovery, LoadedListenSource } from './bundles.js';

/** A vendor that can be discovered: its id and its loaded discovery. */
export type DiscoveryVendor = {
  readonly id: string;
  readonly discovery: LoadedDiscovery;
};

/** Which driver and model a configuration being tried reaches. */
export type Detected = {
  readonly kind: string;
  readonly model: string | null;
  readonly modelChoices: readonly string[];
};

/** What discovery needs. */
export type DiscoveryServiceOptions = {
  readonly vendors: readonly DiscoveryVendor[];
  readonly mdns: MdnsSource;
  readonly transports: Registry<Transport>;
  readonly integrations: Registry<Integration>;
  readonly logger: PlatformLogger;

  /**
   * Reads what the owner saved for a vendor, which a probe is asked with beneath the address.
   *
   * @param vendorId - The vendor.
   * @returns Its saved settings, secrets opened; empty when there are none.
   */
  readonly vendorSettings: (vendorId: string) => Promise<JsonObject>;

  /**
   * Reads the accounts of a vendor signed in to, which its listener asks for its devices.
   *
   * @param vendorId - The vendor.
   * @returns The accounts; none when the vendor has none, or none is signed in.
   */
  readonly vendorAccounts?: (vendorId: string) => Promise<readonly AccountHandle[]>;

  /**
   * Reads what is already added.
   *
   * @returns The external ids and addresses of every instance.
   */
  readonly taken: () => Promise<TakenDevices>;

  /**
   * Announces that the proposed devices changed.
   *
   * @param count - How many there now are.
   */
  readonly publishChanged: (count: number) => void;

  /** How often mDNS is asked again. */
  readonly queryIntervalMs: number;

  /** How long a device stays proposed without being heard again. */
  readonly ttlMs: number;

  /** How long an address's answer to a probe is trusted before it is asked again. */
  readonly probeIntervalMs: number;

  /** How long one probe may take. */
  readonly probeTimeoutMs?: number;

  /**
   * How long an address that did not answer waits before each timed retry; the ladder in
   * {@link PROBE_RETRY_MS} when not said.
   */
  readonly probeRetryMs?: number;

  /** How many probes may be in flight at once. */
  readonly probeConcurrency?: number;

  /** How long a vendor's module is left before it is listened with again, after it stopped. */
  readonly moduleRestartMs?: number;

  /** The clock, in milliseconds; the wall clock when not said. */
  readonly now?: () => number;

  /**
   * The house's Matter fabric, for a hub that holds one: every device of every node not removed
   * from the house, told again whenever the nodes change, and the platform's own vendor, which
   * takes a device no other vendor's rules - or more than one's - take.
   */
  readonly matter?: BrokerFeed<MatterSighting>;

  /**
   * The house's MQTT broker: every device it hears not removed from the house - announced, mapped
   * by the owner, or its own - told again once a burst of them has settled, and the platform's own
   * vendor, which takes a device no other vendor's rules - or more than one's - take.
   */
  readonly mqtt?: BrokerFeed<MqttSighting>;

  /**
   * The house's Modbus broker: every device the owner added - a template at an address - told
   * again whenever one changes. Each says the driver it is read as - the platform's own, or the
   * integration whose template it is - so no vendor's rules are asked.
   */
  readonly modbus?: BrokerFeed<ModbusSighting>;
};

/** One of the platform's brokers, as discovery hears it. */
export type BrokerFeed<TSighting> = {
  readonly devices: () => readonly TSighting[];
  readonly onChange: (listener: () => void) => () => void;
  readonly vendor: DiscoveryVendor;
};

/** A device one of the platform's brokers holds, as discovery proposes it. */
type BrokerDevice = {
  readonly deviceKey: string;

  /** Who it says it is, which the vendors' rules read. */
  readonly identity: unknown;
  readonly name: string;
  readonly modelCode: string | null;
  readonly swVersion: string | null;
  readonly macs: readonly string[];

  /** The driver it is read as, when the broker says it rather than the vendors' rules. */
  readonly kind?: string;
};

/** The platform's brokers, in the order they are heard. */
const BROKER_SOURCES = ['matter', 'mqtt', 'modbus'] as const satisfies readonly BrokerSource[];

/** How each broker's devices are named where the owner sees them. */
const BROKER_LABELS: Readonly<Record<BrokerSource, string>> = {
  matter: 'Matter',
  mqtt: 'MQTT',
  modbus: 'Modbus',
};

/** Each broker's own vendor: what takes a device no integration's rules take. */
const BROKER_VENDORS: Readonly<Record<BrokerSource, string>> = {
  matter: MATTER_VENDOR,
  mqtt: MQTT_VENDOR,
  modbus: MODBUS_VENDOR,
};

/** A proposed device, and when it was last heard, as a number to compare. */
type Candidate = { readonly device: DiscoveredDevice; readonly heardAtMs: number };

/** A device heard that no driver of its vendor takes, and when it was last heard. */
type Unclaimed = {
  readonly vendorId: string;
  readonly device: PassedOverDevice;
  readonly heardAtMs: number;
};

/** What the hub knows of how one vendor's devices are being heard, for the vendor's page. */
export type VendorHearing = {
  /** How the vendor's own listener last said it was getting on; null before it said. */
  readonly listener: VendorListener | null;

  /** The devices heard and not added, latest first, at most {@link MAXIMUM_PASSED_OVER}. */
  readonly passedOver: PassedOverDevice[];
};

/** How many devices heard and not added a vendor's page is told of. */
const MAXIMUM_PASSED_OVER = 100;

/**
 * What a probe of one address last found, and when.
 *
 * `isAnswered` tells an address that said who it is - proposed, or taken by no driver - from one
 * that said nothing. The first is trusted for the probe interval; the second only for a short
 * while, since a device that was busy or rebooting when it was first asked is the usual reason,
 * and it should not wait ten minutes to be asked again.
 */
type Probed = {
  readonly atMs: number;
  readonly candidateId: string | null;
  readonly isAnswered: boolean;

  /** How many probes in a row found nothing; 0 once one answered. */
  readonly misses: number;
};

/** A dotted-quad IPv4 address, which is what the private-address check applies to. */
const IPV4_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** How many probes may be in flight at once, when not said. */
const DEFAULT_PROBE_CONCURRENCY = 8;

/**
 * How long one probe may take, when not said.
 *
 * A device on the house network answers in tens of milliseconds; four seconds is a device that is
 * not going to, and a slot a real one could have had.
 */
const DEFAULT_PROBE_TIMEOUT_MS = 4000;

/** How long an address that did not answer a probe waits before it is asked again. */
const UNANSWERED_PROBE_RETRY_MS = 30_000;

/**
 * When an address that did not answer a probe is asked again, on a timer, after each miss.
 *
 * The first soon: a device on a weak Wi-Fi link sleeps its radio, and the probe that timed out is
 * what woke it - a Shelly at -80 dBm was measured taking eight seconds to answer the first request
 * and ninety milliseconds the next. Then later, for a device that was rebooting. After the last,
 * it is left to the next time it announces itself rather than asked forever.
 */
const PROBE_RETRY_MS: readonly number[] = [5000, 30_000, 60_000];

/**
 * When mDNS is asked again after the first question on start, in milliseconds from it.
 *
 * One question over multicast can be lost - a device busy, a Wi-Fi access point dropping one
 * frame, a device that answers only its second querier - and would then wait a whole query
 * interval. RFC 6762 asks a querier to repeat itself at growing intervals: this ladder covers the
 * first minute, after which the configured interval takes over.
 */
const START_ASK_MS: readonly number[] = [1000, 3000, 8000, 15_000, 30_000, 60_000];

/**
 * When mDNS is asked again after the first question of a search the owner asked for.
 *
 * Every second or two, for thirty seconds. Shelly advises listening 15 to 30 seconds for every
 * device to answer, and a device whose radio sleeps between beacons hears multicast late: five
 * Shelly dimmers at -76 to -80 dBm stayed silent to every question for up to twenty seconds and
 * then answered every one, all together. A person watching a spinner will not wait much longer.
 */
const SCAN_ASK_MS: readonly number[] = [
  1000, 2000, 3000, 4500, 6000, 8000, 10_000, 12_500, 15_000, 17_500, 20_000, 22_500, 25_000,
  27_500, 30_000,
];

/**
 * When mDNS is asked again after a device was removed: a few times over ten seconds, enough for
 * a device whose radio sleeps to hear one of them, and not a search's thirty seconds.
 */
const RELEASE_ASK_MS: readonly number[] = [1000, 3000, 6000, 10_000];

/**
 * How long a search the owner asked for lasts, in milliseconds: the last question, and time for
 * its answers to be probed.
 */
export const SCAN_DURATION_MS = 33_000;

/** How long a vendor's saved settings are reused between probes before being read again. */
const SETTINGS_TTL_MS = 10_000;

/** How long a vendor's module is left before it is listened with again, when not said. */
const DEFAULT_MODULE_RESTART_MS = 30_000;

/** How often the proposals are swept for devices gone quiet, at most. */
const MAXIMUM_SWEEP_MS = 30_000;

/**
 * The address a device is reached at, as the card shows it.
 *
 * @param config - How to reach it, in its transport's terms.
 * @returns The host, or the configuration as text when it has none.
 */
function addressOf(config: JsonObject): string {
  return reachedAt(config) ?? JSON.stringify(config);
}

/**
 * Whether a signal has fired, read through a call so that a loop guarded by it is read again.
 *
 * @param signal - The signal.
 * @returns True once it has been aborted.
 */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

/**
 * Waits, unless told to stop first.
 *
 * @param ms - How long.
 * @param signal - Ends the wait early.
 * @returns A promise that settles when the time is up or the signal fires.
 */
async function pause(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);

    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * What a list of devices passed over says, without when each was first heard.
 *
 * @param list - The devices.
 * @returns Text that differs exactly when the list does.
 */
function signatureOf(list: readonly PassedOverDevice[]): string {
  return JSON.stringify(list.map(({ id, name, model, reason }) => [id, name, model, reason]));
}

/** Proposes the devices that announce themselves. */
export class DiscoveryService {
  readonly #options: DiscoveryServiceOptions;
  readonly #candidates = new Map<string, Candidate>();

  /** The candidates the owner set aside, until they are forgotten. */
  readonly #dismissed = new Set<string>();

  /** The MAC addresses of the fabric's devices, by each vendor whose rules take them. */
  #matterMacs = new Map<string, Set<string>>();
  readonly #probed = new Map<string, Probed>();
  readonly #inFlight = new Set<string>();
  readonly #queue: (() => Promise<void>)[] = [];
  readonly #timers: NodeJS.Timeout[] = [];
  readonly #modules: Promise<void>[] = [];
  readonly #repeats = new Set<NodeJS.Timeout>();
  readonly #unclaimed = new Set<string>();
  readonly #noDriver = new Map<string, Unclaimed>();
  readonly #listeners = new Map<string, VendorListener>();
  readonly #passedOver = new Map<string, readonly PassedOverDevice[]>();
  readonly #settings = new Map<
    string,
    { readonly atMs: number; readonly value: Promise<JsonObject> }
  >();
  #abort = new AbortController();
  #active = 0;
  #isListening = false;

  /** Whether the house's network can be heard, as opposed to only a broker. */
  #isLanListening = true;
  #taken: TakenDevices = NOTHING_TAKEN;
  #signature = '[]';
  #stopBrokers: (() => void)[] = [];

  /**
   * Prepares discovery without listening.
   *
   * @param options - Its collaborators and its patience.
   */
  public constructor(options: DiscoveryServiceOptions) {
    this.#options = options;
  }

  /**
   * Starts listening: the mDNS services the vendors declared, and each vendor's own module.
   *
   * @param options - Whether the hub can hear the house's network. Where it cannot - a container
   * on a bridge - only the modules that listen elsewhere (`lan: false`, a broker) run.
   * @param options.lan - True where the house's network can be heard.
   * @returns A promise that settles once it is listening.
   */
  public async start(options: { readonly lan: boolean } = { lan: true }): Promise<void> {
    const { vendors, mdns, queryIntervalMs, ttlMs } = this.#options;

    this.#abort = new AbortController();
    this.#isListening = true;
    this.#isLanListening = options.lan;
    this.#taken = await this.#options.taken();

    const services = [
      ...new Set(
        vendors.flatMap((vendor) =>
          vendor.discovery.sources.flatMap((source) =>
            source.kind === 'mdns' ? [source.service] : [],
          ),
        ),
      ),
    ];

    if (services.length > 0 && options.lan) {
      mdns.start(services, (announcement) => {
        this.#onAnnouncement(announcement);
      });
      this.#ask(START_ASK_MS);

      const querying = setInterval(() => {
        mdns.query();
      }, queryIntervalMs);

      querying.unref();
      this.#timers.push(querying);
    }

    for (const vendor of vendors) {
      for (const source of vendor.discovery.sources) {
        if (source.kind === 'module' && this.#hears(source)) {
          this.#modules.push(this.#listenWith(vendor, source));
        }
      }
    }

    for (const source of BROKER_SOURCES) {
      const feed = this.#options[source];

      if (feed !== undefined) {
        this.#stopBrokers.push(
          feed.onChange(() => {
            this.#hearBroker(source);
          }),
        );
        this.#hearBroker(source);
      }
    }

    const sweeping = setInterval(
      () => {
        this.#sweep();
      },
      Math.max(10, Math.min(ttlMs / 2, MAXIMUM_SWEEP_MS)),
    );

    sweeping.unref();
    this.#timers.push(sweeping);
  }

  /**
   * Stops listening, and ends every probe and module.
   *
   * @returns A promise that settles once nothing is left running.
   */
  public async stop(): Promise<void> {
    this.#abort.abort();
    this.#isListening = false;
    for (const stop of this.#stopBrokers) {
      stop();
    }

    this.#stopBrokers = [];

    for (const timer of this.#timers) {
      clearInterval(timer);
    }

    for (const repeat of this.#repeats) {
      clearTimeout(repeat);
    }

    this.#timers.length = 0;
    this.#repeats.clear();
    this.#queue.length = 0;
    await this.#options.mdns.stop();
    await Promise.all(this.#modules);
    this.#modules.length = 0;
  }

  /**
   * Whether a source listens where the hub can hear now.
   *
   * @param source - The source.
   * @returns True for any source on a hub that hears the network, and for a module that listens
   * elsewhere on one that does not.
   */
  #hears(source: LoadedListenSource): boolean {
    return this.#isLanListening || (source.kind === 'module' && !source.lan);
  }

  /**
   * The devices proposed now, oldest first.
   *
   * @returns Every device heard, not yet added and not gone quiet.
   */
  public list(): DiscoveredDevice[] {
    const nowMs = this.#now();

    return this.#visible().map(({ device }) => ({
      ...device,
      notes: [
        ...(nowMs - device.firstSeenAt.getTime() < DISCOVERY_NEW_FOR_MS ? (['new'] as const) : []),
        ...(device.mac !== null && this.#matterMacs.get(device.vendorId)?.has(device.mac) === true
          ? (['also-on-matter'] as const)
          : []),
        ...device.notes,
      ],
      isDismissed: this.#dismissed.has(device.id),
    }));
  }

  /**
   * Sets heard devices aside, or brings them back. A device set aside stays aside until the hub
   * forgets it - it went quiet - and hears it again.
   *
   * @param ids - The devices, as listed.
   * @param isDismissed - Whether to set them aside.
   * @returns How many of them the hub still had.
   */
  public dismiss(ids: readonly string[], isDismissed: boolean): number {
    const known = ids.filter((id) => this.#candidates.has(id));

    for (const id of known) {
      if (isDismissed) {
        this.#dismissed.add(id);
      } else {
        this.#dismissed.delete(id);
      }
    }

    this.#signature = '';
    this.#publishIfChanged();

    return known.length;
  }

  /**
   * How one vendor's devices are being heard: what its own listener last said, and the devices
   * heard and not added - those its listener passed over and those no driver of it takes.
   *
   * @param vendorId - The vendor.
   * @returns What its page says when its devices do not come.
   */
  public hearingOf(vendorId: string): VendorHearing {
    const noDriver = [...this.#noDriver.values()]
      .filter((each) => each.vendorId === vendorId)
      .map((each) => each.device);
    const byListener = this.#passedOver.get(vendorId) ?? [];
    const seen = new Set(byListener.map((device) => device.id));

    return {
      listener: this.#listeners.get(vendorId) ?? null,
      passedOver: [...byListener, ...noDriver.filter((device) => !seen.has(device.id))]
        .sort((a, b) => b.heardAt.getTime() - a.heardAt.getTime())
        .slice(0, MAXIMUM_PASSED_OVER),
    };
  }

  /**
   * Looks for one vendor's devices now, rather than at the next scheduled question.
   *
   * What a vendor page's "Discover devices" asks. Forgets what the vendor's addresses answered to
   * their last probes, so every device heard is asked again, then asks mDNS - repeating itself
   * for {@link SCAN_DURATION_MS} - and asks the vendor's module, when it can ask. What answers
   * arrives the ordinary way, over those seconds.
   *
   * @param vendorId - The vendor.
   * @returns The vendor, when it is being looked for, and for how long: nothing and 0 when it
   * cannot be found on the network, or discovery is not listening.
   */
  public rescan(vendorId: string): DiscoverReply {
    if (!this.#isListening) {
      return { vendors: [], lookingForMs: 0 };
    }

    const vendors = this.#options.vendors.filter(
      (vendor) =>
        vendor.id === vendorId && vendor.discovery.sources.some((source) => this.#hears(source)),
    );

    if (vendors.length === 0) {
      return { vendors: [], lookingForMs: 0 };
    }

    for (const key of [...this.#probed.keys()]) {
      if (vendors.some((vendor) => key.startsWith(`${vendor.id}\n`))) {
        this.#probed.delete(key);
      }
    }

    const services = [
      ...new Set(
        vendors.flatMap((vendor) =>
          vendor.discovery.sources.flatMap((source) =>
            source.kind === 'mdns' ? [source.service] : [],
          ),
        ),
      ),
    ];

    if (services.length > 0 && this.#isLanListening) {
      this.#ask(SCAN_ASK_MS, services);
    }

    for (const vendor of vendors) {
      for (const source of vendor.discovery.sources) {
        if (source.kind === 'module' && this.#hears(source)) {
          try {
            source.source.scan?.();
          } catch (error: unknown) {
            this.#options.logger.warn(
              { err: error, vendor: vendor.id, module: source.file },
              'A discovery module could not scan',
            );
          }
        }
      }
    }

    this.#options.logger.info({ vendor: vendorId }, 'Looking for devices');

    return { vendors: vendors.map((vendor) => vendor.id), lookingForMs: SCAN_DURATION_MS };
  }

  /**
   * Reads again what is already added, after an instance was added, removed or identified.
   *
   * @returns A promise that settles once the proposals reflect it.
   */
  public async refresh(): Promise<void> {
    this.#taken = await this.#options.taken();
    this.#publishIfChanged();
  }

  /**
   * Reads again what is added after a device was removed, and looks for it again at once.
   *
   * A removed device is on the network as it was, and an owner who removed it by mistake - or to
   * add it again under another driver - expects to find it straight away, not after the next
   * scheduled question minutes away. So what the vendor's addresses answered is forgotten, and
   * the vendor is asked for the way a search the owner asked for would, only more briefly.
   *
   * @param vendorId - The vendor the device was of; every vendor when it is not known.
   * @returns A promise that settles once the proposals reflect the removal.
   */
  public async release(vendorId?: string): Promise<void> {
    this.#taken = await this.#options.taken();

    for (const key of [...this.#probed.keys()]) {
      if (vendorId === undefined || key.startsWith(`${vendorId}\n`)) {
        this.#probed.delete(key);
      }
    }

    this.#publishIfChanged();

    if (!this.#isListening) {
      return;
    }

    const vendors = this.#options.vendors.filter(
      (vendor) =>
        (vendorId === undefined || vendor.id === vendorId) && vendor.discovery.sources.length > 0,
    );
    const services = [
      ...new Set(
        vendors.flatMap((vendor) =>
          vendor.discovery.sources.flatMap((source) =>
            source.kind === 'mdns' ? [source.service] : [],
          ),
        ),
      ),
    ];

    if (services.length > 0) {
      this.#ask(RELEASE_ASK_MS, services);
    }

    for (const vendor of vendors) {
      for (const source of vendor.discovery.sources) {
        if (source.kind === 'module') {
          try {
            source.source.scan?.();
          } catch (error: unknown) {
            this.#options.logger.debug(
              { err: error, vendor: vendor.id, module: source.file },
              'A discovery module could not scan',
            );
          }
        }
      }
    }
  }

  /**
   * Says which driver and model a configuration being tried reaches.
   *
   * What the add form's Test asks, so that it can preselect the model the device says it is. Only
   * for a vendor whose discovery probes: the address is asked exactly as discovery would ask it.
   *
   * @param kind - The driver the form is on, which names the vendor.
   * @param transportConfig - The configuration being tried, complete.
   * @returns The driver and model, or undefined when the vendor does not probe or nothing takes
   * the device.
   */
  public async detect(kind: string, transportConfig: JsonObject): Promise<Detected | undefined> {
    const [vendorId = ''] = kind.split('/');
    const vendor = this.#options.vendors.find((candidate) => candidate.id === vendorId);
    const probe = vendor?.discovery.plan.discovery.probe;

    if (vendor === undefined || probe === undefined) {
      return undefined;
    }

    const found = await this.#probe(vendor.id, probe, transportConfig);

    if (found === undefined) {
      return undefined;
    }

    const association = this.#associate(vendor, found.payload, found).association;

    return association === null
      ? undefined
      : {
          kind: `${vendor.id}/${association.driverId}`,
          model: association.model,
          modelChoices: association.modelChoices,
        };
  }

  /**
   * Asks mDNS now, and again along a ladder, unless discovery stops first.
   *
   * @param ladder - When to ask again, in milliseconds from now.
   * @param services - Only these service types; every one browsed for when absent.
   */
  #ask(ladder: readonly number[], services?: readonly string[]): void {
    const { mdns } = this.#options;

    mdns.query(services);

    for (const afterMs of ladder) {
      this.#later(afterMs, () => {
        mdns.query(services);
      });
    }
  }

  /**
   * Runs something once, later, unless discovery stops first.
   *
   * @param afterMs - How long from now.
   * @param run - What to run.
   */
  #later(afterMs: number, run: () => void): void {
    const timer: NodeJS.Timeout = setTimeout(() => {
      this.#repeats.delete(timer);

      if (!this.#abort.signal.aborted) {
        run();
      }
    }, afterMs);

    timer.unref();
    this.#repeats.add(timer);
  }

  /**
   * Hands an mDNS announcement to every vendor listening for its service.
   *
   * @param announcement - What the browser heard.
   */
  #onAnnouncement(announcement: MdnsAnnouncement): void {
    const config: JsonObject = {
      host:
        announcement.port === 80
          ? announcement.address
          : `${announcement.address}:${String(announcement.port)}`,
    };

    for (const vendor of this.#options.vendors) {
      const listens = vendor.discovery.sources.some(
        (source) => source.kind === 'mdns' && source.service === announcement.service,
      );

      if (listens) {
        this.#onSighting(vendor, 'mdns', { config, payload: announcement });
      }
    }
  }

  /**
   * Listens with a vendor's own module until discovery stops, listening again if it ends.
   *
   * @param vendor - The vendor.
   * @param source - Its module.
   * @returns A promise that settles once discovery stops.
   */
  async #listenWith(
    vendor: DiscoveryVendor,
    source: Extract<LoadedListenSource, { kind: 'module' }>,
  ): Promise<void> {
    const signal = this.#abort.signal;
    const restartMs = this.#options.moduleRestartMs ?? DEFAULT_MODULE_RESTART_MS;

    while (!isAborted(signal)) {
      try {
        // One listening at a time, by design: the module is listened with again only once it has
        // stopped, and after a pause, so a module that fails at once does not spin.
        // eslint-disable-next-line no-await-in-loop -- see above
        for await (const sighting of source.source.listen(signal, {
          /**
           * Reads the vendor's settings, for a listener that signs in to a cloud with them.
           *
           * @returns The settings, secrets opened.
           */
          settings: async () => this.#settingsOf(vendor.id),

          /**
           * Reads the vendor's accounts signed in to, for a listener that asks each for its
           * devices.
           *
           * @returns The accounts.
           */
          accounts: async () => this.#options.vendorAccounts?.(vendor.id) ?? [],

          /**
           * Keeps what the listener says of how it is getting on, for the vendor's page.
           *
           * @param status - What it says.
           */
          status: (status: ListenerStatus) => {
            this.#onListenerStatus(vendor.id, status);
          },

          /**
           * Keeps the devices the listener heard and does not report, the whole list each time.
           *
           * @param devices - Them, and why.
           */
          passedOver: (devices: readonly PassedOverSighting[]) => {
            this.#onPassedOver(vendor.id, devices);
          },
        })) {
          if (isAborted(signal)) {
            break;
          }

          const host = sighting.config['host'];

          if (typeof host === 'string' && IPV4_PATTERN.test(host) && !isPrivateIpv4(host)) {
            // Unauthenticated, like an announcement: an address on the internet is not followed.
            this.#options.logger.debug(
              { vendor: vendor.id, module: source.file, host },
              'A discovery module reported a public address; not followed',
            );
            continue;
          }

          this.#onSighting(vendor, 'module', sighting);
        }
      } catch (error: unknown) {
        if (!isAborted(signal)) {
          this.#options.logger.warn(
            { err: error, vendor: vendor.id, module: source.file },
            'A discovery module failed; it will be listened with again',
          );
        }
      }

      // eslint-disable-next-line no-await-in-loop -- the pause between two listenings, see above
      await pause(restartMs, signal);
    }
  }

  /**
   * Keeps what a vendor's listener says of how it is getting on, announcing a change.
   *
   * @param vendorId - The vendor.
   * @param status - What its listener says.
   */
  #onListenerStatus(vendorId: string, status: ListenerStatus): void {
    const previous = this.#listeners.get(vendorId);
    const message = status.message.slice(0, 1024);

    if (previous?.level === status.level && previous.message === message) {
      return;
    }

    this.#listeners.set(vendorId, { level: status.level, message, at: new Date(this.#now()) });

    if (status.level !== 'ok') {
      this.#options.logger.info({ vendor: vendorId, level: status.level }, message);
    }

    this.#options.publishChanged(this.#visible().length);
  }

  /**
   * Keeps the devices a vendor's listener heard and does not report, announcing a change.
   *
   * @param vendorId - The vendor.
   * @param devices - Every one of them, which replaces the list it said last.
   */
  #onPassedOver(vendorId: string, devices: readonly PassedOverSighting[]): void {
    const nowMs = this.#now();
    const previous = new Map((this.#passedOver.get(vendorId) ?? []).map((each) => [each.id, each]));
    const next = devices.slice(0, MAXIMUM_PASSED_OVER).map((device): PassedOverDevice => ({
      id: device.id.slice(0, 256),
      name: device.name === '' ? device.id.slice(0, 256) : device.name.slice(0, 256),
      model: device.model?.slice(0, 256) ?? null,
      reason: device.reason.slice(0, 512),
      heardAt: previous.get(device.id)?.heardAt ?? new Date(nowMs),
    }));

    if (signatureOf(next) === signatureOf([...previous.values()])) {
      return;
    }

    this.#passedOver.set(vendorId, next);
    this.#options.publishChanged(this.#visible().length);
  }

  /**
   * Takes one sighting through match and, when the vendor probes, the probe.
   *
   * @param vendor - Whose sighting it is.
   * @param source - How it was heard.
   * @param sighting - How to reach the device, and what it said.
   * @param isRetry - Whether this is the timer asking again an address that did not answer, which
   * the trust given to its last probe does not hold back.
   */
  #onSighting(
    vendor: DiscoveryVendor,
    source: DiscoverySource,
    sighting: Sighting,
    isRetry = false,
  ): void {
    const { plan } = vendor.discovery;

    if (!matchesAnnouncement(plan, sighting.payload)) {
      return;
    }

    const probe = plan.discovery.probe;

    if (probe === undefined) {
      this.#propose(vendor, source, sighting.config, sighting.payload);

      return;
    }

    const host = reachedAt(sighting.config);

    if (host !== undefined && this.#taken.hosts.has(`${vendor.id}\n${host}`)) {
      // Already added at this address: it would not be proposed, and asking it opens one more
      // connection to a device already busy with the hub's own. What it was proposed as is kept
      // heard, though, so that removing the device shows it again at once rather than after the
      // next probe of an address nobody is asking.
      this.#touchAt(vendor.id, host);

      return;
    }

    const key = `${vendor.id}\n${probe.transport}\n${JSON.stringify(sighting.config)}`;
    const last = this.#probed.get(key);
    const trustMs =
      last?.isAnswered === false
        ? Math.min(UNANSWERED_PROBE_RETRY_MS, this.#options.probeIntervalMs)
        : this.#options.probeIntervalMs;

    if (!isRetry && last !== undefined && this.#now() - last.atMs < trustMs) {
      if (last.candidateId !== null) {
        this.#touch(last.candidateId);
      }

      return;
    }

    if (this.#inFlight.has(key)) {
      return;
    }

    this.#inFlight.add(key);
    this.#enqueue(async () => {
      try {
        const found = await this.#probe(vendor.id, probe, sighting.config);
        const candidateId =
          found === undefined
            ? null
            : this.#propose(
                vendor,
                source,
                sighting.config,
                found.payload,
                found,
                // Answered only after a question went unanswered: a battery device that wakes.
                (last?.misses ?? 0) > 0,
              );
        const misses = found === undefined ? (last?.misses ?? 0) + 1 : 0;

        this.#probed.set(key, {
          atMs: this.#now(),
          candidateId,
          isAnswered: found !== undefined,
          misses,
        });

        const retryMs = PROBE_RETRY_MS[misses - 1];

        if (found === undefined && retryMs !== undefined) {
          // Asked again on a timer rather than at the next announcement, which for a device that
          // does not announce on its own is the next query - minutes away.
          this.#later(this.#options.probeRetryMs ?? retryMs, () => {
            this.#onSighting(vendor, source, sighting, true);
          });
        }
      } finally {
        this.#inFlight.delete(key);
      }
    });
  }

  /**
   * Asks an address what the vendor's discovery says to ask it.
   *
   * @param vendorId - The vendor.
   * @param probe - What to ask, through which transport.
   * @param config - How to reach it.
   * @returns The first answer, or undefined when there was none, the transport is not there, or
   * the probe failed - all of which are the ordinary outcome of something on the network not
   * being what it announced.
   */
  async #probe(
    vendorId: string,
    probe: DiscoveryProbe,
    config: JsonObject,
  ): Promise<Discovered | undefined> {
    const { logger, transports } = this.#options;
    const transport = transports.get(probe.transport);

    if (transport === undefined) {
      logger.debug({ vendor: vendorId, transport: probe.transport }, 'No transport to probe with');

      return undefined;
    }

    const timeoutMs = probe.timeoutMs ?? this.#options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
    const signal = AbortSignal.any([this.#abort.signal, AbortSignal.timeout(timeoutMs)]);

    try {
      const settings = await this.#settingsOf(vendorId);
      const terms: JsonObject = { probe: { op: probe.op, args: probe.args } };
      // A vendor that says how long its devices take says it to the transport as well, whose own
      // timeout would otherwise end the request first.
      const asked = probe.timeoutMs === undefined ? config : { ...config, timeoutMs };

      for await (const found of transport.scan({ ...settings, ...asked }, terms, signal)) {
        return found;
      }
    } catch (error: unknown) {
      logger.debug({ err: error, vendor: vendorId, address: addressOf(config) }, 'Probe failed');
    }

    return undefined;
  }

  /**
   * Reads what the owner saved for a vendor, reusing a recent read.
   *
   * A scan probes a dozen devices of one vendor in the same second, and each would otherwise read
   * the same row; a few seconds' reuse is far shorter than anyone takes to edit the settings.
   *
   * @param vendorId - The vendor.
   * @returns Its saved settings.
   */
  #settingsOf(vendorId: string): Promise<JsonObject> {
    const nowMs = this.#now();
    const cached = this.#settings.get(vendorId);

    if (cached !== undefined && nowMs - cached.atMs < SETTINGS_TTL_MS) {
      return cached.value;
    }

    const value = this.#options.vendorSettings(vendorId);

    this.#settings.set(vendorId, { atMs: nowMs, value });

    // A read that failed is not kept: the next probe reads again.
    value.catch(() => {
      if (this.#settings.get(vendorId)?.value === value) {
        this.#settings.delete(vendorId);
      }
    });

    return value;
  }

  /**
   * Reads who a device is, and which driver takes it.
   *
   * @param vendor - The vendor.
   * @param payload - What the probe returned, or the announcement.
   * @param discovered - The probe's answer, for the drivers' own claims to read; absent when
   * there was no probe.
   * @returns The identity, and the association or null when no driver takes it.
   */
  #associate(
    vendor: DiscoveryVendor,
    payload: unknown,
    discovered: Discovered | undefined,
  ): {
    readonly identity: ReturnType<typeof identifySighting>;
    readonly association: Association | null;
  } {
    const { plan } = vendor.discovery;
    const identity = identifySighting(plan, payload);

    return {
      identity,
      association: associateModel(
        plan,
        identity.modelCode,
        discovered === undefined
          ? undefined
          : (driverId) => this.#claims(`${vendor.id}/${driverId}`, discovered),
      ),
    };
  }

  /**
   * Whether a driver's own claim takes a probe's answer.
   *
   * @param kind - The driver.
   * @param discovered - The answer.
   * @returns True when it claims it; false when it does not, is not loaded, or throws.
   */
  #claims(kind: string, discovered: Discovered): boolean {
    const integration = this.#options.integrations.get(kind);

    try {
      return integration?.claim(discovered, {}) !== null && integration !== undefined;
    } catch {
      return false;
    }
  }

  /**
   * Proposes a device, or refreshes it when it was proposed before.
   *
   * @param vendor - The vendor.
   * @param source - How it was heard.
   * @param config - How to reach it.
   * @param payload - What identity reads.
   * @param discovered - The probe's answer, when there was a probe.
   * @param isWaking - Whether it answered only after a question went unanswered.
   * @returns The candidate's id, or null when no driver takes the device.
   */
  #propose(
    vendor: DiscoveryVendor,
    source: DiscoverySource,
    config: JsonObject,
    payload: unknown,
    discovered?: Discovered,
    isWaking = false,
  ): string | null {
    const { identity, association } = this.#associate(vendor, payload, discovered);
    const address = addressOf(config);

    if (association === null) {
      const heard = `${vendor.id}\n${identity.modelCode ?? '?'}`;

      // Once per model at info: a device of a supported vendor that nothing takes is the answer
      // to "why is my device not found", and it would otherwise be told only at debug.
      this.#options.logger[this.#unclaimed.has(heard) ? 'debug' : 'info'](
        { vendor: vendor.id, address, model: identity.modelCode },
        'Heard a device no driver of its vendor takes',
      );
      this.#unclaimed.add(heard);
      this.#rememberUnclaimed(vendor.id, identity, address);

      return null;
    }

    this.#noDriver.delete(`${vendor.id}\n${identity.externalId ?? `@${address}`}`);

    const id = createHash('sha256')
      .update(`${vendor.id}\n${identity.externalId ?? `@${address}`}`)
      .digest('hex')
      .slice(0, 16);
    const nowMs = this.#now();
    const previous = this.#candidates.get(id);

    this.#candidates.set(id, {
      device: {
        id,
        vendorId: vendor.id,
        driverId: association.driverId,
        kind: `${vendor.id}/${association.driverId}`,
        source,
        address,
        externalId: identity.externalId,
        name: identity.name,
        model: association.model,
        modelChoices: [...association.modelChoices],
        modelCode: identity.modelCode,
        swVersion: identity.swVersion,
        transportConfig: config,
        adoption: vendor.discovery.plan.discovery.adopt,
        movedFrom: null,
        mac: identity.mac,
        // What lasts of a device's notes: it woke to answer once, it says it has a password.
        notes: [
          ...(isWaking || previous?.device.notes.includes('wakes') === true
            ? (['wakes'] as const)
            : []),
          ...(identity.needsPassword ? (['password'] as const) : []),
        ],
        isDismissed: false,
        firstSeenAt: previous?.device.firstSeenAt ?? new Date(nowMs),
        lastSeenAt: new Date(nowMs),
      },
      heardAtMs: nowMs,
    });

    this.#publishIfChanged();

    return id;
  }

  /**
   * Remembers a device no driver of its vendor takes, for the vendor's page to say why.
   *
   * @param vendorId - The vendor.
   * @param identity - Who the device said it is.
   * @param address - Where it was heard.
   */
  #rememberUnclaimed(
    vendorId: string,
    identity: ReturnType<typeof identifySighting>,
    address: string,
  ): void {
    const key = `${vendorId}\n${identity.externalId ?? `@${address}`}`;
    const nowMs = this.#now();

    this.#noDriver.set(key, {
      vendorId,
      device: {
        id: identity.externalId ?? address,
        name: identity.name ?? identity.modelCode ?? address,
        model: identity.modelCode,
        reason:
          identity.modelCode === null
            ? 'It does not say which model it is, so no driver can take it'
            : `No driver of this integration takes the model ${identity.modelCode} yet`,
        heardAt: this.#noDriver.get(key)?.device.heardAt ?? new Date(nowMs),
      },
      heardAtMs: nowMs,
    });
  }

  /**
   * Records that a proposed device was heard again.
   *
   * @param id - The candidate.
   */
  #touch(id: string): void {
    const candidate = this.#candidates.get(id);

    if (candidate !== undefined) {
      const nowMs = this.#now();

      this.#candidates.set(id, {
        device: { ...candidate.device, lastSeenAt: new Date(nowMs) },
        heardAtMs: nowMs,
      });
    }
  }

  /**
   * Records that the device a vendor proposed at an address was heard again.
   *
   * @param vendorId - The vendor.
   * @param host - The address.
   */
  #touchAt(vendorId: string, host: string): void {
    for (const [id, candidate] of this.#candidates) {
      if (
        candidate.device.vendorId === vendorId &&
        reachedAt(candidate.device.transportConfig) === host
      ) {
        this.#touch(id);
      }
    }
  }

  /**
   * The vendors whose rules for one of the platform's brokers take a device, the platform's own
   * vendor of the broker left out.
   *
   * @param source - The broker: `matter`, `mqtt`.
   * @param identity - Who the device says it is.
   * @returns Each vendor whose rules all hold and which has a driver on the broker to take it.
   */
  public brokerClaims(
    source: BrokerSource,
    identity: unknown,
  ): { readonly vendor: DiscoveryVendor; readonly association: Association }[] {
    const own = BROKER_VENDORS[source];

    return this.#options.vendors.flatMap((vendor) => {
      const { plan } = vendor.discovery;

      if (vendor.id === own || !matchesBroker(plan, source, identity)) {
        return [];
      }

      const association = associateBroker(plan, source, identity);

      return association === null ? [] : [{ vendor, association }];
    });
  }

  /**
   * The devices one of the platform's brokers holds, as discovery proposes them.
   *
   * @param source - The broker.
   * @returns Its devices, or none for a broker the hub does not run.
   */
  #brokerDevices(source: BrokerSource): BrokerDevice[] {
    if (source === 'matter') {
      return (this.#options.matter?.devices() ?? []).map(({ deviceKey, device }) => {
        const { identity } = device;

        return {
          deviceKey,
          identity,
          name: nameOf(identity),
          modelCode: identity.productId === null ? null : String(identity.productId),
          swVersion: identity.softwareVersionString,
          macs: identity.macAddresses.flatMap((mac) => normalizeMac(mac) ?? []),
        };
      });
    }

    if (source === 'modbus') {
      return (this.#options.modbus?.devices() ?? []).map(({ deviceKey, device }) => ({
        deviceKey,
        identity: device,
        name: device.name,
        modelCode: null,
        swVersion: null,
        macs: [],
        kind: device.kind,
      }));
    }

    return (this.#options.mqtt?.devices() ?? []).map(({ deviceKey, device }) => ({
      deviceKey,
      identity: device.identity,
      name: device.identity.name,
      modelCode: device.identity.model,
      swVersion: device.identity.swVersion,
      macs: device.identity.macAddresses,
    }));
  }

  /**
   * Proposes every device of one of the platform's brokers: to the one vendor whose rules take
   * it, or to the platform's own. Each is added at once - the owner commissioned it, or it
   * announced itself on the house's broker - and one the broker no longer holds, or that was
   * removed from the house, is no longer proposed.
   *
   * @param source - The broker.
   */
  #hearBroker(source: BrokerSource): void {
    const feed = this.#options[source];

    if (feed === undefined || !this.#isListening) {
      return;
    }

    const heard = new Set<string>();
    const nowMs = this.#now();
    const macs = new Map<string, Set<string>>();

    for (const device of this.#brokerDevices(source)) {
      const [only, other] =
        device.kind === undefined ? this.brokerClaims(source, device.identity) : [];

      // Every vendor that takes a Matter device, so a device of theirs found over its own
      // transport can say the house reaches it through Matter too.
      for (const { vendor } of [only, other].filter((each) => each !== undefined)) {
        for (const mac of device.macs) {
          macs.set(vendor.id, (macs.get(vendor.id) ?? new Set()).add(mac));
        }
      }

      const fallback = associateBroker(feed.vendor.discovery.plan, source, device.identity);
      const chosen =
        device.kind !== undefined
          ? this.#ofKind(device.kind, feed.vendor)
          : only !== undefined && other === undefined
            ? only
            : fallback === null
              ? undefined
              : { vendor: feed.vendor, association: fallback };

      if (chosen === undefined) {
        continue;
      }

      const id = createHash('sha256')
        .update(`${source}/${device.deviceKey}`)
        .digest('hex')
        .slice(0, 16);
      const previous = this.#candidates.get(id);

      heard.add(id);
      this.#candidates.set(id, {
        device: {
          id,
          vendorId: chosen.vendor.id,
          driverId: chosen.association.driverId,
          kind: `${chosen.vendor.id}/${chosen.association.driverId}`,
          source,
          address: `${BROKER_LABELS[source]} ${device.deviceKey}`.slice(0, 256),
          externalId: device.deviceKey,
          name: device.name.slice(0, 256),
          model: chosen.association.model,
          modelChoices: [...chosen.association.modelChoices],
          modelCode: device.modelCode,
          swVersion: device.swVersion?.slice(0, 64) ?? null,
          transportConfig: {},
          adoption: 'automatic',
          movedFrom: null,
          mac: device.macs[0] ?? null,
          notes: [],
          isDismissed: false,
          firstSeenAt: previous?.device.firstSeenAt ?? new Date(nowMs),
          lastSeenAt: new Date(nowMs),
        },
        heardAtMs: nowMs,
      });
    }

    if (source === 'matter') {
      this.#matterMacs = macs;
    }

    for (const [id, candidate] of this.#candidates) {
      if (candidate.device.source === source && !heard.has(id)) {
        this.#candidates.delete(id);
        this.#dismissed.delete(id);
      }
    }

    this.#publishIfChanged();
  }

  /**
   * The vendor and driver a device a broker names the driver of is proposed to.
   *
   * @param kind - The driver, `vendor/driver`.
   * @param own - The broker's own vendor, which is not among the bundles.
   * @returns Them, or undefined when that driver is not loaded.
   */
  #ofKind(
    kind: string,
    own: DiscoveryVendor,
  ): { readonly vendor: DiscoveryVendor; readonly association: Association } | undefined {
    const [vendorId = '', driverId = ''] = kind.split('/');
    const vendor =
      own.id === vendorId ? own : this.#options.vendors.find((each) => each.id === vendorId);
    const driver = vendor?.discovery.plan.drivers.find((each) => each.id === driverId);

    if (vendor === undefined || driver === undefined) {
      return undefined;
    }

    const choices = driver.models.length === 0 ? [driver.name] : driver.models;

    return {
      vendor,
      association: {
        driverId,
        model: choices.length === 1 ? (choices[0] ?? null) : null,
        modelChoices: choices,
      },
    };
  }

  /** Forgets the devices gone quiet, and the probe answers too old to trust. */
  #sweep(): void {
    for (const source of BROKER_SOURCES) {
      this.#hearBroker(source);
    }

    const nowMs = this.#now();

    for (const [id, candidate] of this.#candidates) {
      if (nowMs - candidate.heardAtMs > this.#options.ttlMs) {
        this.#candidates.delete(id);
        // Forgotten, so heard again it is offered again.
        this.#dismissed.delete(id);
      }
    }

    for (const [key, probed] of this.#probed) {
      if (nowMs - probed.atMs > this.#options.probeIntervalMs) {
        this.#probed.delete(key);
      }
    }

    for (const [key, unclaimed] of this.#noDriver) {
      if (nowMs - unclaimed.heardAtMs > this.#options.ttlMs) {
        this.#noDriver.delete(key);
      }
    }

    this.#publishIfChanged();
  }

  /**
   * The candidates not already added, oldest first.
   *
   * @returns The candidates an owner is shown.
   */
  #visible(): Candidate[] {
    const { externalIds, hosts, locations } = this.#taken;

    return [...this.#candidates.values()]
      .flatMap((candidate): Candidate[] => {
        const { device } = candidate;

        if (device.source === 'matter' || device.source === 'mqtt' || device.source === 'modbus') {
          return device.externalId !== null && this.#taken[device.source].has(device.externalId)
            ? []
            : [candidate];
        }

        const host = reachedAt(device.transportConfig);
        const key = `${device.vendorId}\n${device.externalId ?? ''}`;
        const byId = device.externalId !== null && externalIds.has(key);
        const byHost = host !== undefined && hosts.has(`${device.vendorId}\n${host}`);

        if (byHost) {
          return [];
        }

        if (!byId) {
          return [candidate];
        }

        // Added, and heard at an address its instance does not reach: the lease changed. Shown
        // for the owner to move it, rather than hidden as a device already added.
        const location = locations.get(key);

        return location === undefined || host === undefined || location.host === host
          ? []
          : [
              {
                ...candidate,
                device: {
                  ...device,
                  movedFrom: { deviceId: location.instanceId, address: location.host },
                },
              },
            ];
      })
      .sort((a, b) => a.device.firstSeenAt.getTime() - b.device.firstSeenAt.getTime());
  }

  /** Announces the proposals when they changed in anything but when they were last heard. */
  #publishIfChanged(): void {
    const visible = this.#visible();
    const signature = JSON.stringify(
      visible.map(({ device }) => ({ ...device, lastSeenAt: null })),
    );

    if (signature !== this.#signature) {
      this.#signature = signature;
      this.#options.publishChanged(visible.length);
    }
  }

  /**
   * Runs a probe when a slot is free.
   *
   * @param task - The probe.
   */
  #enqueue(task: () => Promise<void>): void {
    this.#queue.push(task);
    this.#drain();
  }

  /** Starts queued probes up to the limit. */
  #drain(): void {
    const limit = this.#options.probeConcurrency ?? DEFAULT_PROBE_CONCURRENCY;

    while (this.#active < limit) {
      const task = this.#queue.shift();

      if (task === undefined) {
        return;
      }

      this.#active += 1;
      task()
        .catch((error: unknown) => {
          this.#options.logger.warn({ err: error }, 'A discovery probe failed');
        })
        .finally(() => {
          this.#active -= 1;
          this.#drain();
        });
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
