/**
 * What a package - or a vendor, in its `manifest.json` - needs besides itself (PACKAGES.md 7).
 *
 * Apart from the manifest so that the vendors' grammar can name it without pulling the package
 * manifest's whole grammar - and what that imports - in with it.
 */
import { z } from 'zod';

import { packageIdSchema } from './package-id.js';
import { semverRangeSchema } from './semver.js';

/** A service a package provides and others require: `mqtt-broker`, `object-detection`. */
export const packageServiceNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{1,63}$/, 'Must be a lower-case service name');

/**
 * What a package - or a vendor, in its `manifest.json` - needs besides itself: the platform, by
 * version range; other packages, by id and range; and services, by name, whoever provides them.
 */
export const packageRequiresSchema = z
  .strictObject({
    platform: semverRangeSchema.optional(),
    packages: z.record(packageIdSchema, semverRangeSchema).default({}),
    services: z.array(packageServiceNameSchema).max(16).default([]),
  })
  .default({ packages: {}, services: [] });

/** What a package needs besides itself. */
export type PackageRequires = z.output<typeof packageRequiresSchema>;
