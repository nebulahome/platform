/**
 * Installing integrations: what `packet-manager` answers about the Community Hub's integrations
 * and the bundles it installs, and what `api` relays of it.
 *
 * An integration is a vendor's bundle. `packet-manager` searches the Hub for it, downloads the
 * release the integrations index names, checks it, unpacks it into a folder of its own build -
 * `hub/integrations/<vendor>/<build>/` - and asks `hub` to load it (`svc.hub.vendor_load`). Only
 * once `hub` says the build loaded does it write the marker that makes the build current; a build
 * that does not load is deleted, and the copy that ran before runs on.
 *
 * `hub_detail` is shared with the packages: what the Hub says of one item beyond its search row -
 * whose repository it is, the models it works with, the transports its drivers speak - read when
 * the owner opens the item's own page in the install dialog.
 */
import { z } from 'zod';

import { INTEGRATION_BUNDLE_KINDS } from './integration-index.js';
import {
  INTEGRATION_INSTALL_SOURCES,
  integrationInstallSchema,
  VENDOR_ID_PATTERN,
} from './integrations.js';
import { PACKAGE_ID_PATTERN } from './package-id.js';
import { packageRequiresSchema } from './package-requires.js';
import {
  PACKAGE_LISTING_ORIGINS,
  packageSearchRequestSchema,
  sha256Schema,
} from './packet-manager.js';
import { semverSchema } from './semver.js';
import { timestampSchema } from './timestamp.js';

/** A vendor's id, as a request names it. */
const vendorIdSchema = z.string().regex(VENDOR_ID_PATTERN, 'Must be a vendor id');

/** `svc.packet-manager.integration_search`: what to look for, and from which page on. */
export const integrationSearchRequestSchema = packageSearchRequestSchema;

/** What to look for. */
export type IntegrationSearchRequest = z.output<typeof integrationSearchRequestSchema>;

/**
 * One integration a search found: what the Hub says of it and, from the integrations index, what
 * installing it here would take.
 */
export const integrationListingSchema = z.object({
  id: vendorIdSchema,
  name: z.string().min(1).max(128),
  description: z.string().max(512),

  /** Its repository on GitHub, `owner/name`; null for a local file that names none. */
  repository: z.string().max(201).nullable(),

  /** A hex colour its monogram is tinted with, when it has no logo. */
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/u)
    .nullable(),

  /** Its logo's SHA-256, relayed by `GET /catalogue/logos/:sha256`; null when it has none. */
  logo: sha256Schema.nullable(),

  /** Whether the Hub's team publishes it. */
  isOfficial: z.boolean(),

  /** How many houses installed it, and how many people starred it, as the Hub counts them. */
  downloads: z.int().min(0),
  stars: z.int().min(0),

  /** Whether its devices stop working when the internet does; null when nothing says. */
  internetRequired: z.boolean().nullable(),

  origin: z.enum(PACKAGE_LISTING_ORIGINS),

  /** The newest release that works with this platform; null when none does. */
  latest: z
    .object({
      version: semverSchema,
      sdk: z.string().max(64),
      requires: packageRequiresSchema,
      bundleKind: z.enum(INTEGRATION_BUNDLE_KINDS),
      publishedAt: timestampSchema,
      changelogUrl: z.string().max(1024).nullable(),

      /** Whether it is a file of the local folder rather than a release of the index. */
      source: z.enum(INTEGRATION_INSTALL_SOURCES),
    })
    .nullable(),

  /** The newest release of all, compatible or not; null when the index has none. */
  newestVersion: semverSchema.nullable(),

  /** The version the platform installed; null when it installed none. */
  installedVersion: z.string().max(64).nullable(),

  /**
   * Whether a copy under development - a bundle the hub reads from `HUB_DEV_BUNDLE_DIR` - runs
   * and none is installed: installing one puts it in that copy's place.
   */
  isBuiltIn: z.boolean(),

  /** Whether a newer compatible release than the one installed is out. */
  hasUpdate: z.boolean(),

  /** Whether the local folder holds other bytes of the version installed: a rebuild to reinstall. */
  hasNewBuild: z.boolean(),

  /** Why it cannot be installed here, when it cannot. */
  unavailableReason: z.string().max(512).nullable(),
});

/** One integration a search found. */
export type IntegrationListing = z.output<typeof integrationListingSchema>;

/** What a search found, and why the Hub could not be asked, when it could not. */
export const integrationSearchReplySchema = z.object({
  items: z.array(integrationListingSchema).max(250),

  /** The cursor of the next page; null on the last. */
  nextCursor: z.string().min(1).max(512).nullable(),

  /** Why the Hub could not be asked. The local folder's files are listed still. */
  hubError: z.string().max(1024).nullable(),
});

/** What a search found. */
export type IntegrationSearchReply = z.output<typeof integrationSearchReplySchema>;

/** `svc.packet-manager.integration_install`: which vendor, which release, who asked. */
export const integrationInstallRequestSchema = z.strictObject({
  vendorId: vendorIdSchema,

  /** A release; the newest that fits when not said. */
  version: semverSchema.optional(),

  /** The account that asked, written into the marker. */
  requestedBy: z.uuid().optional(),
});

/** Which vendor, which release. */
export type IntegrationInstallRequest = z.output<typeof integrationInstallRequestSchema>;

/** What an install did. */
export const INTEGRATION_INSTALL_ACTIONS = ['installed', 'updated', 'reinstalled'] as const;

/** What an install did, and the build `hub` now runs. */
export const integrationInstallReplySchema = z.object({
  vendorId: vendorIdSchema,
  action: z.enum(INTEGRATION_INSTALL_ACTIONS),
  install: integrationInstallSchema,

  /** What of the build did not load though the vendor did - a driver - in sentences. */
  warnings: z.array(z.string().max(2048)).max(64),
});

/** What an install did. */
export type IntegrationInstallReply = z.output<typeof integrationInstallReplySchema>;

/** `svc.packet-manager.integration_remove`: which vendor. */
export const integrationRemoveRequestSchema = z.strictObject({ vendorId: vendorIdSchema });

/** Which vendor. */
export type IntegrationRemoveRequest = z.output<typeof integrationRemoveRequestSchema>;

/** What removing a bundle did. */
export const integrationRemoveReplySchema = z.object({
  /** True when the copy under development it stood in for comes back only once `hub` restarts. */
  isRestartNeeded: z.boolean(),
});

/** What removing a bundle did. */
export type IntegrationRemoveReply = z.output<typeof integrationRemoveReplySchema>;

/** What the Hub lists. */
export const HUB_ITEM_KINDS = ['package', 'integration'] as const;

/** What the Hub lists. */
export type HubItemKind = (typeof HUB_ITEM_KINDS)[number];

/** `svc.packet-manager.hub_detail`: which item. */
export const hubDetailRequestSchema = z.strictObject({
  kind: z.enum(HUB_ITEM_KINDS),
  id: z.string().regex(PACKAGE_ID_PATTERN, 'Must be an id'),
});

/** Which item. */
export type HubDetailRequest = z.output<typeof hubDetailRequestSchema>;

/** What the Hub says of one item beyond its search row. */
export const hubDetailSchema = z.object({
  kind: z.enum(HUB_ITEM_KINDS),
  id: z.string().max(64),

  /** Who publishes it: the owner of its repository on GitHub. */
  owner: z.string().max(100).nullable(),

  /** Its home page, as the Hub has it. */
  homepageUrl: z.string().max(1024).nullable(),

  /** The device models it works with (integrations); empty when it names none. */
  models: z.array(z.string().max(256)).max(256),

  /** Whether its devices stop working when the internet does; null for a package. */
  internetRequired: z.boolean().nullable(),

  /** Its newest release, and when it was published. */
  version: z.string().max(128).nullable(),
  publishedAt: timestampSchema.nullable(),

  /** What its newest release's drivers speak - `http`, `mqtt` - each once (integrations). */
  transports: z.array(z.string().max(64)).max(32),

  /** Whether its newest release ships code (integrations); null for a package. */
  bundleKind: z.enum(INTEGRATION_BUNDLE_KINDS).nullable(),
});

/** What the Hub says of one item. */
export type HubDetail = z.output<typeof hubDetailSchema>;

/** `svc.packet-manager.integration_available`: nothing. */
export const integrationAvailableRequestSchema = z.strictObject({});

/** One installed integration, and what the index offers it. */
export const integrationAvailabilitySchema = z.object({
  vendorId: vendorIdSchema,
  installedVersion: z.string().max(64),
  source: z.enum(INTEGRATION_INSTALL_SOURCES),

  /** The newest release that works here; null when the index has none. */
  latestVersion: semverSchema.nullable(),
  hasUpdate: z.boolean(),
  hasNewBuild: z.boolean(),
});

/** One installed integration, and what the index offers it. */
export type IntegrationAvailability = z.output<typeof integrationAvailabilitySchema>;

/** Every installed integration, and whether the index could be read. */
export const integrationAvailableReplySchema = z.object({
  items: z.array(integrationAvailabilitySchema).max(1024),
  error: z.string().max(1024).nullable(),
});

/** Every installed integration, and what the index offers. */
export type IntegrationAvailableReply = z.output<typeof integrationAvailableReplySchema>;

/** `POST /integrations/vendors/:vendorId/install`: which release, the newest that fits when not said. */
export const integrationInstallBodySchema = z.strictObject({ version: semverSchema.optional() });

/** `GET /integrations/catalogue`: what to look for, and from which page on. */
export const integrationCatalogueQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  cursor: z.string().min(1).max(512).optional(),
});

/** What `DELETE /integrations/vendors/:vendorId` took away with the bundle. */
export const integrationRemovedSchema = z.object({
  devices: z.int().min(0),
  accounts: z.int().min(0),
  isRestartNeeded: z.boolean(),
});

/** What removing an integration took away. */
export type IntegrationRemoved = z.output<typeof integrationRemovedSchema>;
