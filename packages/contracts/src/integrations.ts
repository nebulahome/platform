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
   * The icon a device of this driver starts with, from the catalogue, when the bundle names
   * one. The owner picks another per device; this is only what the form starts from.
   */
  defaultIcon: iconIdSchema.optional(),

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

  /**
   * Extra room the interface leaves around the logo, in pixels, on top of the small margin
   * every logo gets. For a mark drawn to the edge of its file.
   */
  logoPadding: z.int().min(0).max(16).default(0),

  /** Whether its devices stop working when the internet does. */
  internetRequired: z.boolean(),

  /** Every transport one of its drivers speaks, each once, in the drivers' order. */
  transports: z.array(transportIdSchema),

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
