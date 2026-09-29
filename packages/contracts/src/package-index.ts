/**
 * The package index: every package an installation may install, and every release of each.
 *
 * The releases themselves are files on GitHub - each package's repository publishes a release
 * with its archive as an asset, which a public repository serves to anyone without a token. The
 * index is what points at them: one JSON document, fetched from `PACKAGE_INDEX_URL`, naming for
 * each release the versions of the platform and the SDK it needs, and the archive's address,
 * size and SHA-256. The packet-manager downloads an archive only to check it against these
 * before it unpacks anything.
 *
 * Until the Community Hub exists the index is a static file; the Hub will serve the same
 * document, which is why its metadata - the name, the description, the category - is here rather
 * than read out of each archive (ARCHITECTURE.md 9.1, 10).
 */
import { z } from 'zod';

import { iconIdSchema } from './icons.js';
import {
  PACKAGE_CATEGORIES,
  packageIdSchema,
  packageRequiresSchema,
  packageServiceNameSchema,
} from './package-manifest.js';
import { semverRangeSchema, semverSchema } from './semver.js';
import { timestampSchema } from './timestamp.js';

/** How large one package's archive may be. */
export const PACKAGE_ARCHIVE_MAXIMUM_BYTES = 512 * 1024 * 1024;

/** One archive: where it is, how large, and its digest. */
export const packageArtifactSchema = z.strictObject({
  /** An HTTPS address: a GitHub release asset. */
  url: z.url({ protocol: /^https$/ }).max(1024),

  /** The SHA-256 of the archive, in hexadecimal. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'Must be a SHA-256 in lower-case hexadecimal'),

  size: z.int().min(1).max(PACKAGE_ARCHIVE_MAXIMUM_BYTES),
});

/** One archive. */
export type PackageArtifact = z.output<typeof packageArtifactSchema>;

/** One release of a package. */
export const packageReleaseSchema = z.strictObject({
  version: semverSchema,

  /** The platform versions it works with, as its manifest says. */
  platform: semverRangeSchema,

  /** The SDK versions it was written against. */
  sdk: semverRangeSchema,

  /** What it needs besides itself, as its manifest says, so the store can say it before. */
  requires: packageRequiresSchema,

  /** The services it provides. */
  provides: z.array(packageServiceNameSchema).max(16).default([]),

  artifact: packageArtifactSchema,
  publishedAt: timestampSchema,

  /** Where what changed is written: the release's page. */
  changelogUrl: z.url().max(1024).optional(),
});

/** One release of a package. */
export type PackageRelease = z.output<typeof packageReleaseSchema>;

/** One package, as the index lists it. */
export const packageIndexEntrySchema = z.strictObject({
  id: packageIdSchema,
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(512),

  /** Its repository on GitHub, `owner/name`. */
  repository: z.string().regex(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/),
  category: z.enum(PACKAGE_CATEGORIES),
  icon: iconIdSchema.optional(),

  /** Every release, newest first. */
  versions: z.array(packageReleaseSchema).min(1).max(256),
});

/** One package, as the index lists it. */
export type PackageIndexEntry = z.output<typeof packageIndexEntrySchema>;

/** The whole index. */
export const packageIndexSchema = z
  .strictObject({
    /** When it was made. */
    generatedAt: timestampSchema,
    packages: z.array(packageIndexEntrySchema).max(4096),
  })
  .refine(
    (index) => new Set(index.packages.map((each) => each.id)).size === index.packages.length,
    {
      message: 'Each package is listed once',
    },
  );

/** The whole index. */
export type PackageIndex = z.output<typeof packageIndexSchema>;
