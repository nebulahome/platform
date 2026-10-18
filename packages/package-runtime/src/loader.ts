/**
 * Reading integrations off disk: the loader `hub` runs and the integration SDK checks a bundle
 * with, so that what passes `nebulahome-integration validate` is what `hub` loads.
 *
 * A bundle is a vendor directory - `manifest.json`, a logo, optionally a `setup.json` of what
 * every device of the vendor shares - holding one driver directory per profile or entry point,
 * each with `driver.json`, its own `setup.json` and the profile or code. It is read in two steps:
 *
 * 1. {@link readVendorDirectory} reads and checks every file - the schemas, the ids against the
 *    folders, the runtime range, the logo, the containers, that every module named is there -
 *    and imports nothing. It is all a source tree needs to be checked.
 * 2. {@link instantiateVendor} imports the code and hands it the {@link BundleSdk}: the vendor's
 *    own transports, stream sources and account, each driver, and the discovery modules. Who
 *    builds the SDK is the caller's - `hub` hands the real one, the SDK's tests a fake.
 *
 * **It is also the seam the catalogue arrives through.** `verify` and `verifyVendor` are called
 * before code is imported, and nothing passes them today. When the catalogue stamps a signature on
 * an approved code bundle, the verifier that checks it is injected there and nothing else changes.
 *
 * One broken driver never stops its siblings, and one broken vendor never stops the others. A
 * failure is collected and reported so the interface can say which directory and why, because
 * the alternative - refusing to start - means one bad download takes the whole house offline.
 * The same goes one level down for a vendor's `discovery.json`: discovery is a convenience on top
 * of adding a device by address, so a broken one is reported and the vendor loads without it.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { satisfies } from 'semver';
import type { z } from 'zod';

import {
  integrationSetupSchema,
  TRANSPORT_WIRES,
  withPollingField,
  type IntegrationSetup,
  type TransportWire,
} from '@nebulahome/contracts';

import {
  accountDeclarationSchema,
  type AccountDeclaration,
  type AccountFactory,
  type AccountModule,
} from './account.js';
import {
  driverManifestSchema,
  resolveManifest,
  transportModuleOf,
  transportWiresOf,
  vendorManifestSchema,
  type BundleManifest,
  type VendorManifest,
} from './bundle.js';
import { containerDependencyProblems } from './containers.js';
import { createDeclarativeIntegration } from './declarative.js';
import {
  resolveDiscovery,
  vendorDiscoverySchema,
  type DiscoveryPlan,
  type DiscoverySource,
  type VendorDiscovery,
} from './discovery.js';
import { INSTALL_MARKER_FILE, installMarkerSchema, type InstallMarker } from './install-marker.js';
import type { Integration } from './integration.js';
import { createMatterIntegration } from './matter-mapping.js';
import { integrationProfileSchema, type IntegrationProfile } from './profile.js';
import type { BundleLogger, BundleSdk, StreamFactory, TransportFactory } from './sdk.js';
import type { StreamSource } from './stream.js';
import type { Transport } from './transport.js';

/** The file every vendor is recognised by. */
export const MANIFEST_FILE = 'manifest.json';

/** The file every driver is recognised by. */
export const DRIVER_FILE = 'driver.json';

/** The file a discoverable vendor says how its devices are found in. */
export const DISCOVERY_FILE = 'discovery.json';

/**
 * The most a logo may weigh.
 *
 * It rides inside every catalogue reply, base64-encoded, so a large one slows every page that
 * lists vendors. Generous for an SVG mark or a small PNG, and found at startup rather than on
 * somebody's page.
 */
export const LOGO_MAXIMUM_BYTES = 64 * 1024;

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
 * `installed` is the data directory's `hub/integrations`: where the platform installs a vendor
 * from the integrations index or its local folder, and the only place a production hub reads.
 * `development` is a directory of bundles under development - an integration repository's
 * `dist/`, named in the hub's `HUB_DEV_BUNDLE_DIR` - read beside it. `platform` is no place at
 * all: the vendor the hub is itself, `matter`, built in code.
 */
export type BundleOrigin = 'development' | 'installed' | 'platform';

/** Where a vendor's devices announce themselves, ready to listen to. */
export type LoadedListenSource =
  | { readonly kind: 'mdns'; readonly service: string }
  | {
      readonly kind: 'module';
      readonly file: string;
      readonly source: DiscoverySource;

      /** Whether it listens on the house's network, and is off where the hub cannot hear it. */
      readonly lan: boolean;
    };

/** How a vendor's devices are found: its plan, checked against its drivers, and its sources. */
export type LoadedDiscovery = {
  readonly plan: DiscoveryPlan;
  readonly sources: readonly LoadedListenSource[];
};

/** A vendor's account: what signing in asks, and the module that does it. */
export type LoadedAccount = {
  readonly declaration: AccountDeclaration;
  readonly module: AccountModule;
};

/** A vendor that loaded, with the drivers of it that did. */
export type LoadedVendor = {
  readonly manifest: VendorManifest;

  /** Which of the two places it was read from. */
  readonly origin: BundleOrigin;

  /** How the platform installed it, for one it did: its marker. */
  readonly install?: InstallMarker;

  /** What setting the vendor up asks; empty groups when it asks for nothing. */
  readonly setup: IntegrationSetup;

  /** The logo as an image data URL, when the bundle ships one. */
  readonly logo?: string;

  /** Every transport one of its drivers speaks, each once, in the drivers' order. */
  readonly transports: readonly string[];

  /** The wires its devices are reached over, for its card: see {@link wiresOf}. */
  readonly wires: readonly TransportWire[];

  /** The transports the vendor ships itself, ready to register: `shelly/rpc`. */
  readonly ownTransports: readonly Transport[];

  /** The stream sources the vendor ships, ready to register: `bambulab/camera`. */
  readonly streams: readonly StreamSource[];

  readonly drivers: readonly LoadedBundle[];

  /** How its devices are found, when it has a `discovery.json` that loaded. */
  readonly discovery?: LoadedDiscovery;

  /**
   * The account its devices are reached through, when it has an `account.json` - what
   * signing in asks, and the module that signs in.
   */
  readonly account?: LoadedAccount;

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

  /** The vendor it belongs to - its folder's name - when the failure is inside one. */
  readonly vendorId?: string;
};

/** What was found in a bundle directory. */
export type LoadBundlesResult = {
  readonly vendors: LoadedVendor[];

  /** Every driver that loaded, across vendors: what the runtime keys its registries by. */
  readonly loaded: LoadedBundle[];

  readonly failures: BundleFailure[];
};

/**
 * Finds a module a bundle names.
 *
 * @param directory - The folder the name is relative to.
 * @param file - The name, as the bundle writes it: `./rpc/transport.js`.
 * @returns The module's path, or null when it is not there.
 */
export type ResolveModule = (directory: string, file: string) => Promise<string | null>;

/** What reading a vendor's files takes. */
export type ReadVendorOptions = {
  /** What the vendor must call itself: its folder's name. The directory's own name when absent. */
  readonly expectedId?: string;

  /** The contract version the bundle is checked against; its range is not checked when absent. */
  readonly runtimeVersion?: string;

  /**
   * The version and the runtime range of a vendor read from its sources, where the build writes
   * them rather than the author: the manifest must not say them, and is read with these.
   */
  readonly stamp?: { readonly version: string; readonly sdk: string };

  /** Where a module named in the bundle is; the file itself, when it exists, when absent. */
  readonly resolveModule?: ResolveModule;
};

/** A driver whose files were read, its code not imported yet. */
export type DriverDeclaration = {
  readonly manifest: BundleManifest;
  readonly vendorId: string;
  readonly driverId: string;
  readonly driverName: string;
  readonly setup: IntegrationSetup;
  readonly directory: string;

  /** The profile, for a declarative driver. */
  readonly profile?: IntegrationProfile;

  /** The module's path, for a code driver. */
  readonly entry?: string;
};

/** A module the vendor names, found. */
export type DeclaredModule = {
  /** The name the manifest gives it: `rpc`, `camera`. */
  readonly name: string;

  /** Its path. */
  readonly path: string;
};

/** A vendor whose files were read, its code not imported yet. */
export type VendorDeclaration = {
  readonly manifest: VendorManifest;
  readonly directory: string;

  /** What the vendor must call itself, and what a failure inside it is reported under. */
  readonly vendorId: string;

  readonly setup: IntegrationSetup;

  /** The logo as an image data URL, when the bundle ships one. */
  readonly logo?: string;

  readonly transports: readonly DeclaredModule[];
  readonly streams: readonly DeclaredModule[];

  /** Its account, and the module that signs in. */
  readonly account?: { readonly declaration: AccountDeclaration; readonly module: string };

  /** How its devices are found, and each module it listens with by the name the file gives. */
  readonly discovery?: {
    readonly declaration: VendorDiscovery;
    readonly modules: ReadonlyMap<string, string>;
  };

  /** The drivers whose files hold. */
  readonly drivers: readonly DriverDeclaration[];

  /** The drivers whose files do not, and a `discovery.json` that does not. */
  readonly failures: readonly BundleFailure[];
};

/** What the code of one vendor is handed, and how to let go of what it opened. */
export type VendorSdk = {
  readonly sdk: BundleSdk;

  /** Lets go of what the vendor's code opened through the SDK. */
  readonly release: () => Promise<void>;
};

/** What importing a vendor's code takes. */
export type InstantiateVendorOptions = {
  readonly sdk: BundleSdk;

  /** Lets go of what the vendor's code opened, when it is released or fails to load. */
  readonly release: () => Promise<void>;

  /** Which of the two places it was read from; `installed` when not said. */
  readonly origin?: BundleOrigin;

  /** How the platform installed it, for one it did. */
  readonly install?: InstallMarker;

  /** How a module is imported: `import()` of its file URL when absent. */
  readonly importModule?: (file: string) => Promise<unknown>;

  /**
   * Decides whether a driver may be loaded at all.
   *
   * Absent means anything found locally is loaded, which is the state before a catalogue signs.
   *
   * @param manifest - What the driver says about itself, joined with its vendor.
   * @param directory - Where it was read from.
   * @returns Nothing, or a promise that settles, when it may be loaded.
   */
  readonly verify?: (manifest: BundleManifest, directory: string) => void | Promise<void>;

  /**
   * Decides whether a vendor's own code - its transports, its discovery modules - may be loaded
   * at all: it sits at the tier a code driver does. Absent means anything found is loaded.
   *
   * @param vendor - What the vendor says about itself.
   * @param directory - Where it was read from.
   * @returns Nothing, or a promise that settles, when it may be loaded.
   */
  readonly verifyVendor?: (vendor: VendorManifest, directory: string) => void | Promise<void>;
};

/** What loading the vendors of a directory takes. */
export type LoadBundleDirectoryOptions = Omit<
  InstantiateVendorOptions,
  'sdk' | 'release' | 'install'
> &
  Omit<ReadVendorOptions, 'expectedId' | 'stamp'> & {
    /** Where the vendors are. Missing is not an error: a fresh installation has none. */
    readonly directory: string;

    /**
     * Builds what one vendor's code is handed.
     *
     * @param manifest - The vendor, checked.
     * @returns The SDK, and how to let go of what the vendor opens through it.
     */
    readonly createSdk: (manifest: VendorManifest) => VendorSdk;
  };

/**
 * The message of something thrown.
 *
 * @param error - What was thrown.
 * @returns Its message.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Reads and parses one JSON file of a bundle. A `$schema` at its top - which an editor reads, and
 * which a bundle's sources carry for one - is not the bundle's and is dropped.
 *
 * @param directory - The bundle.
 * @param file - The file, relative to it.
 * @returns Whatever the file held.
 * @throws {Error} When the file cannot be read or is not JSON.
 */
export async function readBundleJson(directory: string, file: string): Promise<unknown> {
  const parsed = JSON.parse(await readFile(path.join(directory, file), 'utf8')) as unknown;

  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    '$schema' in parsed
  ) {
    return Object.fromEntries(Object.entries(parsed).filter(([key]) => key !== '$schema'));
  }

  return parsed;
}

/** How many of a schema's complaints a message names. */
const ISSUES_NAMED = 4;

/**
 * A file's name as a message says it: `relay/setup.json`, not `./setup.json` or a Windows path.
 *
 * @param file - The name, as the bundle writes it.
 * @returns It, tidied.
 */
function nameOf(file: string): string {
  return path.normalize(file).split(path.sep).join('/');
}

/**
 * Reads one JSON file of a bundle and checks it, saying which file and which field when it does
 * not hold - a sentence an author can act on, rather than a dump of the schema's findings.
 *
 * @param schema - What the file must be.
 * @param directory - The folder it is in.
 * @param file - The file, relative to it.
 * @returns What it holds, checked.
 * @throws {Error} When it is not there, is not JSON, or does not hold.
 */
async function readBundleFile<TSchema extends z.ZodType>(
  schema: TSchema,
  directory: string,
  file: string,
): Promise<z.output<TSchema>> {
  let raw: unknown;

  try {
    raw = await readBundleJson(directory, file);
  } catch (error: unknown) {
    const code = (error as { readonly code?: unknown } | null)?.code;

    throw new Error(
      code === 'ENOENT'
        ? `${nameOf(file)} is missing`
        : `${nameOf(file)} could not be read: ${messageOf(error)}`,
      { cause: error },
    );
  }

  return parseBundleValue(schema, raw, file);
}

/**
 * Checks what one file of a bundle holds, saying which file and which field when it does not.
 *
 * @param schema - What it must be.
 * @param value - What it holds.
 * @param file - The file, for the message.
 * @returns The value, checked.
 * @throws {Error} When it does not hold.
 */
function parseBundleValue<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
  file: string,
): z.output<TSchema> {
  const parsed = schema.safeParse(value);

  if (parsed.success) {
    return parsed.data;
  }

  const { issues } = parsed.error;
  const named = issues
    .slice(0, ISSUES_NAMED)
    .map((issue) =>
      issue.path.length === 0
        ? issue.message
        : `${issue.path.map(String).join('.')}: ${issue.message}`,
    );
  const more =
    issues.length > ISSUES_NAMED ? `; and ${String(issues.length - ISSUES_NAMED)} more` : '';

  throw new Error(`${nameOf(file)}: ${named.join('; ')}${more}`, { cause: parsed.error });
}

/**
 * Whether a file is there to be read.
 *
 * @param file - The file.
 * @returns True when it is a file.
 */
async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
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

    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Finds a module where the bundle says it is, as an installed or built bundle holds it.
 *
 * @param directory - The folder the name is relative to.
 * @param file - The name.
 * @returns Its path, or null when it is not there.
 */
const fileAsNamed: ResolveModule = async (directory, file) => {
  const found = path.join(directory, file);

  return (await isFile(found)) ? found : null;
};

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
 * Finds a module the bundle names, or says it is not there.
 *
 * @param resolve - How modules are found.
 * @param directory - The folder the name is relative to.
 * @param file - The name.
 * @param what - What names it, for the message.
 * @returns The module's path.
 * @throws {Error} When it is not there.
 */
async function moduleOf(
  resolve: ResolveModule,
  directory: string,
  file: string,
  what: string,
): Promise<string> {
  const found = await resolve(directory, file);

  if (found === null) {
    throw new Error(`${what} names ${file}, which is not in the bundle`);
  }

  return found;
}

/**
 * The wires a vendor's devices are reached over: each platform transport a driver speaks that is
 * a wire itself - `http`, `mqtt` - and what each of the vendor's own transports a driver speaks
 * declares it goes over, since `shelly/rpc` says nothing to a person and HTTP does.
 *
 * @param vendor - The vendor's manifest.
 * @param transports - The transport of every driver.
 * @returns The wires, each once, in {@link TRANSPORT_WIRES}' order.
 */
export function wiresOf(vendor: VendorManifest, transports: readonly string[]): TransportWire[] {
  const found = new Set<string>();

  for (const transport of transports) {
    const own = transport.startsWith(`${vendor.id}/`)
      ? vendor.transports[transport.slice(vendor.id.length + 1)]
      : undefined;

    if (own === undefined) {
      found.add(transport);
    } else {
      for (const wire of transportWiresOf(own)) {
        found.add(wire);
      }
    }
  }

  return TRANSPORT_WIRES.filter((wire) => found.has(wire));
}

/**
 * Reads one driver directory.
 *
 * @param vendor - The vendor it belongs to, already checked.
 * @param directory - The driver.
 * @param resolve - How modules are found.
 * @returns What its files say.
 * @throws {Error} When the driver is malformed or cannot be read.
 */
async function readDriver(
  vendor: VendorManifest,
  directory: string,
  resolve: ResolveModule,
): Promise<DriverDeclaration> {
  const driver = await readBundleFile(driverManifestSchema, directory, DRIVER_FILE);

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

  // `polling` is served as the option it stands for, so nothing past the loader has to know it.
  const setup = withPollingField(
    await readBundleFile(integrationSetupSchema, directory, manifest.setup),
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
    const profile = await readBundleFile(
      integrationProfileSchema,
      directory,
      manifest.profile ?? '',
    );

    return { ...identity, profile };
  }

  if (manifest.kind === 'matter') {
    return identity;
  }

  return {
    ...identity,
    entry: await moduleOf(resolve, directory, manifest.entry ?? '', manifest.id),
  };
}

/**
 * Reads one driver directory, if it is a driver at all.
 *
 * @param vendor - The vendor it belongs to.
 * @param directory - The directory to look at.
 * @param resolve - How modules are found.
 * @returns What it declares, why it does not hold, or null when the directory is not a driver.
 */
async function readIfDriver(
  vendor: VendorManifest,
  directory: string,
  resolve: ResolveModule,
): Promise<DriverDeclaration | BundleFailure | null> {
  // A directory with no driver manifest is not a driver anybody meant to install - notes, an
  // editor's leftovers, a build's chunks - so it is passed over rather than reported as broken.
  if (!(await isFile(path.join(directory, DRIVER_FILE)))) {
    return null;
  }

  try {
    return await readDriver(vendor, directory, resolve);
  } catch (error: unknown) {
    return { directory, message: messageOf(error), vendorId: vendor.id };
  }
}

/**
 * Checks a vendor's discovery against its drivers: one code mapped by two drivers, a probe over a
 * transport the vendor does not ship.
 *
 * @param vendor - The vendor's manifest.
 * @param discovery - Its `discovery.json`.
 * @param drivers - The drivers it is checked against.
 * @returns The plan.
 * @throws {Error} When it does not hold.
 */
function planDiscovery(
  vendor: VendorManifest,
  discovery: VendorDiscovery,
  drivers: readonly Pick<DriverDeclaration, 'driverId' | 'driverName' | 'manifest'>[],
): DiscoveryPlan {
  const plan = resolveDiscovery(
    vendor.id,
    discovery,
    drivers.map((driver) => ({
      id: driver.driverId,
      name: driver.driverName,
      transport: driver.manifest.transport,
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

  return plan;
}

/**
 * Reads a vendor's `discovery.json` and finds the modules it listens with.
 *
 * @param vendor - The vendor's manifest.
 * @param directory - The vendor's directory.
 * @param drivers - The drivers whose files hold.
 * @param resolve - How modules are found.
 * @returns The declaration and its modules.
 * @throws {Error} When the file is malformed, does not hold against the drivers, or names a
 * module that is not there.
 */
async function readDiscovery(
  vendor: VendorManifest,
  directory: string,
  drivers: readonly DriverDeclaration[],
  resolve: ResolveModule,
): Promise<NonNullable<VendorDeclaration['discovery']>> {
  const declaration = await readBundleFile(vendorDiscoverySchema, directory, DISCOVERY_FILE);

  planDiscovery(vendor, declaration, drivers);

  const modules = await Promise.all(
    declaration.listen
      .filter((listened) => 'module' in listened)
      .map(
        async (listened) =>
          [
            listened.module,
            await moduleOf(resolve, directory, listened.module, `${vendor.id}'s discovery`),
          ] as const,
      ),
  );

  return { declaration, modules: new Map(modules) };
}

/**
 * Reads every file of one vendor directory and checks it, importing nothing.
 *
 * @param directory - The vendor.
 * @param options - What it must call itself, the runtime it is checked against, the version a
 * source tree is read with, and how modules are found.
 * @returns What the vendor declares, with the drivers and the discovery that do not hold.
 * @throws {Error} When the vendor itself is malformed: its manifest, its logo, its setup, its
 * runtime range, its containers, a module it names, or a directory with no driver in it.
 */
export async function readVendorDirectory(
  directory: string,
  options: ReadVendorOptions = {},
): Promise<VendorDeclaration> {
  const resolve = options.resolveModule ?? fileAsNamed;
  const expectedId = options.expectedId ?? path.basename(directory);
  const raw = await readBundleJson(directory, MANIFEST_FILE);
  let source = raw;

  if (options.stamp !== undefined && raw !== null && typeof raw === 'object') {
    const written = Object.keys(raw).filter((key) =>
      ['version', 'sdk', 'integrity', 'signature'].includes(key),
    );

    if (written.length > 0) {
      throw new Error(
        `${MANIFEST_FILE} says ${written.join(' and ')}, which the build writes: remove ${written.length === 1 ? 'it' : 'them'}`,
      );
    }

    source = { ...raw, ...options.stamp };
  }

  const manifest = parseBundleValue(vendorManifestSchema, source, MANIFEST_FILE);

  if (manifest.id !== expectedId) {
    throw new Error(`The vendor in ${expectedId} calls itself ${manifest.id}; the two must agree`);
  }

  if (options.runtimeVersion !== undefined && !satisfies(options.runtimeVersion, manifest.sdk)) {
    // Both versions named, because "expected string, received number" three files deeper is not
    // something the owner reading it can do anything about.
    throw new Error(
      `${manifest.id} needs a runtime matching ${manifest.sdk}, and this one is ${options.runtimeVersion}`,
    );
  }

  const transports = await Promise.all(
    Object.entries(manifest.transports).map(async ([name, entry]) => ({
      name,
      path: await moduleOf(
        resolve,
        directory,
        transportModuleOf(entry),
        `${manifest.id} transport ${name}`,
      ),
    })),
  );
  const streams = await Promise.all(
    Object.entries(manifest.streams).map(async ([name, file]) => ({
      name,
      path: await moduleOf(resolve, directory, file, `${manifest.id} stream ${name}`),
    })),
  );
  let account: VendorDeclaration['account'];

  if (manifest.account !== undefined) {
    const declaration = await readBundleFile(accountDeclarationSchema, directory, manifest.account);

    account = {
      declaration,
      module: await moduleOf(resolve, directory, declaration.module, `${manifest.id}'s account`),
    };
  }

  const setup =
    manifest.setup === undefined
      ? NO_SETUP
      : withPollingField(await readBundleFile(integrationSetupSchema, directory, manifest.setup));
  const logo =
    manifest.logo === undefined ? undefined : await readLogo(directory, manifest.logo.path);
  const containerProblems = containerDependencyProblems(manifest.containers, setup);

  if (containerProblems.length > 0) {
    throw new Error(containerProblems.join('; '));
  }

  const results = await Promise.all(
    (await subdirectories(directory)).map(async (name) =>
      readIfDriver(manifest, path.join(directory, name), resolve),
    ),
  );
  const drivers = results.filter(
    (result): result is DriverDeclaration => result !== null && !('message' in result),
  );
  const failures = results.filter(
    (result): result is BundleFailure => result !== null && 'message' in result,
  );

  if (drivers.length === 0 && failures.length === 0) {
    throw new Error(`${manifest.id} ships no driver, so there is nothing to add a device with`);
  }

  let discovery: VendorDeclaration['discovery'];

  if (drivers.length > 0 && (await isFile(path.join(directory, DISCOVERY_FILE)))) {
    try {
      discovery = await readDiscovery(manifest, directory, drivers, resolve);
    } catch (error: unknown) {
      failures.push({
        directory: path.join(directory, DISCOVERY_FILE),
        message: messageOf(error),
        vendorId: expectedId,
      });
    }
  }

  return {
    manifest,
    directory,
    vendorId: expectedId,
    setup,
    ...(logo === undefined ? {} : { logo }),
    transports,
    streams,
    ...(account === undefined ? {} : { account }),
    ...(discovery === undefined ? {} : { discovery }),
    drivers,
    failures,
  };
}

/**
 * The default export of a module, imported.
 *
 * @param importModule - How a module is imported.
 * @param file - The module.
 * @returns What it exports by default.
 */
async function defaultOf(
  importModule: (file: string) => Promise<unknown>,
  file: string,
): Promise<unknown> {
  const module = await importModule(file);

  return (module as { readonly default?: unknown } | null)?.default;
}

/**
 * Imports a module by its path, as `hub` does.
 *
 * @param file - The module.
 * @returns The module.
 */
async function importFile(file: string): Promise<unknown> {
  return import(pathToFileURL(file).href);
}

/**
 * Builds one driver: a declarative one from its profile, a code one from its module.
 *
 * @param driver - What its files say.
 * @param sdk - What the vendor's code is handed, a code driver's among it.
 * @param options - How to verify and import.
 * @returns The driver, loaded.
 * @throws {Error} When it may not be loaded, or its module is not an integration.
 */
async function instantiateDriver(
  driver: DriverDeclaration,
  sdk: BundleSdk,
  options: InstantiateVendorOptions,
): Promise<LoadedBundle> {
  const { profile, entry, ...identity } = driver;

  await options.verify?.(driver.manifest, driver.directory);

  if (profile !== undefined) {
    return { ...identity, integration: createDeclarativeIntegration(driver.manifest, profile) };
  }

  if (driver.manifest.kind === 'matter') {
    return { ...identity, integration: createMatterIntegration(driver.manifest) };
  }

  const exported = await defaultOf(options.importModule ?? importFile, entry ?? '');

  // A code driver may export a function of the SDK, which builds its schemas with the
  // runtime's zod; an object is still an integration as it stands.
  const integration: unknown =
    typeof exported === 'function' ? (exported as (given: BundleSdk) => unknown)(sdk) : exported;

  if (integration === null || typeof integration !== 'object') {
    throw new Error(`${driver.manifest.id} does not default-export an integration`);
  }

  return { ...identity, integration: integration as Integration };
}

/**
 * Builds a vendor's own transports or stream sources from their modules, each checked to call
 * itself what the manifest calls it.
 *
 * @param vendor - The vendor's manifest.
 * @param modules - The modules, by name.
 * @param what - `transport` or `stream`, for the messages.
 * @param build - Calls a factory.
 * @param importModule - How a module is imported.
 * @returns What the factories built.
 * @throws {Error} When a module exports no factory, or what it builds names itself otherwise.
 */
async function instantiateNamed<TBuilt extends { readonly id: string }>(
  vendor: VendorManifest,
  modules: readonly DeclaredModule[],
  what: 'transport' | 'stream',
  build: (factory: unknown) => TBuilt,
  importModule: (file: string) => Promise<unknown>,
): Promise<TBuilt[]> {
  return Promise.all(
    modules.map(async (module) => {
      const factory = await defaultOf(importModule, module.path);

      if (typeof factory !== 'function') {
        throw new Error(`${vendor.id} ${what} ${module.name} does not default-export a factory`);
      }

      const built = build(factory);
      const expected = `${vendor.id}/${module.name}`;

      if (built.id !== expected) {
        throw new Error(
          `The ${what} ${vendor.id} ships as ${module.name} calls itself ${built.id}; it must be ${expected}`,
        );
      }

      return built;
    }),
  );
}

/**
 * Builds the modules a vendor's discovery listens with.
 *
 * @param vendor - The vendor's manifest.
 * @param discovery - Its declaration and modules.
 * @param drivers - The drivers that loaded, whose model codes the plan is checked against.
 * @param sdk - What a discovery module is handed.
 * @param importModule - How a module is imported.
 * @returns The discovery, ready to listen with.
 * @throws {Error} When the plan does not hold against the drivers that loaded, or a module does
 * not export a factory of something to listen with.
 */
async function instantiateDiscovery(
  vendor: VendorManifest,
  discovery: NonNullable<VendorDeclaration['discovery']>,
  drivers: readonly LoadedBundle[],
  sdk: BundleSdk,
  importModule: (file: string) => Promise<unknown>,
): Promise<LoadedDiscovery> {
  // Again, against the drivers that loaded: a kind that did not is not proposed.
  const plan = planDiscovery(vendor, discovery.declaration, drivers);
  const sources = await Promise.all(
    discovery.declaration.listen.map(async (listened): Promise<LoadedListenSource> => {
      if ('mdns' in listened) {
        return { kind: 'mdns', service: listened.mdns };
      }

      const factory = await defaultOf(importModule, discovery.modules.get(listened.module) ?? '');

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

      return {
        kind: 'module',
        file: listened.module,
        source: source as DiscoverySource,
        lan: listened.lan,
      };
    }),
  );

  return { plan, sources };
}

/**
 * Imports a vendor's code and hands it the SDK: its own transports, stream sources and account
 * first - a driver is only as loadable as the transport it opens - then each driver, then the
 * modules its discovery listens with.
 *
 * @param declaration - What the vendor's files say.
 * @param options - The SDK, how to verify and import, where it came from.
 * @returns The vendor, when at least one driver loaded, and every failure below it.
 * @throws {Error} When the vendor's own code may not be loaded or does not build.
 */
export async function instantiateVendor(
  declaration: VendorDeclaration,
  options: InstantiateVendorOptions,
): Promise<{ readonly vendor: LoadedVendor | null; readonly failures: BundleFailure[] }> {
  const { manifest, directory } = declaration;
  const { sdk } = options;
  const importModule = options.importModule ?? importFile;
  const failures: BundleFailure[] = [...declaration.failures];

  if (declaration.transports.length > 0) {
    await options.verifyVendor?.(manifest, directory);
  }

  const ownTransports = await instantiateNamed(
    manifest,
    declaration.transports,
    'transport',
    (factory) => (factory as TransportFactory)(sdk),
    importModule,
  );
  const streams = await instantiateNamed(
    manifest,
    declaration.streams,
    'stream',
    (factory) => (factory as StreamFactory)(sdk),
    importModule,
  );
  let account: LoadedAccount | undefined;

  if (declaration.account !== undefined) {
    const factory = await defaultOf(importModule, declaration.account.module);

    if (typeof factory !== 'function') {
      throw new Error(`${manifest.id}'s account module does not default-export a factory`);
    }

    const module = (factory as AccountFactory)(sdk);

    if (typeof module.signIn !== 'function' || typeof module.answer !== 'function') {
      throw new Error(`${manifest.id}'s account module has no signIn and answer`);
    }

    account = { declaration: declaration.account.declaration, module };
  }

  const built = await Promise.all(
    declaration.drivers.map(async (driver): Promise<LoadedBundle | BundleFailure> => {
      try {
        return await instantiateDriver(driver, sdk, options);
      } catch (error: unknown) {
        return {
          directory: driver.directory,
          message: messageOf(error),
          vendorId: declaration.vendorId,
        };
      }
    }),
  );
  const drivers = built.filter((result): result is LoadedBundle => 'integration' in result);

  failures.push(...built.filter((result): result is BundleFailure => 'message' in result));

  if (drivers.length === 0) {
    // The drivers' failures already say what went wrong. A vendor with nothing to add a device
    // with would only be a card that sends the owner to a page that cannot do anything.
    await options.release();

    return { vendor: null, failures };
  }

  let discovery: LoadedDiscovery | undefined;

  if (declaration.discovery !== undefined) {
    try {
      if (declaration.discovery.modules.size > 0) {
        // Code, at the tier a vendor's own transport is.
        await options.verifyVendor?.(manifest, directory);
      }

      discovery = await instantiateDiscovery(
        manifest,
        declaration.discovery,
        drivers,
        sdk,
        importModule,
      );
    } catch (error: unknown) {
      failures.push({
        directory: path.join(directory, DISCOVERY_FILE),
        message: messageOf(error),
        vendorId: declaration.vendorId,
      });
    }
  }

  return {
    vendor: {
      manifest,
      origin: options.origin ?? 'installed',
      ...(options.install === undefined ? {} : { install: options.install }),
      setup: declaration.setup,
      ...(declaration.logo === undefined ? {} : { logo: declaration.logo }),
      transports: [...new Set(drivers.map((driver) => driver.manifest.transport))],
      wires: wiresOf(
        manifest,
        drivers.map((driver) => driver.manifest.transport),
      ),
      ownTransports,
      streams,
      drivers,
      ...(discovery === undefined ? {} : { discovery }),
      ...(account === undefined ? {} : { account }),
      directory,
      release: options.release,
    },
    failures,
  };
}

/** Where one vendor of a directory is read from, and how the platform installed it. */
export type VendorFolder = {
  /** The folder's name: what the vendor must call itself. */
  readonly vendorId: string;

  /** The folder its files are in: the folder itself, or the build its marker names. */
  readonly directory: string;

  /** Its marker, for a vendor the platform installed. */
  readonly install?: InstallMarker;
};

/**
 * Finds where one vendor of a directory is: its own folder when the manifest is there - a bundle
 * under development, or one put there by hand - or the build its install marker names.
 *
 * @param root - The directory of vendors.
 * @param vendorId - The vendor's folder.
 * @returns Where it is, or null when the folder is not a vendor.
 * @throws {Error} When its marker is malformed, or names a build that is not there.
 */
export async function findVendorFolder(
  root: string,
  vendorId: string,
): Promise<VendorFolder | null> {
  const folder = path.join(root, vendorId);

  if (await isFile(path.join(folder, MANIFEST_FILE))) {
    return { vendorId, directory: folder };
  }

  const markerFile = path.join(folder, INSTALL_MARKER_FILE);

  if (!(await isFile(markerFile))) {
    return null;
  }

  const install = await readBundleFile(installMarkerSchema, folder, INSTALL_MARKER_FILE);
  const directory = path.join(folder, install.build);

  if (!(await isFile(path.join(directory, MANIFEST_FILE)))) {
    throw new Error(
      `${vendorId}'s install marker names the build ${install.build}, which is not there`,
    );
  }

  return { vendorId, directory, install };
}

/**
 * Reads, checks and builds the vendor of one folder of a directory.
 *
 * @param root - The directory of vendors.
 * @param vendorId - The vendor's folder.
 * @param options - The runtime, the SDK, how to verify and import.
 * @param install - A build to read rather than the one the marker names: one unpacked and not
 * marked yet, which `hub` loads before the packet-manager says it is the current one.
 * @returns The vendor and its drivers' failures, the vendor's own failure, or null when the folder
 * is not a vendor.
 */
export async function loadVendorFolder(
  root: string,
  vendorId: string,
  options: Omit<LoadBundleDirectoryOptions, 'directory'>,
  install?: InstallMarker,
): Promise<{ readonly vendor: LoadedVendor | null; readonly failures: BundleFailure[] } | null> {
  let folder: VendorFolder | null;

  try {
    folder =
      install === undefined
        ? await findVendorFolder(root, vendorId)
        : { vendorId, directory: path.join(root, vendorId, install.build), install };
  } catch (error: unknown) {
    return {
      vendor: null,
      failures: [{ directory: path.join(root, vendorId), message: messageOf(error), vendorId }],
    };
  }

  if (folder === null) {
    return null;
  }

  const { directory } = folder;

  try {
    const declaration = await readVendorDirectory(directory, {
      expectedId: vendorId,
      ...(options.runtimeVersion === undefined ? {} : { runtimeVersion: options.runtimeVersion }),
      ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
    });
    const { sdk, release } = options.createSdk(declaration.manifest);

    try {
      return await instantiateVendor(declaration, {
        ...options,
        sdk,
        release,
        ...(folder.install === undefined ? {} : { install: folder.install }),
      });
    } catch (error: unknown) {
      await release();

      throw error;
    }
  } catch (error: unknown) {
    return { vendor: null, failures: [{ directory, message: messageOf(error), vendorId }] };
  }
}

/**
 * Reads every vendor of a directory.
 *
 * @param options - Where to look, the runtime to check against, the SDK, how to verify.
 * @returns The vendors and drivers that loaded, and what did not with the reason.
 */
export async function loadBundleDirectory(
  options: LoadBundleDirectoryOptions,
): Promise<LoadBundlesResult> {
  const results = await Promise.all(
    (await subdirectories(options.directory)).map(async (name) =>
      loadVendorFolder(options.directory, name, options),
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
 * Puts together what several places held, the later winning.
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
  logger: Pick<BundleLogger, 'warn'>,
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
        replaced.origin === vendor.origin
          ? 'A later directory of bundles replaces a vendor of an earlier one'
          : 'An installed integration replaces the one under development',
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
