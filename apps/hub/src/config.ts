/**
 * What `hub` reads from the environment.
 *
 * Composed from the shared fragments in `@nebulahome/config` plus the handful of variables only
 * this service has. Anything an owner can change while the system runs belongs in
 * `registry.integrations` or `system.settings` instead; the environment is for what is fixed for
 * the life of a process (RULES.md 11).
 */
import path from 'node:path';

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
} from '@nebulahome/config';
import { MQTT_PORT } from '@nebulahome/contracts';
import integrationSdk from '@nebulahome/integration-sdk/package.json' with { type: 'json' };
import type { PlatformMqtt } from '@nebulahome/package-runtime';

/** Name this service reports in log records and bus envelopes. */
export const SERVICE_NAME = 'hub';

/**
 * Version this build reports on every log record.
 *
 * Kept in step with `package.json` by hand, like every other service.
 */
export const SERVICE_VERSION = '0.0.0';

/**
 * The integration contract version this build implements: the version of the integration SDK an
 * integration is written and built with, which says the same contract - one number, so the two
 * cannot drift. Without its prerelease, which no bundle's range would match.
 *
 * Separate from {@link SERVICE_VERSION} on purpose: a bundle declares the *contract* it was
 * written against, not the release of the service that happens to be running it, and the two move
 * for entirely different reasons.
 */
export const RUNTIME_VERSION: string =
  semver.coerce(integrationSdk.version)?.version ?? integrationSdk.version;

/** Everything `hub` needs from the environment. */
export const hubEnvSchema = runtimeEnvSchema
  .extend(databaseEnvSchema.shape)
  .extend(busEnvSchema.shape)
  .extend(secretsEnvSchema.shape)
  // An external broker, handed to bundle code in place of the hub's own.
  .extend(mqttEnvSchema.shape)
  .extend({
    /**
     * Where the integration bundles under development are, read beside the ones installed in the
     * data directory: one directory of vendors, or several separated by the system's path
     * delimiter (`:` on Linux, `;` on Windows) - the `dist/` of two integration repositories,
     * say. A later directory's vendor replaces an earlier one's.
     *
     * Absent, none: every vendor is installed, and the product ships with no integration.
     * Absolute, for the reason `NEBULA_DATA_DIR` is. See {@link developmentBundleDirectories}.
     */
    HUB_DEV_BUNDLE_DIR: z
      .string()
      .min(1)
      .transform((value) => value.split(path.delimiter).filter((entry) => entry !== ''))
      .refine(
        (values) => values.length > 0 && values.every((value) => path.isAbsolute(value)),
        'Must be absolute paths',
      )
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

    /**
     * Whether to listen for devices announcing themselves, and propose them for adoption.
     *
     * On by default. Off for a hub whose network carries no multicast - a container on a bridge
     * network hears nothing, and would only hold port 5353 for nothing.
     */
    HUB_DISCOVERY_ENABLED: z.stringbool().default(true),

    /**
     * How often to ask mDNS again for the services the vendors declared, and how long an
     * address's answer to a probe is trusted before it is asked again.
     */
    HUB_DISCOVERY_QUERY_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(60_000)
      .max(86_400_000)
      .default(600_000),

    /** How long a proposed device stays proposed without being heard again. */
    HUB_DISCOVERY_TTL_MS: z.coerce.number().int().min(60_000).max(86_400_000).default(1_800_000),

    /**
     * Whether the hub holds the house's Matter fabric. On by default; off for a hub that must not
     * take Matter's UDP port 5540 - another Matter controller on the same host has it.
     */
    HUB_MATTER_ENABLED: z.stringbool().default(true),

    /**
     * The TCP port the house's MQTT broker listens on. 1883 unless said: what every device and
     * the Docker image's port mapping expect. 0 lets the system pick one, for a test.
     */
    HUB_MQTT_PORT: z.coerce.number().int().min(0).max(65_535).default(MQTT_PORT),

    /** This platform's release, which a vendor's `requires.platform` range is checked against. */
    NEBULA_PLATFORM_VERSION: z
      .string()
      .regex(/^\d+\.\d+\.\d+(?:-[\da-z.-]+)?$/i)
      .default('1.0.0'),
  })
  // The data directory, whose `hub/integrations` holds the bundles installed into this hub.
  .extend(dataEnvSchema.shape)
  .superRefine(requireDataDirInProduction);

/** Everything `hub` needs from the environment. */
export type HubConfig = z.output<typeof hubEnvSchema>;

/**
 * Where the bundles under development are read from, if anywhere.
 *
 * @param config - The parsed environment.
 * @returns `HUB_DEV_BUNDLE_DIR`'s directories when given, in production too; otherwise none.
 */
export function developmentBundleDirectories(config: HubConfig): readonly string[] {
  return config.HUB_DEV_BUNDLE_DIR ?? [];
}

/**
 * The external broker the environment names, which bundle code is handed in place of the hub's.
 *
 * @param config - The parsed environment.
 * @returns Its address and credentials, or null when none is named.
 */
export function platformMqttOf(config: HubConfig): PlatformMqtt | null {
  if (config.NEBULA_MQTT_URL === undefined) {
    return null;
  }

  return {
    url: config.NEBULA_MQTT_URL,
    ...(config.NEBULA_MQTT_USERNAME === undefined ? {} : { username: config.NEBULA_MQTT_USERNAME }),
    ...(config.NEBULA_MQTT_PASSWORD === undefined ? {} : { password: config.NEBULA_MQTT_PASSWORD }),
  };
}
