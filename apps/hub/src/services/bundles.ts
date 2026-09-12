/**
 * Reading integrations off disk.
 *
 * A bundle is a vendor directory - `manifest.json`, a logo, optionally a `setup.json` of what
 * every device of the vendor shares - holding one driver directory per profile or entry point,
 * each with `driver.json`, its own `setup.json` and the profile or code. This is where the two
 * become the {@link LoadedVendor} the catalogue lists and the {@link LoadedBundle} the rest of
 * `hub` runs, and it is deliberately the only place that touches the filesystem for that purpose.
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
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { satisfies } from 'semver';

import { integrationSetupSchema, type IntegrationSetup } from '@nebula-home/contracts';
import {
  createDeclarativeIntegration,
  driverManifestSchema,
  integrationProfileSchema,
  resolveManifest,
  vendorManifestSchema,
  type BundleManifest,
  type Integration,
  type VendorManifest,
} from '@nebula-home/package-runtime';

/** The file every vendor is recognised by. */
const MANIFEST_FILE = 'manifest.json';

/** The file every driver is recognised by. */
const DRIVER_FILE = 'driver.json';

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

/** A vendor that loaded, with the drivers of it that did. */
export type LoadedVendor = {
  readonly manifest: VendorManifest;

  /** What setting the vendor up asks; empty groups when it asks for nothing. */
  readonly setup: IntegrationSetup;

  /** The logo as an image data URL, when the bundle ships one. */
  readonly logo?: string;

  /** Every transport one of its drivers speaks, each once, in the drivers' order. */
  readonly transports: readonly string[];

  readonly drivers: readonly LoadedBundle[];

  /** Where it was read from, for a message that has to name it. */
  readonly directory: string;
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

  await options.verify?.(manifest, directory);

  const setup = integrationSetupSchema.parse(await readJson(directory, manifest.setup));
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
 * Turns one vendor directory into a vendor with its drivers.
 *
 * @param directory - The vendor.
 * @param options - The runtime version to check against, and how to verify.
 * @returns The vendor, when at least one driver loaded, and every driver failure.
 * @throws {Error} When the vendor itself is malformed: its manifest, its logo, its setup, its
 * runtime range, or a directory with no driver in it.
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

  const setup =
    manifest.setup === undefined
      ? NO_SETUP
      : integrationSetupSchema.parse(await readJson(directory, manifest.setup));
  const logo = manifest.logo === undefined ? undefined : await readLogo(directory, manifest.logo);

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
    return { vendor: null, failures };
  }

  return {
    vendor: {
      manifest,
      setup,
      ...(logo === undefined ? {} : { logo }),
      transports: [...new Set(drivers.map((driver) => driver.manifest.transport))],
      drivers,
      directory,
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
