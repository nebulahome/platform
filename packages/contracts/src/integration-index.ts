/**
 * The integrations index: every integration a house may install, and every release of each.
 *
 * The Community Hub serves it at `<COMMUNITY_HUB_URL>/v1/index/integrations.json` and defines it
 * (the Hub's ARCHITECTURE.md 9). Unlike the package index it is a **loose** document with a
 * `formatVersion`: a reader ignores the fields it does not know, and the version moves only for a
 * change that breaks one. Each integration is read on its own, so one this build cannot read is
 * left out rather than the index: a release's digest belongs to its own entry, and no other entry
 * can lend it the wrong one.
 *
 * A release is a vendor's bundle - `<vendor>-<version>.tgz`, its files under a `<vendor>/` folder -
 * on the vendor's GitHub releases, checked against the size and SHA-256 named here before anything
 * of it is unpacked.
 */
import { z } from 'zod';

import { VENDOR_ID_PATTERN } from './integrations.js';
import { packageArtifactSchema } from './package-index.js';
import { packageRequiresSchema } from './package-requires.js';
import { semverSchema } from './semver.js';
import { timestampSchema } from './timestamp.js';

/** The format of the index this build reads. */
export const INTEGRATION_INDEX_FORMAT_VERSION = 1;

/**
 * What a bundle holds: profiles alone, which the platform's declarative engine runs, or code of
 * its own - a driver, a transport, a module - which runs inside `hub`.
 */
export const INTEGRATION_BUNDLE_KINDS = ['declarative', 'code'] as const;

/** What a bundle holds. */
export type IntegrationBundleKind = (typeof INTEGRATION_BUNDLE_KINDS)[number];

/** One release of an integration. */
export const integrationReleaseSchema = z.looseObject({
  version: semverSchema,

  /** The integration SDK versions it was built against, as a semver range. */
  sdk: z.string().min(1).max(64),

  /** What its devices need besides it: a package, a service such as the MQTT broker. */
  requires: packageRequiresSchema,

  bundleKind: z.enum(INTEGRATION_BUNDLE_KINDS),
  artifact: packageArtifactSchema,
  publishedAt: timestampSchema,
  changelogUrl: z.url().max(1024).optional(),
});

/** One release of an integration. */
export type IntegrationRelease = z.output<typeof integrationReleaseSchema>;

/** One integration, as the index lists it. */
export const integrationIndexEntrySchema = z.looseObject({
  /** The vendor's id: also its folder, `hub/integrations/<id>/`. */
  id: z.string().regex(VENDOR_ID_PATTERN),
  name: z.string().min(1).max(128),
  description: z.string().max(512).optional(),

  /** Its repository on GitHub, `owner/name`. */
  repository: z.string().regex(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/u),
  url: z.url().max(1024).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/u)
    .optional(),
  category: z.string().max(64).optional(),

  /** Whether its devices stop working when the internet does. */
  internetRequired: z.boolean(),

  /** Every model its newest release's drivers list. */
  models: z.array(z.string().max(256)).max(4096),

  /** Every release, newest first. */
  versions: z.array(integrationReleaseSchema).min(1).max(256),
});

/** One integration, as the index lists it. */
export type IntegrationIndexEntry = z.output<typeof integrationIndexEntrySchema>;

/** The index as a whole, its integrations read one by one after it. */
export const integrationIndexDocumentSchema = z.looseObject({
  formatVersion: z.literal(INTEGRATION_INDEX_FORMAT_VERSION),
  generatedAt: timestampSchema,
  integrations: z.array(z.unknown()).max(4096),
});

/** The integrations index, every entry read. */
export type IntegrationIndex = {
  readonly generatedAt: Date;
  readonly integrations: readonly IntegrationIndexEntry[];
};
