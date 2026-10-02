/**
 * Which packages run, for the vendors whose devices need one (PACKAGES.md 7).
 *
 * A vendor's manifest may say what it needs besides itself - `{ "services": ["mqtt-broker"] }`
 * for Zigbee2MQTT, which talks through the broker `pkg-mqtt` runs. Until that runs, the vendor
 * waits: its instances do not start, and fail with the sentence that says which package they wait
 * for, and its page says the same. So this service keeps what the packet-manager says is
 * installed and running - read once when the hub starts, and again at every package event - and
 * when a vendor's standing changes, it says so, and only that vendor's instances start again.
 *
 * Before the packet-manager has answered at all, what a vendor needs is taken as not there: an
 * instance started against a broker nobody has said is up would fail anyway, with a sentence about
 * a refused connection instead of one about the package it waits for.
 */
import semver from 'semver';

import type { BusClient, BusSubscription } from '@nebulahome/bus';
import {
  BUS_PATTERNS,
  busSubjects,
  describeDependencyProblem,
  jsonObjectSchema,
  PACKET_MANAGER_METHODS,
  PACKET_MANAGER_SERVICE,
  packageListReplySchema,
  unmetRequirements,
  type InstalledNode,
  type PackageRequires,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';

/** How long the packet-manager has to answer: the hub starts without it. */
const LIST_TIMEOUT_MS = 2000;

/** A vendor with what it needs. */
export type WatchedVendor = {
  readonly id: string;
  readonly name: string;
  readonly requires: PackageRequires;
};

/** What the service needs. */
export type PackageWatchOptions = {
  readonly client: BusClient;
  readonly logger: PlatformLogger;

  /** This platform's release, which a vendor's `requires.platform` is checked against. */
  readonly platformVersion: string;

  /**
   * Called when what a vendor waits for changed: it can start now, or has to stop.
   *
   * @param vendorIds - The vendors whose standing changed.
   */
  readonly onChange: (vendorIds: readonly string[]) => void;
};

/**
 * Whether a vendor needs anything at all.
 *
 * @param requires - What it needs.
 * @returns True when it names a platform, a package or a service.
 */
function needsAnything(requires: PackageRequires): boolean {
  return (
    requires.platform !== undefined ||
    Object.keys(requires.packages).length > 0 ||
    requires.services.length > 0
  );
}

/** Follows the packages for the vendors that need them. */
export class PackageWatch {
  readonly #options: PackageWatchOptions;
  #vendors: readonly WatchedVendor[] = [];
  #installed: readonly InstalledNode[] = [];
  #names = new Map<string, string>();
  #isKnown = false;
  #problems = new Map<string, readonly string[]>();
  #subscription: BusSubscription | undefined;

  /**
   * Keeps the options.
   *
   * @param options - See {@link PackageWatchOptions}.
   */
  public constructor(options: PackageWatchOptions) {
    this.#options = options;
  }

  /**
   * Starts following the packages, and reads them once.
   *
   * @param vendors - The vendors loaded, with what each needs.
   * @returns Once the first read is answered, or has given up.
   */
  public async start(vendors: readonly WatchedVendor[]): Promise<void> {
    this.#vendors = vendors.filter((vendor) => needsAnything(vendor.requires));

    if (this.#vendors.length === 0) {
      return;
    }

    this.#subscription = this.#options.client.subscribe(
      BUS_PATTERNS.allPackageEvents,
      jsonObjectSchema,

      /** Reads the packages again: one was installed, started, stopped or removed. */
      (): void => {
        void this.#refresh();
      },
    );

    // Read, not compared: nothing has started yet that would have to start again.
    await this.#read();
    this.#problems = new Map(this.#vendors.map((vendor) => [vendor.id, this.#problemsOf(vendor)]));
  }

  /** Stops following. */
  public stop(): void {
    this.#subscription?.unsubscribe();
    this.#subscription = undefined;
  }

  /**
   * What a vendor needs and is not running, in sentences.
   *
   * @param vendorId - The vendor.
   * @returns The sentences; none for a vendor whose needs are met, or that needs nothing.
   */
  public problemsOf(vendorId: string): readonly string[] {
    return this.#problems.get(vendorId) ?? [];
  }

  /**
   * Reads what is installed.
   *
   * @returns Once read, or given up on: the last answer stands until the next.
   */
  async #read(): Promise<void> {
    try {
      const reply = await this.#options.client.request(
        busSubjects.service(PACKET_MANAGER_SERVICE, PACKET_MANAGER_METHODS.list),
        {},
        packageListReplySchema,
        { timeoutMs: LIST_TIMEOUT_MS },
      );

      this.#installed = reply.items.map((found) => ({
        id: found.id,
        version: found.version,
        requires: found.requires,
        provides: found.provides,
        isRunning: found.state === 'running',
      }));
      this.#names = new Map(reply.items.map((found) => [found.id, found.name]));
      this.#isKnown = true;
    } catch (error: unknown) {
      this.#options.logger.debug({ err: error }, 'The packet-manager did not say what runs');
    }
  }

  /**
   * Reads what is installed again, and says which vendors' standing changed.
   *
   * @returns Once read and told.
   */
  async #refresh(): Promise<void> {
    await this.#read();

    const changed: string[] = [];

    for (const vendor of this.#vendors) {
      const now = this.#problemsOf(vendor);
      const before = this.#problems.get(vendor.id) ?? [];

      if (now.join('\n') !== before.join('\n')) {
        changed.push(vendor.id);
        this.#problems.set(vendor.id, now);
        this.#options.logger.info(
          { vendorId: vendor.id, problems: now },
          now.length === 0 ? 'What a vendor needs runs' : 'A vendor waits for a package',
        );
      }
    }

    if (changed.length > 0) {
      this.#options.onChange(changed);
    }
  }

  /**
   * What one vendor needs and is not running, as things stand.
   *
   * @param vendor - The vendor.
   * @returns The sentences.
   */
  #problemsOf(vendor: WatchedVendor): readonly string[] {
    if (!this.#isKnown) {
      return [
        `${vendor.name} waits for the packet-manager to say whether what it needs is running`,
      ];
    }

    return unmetRequirements(vendor.id, vendor.requires, this.#installed, {
      platformVersion: this.#options.platformVersion,

      /**
       * Whether a release is in a range.
       *
       * @param version - The release.
       * @param range - The range.
       * @returns True when it is.
       */
      satisfies: (version: string, range: string): boolean =>
        semver.satisfies(version, range, { includePrerelease: true }),
    }).map((problem) =>
      describeDependencyProblem(problem, (id) =>
        id === vendor.id ? vendor.name : (this.#names.get(id) ?? id),
      ),
    );
  }
}
