/**
 * What `packet-manager` reads from the environment.
 *
 * Its own database role, for `system.packages`; the bus, which its packages are handed too; the
 * instance key, which opens the secrets a package's settings hold before the package is given
 * them and seals the house's token at the Community Hub; where the Hub and the local folders are,
 * and whether installs are reported to it; the runner a `node` package is started with; and an
 * external MQTT broker, which stands in for the house's own package.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import semver from 'semver';
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
import integrationSdk from '@nebulahome/integration-sdk/package.json' with { type: 'json' };

/** Name this service reports in log records and bus envelopes. */
export const SERVICE_NAME = 'packet-manager';

/** Version this build reports on every log record. Kept in step with `package.json` by hand. */
export const SERVICE_VERSION = '0.0.0';

/**
 * The integration contract this platform's `hub` implements: the integration SDK's version without
 * its prerelease, as `hub` reads it. An integration's release fits when its `sdk` range takes it.
 */
export const INTEGRATION_RUNTIME_VERSION: string =
  semver.coerce(integrationSdk.version)?.version ?? integrationSdk.version;

/** The repository's `infra/local-packages/`, from where this file is built or run. */
const REPOSITORY_LOCAL_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../infra/local-packages',
);

/** The repository's `infra/local-integrations/`, from where this file is built or run. */
const REPOSITORY_LOCAL_INTEGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../infra/local-integrations',
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
     * indexes are read (`/v1/index/packages.json`, `/v1/index/integrations.json`), packages and
     * integrations are searched (`/v1/packages`, `/v1/integrations`) and installs are reported.
     * Unset, nothing is offered but what the local folders hold.
     */
    COMMUNITY_HUB_URL: urlWithScheme(['https:', 'http:'])
      .transform((url) => url.replace(/\/+$/u, ''))
      .optional(),

    /**
     * Whether an install or update of a release of the index is reported to the Hub, which counts
     * how many houses installed each package and integration. The house registers once, the
     * first time it reports. `false` sends nothing.
     */
    COMMUNITY_HUB_REPORT_INSTALLS: z.stringbool().default(true),

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

    /**
     * The local integrations folder: bundles put there by hand (`<vendor>-<version>.tgz`, as
     * `nebulahome-integration pack` writes them), offered beside the integrations index's. Absent,
     * the repository's `infra/local-integrations` outside production and none in production.
     */
    PACKET_MANAGER_LOCAL_INTEGRATIONS_DIR: z
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

/**
 * Where the integrations index is: the Community Hub's document of it.
 *
 * @param config - The parsed environment.
 * @returns Its address; undefined when no Hub is set.
 */
export function integrationIndexUrlOf(config: PacketManagerConfig): string | undefined {
  return config.COMMUNITY_HUB_URL === undefined
    ? undefined
    : `${config.COMMUNITY_HUB_URL}/v1/index/integrations.json`;
}

/**
 * Where the local integrations folder is, if anywhere.
 *
 * @param config - The parsed environment.
 * @returns `PACKET_MANAGER_LOCAL_INTEGRATIONS_DIR` when given; otherwise the repository's
 * `infra/local-integrations` outside production, and none in production.
 */
export function localIntegrationsDirectory(config: PacketManagerConfig): string | undefined {
  if (config.PACKET_MANAGER_LOCAL_INTEGRATIONS_DIR !== undefined) {
    return config.PACKET_MANAGER_LOCAL_INTEGRATIONS_DIR;
  }

  return config.NODE_ENV === 'production' ? undefined : REPOSITORY_LOCAL_INTEGRATIONS_DIR;
}
