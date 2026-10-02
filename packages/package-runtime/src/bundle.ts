/**
 * The two manifests a bundle is written as, and the one the runtime reads.
 *
 * A bundle is how an integration is distributed: a **vendor** directory - the company that
 * makes the devices, with a logo, a version, and whatever settings every device of theirs
 * shares - holding one **driver** directory per profile or entry point, each listing the
 * models it drives. Two files, because the two levels answer different questions: `manifest.json`
 * is what a catalogue lists and an owner recognises, `driver.json` is what the runtime loads
 * and an instance references. The split is also what ends the duplication the old flat layout
 * had, where every driver of one vendor repeated the vendor's name and description and the
 * three copies drifted.
 *
 * What the rest of the runtime reads is neither file but their composition, the
 * {@link BundleManifest}: the vendor's identity and version beside the driver's transport and
 * entry point, keyed by the vendor-qualified kind. {@link resolveManifest} is the only place the
 * two are joined, so a field that moves between the files moves in one function.
 *
 * `kind` is a trust boundary as much as a format. A declarative driver is data - it cannot do
 * anything a path cannot express - so a catalogue can publish one directly. A code driver is
 * JavaScript, and reaches a catalogue only after the manual approval ARCHITECTURE.md 10 already
 * requires of executable content.
 */
import { z } from 'zod';

import {
  iconIdSchema,
  INTEGRATION_KIND_PATTERN,
  packageRequiresSchema,
  SEMVER_PATTERN,
  TRANSPORT_WIRES,
  transportIdSchema,
  type TransportWire,
} from '@nebulahome/contracts';

import { containerDependenciesSchema } from './containers.js';

/** Bundle kind, which is both how it is written and how far it is trusted. */
export const BUNDLE_KINDS = ['declarative', 'code'] as const;

/** Bundle kind, which is both how it is written and how far it is trusted. */
export type BundleKind = (typeof BUNDLE_KINDS)[number];

/** Identifies a vendor, and names its directory: `shelly`, `bambu-lab`. */
export const VENDOR_ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;

/** Validates a vendor id. */
export const vendorIdSchema = z.string().regex(VENDOR_ID_PATTERN, 'Must be a vendor id');

/** Identifies a driver within its vendor, and names its directory: `dimmer-pm`, `3em`. */
export const DRIVER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

/** Validates a driver id. */
export const driverIdSchema = z.string().regex(DRIVER_ID_PATTERN, 'Must be a driver id');

/**
 * Validates an integration kind: `shelly/gen2`, `bambu-lab/printer`.
 *
 * Vendor-qualified, so two vendors may each have a `gen2` and an instance row names one of
 * them without ambiguity. Not an instance of one: an instance gets its own id. The pattern is
 * the contracts package's, because the API checks the same string at its boundary.
 */
export const integrationKindSchema = z
  .string()
  .regex(INTEGRATION_KIND_PATTERN, 'Must be an integration kind, as vendor/driver');

/** The name a vendor ships a transport under; the vendor's id in front of it makes the id. */
const TRANSPORT_NAME_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

/** A path inside the bundle, as a manifest names its files. */
export const bundlePathSchema = z.string().min(1).max(256);

/** How many models one driver may list. A longer list is a catalogue, not a dropdown. */
const MAXIMUM_MODELS = 64;

/** A model's label, as a driver lists it. */
const modelNameSchema = z.string().min(1).max(64);

/** What a device calls its own model: `S3SW-001P16EU`, `diy_plug`, `H6199`. */
const modelCodeSchema = z.string().min(1).max(64);

/**
 * The contents of `manifest.json`: what a vendor says about itself.
 *
 * Nothing here is about how a device is reached. Which transports the vendor speaks is
 * derived from its drivers when the bundle is loaded rather than declared, because a declared
 * `hasMqtt` is a second statement of a fact the drivers already make, and one that can be wrong.
 */
export const vendorManifestSchema = z.strictObject({
  /** How a catalogue groups bundles by company. Also the directory's name. */
  id: vendorIdSchema,

  /** The bundle's version. The vendor directory is what a catalogue publishes and versions. */
  version: z.string().regex(SEMVER_PATTERN, 'Must be a semantic version'),

  /**
   * The runtime versions this bundle works with, as a semver range.
   *
   * A bundle outlives the runtime it was written for. Without a declared range, a profile
   * written against an older schema is loaded against a newer one and fails somewhere further
   * in, with a message about a field rather than about a version.
   */
  sdk: z.string().min(1).max(64),

  name: z.string().min(1).max(128),
  description: z.string().max(512).optional(),
  url: z.url().optional(),

  /** A hex colour the interface tints the vendor's mark with, and its monogram when there is no logo. */
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Must be a hex colour like #3B9DFF')
    .optional(),

  /**
   * The logo: a path relative to the bundle, an SVG or a PNG, either bare or with the room the
   * interface should leave around it. Both forms read as the second, so nothing downstream
   * has to ask which one was written.
   */
  logo: z
    .union([
      bundlePathSchema,
      z.strictObject({
        path: bundlePathSchema,

        /**
         * Room around the mark, in pixels, on top of the small margin every logo gets. For a
         * mark drawn to the edge of its file.
         */
        padding: z.int().min(0).max(16).default(0),
      }),
    ])
    .transform((logo) => (typeof logo === 'string' ? { path: logo, padding: 0 } : logo))
    .optional(),

  /** Whether the devices stop working when the internet does. Shown as a warning on the card. */
  internetRequired: z.boolean().default(false),

  /**
   * Path to a `setup.json` of settings every device of this vendor shares - a cloud API key,
   * an account - relative to the bundle. Absent for the vendors whose devices are reached
   * directly, which is most of them.
   */
  setup: bundlePathSchema.optional(),

  /**
   * Since 1.5: path to an `account.json` - what signing in to the account the vendor's devices
   * are reached through asks, and the module that signs in (`account.ts`). Absent for a vendor
   * without one.
   */
  account: bundlePathSchema.optional(),

  /**
   * Transports of the vendor's own, by name: `{ "rpc": "./rpc/transport.js" }`, or with the
   * wires it goes over, `{ "rpc": { "module": "./rpc/transport.js", "wires": ["http"] } }`.
   *
   * Each module default-exports a factory taking the {@link BundleSdk} and returning a
   * transport whose id is `<vendor>/<name>`. A vendor that ships one ships code, and is
   * reviewed as a code driver is. The wires are what the vendor's card shows - HTTP, MQTT,
   * Zigbee - since a transport of the vendor's own is named nowhere a person would recognise.
   */
  transports: z
    .record(
      z.string().regex(TRANSPORT_NAME_PATTERN, 'Must be a transport name'),
      z.union([
        bundlePathSchema,
        z.strictObject({
          module: bundlePathSchema,
          wires: z.array(z.enum(TRANSPORT_WIRES)).min(1).max(TRANSPORT_WIRES.length),
        }),
      ]),
    )
    .default({}),

  /**
   * Stream sources of the vendor's own, by name: `{ "camera": "./camera/stream.js" }`.
   *
   * Each module default-exports a factory taking the {@link BundleSdk} and returning a stream
   * source whose id is `<vendor>/<name>`, which a profile's camera entity names. Code, as a
   * transport is.
   */
  streams: z
    .record(z.string().regex(TRANSPORT_NAME_PATTERN, 'Must be a stream name'), bundlePathSchema)
    .default({}),

  /**
   * Since 1.3: the containers the vendor's devices depend on - zigbee2mqtt for Zigbee - which the
   * platform downloads and runs once the vendor is set up (`containers.ts`).
   */
  containers: containerDependenciesSchema,

  /**
   * Since 1.5: the packages and services the vendor's devices need, in the grammar a package's
   * manifest names its own with (PACKAGES.md 7) - `{ "services": ["mqtt-broker"] }` for a vendor
   * that talks through the broker. Until what it needs runs, the vendor waits: its devices are
   * not added and its instances are not started, and its page says which package it waits for.
   */
  requires: packageRequiresSchema,

  /**
   * Digest of the bundle's contents, stamped by the catalogue at publication.
   *
   * Not written by the author, and absent on a bundle nobody has published. It is the local
   * half of the approval: what lets `hub` tell that the code it is about to load is the code
   * that was reviewed.
   */
  integrity: z
    .string()
    .regex(/^sha256-[A-Za-z0-9+/]+=*$/, 'Must be a sha256 subresource integrity digest')
    .optional(),

  /** Signature over {@link vendorManifestSchema.integrity}, stamped by the catalogue. */
  signature: z.string().min(1).max(2048).optional(),
});

/** The contents of `manifest.json`. */
export type VendorManifest = z.output<typeof vendorManifestSchema>;

/** One transport of a vendor's own, as its manifest declares it. */
export type VendorTransport = VendorManifest['transports'][string];

/**
 * The module a vendor's own transport is in.
 *
 * @param transport - The manifest's entry.
 * @returns Its path, relative to the bundle.
 */
export function transportModuleOf(transport: VendorTransport): string {
  return typeof transport === 'string' ? transport : transport.module;
}

/**
 * The wires a vendor's own transport goes over.
 *
 * @param transport - The manifest's entry.
 * @returns The wires it declares; none for one that declares none.
 */
export function transportWiresOf(transport: VendorTransport): readonly TransportWire[] {
  return typeof transport === 'string' ? [] : transport.wires;
}

/** What a driver manifest and a resolved manifest say alike: how a driver is written and loaded. */
const driverShape = {
  /** Which transport carries it, and how a catalogue groups it by connection. */
  transport: transportIdSchema,

  /**
   * The models this driver drives, as the labels on their boxes, in the order the owner is
   * offered them. An owner adding a device picks one, and the pick is kept on the instance so
   * the interface can say `X1C` rather than the driver's name. Empty means the driver's own
   * name is the one model.
   */
  models: z
    .array(modelNameSchema)
    .max(MAXIMUM_MODELS)
    .default([])
    .refine((models) => new Set(models).size === models.length, {
      message: 'A model may be listed once',
    }),

  /**
   * What the hardware calls each model, mapped onto the label the owner picks.
   *
   * Discovery reads a code off a device - `S3SW-001P16EU` from a Shelly, `diy_plug` from a
   * Sonoff - and this is how it knows which driver, and which of its models, that is. A code
   * mapped onto several models names a family whose exact model the hardware does not say: the
   * driver is certain, and the owner picks among those. Every model named must be listed.
   */
  modelCodes: z
    .record(
      modelCodeSchema,
      z.union([modelNameSchema, z.array(modelNameSchema).min(1).max(MAXIMUM_MODELS)]),
    )
    .optional(),

  /**
   * Since 1.6: the series each model belongs to, as the vendor sells them - Bambu Lab's
   * `A series`, `X series` - for a vendor whose drivers follow what the hardware needs rather than
   * how the owner knows it: an X1C and an X2D are both the X series, and run by two drivers. The
   * form groups the models by it, across the vendor's drivers. Every model named must be listed.
   */
  modelSeries: z.record(modelNameSchema, z.string().min(1).max(64)).optional(),

  kind: z.enum(BUNDLE_KINDS),

  /**
   * The catalogue icon a device of this driver starts with. The owner picks another per
   * device; this is only what the form starts from, and it may be absent.
   */
  defaultIcon: iconIdSchema.optional(),

  /**
   * The port the device serves its own web page on, when it has one: `80` for a Shelly. Only a
   * driver that names one gets the "open web page" link on its devices, so a device that answers
   * on an API port with nothing to look at never sends the owner to a blank tab.
   */
  webPagePort: z.int().min(1).max(65_535).optional(),

  /** Where the page is on that port, when it is not the root: `/web` for Plex. */
  webPagePath: z
    .string()
    .regex(/^\/[^\s]*$/, 'Must be a path starting with /')
    .max(256)
    .optional(),

  /** Path to the profile, relative to the driver. Declarative drivers only. */
  profile: bundlePathSchema.optional(),

  /** Path to the entry point, relative to the driver. Code drivers only. */
  entry: bundlePathSchema.optional(),

  /**
   * Path to `setup.json`, relative to the driver: what setting up an instance asks.
   *
   * Required of every driver, declarative or code. Without it the interface has no form to
   * show and an instance could only be created by writing a registry row by hand.
   */
  setup: bundlePathSchema,
};

/** The part of either manifest that says how a driver is written and which file holds it. */
type KindFiles = {
  readonly kind: BundleKind;
  readonly profile?: string | undefined;
  readonly entry?: string | undefined;
};

/**
 * Refuses a driver that names the file of the other kind, or not the file of its own.
 *
 * @param manifest - Either manifest, once its shape has been checked.
 * @param ctx - Where to record what is wrong.
 */
function checkKindFiles(manifest: KindFiles, ctx: z.RefinementCtx): void {
  const expected = manifest.kind === 'declarative' ? 'profile' : 'entry';
  const forbidden = manifest.kind === 'declarative' ? 'entry' : 'profile';

  if (manifest[expected] === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: [expected],
      message: `A ${manifest.kind} driver must name its ${expected}`,
    });
  }

  if (manifest[forbidden] !== undefined) {
    // The two are different trust levels. A driver claiming both would have to be treated as
    // the stricter one, which is a decision better refused than guessed at load time.
    ctx.addIssue({
      code: 'custom',
      path: [forbidden],
      message: `A ${manifest.kind} driver must not name an ${forbidden}`,
    });
  }
}

/** The part of either manifest that says which models a driver lists and what they are called. */
type ModelFiles = {
  readonly models: readonly string[];
  readonly modelCodes?: Readonly<Record<string, string | readonly string[]>> | undefined;
  readonly modelSeries?: Readonly<Record<string, string>> | undefined;
};

/**
 * Refuses a code that names a model the driver does not list.
 *
 * Discovery would otherwise propose a model the form then refuses, on a device already half
 * added. A driver that lists no model has none to map a code onto, so it may not map any.
 *
 * @param manifest - Either manifest, once its shape has been checked.
 * @param ctx - Where to record what is wrong.
 */
function checkModelCodes(manifest: ModelFiles, ctx: z.RefinementCtx): void {
  for (const [code, named] of Object.entries(manifest.modelCodes ?? {})) {
    for (const model of typeof named === 'string' ? [named] : named) {
      if (!manifest.models.includes(model)) {
        ctx.addIssue({
          code: 'custom',
          path: ['modelCodes', code],
          message: `${code} names ${model}, which the driver does not list in models`,
        });
      }
    }
  }
}

/**
 * Refuses a series given to a model the driver does not list: the form would group a model it
 * never offers.
 *
 * @param manifest - Either manifest, once its shape has been checked.
 * @param ctx - Where to record what is wrong.
 */
function checkModelSeries(manifest: ModelFiles, ctx: z.RefinementCtx): void {
  for (const model of Object.keys(manifest.modelSeries ?? {})) {
    if (!manifest.models.includes(model)) {
      ctx.addIssue({
        code: 'custom',
        path: ['modelSeries', model],
        message: `${model} is given a series, but the driver does not list it in models`,
      });
    }
  }
}

/**
 * The contents of `driver.json`: one profile or entry point, and the models it drives.
 *
 * Strict, and without the vendor's fields on purpose: a driver that repeated the vendor's name
 * or description would be a second copy to keep in step, which is what the layout was made to
 * end.
 */
export const driverManifestSchema = z
  .strictObject({
    /** Identifies the driver within its vendor. Also the directory's name. */
    id: driverIdSchema,

    /** What the driver is called after the vendor: `Gen2`, `Printer`, `1PM Mini Gen3`. */
    name: z.string().min(1).max(128),

    ...driverShape,
  })
  .superRefine(checkKindFiles)
  .superRefine(checkModelCodes)
  .superRefine(checkModelSeries);

/** The contents of `driver.json`. */
export type DriverManifest = z.output<typeof driverManifestSchema>;

/** Who made the devices this bundle drives, as the resolved manifest carries it. */
export const vendorSchema = z.strictObject({
  /** How a catalogue groups bundles by company. */
  id: vendorIdSchema,

  name: z.string().min(1).max(128),
  url: z.url().optional(),
});

/** Who made the devices this bundle drives. */
export type Vendor = z.output<typeof vendorSchema>;

/**
 * A driver as the runtime reads it: its own manifest joined with its vendor's.
 *
 * This is what every other part of the runtime and `hub` is written against, and what a test
 * builds by hand when it wants an integration without a directory. It is never read from a
 * file; {@link resolveManifest} composes it.
 */
export const bundleManifestSchema = z
  .strictObject({
    /** The driver this bundle provides, vendor-qualified. An instance of it gets its own id. */
    id: integrationKindSchema,

    version: z.string().regex(SEMVER_PATTERN, 'Must be a semantic version'),
    sdk: z.string().min(1).max(64),

    /** The vendor's name and the driver's, together: `Shelly Gen2`. */
    name: z.string().min(1).max(256),
    description: z.string().max(512).optional(),
    vendor: vendorSchema,

    ...driverShape,
  })
  .superRefine(checkKindFiles)
  .superRefine(checkModelCodes)
  .superRefine(checkModelSeries);

/** A driver as the runtime reads it. */
export type BundleManifest = z.output<typeof bundleManifestSchema>;

/**
 * Joins a driver's manifest with its vendor's into what the runtime reads.
 *
 * The one place the two files meet. The kind is `vendor/driver`, the name is both names, and
 * everything about distribution - version, runtime range, description, the vendor's identity -
 * comes from the vendor while everything about loading comes from the driver.
 *
 * @param vendor - The vendor's manifest.
 * @param driver - One of its drivers' manifests.
 * @returns The resolved manifest, as {@link bundleManifestSchema} accepts it.
 * @throws {Error} When the driver names another vendor's transport.
 */
export function resolveManifest(vendor: VendorManifest, driver: DriverManifest): BundleManifest {
  const slash = driver.transport.indexOf('/');

  if (slash !== -1 && driver.transport.slice(0, slash) !== vendor.id) {
    // Vendors load in no particular order, so a driver leaning on another vendor's transport
    // would bind or not by luck. The platform's transports are unqualified and always there.
    throw new Error(
      `${vendor.id}/${driver.id} names ${driver.transport}, which belongs to another vendor; a driver uses the platform's transports or its own vendor's`,
    );
  }

  return {
    id: `${vendor.id}/${driver.id}`,
    version: vendor.version,
    sdk: vendor.sdk,
    name: `${vendor.name} ${driver.name}`,
    ...(vendor.description === undefined ? {} : { description: vendor.description }),
    vendor: {
      id: vendor.id,
      name: vendor.name,
      ...(vendor.url === undefined ? {} : { url: vendor.url }),
    },
    transport: driver.transport,
    models: driver.models,
    ...(driver.modelCodes === undefined ? {} : { modelCodes: driver.modelCodes }),
    ...(driver.modelSeries === undefined ? {} : { modelSeries: driver.modelSeries }),
    kind: driver.kind,
    ...(driver.defaultIcon === undefined ? {} : { defaultIcon: driver.defaultIcon }),
    ...(driver.webPagePort === undefined ? {} : { webPagePort: driver.webPagePort }),
    ...(driver.webPagePath === undefined ? {} : { webPagePath: driver.webPagePath }),
    ...(driver.profile === undefined ? {} : { profile: driver.profile }),
    ...(driver.entry === undefined ? {} : { entry: driver.entry }),
    setup: driver.setup,
  };
}
