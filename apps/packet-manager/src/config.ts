/**
 * What `packet-manager` reads from the environment.
 *
 * Its own database role, for `system.packages`; the bus, which its packages are handed too; the
 * instance key, which opens the secrets a package's settings hold before the package is given
 * them; where the packages shipped in the image are, where the package index is, and the runner
 * a `node` package is started with.
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
  urlWithScheme,
} from '@nebula-home/config';

/** Name this service reports in log records and bus envelopes. */
export const SERVICE_NAME = 'packet-manager';

/** Version this build reports on every log record. Kept in step with `package.json` by hand. */
export const SERVICE_VERSION = '0.0.0';

/** The monorepo's `pkgs/`, from where this file is built or run: the system packages in development. */
const DEVELOPMENT_BUILTIN_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../pkgs',
);

/** Everything `packet-manager` needs from the environment. */
export const packetManagerEnvSchema = runtimeEnvSchema
  .extend(databaseEnvSchema.shape)
  .extend(busEnvSchema.shape)
  .extend(secretsEnvSchema.shape)
  .extend({
    /** The packages shipped with the platform: `/app/pkgs` in the image, `platform/pkgs` here. */
    PACKET_MANAGER_BUILTIN_DIR: z.string().min(1).default(DEVELOPMENT_BUILTIN_DIR),

    /**
     * Where the package index is: a static JSON file until the Community Hub serves it. Unset,
     * nothing is offered but the packages the platform ships.
     */
    PACKAGE_INDEX_URL: urlWithScheme(['https:', 'http:']).optional(),

    /** How long the index is trusted before it is read again. */
    PACKET_MANAGER_INDEX_TTL_MS: z.coerce
      .number()
      .int()
      .min(60_000)
      .max(86_400_000)
      .default(21_600_000),

    /**
     * The runner a `node` package is started with: `@nebula-home/package-sdk`'s, resolved from
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
