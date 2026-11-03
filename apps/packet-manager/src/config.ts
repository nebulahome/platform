/**
 * What `packet-manager` reads from the environment.
 *
 * Its own database role, for `system.packages`; the bus, which its packages are handed too; the
 * instance key, which opens the secrets a package's settings hold before the package is given
 * them and seals the house's token at the Community Hub; where the Hub and the local folders are,
 * and whether installs are reported to it; and the runner a `node` package is started with.
 */
import { BlockList, isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import semver from 'semver';
import { z } from 'zod';

import {
  busEnvSchema,
  databaseEnvSchema,
  dataEnvSchema,
  requireDataDirInProduction,
  runtimeEnvSchema,
  secretsEnvSchema,
  urlWithScheme,
} from '@nebulahome/config';
import type { UpdateChannel } from '@nebulahome/contracts';
import integrationSdk from '@nebulahome/integration-sdk/package.json' with { type: 'json' };

/** Name this service reports in log records and bus envelopes. */
export const SERVICE_NAME = 'packet-manager';

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

/** Loopback and private networks: where a Hub may be asked over plain HTTP in production. */
const LOCAL_NETWORKS = new BlockList();

LOCAL_NETWORKS.addSubnet('127.0.0.0', 8);
LOCAL_NETWORKS.addSubnet('10.0.0.0', 8);
LOCAL_NETWORKS.addSubnet('172.16.0.0', 12);
LOCAL_NETWORKS.addSubnet('192.168.0.0', 16);
LOCAL_NETWORKS.addSubnet('::1', 128, 'ipv6');
LOCAL_NETWORKS.addSubnet('fc00::', 7, 'ipv6');

/**
 * Says whether the Hub may be asked at an address: over HTTPS anywhere, over plain HTTP only on
 * this machine or its network - a container's name, `localhost`, `host.docker.internal`, a
 * `.local` name, a loopback or private address - since anyone on the way could otherwise change
 * the index, and with it which archive and digest a house installs, or read the house's token.
 *
 * @param url - The Hub's address.
 * @returns True when it may.
 */
export function isTrustedHubUrl(url: string): boolean {
  const { protocol, hostname } = new URL(url);
  const host = hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  const family = isIP(host);

  if (protocol === 'https:') {
    return true;
  }

  return family === 0
    ? !host.includes('.') || /(?:^|\.)(?:localhost|internal|local)$/u.test(host)
    : LOCAL_NETWORKS.check(host, family === 6 ? 'ipv6' : 'ipv4');
}

/** Everything `packet-manager` needs from the environment. */
export const packetManagerEnvSchema = runtimeEnvSchema
  .extend(databaseEnvSchema.shape)
  .extend(busEnvSchema.shape)
  .extend(secretsEnvSchema.shape)
  .extend({
    /**
     * The Community Hub's public API, `https://hub.example.com` - no path, no `/v1`: where the
     * indexes are read (`/v1/index/packages.json`, `/v1/index/integrations.json`), packages and
     * integrations are searched (`/v1/packages`, `/v1/integrations`) and installs are reported.
     * Unset, nothing is offered but what the local folders hold. In production it must be HTTPS,
     * but for a Hub on this machine or its network ({@link isTrustedHubUrl}).
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
  .superRefine(requireDataDirInProduction)
  .superRefine((config, context) => {
    if (
      config.NODE_ENV === 'production' &&
      config.COMMUNITY_HUB_URL !== undefined &&
      !isTrustedHubUrl(config.COMMUNITY_HUB_URL)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['COMMUNITY_HUB_URL'],
        message: 'Must be https in production, unless the Hub is on this machine or its network',
      });
    }
  });

/** Everything `packet-manager` needs from the environment. */
export type PacketManagerConfig = z.output<typeof packetManagerEnvSchema>;

/**
 * Where one of the Community Hub's indexes is for a release channel. The stable one keeps the
 * address every Hub serves; betas and development builds have one each beside it.
 *
 * @param config - The parsed environment.
 * @param name - `packages` or `integrations`.
 * @param channel - The house's channel for that kind.
 * @returns Its address; undefined when no Hub is set.
 */
function indexUrlOf(
  config: Pick<PacketManagerConfig, 'COMMUNITY_HUB_URL'>,
  name: 'packages' | 'integrations',
  channel: UpdateChannel,
): string | undefined {
  if (config.COMMUNITY_HUB_URL === undefined) {
    return undefined;
  }

  return channel === 'stable'
    ? `${config.COMMUNITY_HUB_URL}/v1/index/${name}.json`
    : `${config.COMMUNITY_HUB_URL}/v1/index/${channel}/${name}.json`;
}

/**
 * Where the package index is: the Community Hub's document of it.
 *
 * @param config - The parsed environment.
 * @param channel - The house's channel for packages.
 * @returns Its address; undefined when no Hub is set.
 */
export function packageIndexUrlOf(
  config: Pick<PacketManagerConfig, 'COMMUNITY_HUB_URL'>,
  channel: UpdateChannel,
): string | undefined {
  return indexUrlOf(config, 'packages', channel);
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
 * @param channel - The house's channel for integrations.
 * @returns Its address; undefined when no Hub is set.
 */
export function integrationIndexUrlOf(
  config: Pick<PacketManagerConfig, 'COMMUNITY_HUB_URL'>,
  channel: UpdateChannel,
): string | undefined {
  return indexUrlOf(config, 'integrations', channel);
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
