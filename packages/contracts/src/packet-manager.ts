/**
 * What `packet-manager` answers on the bus, and what a running package says to it.
 *
 * The packet-manager installs, runs and removes packages ([PACKAGES.md](../../../../PACKAGES.md)):
 * `api` asks it on the owner's behalf - `nebula.v1.svc.packet-manager.<method>` - and a package's
 * process, once started, announces what it registered (`announce`): the RPC methods its pages call.
 * Its events, `nebula.v1.pkg.<installed|started|stopped|removed|configured>`, are what the rest of the
 * platform follows a package's life by: `hub` holds and releases the vendors that need it, `api`
 * relays them to the interface, which loads the package's page and cards without a reload.
 *
 * A package answers two subjects of its own, under its id as every owner does: `svc.<id>.command`,
 * the commands `core` routes to its entities, and `svc.<id>.rpc`, the calls its pages make through
 * `POST /api/v1/packages/:id/rpc/:method`.
 */
import { z } from 'zod';

import { integrationSetupSchema } from './integration-setup.js';
import { jsonObjectSchema, jsonValueSchema } from './json.js';
import { packageIdSchema } from './package-id.js';
import {
  PACKAGE_CATEGORIES,
  PACKAGE_RUNTIMES,
  PACKAGE_SOURCES,
  PACKAGE_STATES,
  packageEntityTypeSchema,
  packageUiSchema,
} from './package-manifest.js';
import { packageRequiresSchema, packageServiceNameSchema } from './package-requires.js';
import { semverSchema } from './semver.js';
import { containerLogCursorSchema, containerLogsReplySchema } from './supervisor.js';
import { timestampSchema } from './timestamp.js';

/** The bus service name the packet-manager answers on. */
export const PACKET_MANAGER_SERVICE = 'packet-manager';

/** The methods the packet-manager answers, each `nebula.v1.svc.packet-manager.<method>`. */
export const PACKET_MANAGER_METHODS = {
  /** Every installed package, as the list shows it. */
  list: 'list',

  /** One installed package, with its setup, for its page. */
  get: 'get',

  /** What the package index offers, with what fits this platform. */
  available: 'available',

  /** What installing a package would take, before the owner confirms. */
  plan: 'plan',

  /** Installs a package and what it needs. */
  install: 'install',

  /** Updates a package to a newer release. */
  update: 'update',

  /** Removes a package. */
  remove: 'remove',

  start: 'start',
  stop: 'stop',
  restart: 'restart',

  /** The last lines a package's process wrote. */
  logs: 'logs',

  /** Saves what the owner configured, and starts the package again with it. */
  configure: 'configure',

  /** A package's process, once started: the RPC methods it registered. */
  announce: 'announce',
} as const;

/** The subject token a package answers its pages' calls on: `svc.<id>.rpc`. */
export const PACKAGE_RPC_METHOD = 'rpc';

/** The subject token a package hears a live change of its settings on: `svc.<id>.settings`. */
export const PACKAGE_SETTINGS_METHOD = 'settings';

/**
 * The subject tokens under a package's id that are the platform's, never a service of the
 * package's own: its commands, its methods, its settings, and those kept for what is planned - a
 * package's health, its events, what it says of itself - and anything starting with `_`.
 */
export const RESERVED_PACKAGE_SERVICES = [
  'command',
  'rpc',
  'settings',
  'health',
  'events',
  'info',
] as const;

/**
 * Says whether a service name is one a package may provide.
 *
 * @param name - The name.
 * @returns False for a reserved one.
 */
export function isPackageServiceAllowed(name: string): boolean {
  return !name.startsWith('_') && !RESERVED_PACKAGE_SERVICES.some((reserved) => reserved === name);
}

/** A live change of a package's settings, as its process hears it. */
export const packageSettingsChangeSchema = z.strictObject({
  /** Every setting as it now stands, secrets opened. */
  values: jsonObjectSchema,

  /** The keys that changed: each one of a field marked live. */
  changed: z.array(z.string().min(1).max(64)).max(64),
});

/** A live change of a package's settings. */
export type PackageSettingsChange = z.output<typeof packageSettingsChangeSchema>;

/** Who called a package's method from its interface. */
export const packageRpcCallerSchema = z.strictObject({
  userId: z.string().min(1).max(64),
  username: z.string().min(1).max(64),
  role: z.string().min(1).max(64),
});

/** Who called a package's method. */
export type PackageRpcCaller = z.output<typeof packageRpcCallerSchema>;

/** Who may call an RPC method of a package's: anyone who may read it, or configure it. */
export const PACKAGE_RPC_ACCESS = ['read', 'configure'] as const;

/** Who may call an RPC method. */
export type PackageRpcAccess = (typeof PACKAGE_RPC_ACCESS)[number];

/** One RPC method a package's process registered. */
export const packageRpcMethodSchema = z.object({
  name: z.string().regex(/^[a-z][a-zA-Z0-9_]{0,63}$/, 'Must be a camelCase method name'),
  access: z.enum(PACKAGE_RPC_ACCESS),
});

/** One RPC method a package's process registered. */
export type PackageRpcMethod = z.output<typeof packageRpcMethodSchema>;

/** Who depends on a package, or what a package depends on, as a page names it. */
export const packageRelationSchema = z.object({
  kind: z.enum(['package', 'vendor']),
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(128),
});

/** Who depends on a package, or what it depends on. */
export type PackageRelation = z.output<typeof packageRelationSchema>;

/** An installed package, as the packet-manager knows it. */
export const installedPackageSchema = z.object({
  id: packageIdSchema,
  version: semverSchema,

  /**
   * The release and the archive it came from, `<version>+<first 8 of its SHA-256>`: in the
   * address of its interface's files, so that a new build of the same version - a local file
   * reinstalled - is loaded fresh.
   */
  build: z.string().min(1).max(96),

  name: z.string().min(1).max(64),
  description: z.string().min(1).max(512),
  category: z.enum(PACKAGE_CATEGORIES),
  runtime: z.enum(PACKAGE_RUNTIMES),
  state: z.enum(PACKAGE_STATES),
  source: z.enum(PACKAGE_SOURCES),

  /**
   * The only package that provides a service the house must have - the MQTT broker
   * (PACKAGES.md 2): it is not removed or stopped while no other package provides it.
   */
  isSystem: z.boolean(),

  repository: z.string().max(201).nullable(),
  url: z.string().max(512).nullable(),
  color: z.string().max(7).nullable(),

  /** Whether it ships a logo, served beside its interface. */
  hasLogo: z.boolean(),

  /** What it adds to the interface; null for a package with none. */
  ui: packageUiSchema.nullable(),

  entityTypes: z.array(packageEntityTypeSchema),
  requires: packageRequiresSchema,
  provides: z.array(packageServiceNameSchema),

  /** Whether it asks to be configured, and whether that is done. */
  hasSetup: z.boolean(),

  /** The release it was updated from, while it is still unpacked to roll back to. */
  previousVersion: semverSchema.nullable(),

  lastStartedAt: timestampSchema.nullable(),

  /** Why it last failed, or why it waits. */
  lastError: z.string().max(1024).nullable(),

  installedAt: timestampSchema,
  updatedAt: timestampSchema,

  /** The methods its process registered, while it runs. */
  rpcMethods: z.array(packageRpcMethodSchema),

  /** What it needs and is not there or not running, in sentences. */
  problems: z.array(z.string().max(512)),

  /** The packages and vendors that need it. */
  usedBy: z.array(packageRelationSchema),

  /** The packages it needs, installed or not. */
  dependsOn: z.array(packageRelationSchema),
});

/** An installed package. */
export type InstalledPackage = z.output<typeof installedPackageSchema>;

/** One installed package with what its page needs besides: its setup, and what is saved. */
export const packageDetailSchema = installedPackageSchema.extend({
  /** What configuring it asks; null for one that asks nothing. */
  setup: integrationSetupSchema.nullable(),

  /** What the owner saved, secrets sealed: never handed to the interface opened. */
  config: jsonObjectSchema,

  /**
   * Where its files are on this machine, for `api` to serve its interface from. Kept between
   * the services: `api` leaves it out of what it answers the browser.
   */
  root: z.string().min(1).max(1024),
});

/** One installed package, for its page. */
export type PackageDetail = z.output<typeof packageDetailSchema>;

/** A package the index offers - or a local file, beside it. */
export const availablePackageSchema = z.object({
  id: packageIdSchema,
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(512),
  category: z.enum(PACKAGE_CATEGORIES),
  repository: z.string().max(201),
  icon: z.string().max(64).nullable(),

  /** The newest release that works with this platform; null when none does. */
  latest: z
    .object({
      version: semverSchema,
      requires: packageRequiresSchema,
      provides: z.array(packageServiceNameSchema),
      publishedAt: timestampSchema,
      changelogUrl: z.string().max(1024).nullable(),

      /** Whether it is a local file rather than a release of the index. */
      source: z.enum(PACKAGE_SOURCES),
    })
    .nullable(),

  /** The newest release of all, compatible or not. */
  newestVersion: semverSchema,

  /** The version installed, when it is. */
  installedVersion: semverSchema.nullable(),

  /** Whether a newer compatible release than the one installed is out. */
  hasUpdate: z.boolean(),

  /**
   * Whether a local file holds another build of the version installed - the same version, other
   * bytes - which updating reinstalls.
   */
  hasNewBuild: z.boolean(),
});

/** A package the index offers. */
export type AvailablePackage = z.output<typeof availablePackageSchema>;

/** `svc.packet-manager.list`: nothing. */
export const packetManagerEmptyRequestSchema = z.strictObject({});

/** Every installed package. */
export const packageListReplySchema = z.object({ items: z.array(installedPackageSchema) });

/** Every installed package. */
export type PackageListReply = z.output<typeof packageListReplySchema>;

/** What the index offers, and whether it could be read. */
export const packageAvailableReplySchema = z.object({
  items: z.array(availablePackageSchema),

  /** When the index was last read; null before it ever was. */
  checkedAt: timestampSchema.nullable(),

  /** Why it could not be read, when it could not. */
  error: z.string().max(1024).nullable(),
});

/** What the index offers. */
export type PackageAvailableReply = z.output<typeof packageAvailableReplySchema>;

/** A method about one package. */
export const packageIdRequestSchema = z.strictObject({ packageId: packageIdSchema });

/** A method about one package. */
export type PackageIdRequest = z.output<typeof packageIdRequestSchema>;

/** Installing or planning one: which package, which release, who asked. */
export const packageInstallRequestSchema = z.strictObject({
  packageId: packageIdSchema,

  /** A release; the newest that fits when not said. */
  version: semverSchema.optional(),

  /** The account that asked, for the audit trail. */
  requestedBy: z.uuid().optional(),
});

/** Installing or planning one. */
export type PackageInstallRequest = z.output<typeof packageInstallRequestSchema>;

/** What installing would take, or why it cannot be done. */
export const packagePlanReplySchema = z.object({
  /** What would be installed, what it needs first. Empty when it cannot be done. */
  install: z.array(z.object({ id: packageIdSchema, version: semverSchema, name: z.string() })),

  /** Why it cannot be done, in sentences naming both parties. */
  problems: z.array(z.string().max(512)),
});

/** What installing would take. */
export type PackagePlanReply = z.output<typeof packagePlanReplySchema>;

/** What an install did: the packages installed, the one asked for last. */
export const packageInstallReplySchema = z.object({
  installed: z.array(installedPackageSchema).min(1),
});

/** What an install did. */
export type PackageInstallReply = z.output<typeof packageInstallReplySchema>;

/** A package after something was done to it. */
export const packageReplySchema = z.object({ package: installedPackageSchema });

/** A package after something was done to it. */
export type PackageReply = z.output<typeof packageReplySchema>;

/** Removing one: whether its data folder goes too. */
export const packageRemoveRequestSchema = z.strictObject({
  packageId: packageIdSchema,

  /** Whether what it kept - recordings, a model - is deleted as well. Kept when not said. */
  isDataRemoved: z.boolean().default(false),
});

/** Removing one. */
export type PackageRemoveRequest = z.output<typeof packageRemoveRequestSchema>;

/** Which package's log, how many lines, after which. */
export const packageLogsRequestSchema = z.strictObject({
  packageId: packageIdSchema,
  tail: z.int().min(1).max(2000).default(500),
  since: containerLogCursorSchema.optional(),
});

/** Which package's log. */
export type PackageLogsRequest = z.output<typeof packageLogsRequestSchema>;

/** A package's log: the same shape as a container's, so one viewer reads both. */
export const packageLogsReplySchema = containerLogsReplySchema;

/** Saving what the owner configured. `api` has sealed the secrets already. */
export const packageConfigureRequestSchema = z.strictObject({
  packageId: packageIdSchema,
  values: jsonObjectSchema,
});

/** Saving what the owner configured. */
export type PackageConfigureRequest = z.output<typeof packageConfigureRequestSchema>;

/** What a package's process registered, once it started. */
export const packageAnnounceRequestSchema = z.strictObject({
  packageId: packageIdSchema,
  version: semverSchema,
  rpcMethods: z.array(packageRpcMethodSchema).max(128),
});

/** What a package's process registered. */
export type PackageAnnounceRequest = z.output<typeof packageAnnounceRequestSchema>;

/** `nebula.v1.pkg.<event>`: which package, which release, where it stands. */
export const packageEventSchema = z.object({
  packageId: packageIdSchema,
  version: semverSchema,
  state: z.enum(PACKAGE_STATES),
});

/** A package's event. */
export type PackageEvent = z.output<typeof packageEventSchema>;

/** A call a package's page makes: `svc.<id>.rpc`. */
export const packageRpcRequestSchema = z.strictObject({
  method: packageRpcMethodSchema.shape.name,
  input: jsonValueSchema.default(null),

  /** Who called, when a person did through the interface. */
  caller: packageRpcCallerSchema.optional(),
});

/** A call a package's page makes. */
export type PackageRpcRequest = z.output<typeof packageRpcRequestSchema>;

/** What a package's method answered. */
export const packageRpcReplySchema = z.object({ output: jsonValueSchema });

/** What a package's method answered. */
export type PackageRpcReply = z.output<typeof packageRpcReplySchema>;

// --- what `api` answers the interface --------------------------------------------------------

/** An installed package, as the interface lists it: with how much of the house it accounts for. */
export const apiPackageSchema = installedPackageSchema.extend({
  deviceCount: z.int().min(0),
  entityCount: z.int().min(0),
});

/** An installed package, as the interface lists it. */
export type ApiPackage = z.output<typeof apiPackageSchema>;

/** One package, for its page: without where its files are, which is the machine's business. */
export const apiPackageDetailSchema = packageDetailSchema.omit({ root: true }).extend({
  deviceCount: z.int().min(0),
  entityCount: z.int().min(0),
});

/** One package, for its page. */
export type ApiPackageDetail = z.output<typeof apiPackageDetailSchema>;

/** `POST /packages/:id/install` and `/plan`: which release, the newest that fits when not said. */
export const packageInstallBodySchema = z.strictObject({ version: semverSchema.optional() });

/** `PUT /packages/:id/config`: the setup form's two groups, as a vendor's settings are sent. */
export const packageConfigBodySchema = z
  .strictObject({
    transportConfig: jsonObjectSchema.optional(),
    options: jsonObjectSchema.optional(),
  })
  .refine((body) => body.transportConfig !== undefined || body.options !== undefined, {
    message: 'Nothing to change',
  });

/** What configuring a package sends. */
export type PackageConfigBody = z.output<typeof packageConfigBodySchema>;

/** `POST /packages/:id/rpc/:method`: what the method is handed. */
export const packageRpcBodySchema = z.strictObject({ input: jsonValueSchema.default(null) });
