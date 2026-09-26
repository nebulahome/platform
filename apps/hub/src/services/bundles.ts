/**
 * Reading integrations off disk.
 *
 * A bundle is a vendor directory - `manifest.json`, a logo, optionally a `setup.json` of what
 * every device of the vendor shares - holding one driver directory per profile or entry point,
 * each with `driver.json`, its own `setup.json` and the profile or code. This is where the two
 * become the {@link LoadedVendor} the catalogue lists and the {@link LoadedBundle} the rest of
 * `hub` runs, and it is deliberately the only place that touches the filesystem for that purpose.
 * Bundles are read from two places - the data directory, and outside production the repository's
 * bundles under development - and {@link mergeBundleResults} puts the two together.
 *
 * **It is also the seam the catalogue will arrive through.** {@link LoadBundlesOptions.verify} is
 * called before a driver is built, and nothing passes one today because the only way a bundle
 * arrives is somebody putting it there. When a catalogue starts supplying them, the verifier that
 * checks the signature stamped on an approved code bundle is injected there and nothing else in
 * `hub` changes. Building the boundary now costs an optional call; retrofitting one later would
 * mean finding every place a bundle is read.
 *
 * One broken driver never stops its siblings, and one broken vendor never stops the others. A
 * failure is collected and reported so the interface can say which directory and why, because
 * the alternative - refusing to start - means one bad download takes the whole house offline.
 * The same goes one level down for a vendor's `discovery.json`: discovery is a convenience on top
 * of adding a device by address, so a broken one is reported and the vendor loads without it.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { satisfies } from 'semver';

import {
  integrationSetupSchema,
  withPollingField,
  type IntegrationSetup,
} from '@nebula-home/contracts';
import { createLogger, type PlatformLogger } from '@nebula-home/logging';
import {
  createDeclarativeIntegration,
  driverManifestSchema,
  integrationProfileSchema,
  resolveDiscovery,
  resolveManifest,
  vendorDiscoverySchema,
  vendorManifestSchema,
  type BundleManifest,
  type BundleSdk,
  type DiscoveryPlan,
  type DiscoverySource,
  type Integration,
  type Transport,
  type StreamFactory,
  type StreamSource,
  type TransportFactory,
  type VendorManifest,
} from '@nebula-home/package-runtime';

import { createUdpSockets } from '../transports/managed-udp.js';

import { createBundleSdk } from './bundle-sdk.js';

/** The file every vendor is recognised by. */
const MANIFEST_FILE = 'manifest.json';

/** The file every driver is recognised by. */
const DRIVER_FILE = 'driver.json';

/** The file a discoverable vendor says how its devices are found in. */
const DISCOVERY_FILE = 'discovery.json';

/**
 * The most a logo may weigh.
 *
 * It rides inside every catalogue reply, base64-encoded, so a large one slows every page that
 * lists vendors. Generous for an SVG mark or a small PNG, and found at startup rather than on
 * somebody's page.
 */
const LOGO_MAXIMUM_BYTES = 64 * 1024;

/** The image types a logo may be, by the extension the manifest names. */
const LOGO_TYPES: Readonly<Record<string, string>> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

/** A vendor that asks for nothing at setup. */
const NO_SETUP: IntegrationSetup = {
  transport: { constants: {}, fields: [] },
  options: { constants: {}, fields: [] },
};

/** A driver that loaded. */
export type LoadedBundle = {
  /** The driver's manifest joined with its vendor's, keyed by the kind. */
  readonly manifest: BundleManifest;
  readonly vendorId: string;
  readonly driverId: string;

  /** The driver's own name, without the vendor's in front: `Gen2`, `Printer`. */
  readonly driverName: string;
  readonly integration: Integration;

  /** What setting up an instance asks, for the catalogue to serve and the API to check against. */
  readonly setup: IntegrationSetup;

  /** Where it was read from, for a message that has to name it. */
  readonly directory: string;
};

/**
 * Which of the two places a vendor was read from.
 *
 * `installed` is the data directory's `hub/integrations`: where a download from the integrations
 * catalogue lands, and the only place a production hub reads, since the product ships with no
 * integration. `development` is the repository's `apps/hub/bundles`, read outside production in
 * the catalogue's place until it exists.
 */
export type BundleOrigin = 'development' | 'installed';

/** Where a vendor's devices announce themselves, ready to listen to. */
export type LoadedListenSource =
  | { readonly kind: 'mdns'; readonly service: string }
  | { readonly kind: 'module'; readonly file: string; readonly source: DiscoverySource };

/** How a vendor's devices are found: its plan, checked against its drivers, and its sources. */
export type LoadedDiscovery = {
  readonly plan: DiscoveryPlan;
  readonly sources: readonly LoadedListenSource[];
};

/** A vendor that loaded, with the drivers of it that did. */
export type LoadedVendor = {
  readonly manifest: VendorManifest;

  /** Which of the two places it was read from. */
  readonly origin: BundleOrigin;

  /** What setting the vendor up asks; empty groups when it asks for nothing. */
  readonly setup: IntegrationSetup;

  /** The logo as an image data URL, when the bundle ships one. */
  readonly logo?: string;

  /** Every transport one of its drivers speaks, each once, in the drivers' order. */
  readonly transports: readonly string[];

  /** The transports the vendor ships itself, ready to register: `shelly/rpc`. */
  readonly ownTransports: readonly Transport[];

  /** The stream sources the vendor ships, ready to register: `bambu-lab/camera`. */
  readonly streams: readonly StreamSource[];

  readonly drivers: readonly LoadedBundle[];

  /** How its devices are found, when it has a `discovery.json` that loaded. */
  readonly discovery?: LoadedDiscovery;

  /** Where it was read from, for a message that has to name it. */
  readonly directory: string;

  /**
   * Lets go of what the vendor's code holds: every UDP socket it opened.
   *
   * @returns A promise that settles once every port it held is free.
   */
  readonly release: () => Promise<void>;
};

/** A vendor or a driver that did not load, and why. */
export type BundleFailure = {
  readonly directory: string;
  readonly message: string;
};

/** What was found in a bundle directory. */
export type LoadBundlesResult = {
  readonly vendors: LoadedVendor[];

  /** Every driver that loaded, across vendors: what the runtime keys its registries by. */
  readonly loaded: LoadedBundle[];

  readonly failures: BundleFailure[];
};

/** What the loader needs. */
export type LoadBundlesOptions = {
  /** Where bundles are installed. Missing is not an error: a fresh installation has none. */
  readonly directory: string;

  /** Which of the two places the directory is; `installed` when not said. */
  readonly origin?: BundleOrigin;

  /** The contract version this build implements, checked against each bundle's range. */
  readonly runtimeVersion: string;

  /**
   * Decides whether a driver may be loaded at all.
   *
   * Absent means anything found locally is loaded, which is the state before a catalogue exists.
   *
   * @param manifest - What the driver says about itself, joined with its vendor.
   * @param directory - Where it was read from.
   * @returns Nothing, or a promise that settles, when it may be loaded.
   */
  readonly verify?: (manifest: BundleManifest, directory: string) => void | Promise<void>;

  /**
   * Decides whether a vendor's own transports may be loaded at all: they are code, and sit
   * at the tier a code driver does. Absent means anything found locally is loaded.
   *
   * @param vendor - What the vendor says about itself.
   * @param directory - Where it was read from.
   * @returns Nothing, or a promise that settles, when they may be loaded.
   */
  readonly verifyVendor?: (vendor: VendorManifest, directory: string) => void | Promise<void>;

  /** Where bundle code may log. A silent logger when the caller has none, as in tests. */
  readonly logger?: PlatformLogger;
};

/**
 * Reads and parses one JSON file of a bundle.
 *
 * @param directory - The bundle.
 * @param file - The file, relative to it.
 * @returns Whatever the file held.
 * @throws {Error} When the file cannot be read or is not JSON.
 */
async function readJson(directory: string, file: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(directory, file), 'utf8')) as unknown;
}

/**
 * The subdirectories of one directory.
 *
 * @param directory - Where to look.
 * @returns Their names, or none when the directory does not exist.
 */
async function subdirectories(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });

    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * Reads a vendor's logo as a data URL.
 *
 * @param directory - The vendor.
 * @param file - The logo, relative to it, as the manifest names it.
 * @returns The data URL.
 * @throws {Error} When the file is not an SVG or a PNG, is too large, or cannot be read.
 */
async function readLogo(directory: string, file: string): Promise<string> {
  const type = LOGO_TYPES[path.extname(file).toLowerCase()];

  if (type === undefined) {
    throw new Error(`The logo ${file} must be an .svg or a .png`);
  }

  const bytes = await readFile(path.join(directory, file));

  if (bytes.byteLength > LOGO_MAXIMUM_BYTES) {
    throw new Error(
      `The logo ${file} is ${String(bytes.byteLength)} bytes, and the most a logo may be is ${String(LOGO_MAXIMUM_BYTES)}`,
    );
  }

  return `data:${type};base64,${bytes.toString('base64')}`;
}

/**
 * Turns one driver directory into an integration.
 *
 * @param vendor - The vendor it belongs to, already checked.
 * @param directory - The driver.
 * @param options - How to verify.
 * @returns The integration and the manifest it came from.
 * @throws {Error} When the driver is malformed or cannot be read.
 */
async function loadDriver(
  vendor: VendorManifest,
  directory: string,
  options: LoadBundlesOptions,
): Promise<LoadedBundle> {
  const driver = driverManifestSchema.parse(await readJson(directory, DRIVER_FILE));

  if (driver.id !== path.basename(directory)) {
    throw new Error(
      `The driver in ${path.basename(directory)} calls itself ${driver.id}; the two must agree`,
    );
  }

  const manifest = resolveManifest(vendor, driver);
  const ownName = manifest.transport.startsWith(`${vendor.id}/`)
    ? manifest.transport.slice(vendor.id.length + 1)
    : null;

  if (ownName !== null && !(ownName in vendor.transports)) {
    throw new Error(`${manifest.id} names ${manifest.transport}, which the vendor does not ship`);
  }

  await options.verify?.(manifest, directory);

  // `polling` is served as the option it stands for, so nothing past the loader has to know it.
  const setup = withPollingField(
    integrationSetupSchema.parse(await readJson(directory, manifest.setup)),
  );
  const identity = {
    manifest,
    vendorId: vendor.id,
    driverId: driver.id,
    driverName: driver.name,
    setup,
    directory,
  };

  if (manifest.kind === 'declarative') {
    const profile = integrationProfileSchema.parse(
      await readJson(directory, manifest.profile ?? ''),
    );

    return { ...identity, integration: createDeclarativeIntegration(manifest, profile) };
  }

  const entry = pathToFileURL(path.join(directory, manifest.entry ?? '')).href;
  const module: unknown = await import(entry);
  const integration = (module as { readonly default?: unknown }).default;

  if (integration === null || typeof integration !== 'object') {
    throw new Error(`${manifest.id} does not default-export an integration`);
  }

  return { ...identity, integration: integration as Integration };
}

/**
 * Reads one driver directory, if it is a driver at all.
 *
 * @param vendor - The vendor it belongs to.
 * @param directory - The directory to look at.
 * @param options - How to verify.
 * @returns What loaded, why it did not, or null when the directory is not a driver.
 */
async function loadIfDriver(
  vendor: VendorManifest,
  directory: string,
  options: LoadBundlesOptions,
): Promise<LoadedBundle | BundleFailure | null> {
  try {
    await readFile(path.join(directory, DRIVER_FILE));
  } catch {
    // A directory with no driver manifest is not a driver anybody meant to install - notes,
    // an editor's leftovers - so it is passed over rather than reported as broken.
    return null;
  }

  try {
    return await loadDriver(vendor, directory, options);
  } catch (error: unknown) {
    return { directory, message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Loads the transports a vendor ships, each from its module, each checked to call itself
 * what the vendor's manifest calls it.
 *
 * @param vendor - The vendor's manifest.
 * @param directory - The vendor's directory.
 * @param options - How to verify.
 * @param sdk - What the vendor's code is handed.
 * @returns The transports, registered under `<vendor>/<name>`.
 * @throws {Error} When a module is missing, exports no factory, or names itself otherwise.
 */
async function loadVendorTransports(
  vendor: VendorManifest,
  directory: string,
  options: LoadBundlesOptions,
  sdk: BundleSdk,
): Promise<Transport[]> {
  const entries = Object.entries(vendor.transports);

  if (entries.length === 0) {
    return [];
  }

  await options.verifyVendor?.(vendor, directory);

  return Promise.all(
    entries.map(async ([name, file]) => {
      const module: unknown = await import(pathToFileURL(path.join(directory, file)).href);
      const factory = (module as { readonly default?: unknown }).default;

      if (typeof factory !== 'function') {
        throw new Error(`${vendor.id} transport ${name} does not default-export a factory`);
      }

      const transport = (factory as TransportFactory)(sdk);
      const expected = `${vendor.id}/${name}`;

      if (transport.id !== expected) {
        throw new Error(
          `The transport ${vendor.id} ships as ${name} calls itself ${transport.id}; it must be ${expected}`,
        );
      }

      return transport;
    }),
  );
}

/**
 * Loads the stream sources a vendor ships, each checked to call itself what the manifest calls it.
 *
 * @param vendor - The vendor's manifest.
 * @param directory - The vendor's directory.
 * @param sdk - What the vendor's code is handed.
 * @returns The sources, registered under `<vendor>/<name>`.
 * @throws {Error} When a module is missing, exports no factory, or names itself otherwise.
 */
async function loadVendorStreams(
  vendor: VendorManifest,
  directory: string,
  sdk: BundleSdk,
): Promise<StreamSource[]> {
  return Promise.all(
    Object.entries(vendor.streams).map(async ([name, file]) => {
      const module: unknown = await import(pathToFileURL(path.join(directory, file)).href);
      const factory = (module as { readonly default?: unknown }).default;

      if (typeof factory !== 'function') {
        throw new Error(`${vendor.id} stream ${name} does not default-export a factory`);
      }

      const source = (factory as StreamFactory)(sdk);
      const expected = `${vendor.id}/${name}`;

      if (source.id !== expected) {
        throw new Error(
          `The stream ${vendor.id} ships as ${name} calls itself ${source.id}; it must be ${expected}`,
        );
      }

      return source;
    }),
  );
}

/**
 * Whether a file is there to be read.
 *
 * @param file - The file.
 * @returns True when it can be read.
 */
async function exists(file: string): Promise<boolean> {
  try {
    await readFile(file);

    return true;
  } catch {
    return false;
  }
}

/**
 * Reads how a vendor's devices are found, and loads the modules it listens with.
 *
 * @param vendor - The vendor's manifest.
 * @param directory - The vendor's directory.
 * @param drivers - The drivers that loaded, whose model codes the plan is checked against.
 * @param options - How to verify.
 * @param sdk - What a discovery module is handed.
 * @returns The discovery, ready to listen with.
 * @throws {Error} When the file is malformed, a code is mapped by two drivers, the probe names a
 * transport the vendor does not ship, or a module does not export a factory.
 */
async function loadDiscovery(
  vendor: VendorManifest,
  directory: string,
  drivers: readonly LoadedBundle[],
  options: LoadBundlesOptions,
  sdk: BundleSdk,
): Promise<LoadedDiscovery> {
  const discovery = vendorDiscoverySchema.parse(await readJson(directory, DISCOVERY_FILE));
  const plan = resolveDiscovery(
    vendor.id,
    discovery,
    drivers.map((driver) => ({
      id: driver.driverId,
      name: driver.driverName,
      models: driver.manifest.models,
      modelCodes: driver.manifest.modelCodes,
    })),
  );
  const probed = discovery.probe?.transport;

  if (probed?.startsWith(`${vendor.id}/`) === true) {
    const name = probed.slice(vendor.id.length + 1);

    if (!(name in vendor.transports)) {
      throw new Error(`${vendor.id} probes with ${probed}, which the vendor does not ship`);
    }
  }

  const modules = discovery.listen.filter((source) => 'module' in source);

  if (modules.length > 0) {
    // Code, at the tier a vendor's own transport is.
    await options.verifyVendor?.(vendor, directory);
  }

  const sources = await Promise.all(
    discovery.listen.map(async (listened): Promise<LoadedListenSource> => {
      if ('mdns' in listened) {
        return { kind: 'mdns', service: listened.mdns };
      }

      const module: unknown = await import(
        pathToFileURL(path.join(directory, listened.module)).href
      );
      const factory = (module as { readonly default?: unknown }).default;

      if (typeof factory !== 'function') {
        throw new Error(
          `${vendor.id} discovery module ${listened.module} does not default-export a factory`,
        );
      }

      const source: unknown = (factory as (given: BundleSdk) => unknown)(sdk);

      if (
        source === null ||
        typeof source !== 'object' ||
        typeof (source as { readonly listen?: unknown }).listen !== 'function'
      ) {
        throw new Error(
          `${vendor.id} discovery module ${listened.module} does not return something to listen with`,
        );
      }

      return { kind: 'module', file: listened.module, source: source as DiscoverySource };
    }),
  );

  return { plan, sources };
}

/**
 * Turns one vendor directory into a vendor with its drivers.
 *
 * @param directory - The vendor.
 * @param options - The runtime version to check against, and how to verify.
 * @returns The vendor, when at least one driver loaded, and every driver failure.
 * @throws {Error} When the vendor itself is malformed: its manifest, its logo, its setup, its
 * runtime range, its own transports, or a directory with no driver in it.
 */
async function loadVendor(
  directory: string,
  options: LoadBundlesOptions,
): Promise<{ readonly vendor: LoadedVendor | null; readonly failures: BundleFailure[] }> {
  const manifest = vendorManifestSchema.parse(await readJson(directory, MANIFEST_FILE));

  if (manifest.id !== path.basename(directory)) {
    throw new Error(
      `The vendor in ${path.basename(directory)} calls itself ${manifest.id}; the two must agree`,
    );
  }

  if (!satisfies(options.runtimeVersion, manifest.sdk)) {
    // Both versions named, because "expected string, received number" three files deeper is not
    // something the owner reading it can do anything about.
    throw new Error(
      `${manifest.id} needs a runtime matching ${manifest.sdk}, and this one is ${options.runtimeVersion}`,
    );
  }

  const logger =
    options.logger ??
    createLogger({ service: 'hub', version: options.runtimeVersion, level: 'fatal' });
  const udp = createUdpSockets(logger);
  const sdk = createBundleSdk({
    version: options.runtimeVersion,
    logger,
    openUdpSocket: udp.open,
  });

  try {
    return await loadVendorWith(manifest, directory, options, sdk, udp.closeAll);
  } catch (error: unknown) {
    await udp.closeAll();

    throw error;
  }
}

/**
 * Loads a vendor whose manifest has been checked, with the SDK its code is handed.
 *
 * @param manifest - The vendor's manifest.
 * @param directory - The vendor.
 * @param options - How to verify.
 * @param sdk - What the vendor's code is handed.
 * @param release - Lets go of what the vendor's code holds.
 * @returns The vendor, when at least one driver loaded, and every failure below it.
 * @throws {Error} When the vendor's own transports, setup or logo are malformed, or a directory
 * has no driver in it.
 */
async function loadVendorWith(
  manifest: VendorManifest,
  directory: string,
  options: LoadBundlesOptions,
  sdk: BundleSdk,
  release: () => Promise<void>,
): Promise<{ readonly vendor: LoadedVendor | null; readonly failures: BundleFailure[] }> {
  // Before the drivers: a driver is only as loadable as the transport it opens, and a vendor
  // whose transport is broken has nothing to offer.
  const ownTransports = await loadVendorTransports(manifest, directory, options, sdk);
  const streams = await loadVendorStreams(manifest, directory, sdk);
  const setup =
    manifest.setup === undefined
      ? NO_SETUP
      : withPollingField(integrationSetupSchema.parse(await readJson(directory, manifest.setup)));
  const logo =
    manifest.logo === undefined ? undefined : await readLogo(directory, manifest.logo.path);

  const results = await Promise.all(
    (await subdirectories(directory)).map(async (name) =>
      loadIfDriver(manifest, path.join(directory, name), options),
    ),
  );
  const drivers = results.filter(
    (result): result is LoadedBundle => result !== null && 'integration' in result,
  );
  const failures = results.filter(
    (result): result is BundleFailure => result !== null && 'message' in result,
  );

  if (drivers.length === 0 && failures.length === 0) {
    throw new Error(`${manifest.id} ships no driver, so there is nothing to add a device with`);
  }

  if (drivers.length === 0) {
    // The drivers' failures already say what went wrong. A vendor with nothing to add a device
    // with would only be a card that sends the owner to a page that cannot do anything.
    await release();

    return { vendor: null, failures };
  }

  let discovery: LoadedDiscovery | undefined;

  if (await exists(path.join(directory, DISCOVERY_FILE))) {
    try {
      discovery = await loadDiscovery(manifest, directory, drivers, options, sdk);
    } catch (error: unknown) {
      failures.push({
        directory: path.join(directory, DISCOVERY_FILE),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    vendor: {
      manifest,
      origin: options.origin ?? 'installed',
      setup,
      ...(logo === undefined ? {} : { logo }),
      transports: [...new Set(drivers.map((driver) => driver.manifest.transport))],
      ownTransports,
      streams,
      drivers,
      ...(discovery === undefined ? {} : { discovery }),
      directory,
      release,
    },
    failures,
  };
}

/**
 * Reads one vendor directory, if it is a vendor at all.
 *
 * @param directory - The directory to look at.
 * @param options - The runtime version to check against, and how to verify.
 * @returns The vendor and its drivers' failures, the vendor's own failure, or null when the
 * directory is not a vendor.
 */
async function loadIfVendor(
  directory: string,
  options: LoadBundlesOptions,
): Promise<{ readonly vendor: LoadedVendor | null; readonly failures: BundleFailure[] } | null> {
  try {
    await readFile(path.join(directory, MANIFEST_FILE));
  } catch {
    return null;
  }

  try {
    return await loadVendor(directory, options);
  } catch (error: unknown) {
    return {
      vendor: null,
      failures: [{ directory, message: error instanceof Error ? error.message : String(error) }],
    };
  }
}

/**
 * Reads every bundle installed in a directory.
 *
 * @param options - Where to look, what contract version to check against, and how to verify.
 * @returns The vendors and drivers that loaded, and what did not with the reason.
 */
export async function loadBundles(options: LoadBundlesOptions): Promise<LoadBundlesResult> {
  const results = await Promise.all(
    (await subdirectories(options.directory)).map(async (name) =>
      loadIfVendor(path.join(options.directory, name), options),
    ),
  );
  const found = results.filter((result) => result !== null);
  const vendors = found
    .map((result) => result.vendor)
    .filter((vendor): vendor is LoadedVendor => vendor !== null);

  return {
    vendors,
    loaded: vendors.flatMap((vendor) => vendor.drivers),
    failures: found.flatMap((result) => result.failures),
  };
}

/**
 * Puts together what the two places held.
 *
 * An installed vendor replaces a development one with the same id, whole - drivers, transports
 * and all - because it is what somebody put in the data directory on purpose, and mixing the
 * drivers of two copies of one vendor would run a driver against a transport it was not written
 * for. The replacement is logged naming both directories, so that an edit in the repository that
 * seems to have no effect explains itself. An installed copy that failed to load replaces
 * nothing: its failure is reported, and the development one keeps working.
 *
 * @param development - What the development directory held.
 * @param installed - What the data directory held.
 * @param logger - Where a replacement is reported.
 * @returns One result, as if read from one directory.
 */
export function mergeBundleResults(
  development: LoadBundlesResult,
  installed: LoadBundlesResult,
  logger: PlatformLogger,
): LoadBundlesResult {
  const byId = new Map<string, LoadedVendor>();

  for (const vendor of development.vendors) {
    byId.set(vendor.manifest.id, vendor);
  }

  for (const vendor of installed.vendors) {
    const replaced = byId.get(vendor.manifest.id);

    if (replaced !== undefined) {
      logger.warn(
        {
          vendor: vendor.manifest.id,
          installed: vendor.directory,
          development: replaced.directory,
        },
        'An installed integration replaces the one under development',
      );

      // Whatever the replaced copy's code opened while it loaded is let go of: it will never run.
      replaced.release().catch((error: unknown) => {
        logger.warn(
          { err: error, vendor: vendor.manifest.id },
          'Could not release a replaced vendor',
        );
      });
    }

    byId.set(vendor.manifest.id, vendor);
  }

  const vendors = [...byId.values()];

  return {
    vendors,
    loaded: vendors.flatMap((vendor) => vendor.drivers),
    failures: [...development.failures, ...installed.failures],
  };
}
