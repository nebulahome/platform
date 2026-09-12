/**
 * Integration instances: what an owner configured, what a scan found, and what adopting it does.
 *
 * An **integration** is a driver bundle - declarative or code - bound to a transport. An
 * **instance** is one configured copy of it: this MQTT broker, that ESPHome device. The instance
 * id is what an entity carries as its `source`, which is why it shares a namespace with a
 * package id rather than having one of its own.
 *
 * Discovery deliberately persists nothing. A candidate is something a scan saw a moment ago and
 * is valid only until the scan that produced it is replaced; the registry hears only about the
 * ones an owner adopts. Storing candidates would mean a table whose rows go stale the instant a
 * device is unplugged, and a second definition of "device" competing with `registry.devices`.
 *
 * Defined in ARCHITECTURE.md 8.
 */
import { z } from 'zod';

import { ulidSchema } from './bus-envelope.js';
import { capabilityNameSchema } from './capabilities.js';
import { entityIdSchema } from './entity-id.js';
import { integrationSetupSchema } from './integration-setup.js';
import { jsonObjectSchema } from './json.js';
import { PACKAGE_ID_PATTERN } from './package-manifest.js';

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

/** Identifies a vendor on its own: `shelly`, `bambu-lab`. A directory people type, so letter first. */
const VENDOR_ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;

/** Identifies a driver within its vendor: `gen2`, `1pm-mini-g3`. Named after the product, so digits allowed first. */
const DRIVER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

/** What a logo may be served as: an image the interface can put straight into an `img`. */
const LOGO_DATA_URL_PATTERN = /^data:image\/(?:svg\+xml|png);base64,[A-Za-z0-9+/]+=*$/;

/** The lifecycle states `hub` records for a configured instance. */
export const INTEGRATION_STATES = ['stopped', 'starting', 'running', 'failed', 'disabled'] as const;

/** The lifecycle state of a configured instance. */
export type IntegrationState = (typeof INTEGRATION_STATES)[number];

/** Validates an instance lifecycle state. */
export const integrationStateSchema = z.enum(INTEGRATION_STATES);

/** The bus service name `hub` answers management calls on. */
export const HUB_SERVICE = 'hub';

/** Starts a discovery pass. */
export const HUB_DISCOVER_METHOD = 'discover';

/** Reads what the current pass has found so far. */
export const HUB_CANDIDATES_METHOD = 'candidates';

/** Turns a candidate into a registered device. */
export const HUB_ADOPT_METHOD = 'adopt';

/** Releases an adopted device. */
export const HUB_FORGET_METHOD = 'forget';

/** Lists the vendors `hub` has loaded, with their drivers and what each asks at setup. */
export const HUB_CATALOGUE_METHOD = 'catalogue';

/** Tries a configuration against the world without keeping it. */
export const HUB_PROBE_METHOD = 'probe';

/** Re-reads one instance from the registry and starts, restarts or stops it to match. */
export const HUB_RELOAD_METHOD = 'reload';

/** How long a probe may take when the caller does not say. */
const DEFAULT_PROBE_TIMEOUT_MS = 8000;

/**
 * One entity a candidate would produce if it were adopted.
 *
 * Shown before the owner commits, because "adopt this and find out" is a poor offer for
 * something that writes rows the automations then reference.
 */
export const entityPreviewSchema = z.object({
  entityId: entityIdSchema,
  name: z.string().min(1).max(128),
  capabilities: z.array(capabilityNameSchema).min(1),
});

/** One entity a candidate would produce if it were adopted. */
export type EntityPreview = z.output<typeof entityPreviewSchema>;

/** A device a scan found and an integration claimed, not yet adopted. */
export const discoveredCandidateSchema = z.object({
  /**
   * Identifies the candidate within the scan that produced it.
   *
   * Not durable: a new scan issues new ones, and adopting against a stale id fails rather than
   * adopting whatever now sits at that position.
   */
  candidateId: z.string().min(1).max(128),

  /** The instance that claimed it, and that will own the device. */
  integrationId: integrationIdSchema,

  /** The owner's own identifier for the device, unique within the instance. */
  externalId: z.string().min(1).max(256),

  name: z.string().min(1).max(128),
  manufacturer: z.string().max(128).optional(),
  model: z.string().max(128).optional(),

  /** At least one: a device that would expose nothing is not worth a registry row. */
  entities: z.array(entityPreviewSchema).min(1),

  /**
   * What the transport actually saw.
   *
   * Kept so that a claim which looks wrong can be argued with. Without it the only answer to
   * "why does it think my dimmer is a switch" is to run the scan again and read the logs.
   */
  evidence: jsonObjectSchema.default({}),
});

/** A device a scan found and an integration claimed, not yet adopted. */
export type DiscoveredCandidate = z.output<typeof discoveredCandidateSchema>;

/** Asks `hub` to start a discovery pass. */
export const discoverRequestSchema = z.object({
  /** One instance, or every enabled one when omitted. */
  integrationId: integrationIdSchema.optional(),

  /**
   * How long the pass runs.
   *
   * Defaulted rather than optional: a scan holds a subscription or a radio open, and a caller
   * that forgot the field would otherwise leave one running until the service restarts.
   */
  timeoutMs: z.int().min(1000).max(300_000).default(30_000),
});

/** Asks `hub` to start a discovery pass. */
export type DiscoverRequest = z.output<typeof discoverRequestSchema>;

/** What `hub` answers when a pass starts. */
export const discoverReplySchema = z.object({
  scanId: ulidSchema,

  /** The instances actually scanning, which is not every instance the owner configured. */
  integrationIds: z.array(integrationIdSchema),
});

/** What `hub` answers when a pass starts. */
export type DiscoverReply = z.output<typeof discoverReplySchema>;

/** Asks `hub` what the current pass has found. */
export const candidatesRequestSchema = z.object({});

/** Asks `hub` what the current pass has found. */
export type CandidatesRequest = z.output<typeof candidatesRequestSchema>;

/** What `hub` has found so far. */
export const candidatesReplySchema = z.object({
  candidates: z.array(discoveredCandidateSchema),

  /** False once the pass has ended, so the interface can stop saying "searching". */
  isScanning: z.boolean(),
});

/** What `hub` has found so far. */
export type CandidatesReply = z.output<typeof candidatesReplySchema>;

/** Asks `hub` to adopt a candidate. */
export const adoptRequestSchema = z.object({
  candidateId: z.string().min(1).max(128),

  /** Replaces the discovered name. Omitted leaves whatever the integration reported. */
  name: z.string().min(1).max(128).optional(),

  areaId: z.uuid().optional(),
});

/** Asks `hub` to adopt a candidate. */
export type AdoptRequest = z.output<typeof adoptRequestSchema>;

/** What adoption produced. */
export const adoptReplySchema = z.object({
  deviceId: z.uuid(),
  entityIds: z.array(entityIdSchema).min(1),
});

/** What adoption produced. */
export type AdoptReply = z.output<typeof adoptReplySchema>;

/** Asks `hub` to release an adopted device. */
export const forgetRequestSchema = z.object({ deviceId: z.uuid() });

/** Asks `hub` to release an adopted device. */
export type ForgetRequest = z.output<typeof forgetRequestSchema>;

/** What releasing a device removed. */
export const forgetReplySchema = z.object({ entityIds: z.array(entityIdSchema) });

/** What releasing a device removed. */
export type ForgetReply = z.output<typeof forgetReplySchema>;

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

  /** Which transport an instance of it opens: `http`, `mqtt`. */
  transport: z.string().min(1).max(32),

  /**
   * The models it drives, for the owner to pick from. Empty means the driver's name is the
   * one model.
   */
  models: z.array(z.string().min(1).max(64)).default([]),

  /** What setting up an instance asks. */
  setup: integrationSetupSchema,
});

/** One driver `hub` loaded. */
export type IntegrationKind = z.output<typeof integrationKindSchema>;

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

  /** Whether its devices stop working when the internet does. */
  internetRequired: z.boolean(),

  /** Every transport one of its drivers speaks, each once, in the drivers' order. */
  transports: z.array(z.string().min(1).max(32)),

  /** What setting the vendor up asks; empty groups for a vendor that needs nothing. */
  setup: integrationSetupSchema,

  drivers: z.array(integrationKindSchema),
});

/** One vendor `hub` loaded. */
export type IntegrationVendor = z.output<typeof integrationVendorSchema>;

/** One thing an owner adding a device may pick: a model, and the driver that pick selects. */
export type ModelChoice = {
  readonly kind: string;
  readonly driverId: string;
  readonly model: string;
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
    })),
  );
}

/** What `hub` has loaded. */
export const catalogueReplySchema = z.object({ vendors: z.array(integrationVendorSchema) });

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
