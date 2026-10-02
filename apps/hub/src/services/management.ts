/**
 * What the interface needs from `hub` to configure an instance: the catalogue, a probe, a
 * reload, a forget, and the devices discovery proposes.
 *
 * Six questions, one bus subject each. *What can I install?* is answered from the bundles on
 * disk, with what each asks at setup, so the form is built from the bundle's own words and the
 * interface never reads a file. *Does this configuration work?* opens the transport once and
 * lets go, keeping nothing - the answer is a verdict and a sentence, because a configuration
 * that does not work is the expected outcome of trying one; when the vendor's discovery can tell
 * which model answered, the answer says so too. *I saved it; match it* re-reads one row of the
 * registry and starts, restarts or stops the instance to fit. *I am deleting it; let go* stops the
 * instance without reading anything, because the row is about to be gone. *What is out there?*
 * lists the devices discovery heard and nobody has added. *Look now* asks discovery to ask the
 * network again for one vendor, instead of waiting for its next scheduled question.
 *
 * Nothing here touches the registry directly. The API owns writes, the service that runs
 * instances owns the reload and the forget, and this class only routes between the bus and it.
 */
import { z } from 'zod';

import type { BusClient, BusSubscription } from '@nebulahome/bus';
import {
  busSubjects,
  catalogueRequestSchema,
  discoveredRequestSchema,
  discoverRequestSchema,
  forgetRequestSchema,
  HUB_CATALOGUE_METHOD,
  HUB_DISCOVER_METHOD,
  HUB_DISCOVERED_METHOD,
  HUB_FORGET_METHOD,
  HUB_PROBE_METHOD,
  HUB_RELOAD_METHOD,
  HUB_SERVICE,
  HUB_VENDOR_CHANGED_METHOD,
  NotFoundError,
  probeRequestSchema,
  reloadRequestSchema,
  vendorChangedRequestSchema,
  type CatalogueReply,
  type DiscoveredDevice,
  type DiscoveredReply,
  type DiscoverReply,
  type DiscoverRequest,
  type ForgetReply,
  type ForgetRequest,
  type IntegrationKind,
  type IntegrationVendor,
  type ProbeReply,
  type ProbeRequest,
  type ReloadReply,
  type ReloadRequest,
  type VendorChangedReply,
  type VendorChangedRequest,
} from '@nebulahome/contracts';
import type { JsonObject } from '@nebulahome/contracts';
import { openSecrets } from '@nebulahome/db';
import type { PlatformLogger } from '@nebulahome/logging';
import type { Registry, Transport } from '@nebulahome/package-runtime';

import type { LoadedBundle, LoadedVendor } from './bundles.js';
import type { Detected, VendorHearing } from './discovery.js';

/** What the service needs. */
export type ManagementServiceOptions = {
  /** Serves the subjects, as `hub`. */
  readonly client: BusClient;

  /** The transports a probe may open. */
  readonly transports: Registry<Transport>;

  readonly logger: PlatformLogger;

  /** Opens the secrets a probe request carries sealed. */
  readonly secretsKey: Buffer;

  /**
   * The vendors loaded, read when asked rather than captured once, so a catalogue asked after a
   * bundle is added lists it without this service being told.
   *
   * @returns Every loaded vendor, with the drivers of it that loaded.
   */
  readonly vendors: () => readonly LoadedVendor[];

  /**
   * The devices discovery proposes, read when asked.
   *
   * @returns Every device heard and not yet added.
   */
  readonly discovered: () => readonly DiscoveredDevice[];

  /**
   * How one vendor's devices are being heard, read when asked: what its own listener says, and
   * the devices heard and not added.
   *
   * @param vendorId - The vendor.
   * @returns Both; nothing said and nothing passed over before discovery has started.
   */
  readonly hearing: (vendorId: string) => VendorHearing;

  /**
   * What one vendor needs and is not running, in sentences, read when asked.
   *
   * @param vendorId - The vendor.
   * @returns The sentences; none when all it needs runs, or it needs nothing. None when not said.
   */
  readonly packageProblems?: (vendorId: string) => readonly string[];

  /**
   * Asks discovery to look now for one vendor's devices.
   *
   * @param vendorId - The vendor.
   * @returns The vendor being looked for and for how long; nothing when discovery is off.
   */
  readonly rescan: (vendorId: string) => DiscoverReply;

  /**
   * Says which driver and model a configuration that answered reaches.
   *
   * @param kind - The driver the form is on.
   * @param transportConfig - The configuration, secrets opened.
   * @returns The driver and model, or undefined when discovery cannot tell.
   */
  readonly detect: (kind: string, transportConfig: JsonObject) => Promise<Detected | undefined>;

  /**
   * Matches one instance to its registry row.
   *
   * @param integrationId - Which instance.
   * @returns Where it ended up.
   */
  readonly reload: (integrationId: string) => Promise<ReloadReply>;

  /**
   * Stops one instance and drops it, without reading the registry.
   *
   * @param integrationId - Which instance.
   * @returns Whether it was running.
   */
  readonly forget: (integrationId: string) => Promise<ForgetReply>;

  /**
   * Hands the supervisor a vendor's containers again, after its settings were saved.
   *
   * @param vendorId - The vendor.
   * @returns Whether the vendor is loaded.
   */
  readonly vendorChanged: (vendorId: string) => Promise<boolean>;
};

/** How many Tests may be waiting on their devices at once. */
const PROBE_CONCURRENCY = 4;

/**
 * Says why a probe failed, in one sentence the owner can act on.
 *
 * @param error - What the attempt threw.
 * @returns The transport's own words for anything it reported; for a configuration the transport
 * would not even take, the fields it objected to - `url: Too small` says more than a JSON dump
 * of the same.
 */
function detailOf(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues
      .map((issue) => `${issue.path.map(String).join('.') || 'configuration'}: ${issue.message}`)
      .join('; ');
  }

  return error instanceof Error ? error.message : String(error);
}

/**
 * What the interface lists a driver by.
 *
 * @param bundle - As the loader produced it.
 * @returns The catalogue entry.
 */
function kindOf(bundle: LoadedBundle): IntegrationKind {
  const { manifest } = bundle;

  return {
    id: manifest.id,
    vendorId: bundle.vendorId,
    driverId: bundle.driverId,
    name: bundle.driverName,
    transport: manifest.transport,
    models: manifest.models,
    ...(manifest.modelSeries === undefined ? {} : { modelSeries: manifest.modelSeries }),
    ...(manifest.defaultIcon === undefined ? {} : { defaultIcon: manifest.defaultIcon }),
    setup: bundle.setup,
    ...(manifest.webPagePort === undefined ? {} : { webPagePort: manifest.webPagePort }),
    ...(manifest.webPagePath === undefined ? {} : { webPagePath: manifest.webPagePath }),
  };
}

/**
 * What the interface lists a vendor by.
 *
 * @param vendor - As the loader produced it.
 * @param hearing - How its devices are being heard now.
 * @param packageProblems - What it needs and is not running, in sentences.
 * @returns The catalogue entry, drivers included.
 */
function vendorOf(
  vendor: LoadedVendor,
  hearing: VendorHearing,
  packageProblems: readonly string[],
): IntegrationVendor {
  const { manifest } = vendor;
  const pairing = vendor.discovery?.plan.discovery.pairing;

  return {
    id: manifest.id,
    version: manifest.version,
    name: manifest.name,
    ...(manifest.description === undefined ? {} : { description: manifest.description }),
    ...(manifest.url === undefined ? {} : { url: manifest.url }),
    ...(manifest.color === undefined ? {} : { color: manifest.color }),
    ...(vendor.logo === undefined ? {} : { logo: vendor.logo }),
    logoPadding: manifest.logo?.padding ?? 0,
    internetRequired: manifest.internetRequired,
    transports: [...vendor.transports],
    wires: [...vendor.wires],
    setup: vendor.setup,
    account:
      vendor.account === undefined
        ? null
        : {
            name: vendor.account.declaration.name,
            ...(vendor.account.declaration.help === undefined
              ? {}
              : { help: vendor.account.declaration.help }),
            fields: vendor.account.declaration.fields,
            identity: vendor.account.declaration.identity,
          },
    discoverySources: [...new Set(vendor.discovery?.sources.map((source) => source.kind) ?? [])],
    adoption: vendor.discovery?.plan.discovery.adopt ?? 'owner',
    pairing:
      pairing === undefined
        ? null
        : {
            driverId: pairing.driver,
            openObjectId: pairing.open,
            closeObjectId: pairing.close,
            stateObjectId: pairing.state,
          },
    drivers: vendor.drivers.map(kindOf),
    containers: manifest.containers.map((container) => ({
      id: container.id,
      name: container.name,
      image: container.image,
      minVersion: container.minVersion,
    })),
    requires: manifest.requires,
    packageProblems: [...packageProblems],
    listener: hearing.listener,
    passedOver: hearing.passedOver,
  };
}

/** Answers the interface's questions about bundles and configurations. */
export class ManagementService {
  readonly #options: ManagementServiceOptions;

  /**
   * Prepares the service without serving anything.
   *
   * @param options - Its collaborators.
   */
  public constructor(options: ManagementServiceOptions) {
    this.#options = options;
  }

  /**
   * Lists what is loaded.
   *
   * @returns Every vendor with its drivers, and what setting up each asks.
   */
  public catalogue(): CatalogueReply {
    return {
      vendors: this.#options
        .vendors()
        .map((vendor) =>
          vendorOf(
            vendor,
            this.#options.hearing(vendor.manifest.id),
            this.#options.packageProblems?.(vendor.manifest.id) ?? [],
          ),
        ),
    };
  }

  /**
   * Tries a configuration against the world and lets go.
   *
   * @param request - Which bundle, and the configuration as the form built it.
   * @returns A verdict and a sentence. A configuration that does not work is reported, not
   * thrown: it is the outcome the owner pressed the button to learn.
   * @throws {NotFoundError} When no loaded bundle has that kind, which is not a verdict on the
   * configuration but on the request.
   */
  public async probe(request: ProbeRequest): Promise<ProbeReply> {
    const bundle = this.#options
      .vendors()
      .flatMap((vendor) => vendor.drivers)
      .find((each) => each.manifest.id === request.kind);

    if (bundle === undefined) {
      throw new NotFoundError('No loaded bundle has that kind', {
        details: { kind: request.kind },
      });
    }

    try {
      const transport = this.#options.transports.require(bundle.manifest.transport);
      const config = openSecrets(request.transportConfig, this.#options.secretsKey);
      const detail = await transport.probe(config, AbortSignal.timeout(request.timeoutMs));
      const detected = await this.#detect(request.kind, config);

      return { isReachable: true, detail, ...(detected === undefined ? {} : { detected }) };
    } catch (error: unknown) {
      const detail = detailOf(error);

      this.#options.logger.info({ kind: request.kind, detail }, 'A configuration did not probe');

      return { isReachable: false, detail };
    }
  }

  /**
   * Asks discovery which model answered, without letting its failure spoil the verdict.
   *
   * @param kind - The driver the form is on.
   * @param config - The configuration, secrets opened.
   * @returns The driver and model, or undefined when discovery cannot tell or failed.
   */
  async #detect(kind: string, config: JsonObject): Promise<ProbeReply['detected']> {
    try {
      const detected = await this.#options.detect(kind, config);

      return detected === undefined
        ? undefined
        : { ...detected, modelChoices: [...detected.modelChoices] };
    } catch (error: unknown) {
      this.#options.logger.debug({ err: error, kind }, 'Could not tell which model answered');

      return undefined;
    }
  }

  /**
   * Serves the management subjects.
   *
   * @returns The subscriptions, to unsubscribe on shutdown.
   */
  public serve(): BusSubscription[] {
    const { client } = this.#options;

    return [
      client.serve(
        busSubjects.service(HUB_SERVICE, HUB_CATALOGUE_METHOD),
        catalogueRequestSchema,

        /**
         * Lists what is loaded.
         *
         * @returns Every vendor, its drivers, and their setup declarations.
         */
        (): CatalogueReply => this.catalogue(),
      ),

      client.serve(
        busSubjects.service(HUB_SERVICE, HUB_PROBE_METHOD),
        probeRequestSchema,

        /**
         * Tries one configuration.
         *
         * @param request - Which bundle and what to try.
         * @returns The verdict.
         */
        async (request: ProbeRequest): Promise<ProbeReply> => this.probe(request),

        // A Test waits on a device for up to its timeout; two owners testing two devices, or one
        // device that does not answer, need not queue behind each other.
        { concurrency: PROBE_CONCURRENCY },
      ),

      client.serve(
        busSubjects.service(HUB_SERVICE, HUB_DISCOVER_METHOD),
        discoverRequestSchema,

        /**
         * Asks discovery to look now.
         *
         * @param request - Which vendor.
         * @returns The vendor being looked for, and for how long.
         */
        (request: DiscoverRequest): DiscoverReply => this.#options.rescan(request.vendorId),
      ),

      client.serve(
        busSubjects.service(HUB_SERVICE, HUB_DISCOVERED_METHOD),
        discoveredRequestSchema,

        /**
         * Lists what discovery proposes.
         *
         * @returns Every device heard and not yet added.
         */
        (): DiscoveredReply => ({ items: [...this.#options.discovered()] }),
      ),

      client.serve(
        busSubjects.service(HUB_SERVICE, HUB_RELOAD_METHOD),
        reloadRequestSchema,

        /**
         * Matches one instance to its row.
         *
         * @param request - Which instance.
         * @returns Where it ended up.
         */
        async (request: ReloadRequest): Promise<ReloadReply> =>
          this.#options.reload(request.integrationId),
      ),

      client.serve(
        busSubjects.service(HUB_SERVICE, HUB_FORGET_METHOD),
        forgetRequestSchema,

        /**
         * Stops one instance and drops it.
         *
         * @param request - Which instance.
         * @returns Whether it was running.
         */
        async (request: ForgetRequest): Promise<ForgetReply> =>
          this.#options.forget(request.integrationId),
      ),

      client.serve(
        busSubjects.service(HUB_SERVICE, HUB_VENDOR_CHANGED_METHOD),
        vendorChangedRequestSchema,

        /**
         * Takes in a vendor's saved settings: runs the containers it declares with them.
         *
         * @param request - Which vendor.
         * @returns Whether it is loaded.
         */
        async (request: VendorChangedRequest): Promise<VendorChangedReply> => ({
          isLoaded: await this.#options.vendorChanged(request.vendorId),
        }),
      ),
    ];
  }
}
