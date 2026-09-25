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

import type { DiscoveredDevice, DiscoverySource, JsonObject } from '@nebula-home/contracts';
import type { PlatformLogger } from '@nebula-home/logging';
import {
  associateModel,
  identifySighting,
  matchesAnnouncement,
  type Association,
  type Discovered,
  type DiscoveryProbe,
  type Integration,
  type MdnsAnnouncement,
  type Registry,
  type Sighting,
  type Transport,
} from '@nebula-home/package-runtime';

import { isPrivateIpv4, type MdnsSource } from '../discovery/mdns-source.js';
import type { TakenDevices } from '../domain/taken.js';

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

  /** How many probes may be in flight at once. */
  readonly probeConcurrency?: number;

  /** How long a vendor's module is left before it is listened with again, after it stopped. */
  readonly moduleRestartMs?: number;

  /** The clock, in milliseconds; the wall clock when not said. */
  readonly now?: () => number;
};

/** A proposed device, and when it was last heard, as a number to compare. */
type Candidate = { readonly device: DiscoveredDevice; readonly heardAtMs: number };

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
 * When mDNS is asked again after the first question, on start and on a scan the owner asked for.
 *
 * One question over multicast can be lost - a device busy, a Wi-Fi access point dropping one
 * frame - and would then wait a whole query interval. RFC 6762 asks a querier to repeat itself
 * at growing intervals, and this is the start of that ladder.
 */
const MDNS_REPEAT_MS: readonly number[] = [1000, 3000];

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
  const host = config['host'];

  return typeof host === 'string' && host.length > 0 ? host : JSON.stringify(config);
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

/** Proposes the devices that announce themselves. */
export class DiscoveryService {
  readonly #options: DiscoveryServiceOptions;
  readonly #candidates = new Map<string, Candidate>();
  readonly #probed = new Map<string, Probed>();
  readonly #inFlight = new Set<string>();
  readonly #queue: (() => Promise<void>)[] = [];
  readonly #timers: NodeJS.Timeout[] = [];
  readonly #modules: Promise<void>[] = [];
  readonly #repeats = new Set<NodeJS.Timeout>();
  readonly #settings = new Map<
    string,
    { readonly atMs: number; readonly value: Promise<JsonObject> }
  >();
  #abort = new AbortController();
  #active = 0;
  #isListening = false;
  #taken: TakenDevices = { externalIds: new Set(), hosts: new Set() };
  #signature = '[]';

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
   * @returns A promise that settles once it is listening.
   */
  public async start(): Promise<void> {
    const { vendors, mdns, queryIntervalMs, ttlMs } = this.#options;

    this.#abort = new AbortController();
    this.#isListening = true;
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

    if (services.length > 0) {
      mdns.start(services, (announcement) => {
        this.#onAnnouncement(announcement);
      });
      this.#ask();

      const querying = setInterval(() => {
        mdns.query();
      }, queryIntervalMs);

      querying.unref();
      this.#timers.push(querying);
    }

    for (const vendor of vendors) {
      for (const source of vendor.discovery.sources) {
        if (source.kind === 'module') {
          this.#modules.push(this.#listenWith(vendor, source));
        }
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
   * The devices proposed now, oldest first.
   *
   * @returns Every device heard, not yet added and not gone quiet.
   */
  public list(): DiscoveredDevice[] {
    return this.#visible().map((candidate) => candidate.device);
  }

  /**
   * Looks for devices now, rather than at the next scheduled question.
   *
   * What the owner's "look for devices" asks. Forgets what the vendors' addresses answered to
   * their last probes, so every device heard is asked again, then asks mDNS - repeating itself,
   * as on start - and asks every vendor module that can ask. What answers arrives the ordinary
   * way, over the next seconds.
   *
   * @param vendorId - Only this vendor; every vendor that can be found when absent.
   * @returns The vendors now being looked for: none when the vendor cannot be found on the
   * network, or discovery is not listening.
   */
  public rescan(vendorId?: string): string[] {
    if (!this.#isListening) {
      return [];
    }

    const vendors = this.#options.vendors.filter(
      (vendor) =>
        (vendorId === undefined || vendor.id === vendorId) && vendor.discovery.sources.length > 0,
    );

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

    if (services.length > 0) {
      this.#ask(services);
    }

    for (const vendor of vendors) {
      for (const source of vendor.discovery.sources) {
        if (source.kind === 'module') {
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

    this.#options.logger.info(
      { vendors: vendors.map((vendor) => vendor.id) },
      'Looking for devices',
    );

    return vendors.map((vendor) => vendor.id);
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
   * Asks mDNS now, and again along the repeat ladder, unless discovery stops first.
   *
   * @param services - Only these service types; every one browsed for when absent.
   */
  #ask(services?: readonly string[]): void {
    const { mdns } = this.#options;

    mdns.query(services);

    for (const afterMs of MDNS_REPEAT_MS) {
      const repeat: NodeJS.Timeout = setTimeout(() => {
        this.#repeats.delete(repeat);

        if (!this.#abort.signal.aborted) {
          mdns.query(services);
        }
      }, afterMs);

      repeat.unref();
      this.#repeats.add(repeat);
    }
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
        for await (const sighting of source.source.listen(signal)) {
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
   * Takes one sighting through match and, when the vendor probes, the probe.
   *
   * @param vendor - Whose sighting it is.
   * @param source - How it was heard.
   * @param sighting - How to reach the device, and what it said.
   */
  #onSighting(vendor: DiscoveryVendor, source: DiscoverySource, sighting: Sighting): void {
    const { plan } = vendor.discovery;

    if (!matchesAnnouncement(plan, sighting.payload)) {
      return;
    }

    const probe = plan.discovery.probe;

    if (probe === undefined) {
      this.#propose(vendor, source, sighting.config, sighting.payload);

      return;
    }

    const host = sighting.config['host'];

    if (typeof host === 'string' && this.#taken.hosts.has(`${vendor.id}\n${host}`)) {
      // Already added at this address: it would not be proposed, and asking it opens one more
      // connection to a device already busy with the hub's own.
      return;
    }

    const key = `${vendor.id}\n${probe.transport}\n${JSON.stringify(sighting.config)}`;
    const last = this.#probed.get(key);
    const trustMs =
      last?.isAnswered === false
        ? Math.min(UNANSWERED_PROBE_RETRY_MS, this.#options.probeIntervalMs)
        : this.#options.probeIntervalMs;

    if (last !== undefined && this.#now() - last.atMs < trustMs) {
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
            : this.#propose(vendor, source, sighting.config, found.payload, found);

        this.#probed.set(key, {
          atMs: this.#now(),
          candidateId,
          isAnswered: found !== undefined,
        });
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

    const signal = AbortSignal.any([
      this.#abort.signal,
      AbortSignal.timeout(this.#options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS),
    ]);

    try {
      const settings = await this.#settingsOf(vendorId);
      const terms: JsonObject = { probe: { op: probe.op, args: probe.args } };

      for await (const found of transport.scan({ ...settings, ...config }, terms, signal)) {
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
   * @returns The candidate's id, or null when no driver takes the device.
   */
  #propose(
    vendor: DiscoveryVendor,
    source: DiscoverySource,
    config: JsonObject,
    payload: unknown,
    discovered?: Discovered,
  ): string | null {
    const { identity, association } = this.#associate(vendor, payload, discovered);
    const address = addressOf(config);

    if (association === null) {
      this.#options.logger.debug(
        { vendor: vendor.id, address, model: identity.modelCode },
        'Heard a device no driver of its vendor takes',
      );

      return null;
    }

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
        firstSeenAt: previous?.device.firstSeenAt ?? new Date(nowMs),
        lastSeenAt: new Date(nowMs),
      },
      heardAtMs: nowMs,
    });

    this.#publishIfChanged();

    return id;
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

  /** Forgets the devices gone quiet, and the probe answers too old to trust. */
  #sweep(): void {
    const nowMs = this.#now();

    for (const [id, candidate] of this.#candidates) {
      if (nowMs - candidate.heardAtMs > this.#options.ttlMs) {
        this.#candidates.delete(id);
      }
    }

    for (const [key, probed] of this.#probed) {
      if (nowMs - probed.atMs > this.#options.probeIntervalMs) {
        this.#probed.delete(key);
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
    const { externalIds, hosts } = this.#taken;

    return [...this.#candidates.values()]
      .filter(({ device }) => {
        const host = device.transportConfig['host'];
        const byId =
          device.externalId !== null && externalIds.has(`${device.vendorId}\n${device.externalId}`);
        const byHost = typeof host === 'string' && hosts.has(`${device.vendorId}\n${host}`);

        return !byId && !byHost;
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
