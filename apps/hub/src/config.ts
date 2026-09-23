/**
 * What `hub` reads from the environment.
 *
 * Composed from the shared fragments in `@nebula-home/config` plus the handful of variables only
 * this service has. Anything an owner can change while the system runs belongs in
 * `registry.integrations` or `system.settings` instead; the environment is for what is fixed for
 * the life of a process (RULES.md 11).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import {
  busEnvSchema,
  databaseEnvSchema,
  dataEnvSchema,
  requireDataDirInProduction,
  runtimeEnvSchema,
  secretsEnvSchema,
} from '@nebula-home/config';

/** Name this service reports in log records and bus envelopes. */
export const SERVICE_NAME = 'hub';

/**
 * Version this build reports on every log record.
 *
 * Kept in step with `package.json` by hand, like every other service.
 */
export const SERVICE_VERSION = '0.0.0';

/**
 * The integration contract version this build implements.
 *
 * Separate from {@link SERVICE_VERSION} on purpose: a bundle declares the *contract* it was
 * written against, not the release of the service that happens to be running it, and the two move
 * for entirely different reasons.
 */
export const RUNTIME_VERSION = '1.0.0';

/** Everything `hub` needs from the environment. */
export const hubEnvSchema = runtimeEnvSchema
  .extend(databaseEnvSchema.shape)
  .extend(busEnvSchema.shape)
  .extend(secretsEnvSchema.shape)
  .extend({
    /**
     * Where the integration bundles under development are, read beside the ones installed in the
     * data directory until the integrations catalogue exists to download them from.
     *
     * Absent, the repository's own `apps/hub/bundles` outside production and nothing in it: the
     * product ships with no integration, and a production image does not contain that directory.
     * Absolute, for the reason `NEBULA_DATA_DIR` is. See {@link developmentBundleDirectory}.
     */
    HUB_DEV_BUNDLE_DIR: z
      .string()
      .min(1)
      .refine((value) => path.isAbsolute(value), 'Must be an absolute path')
      .optional(),

    /**
     * How long a device has to accept a command.
     *
     * Shorter than the timeout `core` gives `hub`, so that a device that will not answer is
     * reported as unavailable by the service that actually knows, rather than surfacing as a
     * bus timeout that names nothing.
     */
    HUB_COMMAND_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(4000),

    /** How long one pass of listening for a device lasts before it counts as having heard nothing. */
    HUB_IDENTIFY_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300_000).default(30_000),

    /**
     * How long to wait after a pass that failed - the transport threw, `core` did not answer -
     * before listening again. A pass that merely heard nothing is followed almost at once.
     */
    HUB_IDENTIFY_RETRY_MS: z.coerce.number().int().min(1000).max(3_600_000).default(60_000),
  })
  // The data directory, whose `hub/integrations` holds the bundles installed into this hub.
  .extend(dataEnvSchema.shape)
  .superRefine(requireDataDirInProduction);

/** Everything `hub` needs from the environment. */
export type HubConfig = z.output<typeof hubEnvSchema>;

/**
 * The repository's own bundles under development.
 *
 * Found from where this file sits - `src` and `dist` are at the same depth - rather than from the
 * working directory, which is wherever the process happened to be started.
 */
const REPOSITORY_BUNDLE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../bundles',
);

/**
 * Where the bundles under development are read from, if anywhere.
 *
 * @param config - The parsed environment.
 * @returns `HUB_DEV_BUNDLE_DIR` when given; otherwise the repository's `apps/hub/bundles` outside
 * production, and nothing in production.
 */
export function developmentBundleDirectory(config: HubConfig): string | undefined {
  if (config.HUB_DEV_BUNDLE_DIR !== undefined) {
    return config.HUB_DEV_BUNDLE_DIR;
  }

  return config.NODE_ENV === 'production' ? undefined : REPOSITORY_BUNDLE_DIR;
}
