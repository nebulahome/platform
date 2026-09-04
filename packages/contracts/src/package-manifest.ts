/**
 * The manifest every installable package ships.
 *
 * Purely operational: how to run the package, what platform it needs, and how to validate the
 * owner's configuration for it. **What a package contributes is not declared here** - entities,
 * bus services and HTTP routes are registered at startup by the code that provides them, so the
 * two cannot drift the moment someone adds a route and forgets the manifest.
 *
 * There is no `permissions` field and no `resources` field. Both exist to constrain code you did
 * not write, and every package is first-party.
 *
 * Defined in ARCHITECTURE.md 9.2.
 */
import { z } from 'zod';

import { jsonObjectSchema } from './json.js';

/**
 * Package identifier.
 *
 * Mirrors `packages_id_format` in DATABASE.md. Hyphens rather than underscores because the id is
 * also the npm package name under the `@nebula-home` scope, and npm names cannot contain
 * underscores at the start.
 */
export const PACKAGE_ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;

/** A released version: `major.minor.patch`, optionally with a prerelease and build suffix. */
export const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[\da-z-]+(?:\.[\da-z-]+)*)?(?:\+[\da-z-]+(?:\.[\da-z-]+)*)?$/i;

/** How a package is executed. */
export const PACKAGE_RUNTIMES = ['node', 'container'] as const;

/** How a package is executed. */
export type PackageRuntime = (typeof PACKAGE_RUNTIMES)[number];

/** The lifecycle states `packet-manager` records for an installed package. */
export const PACKAGE_STATES = [
  'installed',
  'starting',
  'running',
  'stopped',
  'failed',
  'disabled',
] as const;

/** The lifecycle state of an installed package. */
export type PackageState = (typeof PACKAGE_STATES)[number];

/** Validates a package identifier. */
export const packageIdSchema = z.string().regex(PACKAGE_ID_PATTERN, 'Must be a package id');

/** The contents of `nebula.package.json`. */
export const packageManifestSchema = z.object({
  id: packageIdSchema,

  version: z.string().regex(SEMVER_PATTERN, 'Must be a semantic version'),

  /**
   * Whether the package runs as a child process or an OCI container.
   *
   * The split is about shipping native binaries, not about isolation: a container is the least
   * painful way to deliver ffmpeg and its native libraries without asking the owner to install
   * and version them on the host by hand.
   */
  runtime: z.enum(PACKAGE_RUNTIMES),

  /**
   * The platform versions this package works with, as a semver range.
   *
   * Checked before installing. An incompatible package is refused with both versions named,
   * rather than installed and left to fail at startup with something unrelated.
   */
  coreApiVersion: z.string().min(1).max(64),

  /**
   * JSON Schema for the owner's configuration of this package.
   *
   * A JSON Schema document rather than a Zod schema because it has to survive being written to
   * `system.packages.manifest` and rendered as a form by the web UI, neither of which can
   * execute TypeScript.
   */
  configSchema: jsonObjectSchema.default({}),
});

/** The contents of `nebula.package.json`. */
export type PackageManifest = z.output<typeof packageManifestSchema>;

/** A route a running package asks `proxy` to forward to it. */
export const packageRouteSchema = z.object({
  /** The path prefix this package serves, such as `/nvr`. */
  pathPrefix: z
    .string()
    .regex(/^\/[a-z0-9/_-]*$/, 'Must be a lower-case path prefix')
    .refine((prefix) => !/^\/(api|health|ready)(\/|$)/.test(prefix), {
      message: 'Reserved prefix: /api, /health and /ready belong to the platform',
    }),

  /** Where `proxy` forwards matching requests. */
  upstream: z.string().min(1).max(512),

  /** Whether the prefix is removed before forwarding. */
  hasStrippedPrefix: z.boolean().default(true),

  /** A permission the caller must hold, checked by `proxy` before forwarding. */
  requiresPermission: z.string().max(128).optional(),

  /** Whether this route carries WebSocket upgrades. */
  isWebsocket: z.boolean().default(false),
});

/** A route a running package asks `proxy` to forward to it. */
export type PackageRoute = z.output<typeof packageRouteSchema>;
