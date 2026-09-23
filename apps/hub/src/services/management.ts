/**
 * What the interface needs from `hub` to configure an instance: the catalogue, a probe, a
 * reload and a forget.
 *
 * Four questions, one bus subject each. *What can I install?* is answered from the bundles on
 * disk, with what each asks at setup, so the form is built from the bundle's own words and the
 * interface never reads a file. *Does this configuration work?* opens the transport once and
 * lets go, keeping nothing - the answer is a verdict and a sentence, because a configuration
 * that does not work is the expected outcome of trying one. *I saved it; match it* re-reads one
 * row of the registry and starts, restarts or stops the instance to fit. *I am deleting it;
 * let go* stops the instance without reading anything, because the row is about to be gone.
 *
 * Nothing here touches the registry directly. The API owns writes, the service that runs
 * instances owns the reload and the forget, and this class only routes between the bus and it.
 */
import { z } from 'zod';

import type { BusClient, BusSubscription } from '@nebula-home/bus';
import {
  busSubjects,
  catalogueRequestSchema,
  forgetRequestSchema,
  HUB_CATALOGUE_METHOD,
  HUB_FORGET_METHOD,
  HUB_PROBE_METHOD,
  HUB_RELOAD_METHOD,
  HUB_SERVICE,
  NotFoundError,
  probeRequestSchema,
  reloadRequestSchema,
  type CatalogueReply,
  type ForgetReply,
  type ForgetRequest,
  type IntegrationKind,
  type IntegrationVendor,
  type ProbeReply,
  type ProbeRequest,
  type ReloadReply,
  type ReloadRequest,
} from '@nebula-home/contracts';
import { openSecrets } from '@nebula-home/db';
import type { PlatformLogger } from '@nebula-home/logging';
import type { Registry, Transport } from '@nebula-home/package-runtime';

import type { LoadedBundle, LoadedVendor } from './bundles.js';

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
};

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
    ...(manifest.defaultIcon === undefined ? {} : { defaultIcon: manifest.defaultIcon }),
    setup: bundle.setup,
  };
}

/**
 * What the interface lists a vendor by.
 *
 * @param vendor - As the loader produced it.
 * @returns The catalogue entry, drivers included.
 */
function vendorOf(vendor: LoadedVendor): IntegrationVendor {
  const { manifest } = vendor;

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
    setup: vendor.setup,
    drivers: vendor.drivers.map(kindOf),
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
    return { vendors: this.#options.vendors().map(vendorOf) };
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

      return { isReachable: true, detail };
    } catch (error: unknown) {
      const detail = detailOf(error);

      this.#options.logger.info({ kind: request.kind, detail }, 'A configuration did not probe');

      return { isReachable: false, detail };
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
    ];
  }
}
