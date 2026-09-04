/**
 * What `core` reads from the environment.
 *
 * Composed from the shared fragments in `@nebula-home/config` plus the handful of variables only
 * this service has. Anything an owner can change while the system runs belongs in
 * `system.settings` instead; the environment is for what is fixed for the life of a process
 * (RULES.md 11).
 */
import { busEnvSchema, databaseEnvSchema, runtimeEnvSchema } from '@nebula-home/config';
import { z } from 'zod';

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
  });

/** Everything `core` needs from the environment. */
export type CoreConfig = z.output<typeof coreEnvSchema>;
