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

  /**
   * The Community Hub's packages, searched - and the local folder's files - each with what
   * installing it here would take.
   */
  search: 'search',

  /** A logo the Hub showed in a search, by its digest: the interface may not load the Hub's own. */
  hubLogo: 'hub_logo',

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

  /** Starts a round of updates, backing up first when the settings say (contracts `updates.ts`). */
  runUpdates: 'run_updates',

  /** The round of updates running or last run. */
  updateStatus: 'update_status',

  /** Reads the update settings again and plans the automatic updates by them. */
  reloadUpdates: 'reload_updates',

  /**
   * The Community Hub's integrations, searched - and the local integrations folder's files - each
   * with what installing it here would take.
   */
  integrationSearch: 'integration_search',

  /** Installs, updates or reinstalls an integration's bundle, and has `hub` load it. */
  integrationInstall: 'integration_install',

  /** Removes an installed integration's bundle, and has `hub` let go of it. */
  integrationRemove: 'integration_remove',

  /** Every installed integration, and the update the integrations index offers it. */
  integrationAvailable: 'integration_available',

  /** What the Hub says of one package or integration beyond its search row, for its own page. */
  hubDetail: 'hub_detail',
} as const;

/** The subject token a package answers its pages' calls on: `svc.<id>.rpc`. */
export const PACKAGE_RPC_METHOD = 'rpc';

/** The subject token a package hears a live change of its settings on: `svc.<id>.settings`. */
export const PACKAGE_SETTINGS_METHOD = 'settings';

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

/** How many packages one page of a search asks the Hub for. */
export const PACKAGE_SEARCH_PAGE_SIZE = 30;

/** Where a package of a search comes from: the Community Hub, or the local folder alone. */
export const PACKAGE_LISTING_ORIGINS = ['hub', 'local'] as const;

/** Where a package of a search comes from. */
export type PackageListingOrigin = (typeof PACKAGE_LISTING_ORIGINS)[number];

/** A SHA-256 digest, in hex: how the Hub addresses a logo. */
export const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u, 'Must be a SHA-256 in hex');

/** `svc.packet-manager.search`: what to look for, and from which page on. */
export const packageSearchRequestSchema = z.strictObject({
  /** Words of a name or description; the Hub's most installed first when not said. */
  q: z.string().trim().min(1).max(100).optional(),

  /** The Hub's cursor of the page to read, from the reply before. */
  cursor: z.string().min(1).max(512).optional(),
});

/** What to look for. */
export type PackageSearchRequest = z.output<typeof packageSearchRequestSchema>;

/**
 * One package a search found: what the Hub says of it - its colour, its logo, how many installed
 * it - and, from the package index, what installing it here would take.
 */
export const packageListingSchema = availablePackageSchema.extend({
  /** What the Hub holds may be empty, unlike a manifest's. */
  description: z.string().max(512),

  /** Null for a package the Hub lists that is not in the index yet. */
  repository: z.string().max(201).nullable(),

  /** The newest release the index has, or the Hub's latest; null when neither says. */
  newestVersion: semverSchema.nullable(),

  /** Its colour, `#rrggbb`: the Hub's word, so checked before it reaches a style. */
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/u)
    .nullable(),

  /** Its logo's digest, served at `GET /api/v1/catalogue/logos/:sha256`. */
  logo: sha256Schema.nullable(),

  /** Whether the NebulaHome team publishes it. */
  isOfficial: z.boolean(),

  /** How many installations put it in, and how many accounts starred it. */
  downloads: z.int().min(0),
  stars: z.int().min(0),

  origin: z.enum(PACKAGE_LISTING_ORIGINS),

  /** Why it cannot be installed here, in a sentence; null when it can, or is. */
  unavailableReason: z.string().max(512).nullable(),
});

/** One package a search found. */
export type PackageListing = z.output<typeof packageListingSchema>;

/** What a search found, and why the Hub could not be asked, when it could not. */
export const packageSearchReplySchema = z.object({
  items: z.array(packageListingSchema).max(200),

  /** The cursor of the next page; null on the last. */
  nextCursor: z.string().min(1).max(512).nullable(),

  /** Why the Hub could not be asked. The local folder's files are listed still. */
  hubError: z.string().max(1024).nullable(),
});

/** What a search found. */
export type PackageSearchReply = z.output<typeof packageSearchReplySchema>;

/** The largest logo the Hub keeps (its importer refuses more), and so the largest relayed. */
export const PACKAGE_HUB_LOGO_MAXIMUM_BYTES = 256 * 1024;

/** `svc.packet-manager.hub_logo`: which logo. */
export const packageHubLogoRequestSchema = z.strictObject({ sha256: sha256Schema });

/** Which logo. */
export type PackageHubLogoRequest = z.output<typeof packageHubLogoRequestSchema>;

/** A Hub logo's bytes, in base64, and what they are. */
export const packageHubLogoReplySchema = z.object({
  contentType: z.enum(['image/svg+xml', 'image/png']),
  data: z
    .string()
    .max(Math.ceil(PACKAGE_HUB_LOGO_MAXIMUM_BYTES / 3) * 4)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/u),
});

/** A Hub logo. */
export type PackageHubLogoReply = z.output<typeof packageHubLogoReplySchema>;

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

/** `GET /packages/catalogue`: what to look for, and from which page on. */
export const packageCatalogueQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  cursor: z.string().min(1).max(512).optional(),
});

/** `GET /catalogue/logos/:sha256`. */
export const packageHubLogoParamsSchema = packageHubLogoRequestSchema;

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
