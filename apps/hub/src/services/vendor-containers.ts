/**
 * Handing the supervisor the containers the loaded vendors declare.
 *
 * `hub` is the one that knows the bundles, and the one that may open a vendor's saved settings;
 * the supervisor is the one that may reach Docker. So `hub` fills each vendor's declaration in
 * with its settings and sends it over: the whole set when it starts (`reconcile`), and one
 * vendor's again when the owner saved its settings (`ensure`, asked by `api` through
 * `svc.hub.vendor_changed`).
 *
 * A vendor that asks for settings nobody has given declares no container yet: zigbee2mqtt cannot
 * be started without knowing where its adapter is. A supervisor that is not up when `hub` starts
 * is asked again every minute until it answers.
 */
import type { BusClient } from '@nebula-home/bus';
import {
  asksAnythingRequired,
  busSubjects,
  ensureRequestSchema,
  managedReplySchema,
  SUPERVISOR_METHODS,
  SUPERVISOR_SERVICE,
  type IntegrationSetup,
  type JsonObject,
  type VendorContainers,
} from '@nebula-home/contracts';
import type { PlatformLogger } from '@nebula-home/logging';
import { renderContainers, type VendorValues } from '@nebula-home/package-runtime';

import type { VendorSettings } from '../domain/vendors.js';

import type { LoadedVendor } from './bundles.js';

/** How long the supervisor has to take the declarations; the pulls go on after it answers. */
const SUPERVISOR_TIMEOUT_MS = 10_000;

/** How long before a supervisor that did not answer is asked again. */
const RETRY_MS = 60_000;

/** What handing over the declarations needs. */
export type VendorContainersOptions = {
  readonly client: BusClient;
  readonly logger: PlatformLogger;

  /**
   * The vendors loaded.
   *
   * @returns Every loaded vendor.
   */
  readonly vendors: () => readonly LoadedVendor[];

  /**
   * Reads a vendor's saved settings, secrets opened.
   *
   * @param vendorId - The vendor.
   * @returns What the owner saved, or undefined when nothing.
   */
  readonly settings: (vendorId: string) => Promise<VendorSettings | undefined>;
};

/**
 * Every setting a vendor asks, with its default: what a condition reads when nothing was saved.
 *
 * @param setup - The vendor's setup.
 * @returns The defaults.
 */
function defaultsOf(setup: IntegrationSetup): JsonObject {
  return Object.fromEntries(
    [...setup.transport.fields, ...setup.options.fields].flatMap((field) =>
      'default' in field && field.default !== undefined ? [[field.key, field.default]] : [],
    ),
  );
}

/**
 * One vendor's declaration, filled in with what the owner saved.
 *
 * @param vendor - The vendor.
 * @param saved - Its saved settings, or undefined.
 * @returns Its containers; none while it still needs setting up.
 */
export function declaredContainers(
  vendor: LoadedVendor,
  saved: VendorSettings | undefined,
): VendorContainers {
  const vendorId = vendor.manifest.id;

  if (
    vendor.manifest.containers.length === 0 ||
    (saved === undefined && asksAnythingRequired(vendor.setup))
  ) {
    return { vendorId, containers: [] };
  }

  const values: VendorValues = {
    ...defaultsOf(vendor.setup),
    ...vendor.setup.transport.constants,
    ...vendor.setup.options.constants,
    ...saved?.transportConfig,
    ...saved?.options,
  };

  return { vendorId, containers: renderContainers(vendorId, vendor.manifest.containers, values) };
}

/** Hands the supervisor the containers the vendors declare. */
export class VendorContainersService {
  readonly #options: VendorContainersOptions;
  #retry: NodeJS.Timeout | null = null;

  /**
   * Creates the service; nothing is sent until {@link reconcile}.
   *
   * @param options - The bus client, the logger, the vendors and their settings.
   */
  public constructor(options: VendorContainersOptions) {
    this.#options = options;
  }

  /**
   * Sends the whole set: what every loaded vendor declares. Asked again later when the
   * supervisor does not answer.
   */
  public async reconcile(): Promise<void> {
    this.#clearRetry();

    try {
      const vendors = await this.#declarations(this.#options.vendors());

      await this.#options.client.request(
        busSubjects.service(SUPERVISOR_SERVICE, SUPERVISOR_METHODS.reconcile),
        { vendors },
        managedReplySchema,
        { timeoutMs: SUPERVISOR_TIMEOUT_MS },
      );

      const declared = vendors.filter((vendor) => vendor.containers.length > 0);

      if (declared.length > 0) {
        this.#options.logger.info(
          { vendors: declared.map((vendor) => vendor.vendorId) },
          'Handed the supervisor the containers the vendors need',
        );
      }
    } catch (error: unknown) {
      this.#options.logger.warn(
        { err: error, retryInMs: RETRY_MS },
        'Could not hand the supervisor the containers the vendors need',
      );
      this.#retry = setTimeout(() => {
        void this.reconcile();
      }, RETRY_MS);
      this.#retry.unref();
    }
  }

  /**
   * Sends one vendor's containers again, after its settings were saved.
   *
   * @param vendorId - The vendor.
   * @returns Whether the vendor is loaded; an unknown vendor sends nothing.
   * @throws {Error} When the supervisor refuses or does not answer.
   */
  public async vendorChanged(vendorId: string): Promise<boolean> {
    const vendor = this.#options.vendors().find((each) => each.manifest.id === vendorId);

    if (vendor === undefined) {
      return false;
    }

    const [declaration] = await this.#declarations([vendor]);

    if (declaration === undefined) {
      return false;
    }

    await this.#options.client.request(
      busSubjects.service(SUPERVISOR_SERVICE, SUPERVISOR_METHODS.ensure),
      ensureRequestSchema.parse(declaration),
      managedReplySchema,
      { timeoutMs: SUPERVISOR_TIMEOUT_MS },
    );

    return true;
  }

  /**
   * Stops asking again.
   */
  public stop(): void {
    this.#clearRetry();
  }

  /**
   * Fills in the declarations of some vendors.
   *
   * A vendor whose declaration cannot be filled in - a device path the owner typed that is not
   * under `/dev` - declares nothing, and says why in the log.
   *
   * @param vendors - The vendors.
   * @returns One declaration per vendor, in the same order.
   */
  async #declarations(vendors: readonly LoadedVendor[]): Promise<VendorContainers[]> {
    return Promise.all(
      vendors.map(async (vendor) => {
        try {
          return declaredContainers(vendor, await this.#options.settings(vendor.manifest.id));
        } catch (error: unknown) {
          this.#options.logger.error(
            { err: error, vendor: vendor.manifest.id },
            'The containers this vendor needs cannot be made with its settings',
          );

          return { vendorId: vendor.manifest.id, containers: [] };
        }
      }),
    );
  }

  /**
   * Cancels a pending retry.
   */
  #clearRetry(): void {
    if (this.#retry !== null) {
      clearTimeout(this.#retry);
      this.#retry = null;
    }
  }
}
