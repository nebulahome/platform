/**
 * What `hub` reads from the environment.
 *
 * Composed from the shared fragments in `@nebula-home/config` plus the handful of variables only
 * this service has. Anything an owner can change while the system runs belongs in
 * `registry.integrations` or `system.settings` instead; the environment is for what is fixed for
 * the life of a process (RULES.md 11).
 */
import { z } from 'zod';

import {
  busEnvSchema,
  databaseEnvSchema,
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
    /** Where integration bundles are installed. Missing is normal on a fresh installation. */
    HUB_BUNDLE_DIR: z.string().min(1).default('./bundles'),

    /**
     * How long a device has to accept a command.
     *
     * Shorter than the timeout `core` gives `hub`, so that a device that will not answer is
     * reported as unavailable by the service that actually knows, rather than surfacing as a
     * bus timeout that names nothing.
     */
    HUB_COMMAND_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(4000),

    /** How long a discovery pass runs when the caller does not say. */
    HUB_DISCOVERY_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300_000).default(30_000),
  });

/** Everything `hub` needs from the environment. */
export type HubConfig = z.output<typeof hubEnvSchema>;
