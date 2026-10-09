/**
 * What `core` reads from the environment.
 *
 * Composed from the shared fragments in `@nebulahome/config` plus the handful of variables only
 * this service has. Anything an owner can change while the system runs belongs in
 * `system.settings` instead; the environment is for what is fixed for the life of a process
 * (RULES.md 11).
 */
import { z } from 'zod';

import {
  busEnvSchema,
  databaseEnvSchema,
  dataEnvSchema,
  requireDataDirInProduction,
  runtimeEnvSchema,
} from '@nebulahome/config';

/** Name this service reports in log records and bus envelopes. */
export const SERVICE_NAME = 'core';

/**
 * Version this build reports on every log record.
 *
 * Kept in step with `package.json` by hand. Importing the manifest would drag a JSON import and
 * a resolution mode into the service's entry point to save one line that changes once a release.
 */
export const SERVICE_VERSION = '0.0.0';

/** Everything `core` needs from the environment. */
export const coreEnvSchema = runtimeEnvSchema
  .extend(databaseEnvSchema.shape)
  .extend(busEnvSchema.shape)
  .extend({
    /**
     * How long an adapter has to accept a command.
     *
     * Bounded at two minutes rather than left open: a longer wait is a device that is not going
     * to answer, and holding the caller's request open for it turns one unreachable lamp into a
     * queue of stuck HTTP requests.
     */
    CORE_COMMAND_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(5000),

    /** How long a partial batch of history rows waits before being written anyway. */
    CORE_HISTORY_FLUSH_INTERVAL_MS: z.coerce.number().int().min(50).max(60_000).default(1000),

    /** How many history rows trigger an immediate write. */
    CORE_HISTORY_BATCH_SIZE: z.coerce.number().int().min(1).max(10_000).default(500),

    /** How many telemetry readings are pulled from the stream at once. */
    CORE_TELEMETRY_BATCH_SIZE: z.coerce.number().int().min(1).max(10_000).default(500),

    /** How often the system monitor samples the machine: the pace the settings page moves at. */
    CORE_SYSTEM_SAMPLE_INTERVAL_MS: z.coerce.number().int().min(1000).max(60_000).default(10_000),

    /**
     * How often the system entities take a new state, averaged over the samples in between.
     *
     * Slower than the sampling on purpose: an automation on "processor above 90%" should not
     * fire on one busy ten-second stretch, and every state is a row of history.
     */
    CORE_SYSTEM_PUBLISH_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .max(3_600_000)
      .default(60_000),

    /**
     * Where Linux keeps the network counters. In a container that is the container's own
     * traffic; mounting the host's `/proc` and pointing this at `<mount>/1/net/dev` measures the
     * machine instead. `route` is read from beside it, to pick the interface the internet is on.
     */
    CORE_NET_DEV_PATH: z.string().min(1).default('/proc/net/dev'),

    /**
     * How long after startup changes wake no automation, at most: the adapters are
     * resynchronising, and a light that changed while `core` was down reporting in is not a light
     * turning on now. Ends early once every adapter has answered.
     */
    CORE_AUTOMATION_STARTUP_GRACE_MS: z.coerce.number().int().min(0).max(300_000).default(15_000),
  })
  // The data directory: `core` writes nothing there, but the system monitor reads the free space
  // of the volume it is on and counts what is in it.
  .extend(dataEnvSchema.shape)
  .superRefine(requireDataDirInProduction);

/** Everything `core` needs from the environment. */
export type CoreConfig = z.output<typeof coreEnvSchema>;
