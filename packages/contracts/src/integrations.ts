/**
 * Integration instances: the connection half of a device, and what `hub` reports about it.
 *
 * An **integration** is a driver bundle - declarative or code - bound to a transport. An
 * **instance** is one configured copy of it, and one instance is one device: adding a device
 * writes the instance that reaches it and the registry row that describes it, under one id.
 * That id is what an entity carries as its `source`, which is why it shares a namespace with a
 * package id rather than having one of its own.
 *
 * Nothing here finds devices for an owner to pick from. An instance identifies its own device
 * once it is running - the serial on the broker, the id the relay answers with - and asks
 * `core` to complete the registry row; the states below say how far that has got.
 *
 * Defined in ARCHITECTURE.md 8.
 */
import { z } from 'zod';

import { iconIdSchema } from './icons.js';
import { vendorAccountSchema } from './integration-accounts.js';
import { integrationSetupSchema } from './integration-setup.js';
import { jsonObjectSchema } from './json.js';
import { PACKAGE_ID_PATTERN } from './package-id.js';
import { packageRequiresSchema } from './package-requires.js';

/** What an integration may say makes two of its devices one: the same MAC, the same serial. */
export const TWIN_FACTS = ['mac', 'serial'] as const;

/** What may make two devices one. */
export type TwinFact = (typeof TWIN_FACTS)[number];

/**
 * Integration instance identifier.
 *
 * The same expression a package id uses, reused rather than restated. Both end up in
 * `entities.source`, the subject token `core` addresses an owner on, so the two ids share one
 * namespace - and a second copy of the pattern would be a second thing to keep in step.
 */
export const INTEGRATION_ID_PATTERN = PACKAGE_ID_PATTERN;

/** Validates an integration instance identifier. */
export const integrationIdSchema = z
  .string()
  .regex(INTEGRATION_ID_PATTERN, 'Must be an integration id');

/**
 * Integration kind: which driver of which vendor, as `vendor/driver`.
 *
 * Vendor-qualified, so two vendors may each ship a `gen2` and a row names one of them without
 * ambiguity. The runtime reads the same pattern from here rather than keeping its own, for the
 * reason {@link INTEGRATION_ID_PATTERN} gives.
 */
export const INTEGRATION_KIND_PATTERN = /^[a-z][a-z0-9-]{1,63}\/[a-z0-9][a-z0-9-]{1,63}$/;

/** Validates an integration kind. */
export const integrationKindIdSchema = z
  .string()
  .regex(INTEGRATION_KIND_PATTERN, 'Must be an integration kind, as vendor/driver');

/** Identifies a vendor on its own: `shelly`, `bambulab`. A directory people type, so letter first. */
export const VENDOR_ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;

/** Identifies a driver within its vendor: `dimmer-pm`, `3em`. Named after the product, so digits allowed first. */
const DRIVER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

/**
 * A transport id: a platform transport by name - `http`, `mqtt` - or a vendor's own, shipped
 * in its bundle and qualified by the vendor - `shelly/rpc`. The vendor half is a vendor id;
 * the name half is short, because it is typed into every driver of the vendor.
 */
export const TRANSPORT_ID_PATTERN = /^(?:[a-z][a-z0-9-]{1,63}\/)?[a-z][a-z0-9-]{1,31}$/;

/** Validates a transport id. */
export const transportIdSchema = z.string().regex(TRANSPORT_ID_PATTERN, 'Must be a transport id');

/**
 * The wires the interface names on a vendor's card: what a person recognises on the box, whatever
 * transport of the platform's or of the vendor's own carries it. `udp` is a device's own protocol
 * over plain datagrams on the network (Govee's LAN API), `modbus` Modbus TCP, `matter` the
 * house's Matter fabric.
 */
export const TRANSPORT_WIRES = [
  'http',
  'mqtt',
  'ble',
  'zigbee',
  'udp',
  'modbus',
  'matter',
] as const;

/** A wire the interface names. */
export type TransportWire = (typeof TRANSPORT_WIRES)[number];

/**
 * How a device can be heard announcing itself: the platform's mDNS browser, a vendor's own
 * listener, the house's Matter fabric - a node commissioned and not yet added - or the house's
 * MQTT broker - a device that announced itself on it, or that the owner mapped - or the house's
 * Modbus client - a device the owner added at an address. Declared here
 * rather than beside the discovered devices, because a vendor lists the ways it can be found and
 * the discovery module already reads this file.
 */
export const DISCOVERY_SOURCES = ['mdns', 'module', 'matter', 'mqtt', 'modbus'] as const;

/** How a device can be heard. */
export type DiscoverySource = (typeof DISCOVERY_SOURCES)[number];

/**
 * Who adds a device discovery found: the owner, from its card - the ordinary way - or the
 * platform, as soon as it is heard. Automatic for a vendor whose devices were already chosen
 * somewhere the owner set up: a Zigbee device paired with Zigbee2MQTT is one the owner meant to
 * have, and asking again would only be a second step to forget.
 */
export const DEVICE_ADOPTIONS = ['owner', 'automatic'] as const;

/** Who adds a device found. */
export type DeviceAdoption = (typeof DEVICE_ADOPTIONS)[number];

/**
 * Where a vendor's devices are paired, when that is done through one of its own devices: the
 * entities of a device of that driver - the Zigbee2MQTT bridge - that pairing is run by, each by
 * its object id. A button that opens it, a button that closes it, and a text sensor saying whether
 * it is open (`enabled`) or not, which carries when it closes by itself in its `endsAt` attribute
 * while it is open. The vendor's page offers it in place of looking for devices.
 */
export const vendorPairingSchema = z.object({
  driverId: z.string().min(1).max(64),
  openObjectId: z.string().min(1).max(64),
  closeObjectId: z.string().min(1).max(64),
  stateObjectId: z.string().min(1).max(64),
});

/** Where a vendor's devices are paired. */
export type VendorPairing = z.output<typeof vendorPairingSchema>;

/** What a logo may be served as: an image the interface can put straight into an `img`. */
const LOGO_DATA_URL_PATTERN = /^data:image\/(?:svg\+xml|png);base64,[A-Za-z0-9+/]+=*$/;

/**
 * The lifecycle states `hub` records for a configured instance.
 *
 * `identifying` sits between `starting` and `running`: the transport is open, and the instance
 * is waiting to hear from the one device it was added for. A device that has been identified
 * before starts straight into `running`, bound from what the registry kept about it.
 */
export const INTEGRATION_STATES = [
  'stopped',
  'starting',
  'identifying',
  'running',
  'failed',
  'disabled',
] as const;

/** The lifecycle state of a configured instance. */
export type IntegrationState = (typeof INTEGRATION_STATES)[number];

/** Validates an instance lifecycle state. */
export const integrationStateSchema = z.enum(INTEGRATION_STATES);

/** The bus service name `hub` answers management calls on. */
export const HUB_SERVICE = 'hub';

/** Lists the vendors `hub` has loaded, with their drivers and what each asks at setup. */
export const HUB_CATALOGUE_METHOD = 'catalogue';

/** Tries a configuration against the world without keeping it. */
export const HUB_PROBE_METHOD = 'probe';

/** Re-reads one instance from the registry and starts, restarts or stops it to match. */
export const HUB_RELOAD_METHOD = 'reload';

/**
 * Takes in a vendor's saved settings: runs the containers the vendor declares with them. What the
 * API asks after the owner saved them, beside reloading every instance of the vendor.
 */
export const HUB_VENDOR_CHANGED_METHOD = 'vendor_changed';

/** Asks `hub` to take in one vendor's settings. */
export const vendorChangedRequestSchema = z.strictObject({
  vendorId: z.string().regex(VENDOR_ID_PATTERN),
});

/** Asks `hub` to take in one vendor's settings. */
export type VendorChangedRequest = z.output<typeof vendorChangedRequestSchema>;

/** Whether `hub` has the vendor loaded; false sends nothing on. */
export const vendorChangedReplySchema = z.object({ isLoaded: z.boolean() });

/** Whether `hub` has the vendor loaded. */
export type VendorChangedReply = z.output<typeof vendorChangedReplySchema>;

/**
 * Where `hub` read a vendor from: the data directory, where the platform installs vendors, a
 * directory of bundles under development, read outside production - or nowhere, for the vendors
 * the platform is itself: `matter` and `mqtt`, the devices of its brokers no integration claims.
 */
export const BUNDLE_ORIGINS = ['installed', 'development', 'platform'] as const;

/** Where `hub` read a vendor from. */
export type BundleOrigin = (typeof BUNDLE_ORIGINS)[number];

/** Where an installed vendor came from: the integrations index, or the platform's local folder. */
export const INTEGRATION_INSTALL_SOURCES = ['index', 'local'] as const;

/**
 * How the platform installed a vendor: the contents of the marker beside its builds,
 * `hub/integrations/<vendor>/.nebula-install.json`, which names the build `hub` loads.
 */
export const integrationInstallSchema = z.strictObject({
  /** The folder of the build, beside the marker: the version, then a nonce. */
  build: z.string().regex(/^[0-9A-Za-z.+-]{1,96}$/u, 'Must be a build folder name'),

  /** The bundle's version, as its manifest says it. */
  version: z.string().min(1).max(64),

  source: z.enum(INTEGRATION_INSTALL_SOURCES),

  /** The archive's SHA-256, in hex: what tells a rebuilt local file from the one installed. */
  artifactSha256: z.string().regex(/^[0-9a-f]{64}$/u, 'Must be a SHA-256 in hex'),

  installedAt: z.iso.datetime({ offset: true }),

  /** The user who installed it; null when the platform did. */
  installedBy: z.uuid().nullable(),
});

/** How the platform installed a vendor. */
export type IntegrationInstall = z.output<typeof integrationInstallSchema>;

/**
 * Makes the vendor `hub` runs match the data directory: what the packet-manager asks once it has
 * unpacked a build, or removed one. `hub` loads the build beside the one running, and swaps the
 * two only when it loaded.
 */
export const HUB_VENDOR_LOAD_METHOD = 'vendor_load';

/** Which vendor, and - for a build unpacked and not yet marked current - which build. */
export const vendorLoadRequestSchema = z.strictObject({
  vendorId: z.string().regex(VENDOR_ID_PATTERN),

  /**
   * The build to load, and how it was installed: the marker the packet-manager writes once `hub`
   * says it loaded. Absent, `hub` reads the vendor's folder as it stands, and lets go of a vendor
   * whose folder is gone.
   */
  install: integrationInstallSchema.optional(),
});

/** Which vendor, and which build. */
export type VendorLoadRequest = z.output<typeof vendorLoadRequestSchema>;

/** What `hub` runs of the vendor now. */
export const vendorLoadReplySchema = z.object({
  /** Whether a copy of it runs. */
  isLoaded: z.boolean(),

  /** The version that runs; null when none does. */
  version: z.string().max(64).nullable(),

  origin: z.enum(BUNDLE_ORIGINS).nullable(),

  /**
   * Why the build asked for did not load - the vendor's own failure, or every driver's - in
   * sentences. A build that did not load replaces nothing: the copy that ran before runs on.
   */
  failures: z.array(z.string().max(2048)).max(64),

  /**
   * True when a copy under development the removed one stood in for comes back only once `hub`
   * restarts: its code is loaded already, and is not loaded twice.
   */
  isRestartNeeded: z.boolean(),
});

/** What `hub` runs of the vendor now. */
export type VendorLoadReply = z.output<typeof vendorLoadReplySchema>;

/**
 * Stops one instance and drops it, without reading the registry: what the API asks just before
 * `core` deletes the rows, so that nothing is still reporting into a device that is gone.
 */
export const HUB_FORGET_METHOD = 'forget';

/** How long a probe may take when the caller does not say. */
const DEFAULT_PROBE_TIMEOUT_MS = 8000;

/** Asks `hub` what it has loaded. */
export const catalogueRequestSchema = z.object({});

/** Asks `hub` what it has loaded. */
export type CatalogueRequest = z.output<typeof catalogueRequestSchema>;

/**
 * One driver `hub` loaded, as the interface needs it: enough to offer it and to build its form.
 *
 * The manifest fields are repeated here rather than the manifest schema imported, because that
 * schema lives in the package runtime and carries things - integrity, signature, entry point -
 * that are the loader's business and nobody else's.
 */
export const integrationKindSchema = z.object({
  /** The kind, `vendor/driver`, which is what an instance row references. */
  id: integrationKindIdSchema,
  vendorId: z.string().regex(VENDOR_ID_PATTERN),
  driverId: z.string().regex(DRIVER_ID_PATTERN),

  /** The driver's own name, after the vendor's: `Gen2`, `Printer`. */
  name: z.string().min(1).max(128),

  /** Which transport an instance of it opens: `http`, `mqtt`, or a vendor's own, `shelly/rpc`. */
  transport: transportIdSchema,

  /**
   * The models it drives, for the owner to pick from. Empty means the driver's name is the
   * one model.
   */
  models: z.array(z.string().min(1).max(64)).default([]),

  /**
   * The series each model belongs to, for a vendor whose models are known by their series -
   * Bambu Lab's `A series`, `X series` - rather than by the driver that runs them. The form
   * groups the models by it; a model it does not name, or a driver without it, is grouped by the
   * driver.
   */
  modelSeries: z.record(z.string().min(1).max(64), z.string().min(1).max(64)).optional(),

  /**
   * The icon a device of this driver starts with, from the catalogue, when the bundle names
   * one. The owner picks another per device; this is only what the form starts from.
   */
  defaultIcon: iconIdSchema.optional(),

  /** What setting up an instance asks. */
  setup: integrationSetupSchema,

  /**
   * The port the device serves its own web page on, when it has one.
   *
   * Only a driver that says so gets a link: a device that answers on an API port with no page
   * behind it would open a browser tab of JSON, or of nothing.
   */
  webPagePort: z.int().min(1).max(65_535).optional(),

  /** Where on that port the page is, for a device whose page is not at the root. */
  webPagePath: z
    .string()
    .regex(/^\/[^\s]*$/, 'Must be a path starting with /')
    .max(256)
    .optional(),
});

/** One driver `hub` loaded. */
export type IntegrationKind = z.output<typeof integrationKindSchema>;

/** One container a vendor's devices depend on, as the catalogue lists it. */
export const vendorContainerSchema = z.object({
  /** The bundle's id for it: `zigbee2mqtt`. */
  id: z.string().min(1).max(32),
  name: z.string().min(1).max(128),

  /** The image, without a tag: `koenkk/zigbee2mqtt`. */
  image: z.string().min(1).max(255),

  /** The oldest release the vendor works with. */
  minVersion: z.string().min(1).max(64),
});

/** One container a vendor's devices depend on. */
export type VendorContainer = z.output<typeof vendorContainerSchema>;

/** How a vendor's own listener levels what it says: hearing, hearing nothing, unable to listen. */
export const LISTENER_LEVELS = ['ok', 'warning', 'error'] as const;

/**
 * How a vendor's own listener is getting on: connected to the platform's broker but hearing
 * nothing of Zigbee2MQTT, unable to sign in to an account. What its vendor's page says when the
 * devices do not come.
 */
export const vendorListenerSchema = z.object({
  level: z.enum(LISTENER_LEVELS),
  message: z.string().min(1).max(1024),
  at: z.coerce.date(),
});

/** How a vendor's own listener is getting on. */
export type VendorListener = z.output<typeof vendorListenerSchema>;

/**
 * A device the hub heard of a vendor and did not add, and why: one no driver takes, one still
 * being paired. So "why is my device not here" has an answer on the vendor's page.
 */
export const passedOverDeviceSchema = z.object({
  id: z.string().min(1).max(256),
  name: z.string().min(1).max(256),
  model: z.string().max(256).nullable().default(null),
  reason: z.string().min(1).max(512),
  heardAt: z.coerce.date(),
});

/** A device the hub heard of a vendor and did not add. */
export type PassedOverDevice = z.output<typeof passedOverDeviceSchema>;

/**
 * One vendor `hub` loaded: who they are, what every device of theirs shares, and its drivers.
 *
 * `transports` is what the drivers speak, computed by the hub rather than declared by the
 * manifest; `logo` is the file's bytes as a data URL, because the interface cannot read the
 * hub's disk and a second endpoint for one small image is a second thing to secure.
 */
export const integrationVendorSchema = z.object({
  id: z.string().regex(VENDOR_ID_PATTERN),
  version: z.string().min(1).max(64),

  /** Where `hub` read it from: installed by the platform, or a bundle under development. */
  origin: z.enum(BUNDLE_ORIGINS).default('installed'),

  /** How the platform installed it; null for one under development, or put there by hand. */
  install: integrationInstallSchema.nullable().default(null),

  /**
   * Whether it ships code - a driver, a transport, a stream, an account or a discovery module of
   * its own - which runs inside `hub`, rather than profiles alone.
   */
  hasCode: z.boolean().default(false),
  name: z.string().min(1).max(128),
  description: z.string().max(512).optional(),
  url: z.string().max(512).optional(),

  /** A hex colour the interface tints the vendor's mark with. */
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),

  /** The logo as an image data URL, when the bundle ships one. */
  logo: z.string().regex(LOGO_DATA_URL_PATTERN).max(100_000).optional(),

  /**
   * Extra room the interface leaves around the logo, in pixels, on top of the small margin
   * every logo gets. For a mark drawn to the edge of its file.
   */
  logoPadding: z.int().min(0).max(16).default(0),

  /** Whether its devices stop working when the internet does. */
  internetRequired: z.boolean(),

  /** Every transport one of its drivers speaks, each once, in the drivers' order. */
  transports: z.array(transportIdSchema),

  /**
   * The wires its devices are reached over, in {@link TRANSPORT_WIRES}' order: the platform's
   * transports the drivers speak that are wires, and what the vendor's own transports declare.
   */
  wires: z.array(z.enum(TRANSPORT_WIRES)).default([]),

  /** What setting the vendor up asks; empty groups for a vendor that needs nothing. */
  setup: integrationSetupSchema,

  /**
   * What signing in to the vendor's account asks, for a vendor whose devices are reached through
   * an account - a cloud, an app's - rather than set up once; null for one that has none.
   */
  account: vendorAccountSchema.nullable().default(null),

  /**
   * How its devices can be found on the network, each once. Empty for a vendor whose devices are
   * only ever added by address, which is also the vendor the interface offers no scan for.
   */
  discoverySources: z.array(z.enum(DISCOVERY_SOURCES)).default([]),

  /** Who adds what discovery finds: the owner, or the platform on its own. */
  adoption: z.enum(DEVICE_ADOPTIONS).default('owner'),

  /**
   * What makes two of its devices one device reached two ways - the same MAC, the same serial -
   * as its manifest's `twins` says. Empty for a vendor that offers no links.
   */
  twins: z.array(z.enum(TWIN_FACTS)).max(TWIN_FACTS.length).default([]),

  /** The entities pairing is run by, for a vendor whose devices are paired through one of its own. */
  pairing: vendorPairingSchema.nullable().default(null),

  drivers: z.array(integrationKindSchema),

  /**
   * The containers the vendor's devices depend on, which the platform downloads and runs for it
   * once the vendor is set up. Empty for a vendor that runs on the platform alone.
   */
  containers: z.array(vendorContainerSchema).default([]),

  /**
   * The packages and services its devices need - the MQTT broker the platform runs, for
   * Zigbee2MQTT - as its manifest's `requires` says. Nothing when it needs none.
   */
  requires: packageRequiresSchema,

  /**
   * What of that is not installed or not running, in sentences naming both - "NVR needs a
   * package that provides object-detection, and none does". Empty when all of it runs.
   */
  packageProblems: z.array(z.string().max(512)).max(16).default([]),

  /** How the vendor's own listener is getting on; null before it said, or for one without. */
  listener: vendorListenerSchema.nullable().default(null),

  /** The devices heard and not added, and why; at most a hundred, the latest first. */
  passedOver: z.array(passedOverDeviceSchema).max(100).default([]),
});

/** One vendor `hub` loaded. */
export type IntegrationVendor = z.output<typeof integrationVendorSchema>;

/**
 * One thing an owner adding a device may pick: a model, the driver that pick selects, and the
 * series the driver puts the model in - null for none.
 */
export type ModelChoice = {
  readonly kind: string;
  readonly driverId: string;
  readonly model: string;
  readonly series: string | null;
};

/**
 * What an owner adding a device of a vendor is offered.
 *
 * Every model of every driver, in the bundle's order; a driver that lists no model is offered
 * once, under its own name. One function for both the form that shows the list and the API that
 * checks a pick against it, so the two cannot disagree about what the choices are.
 *
 * @param vendor - As the hub lists it.
 * @returns The choices, in order.
 */
export function modelChoicesOf(vendor: IntegrationVendor): ModelChoice[] {
  return vendor.drivers.flatMap((driver) =>
    (driver.models.length === 0 ? [driver.name] : driver.models).map((model) => ({
      kind: driver.id,
      driverId: driver.driverId,
      model,
      series: driver.modelSeries?.[model] ?? null,
    })),
  );
}

/** A vendor, or a driver of one, that `hub` could not load, and why. */
export const bundleFailureSchema = z.object({
  /** The vendor it belongs to - its folder's name - or null for a folder that is no vendor. */
  vendorId: z.string().max(64).nullable(),

  /** The file or folder, relative to the directory of vendors. */
  path: z.string().max(512),

  message: z.string().max(2048),
});

/** A vendor, or a driver of one, that `hub` could not load. */
export type BundleFailureView = z.output<typeof bundleFailureSchema>;

/** What `hub` has loaded, and what it could not. */
export const catalogueReplySchema = z.object({
  vendors: z.array(integrationVendorSchema),
  failures: z.array(bundleFailureSchema).max(256).default([]),
});

/** What `hub` has loaded. */
export type CatalogueReply = z.output<typeof catalogueReplySchema>;

/**
 * Asks `hub` to try a configuration.
 *
 * The configuration is complete - constants applied, secrets either typed or still sealed - and
 * nothing about it is kept. Sealed values are accepted so that an owner can test an instance
 * they are editing without typing its password again.
 */
export const probeRequestSchema = z.object({
  /** Which driver, and so which transport. */
  kind: integrationKindIdSchema,

  transportConfig: jsonObjectSchema,

  /**
   * How long the whole attempt may take, connection included.
   *
   * Bounded above because a probe holds a socket and a bus request open for its whole length,
   * and the interface is waiting on the other end of both.
   */
  timeoutMs: z.int().min(1000).max(30_000).default(DEFAULT_PROBE_TIMEOUT_MS),
});

/** Asks `hub` to try a configuration. */
export type ProbeRequest = z.output<typeof probeRequestSchema>;

/**
 * What trying a configuration found out.
 *
 * A verdict and a sentence, never an error: a configuration that does not work is the expected
 * outcome of a probe, and it is reported the way a working one is so the interface shows the
 * reason in the same place either way.
 */
export const probeReplySchema = z.object({
  isReachable: z.boolean(),

  /** What happened, in one sentence the owner can act on. */
  detail: z.string().min(1).max(1024),

  /**
   * Which driver and model the answer says the device is, when the vendor's discovery probes
   * and a driver took what came back. The form preselects it; the owner may still pick another.
   */
  detected: z
    .object({
      kind: integrationKindIdSchema,
      model: z.string().min(1).max(64).nullable(),
      modelChoices: z.array(z.string().min(1).max(64)).min(1).max(64),
    })
    .optional(),
});

/** What trying a configuration found out. */
export type ProbeReply = z.output<typeof probeReplySchema>;

/** Asks `hub` to re-read one instance and match it. */
export const reloadRequestSchema = z.object({ integrationId: integrationIdSchema });

/** Asks `hub` to re-read one instance and match it. */
export type ReloadRequest = z.output<typeof reloadRequestSchema>;

/** Where the instance ended up. */
export const reloadReplySchema = z.object({
  state: integrationStateSchema,
  lastError: z.string().nullable(),
});

/** Where the instance ended up. */
export type ReloadReply = z.output<typeof reloadReplySchema>;

/** Asks `hub` to stop one instance and forget it. */
export const forgetRequestSchema = z.object({ integrationId: integrationIdSchema });

/** Asks `hub` to stop one instance and forget it. */
export type ForgetRequest = z.output<typeof forgetRequestSchema>;

/** Whether there was anything running to stop. Informational: either way, it is gone. */
export const forgetReplySchema = z.object({ wasRunning: z.boolean() });

/** Whether there was anything running to stop. */
export type ForgetReply = z.output<typeof forgetReplySchema>;
