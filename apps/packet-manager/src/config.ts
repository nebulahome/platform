/**
 * What `packet-manager` reads from the environment.
 *
 * Its own database role, for `system.packages`; the bus, which its packages are handed too; the
 * instance key, which opens the secrets a package's settings hold before the package is given
 * them; where the Community Hub and the local folder are; the runner a `node` package is started
 * with; and an external MQTT broker, which stands in for the house's own package.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import {
  busEnvSchema,
  databaseEnvSchema,
  dataEnvSchema,
  mqttEnvSchema,
  requireDataDirInProduction,
  runtimeEnvSchema,
  secretsEnvSchema,
  urlWithScheme,
} from '@nebulahome/config';

/** Name this service reports in log records and bus envelopes. */
export const SERVICE_NAME = 'packet-manager';

/** Version this build reports on every log record. Kept in step with `package.json` by hand. */
export const SERVICE_VERSION = '0.0.0';

/** The repository's `infra/local-packages/`, from where this file is built or run. */
const REPOSITORY_LOCAL_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../infra/local-packages',
);

/** Everything `packet-manager` needs from the environment. */
export const packetManagerEnvSchema = runtimeEnvSchema
  .extend(databaseEnvSchema.shape)
  .extend(busEnvSchema.shape)
  .extend(secretsEnvSchema.shape)
  // A broker it names stands in for the house's: no package is installed to provide one.
  .extend(mqttEnvSchema.shape)
  .extend({
    /**
     * The Community Hub's public API, `https://hub.example.com` - no path, no `/v1`: where the
     * package index is read (`/v1/index/packages.json`) and the packages are searched
     * (`/v1/packages`). Unset, nothing is offered but what the local folder holds.
     */
    COMMUNITY_HUB_URL: urlWithScheme(['https:', 'http:'])
      .transform((url) => url.replace(/\/+$/u, ''))
      .optional(),

    /**
     * The local folder: releases put there by hand (`<id>-<version>.tgz`, as `nebulahome-package
     * pack` writes them), offered beside the index's, to try a package before it is released.
     * Absent, the repository's `infra/local-packages` outside production and none in production.
     * Absolute, for the reason `NEBULA_DATA_DIR` is. See {@link localPackagesDirectory}.
     */
    PACKET_MANAGER_LOCAL_DIR: z
      .string()
      .min(1)
      .refine((value) => path.isAbsolute(value), 'Must be an absolute path')
      .optional(),

    /** How long the index is trusted before it is read again. */
    PACKET_MANAGER_INDEX_TTL_MS: z.coerce
      .number()
      .int()
      .min(60_000)
      .max(86_400_000)
      .default(21_600_000),

    /**
     * The runner a `node` package is started with: `@nebulahome/package-host`'s, resolved from
     * this service when not said.
     */
    PACKET_MANAGER_RUNNER: z.string().min(1).optional(),

    /** This platform's release, which each package's `platform` range is checked against. */
    NEBULA_PLATFORM_VERSION: z
      .string()
      .regex(/^\d+\.\d+\.\d+(?:-[\da-z.-]+)?$/i)
      .default('1.0.0'),

    /** How long a package's process has to announce itself before it is taken as running anyway. */
    PACKET_MANAGER_ANNOUNCE_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .max(300_000)
      .default(30_000),

    /** How long a download of one archive may take. */
    PACKET_MANAGER_DOWNLOAD_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(5000)
      .max(3_600_000)
      .default(600_000),
  })
  .extend({
    /** Handed to a package's process as they are: where programs are, and the time zone. */
    PATH: z.string().optional(),
    TZ: z.string().optional(),
  })
  .extend(dataEnvSchema.shape)
  .superRefine(requireDataDirInProduction);

/** Everything `packet-manager` needs from the environment. */
export type PacketManagerConfig = z.output<typeof packetManagerEnvSchema>;

/**
 * Where the package index is: the Community Hub's document of it.
 *
 * @param config - The parsed environment.
 * @returns Its address; undefined when no Hub is set.
 */
export function packageIndexUrlOf(config: PacketManagerConfig): string | undefined {
  return config.COMMUNITY_HUB_URL === undefined
    ? undefined
    : `${config.COMMUNITY_HUB_URL}/v1/index/packages.json`;
}

/**
 * Where the local folder is, if anywhere.
 *
 * @param config - The parsed environment.
 * @returns `PACKET_MANAGER_LOCAL_DIR` when given; otherwise the repository's
 * `infra/local-packages` outside production, and none in production.
 */
export function localPackagesDirectory(config: PacketManagerConfig): string | undefined {
  if (config.PACKET_MANAGER_LOCAL_DIR !== undefined) {
    return config.PACKET_MANAGER_LOCAL_DIR;
  }

  return config.NODE_ENV === 'production' ? undefined : REPOSITORY_LOCAL_DIR;
}
