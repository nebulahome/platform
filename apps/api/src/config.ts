/**
 * What `api` reads from the environment.
 *
 * Composed from the shared fragments in `@nebulahome/config` plus what only this service has.
 * The signing key is the one entry with no default: a service that invents its own secret when
 * none is configured issues tokens that stop verifying the moment it restarts, and does it
 * silently.
 */
import { z } from 'zod';

import {
  busEnvSchema,
  databaseEnvSchema,
  dataEnvSchema,
  portSchema,
  requireDataDirInProduction,
  runtimeEnvSchema,
  secretsEnvSchema,
} from '@nebulahome/config';

/** Name this service reports in log records and bus envelopes. */
export const SERVICE_NAME = 'api';

/**
 * Version this build reports on every log record.
 *
 * Kept in step with `package.json` by hand, as in every other service.
 */
export const SERVICE_VERSION = '0.0.0';

/** Everything `api` needs from the environment. */
export const apiEnvSchema = runtimeEnvSchema
  .extend(databaseEnvSchema.shape)
  .extend(busEnvSchema.shape)
  .extend(secretsEnvSchema.shape)
  .extend({
    /** The port the HTTP server listens on. */
    API_PORT: portSchema(4000),

    /**
     * The interface to bind.
     *
     * Loopback by default: in the deployment ARCHITECTURE.md 14 describes, `proxy` is the only
     * thing in front of `api`, and a gateway that binds every interface out of the box is one
     * misconfigured firewall away from being the front door itself.
     */
    API_HOST: z.string().min(1).default('127.0.0.1'),

    /**
     * The secret access tokens are signed with.
     *
     * At least 32 characters, because HS256 with a short key is a password, not a key. Rotating
     * it invalidates every access token immediately, which is the intended emergency lever;
     * refresh tokens survive it, since they are opaque database rows rather than signed claims.
     */
    API_JWT_SECRET: z.string().min(32),

    /**
     * The key TOTP secrets are encrypted with at rest, as 64 hex characters.
     *
     * Separate from the JWT secret on purpose: one signs short-lived tokens and can be rotated
     * freely, the other decrypts stored secrets and cannot be rotated without re-enrolling
     * every user.
     */
    API_TOTP_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'Must be 64 hex characters'),

    /** Origins the browser client may call from. Comma-separated; empty means same-origin only. */
    API_CORS_ORIGINS: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),

    /** How many requests one client may make in {@link API_RATE_LIMIT_WINDOW_MS}. */
    API_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100_000).default(300),

    /** The window the rate limit counts over, in milliseconds. */
    API_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(3_600_000).default(60_000),

    /**
     * How many sign-in attempts one address may make per minute.
     *
     * Far tighter than the general limit: every other endpoint needs a token to be worth
     * attacking, and this one is where a password is guessed.
     */
    API_LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(1000).default(10),

    /** How long a request to another service may take before it is given up on. */
    API_BUS_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(5000),

    /** The largest request body accepted, in bytes. */
    API_BODY_LIMIT_BYTES: z.coerce.number().int().min(1024).max(52_428_800).default(1_048_576),

    /**
     * Where map tiles come from, with `{z}`, `{x}` and `{y}` where the tile goes.
     *
     * OpenStreetMap's own servers by default, which are run by volunteers for light use: the
     * service says who it is, fetches only the buffer around the house, and never in bulk. An
     * installation that draws many maps, or wants another style, points this elsewhere.
     */
    API_MAP_TILE_URL: z
      .url()
      .refine((template) => ['{z}', '{x}', '{y}'].every((slot) => template.includes(slot)), {
        message: 'Must contain {z}, {x} and {y}',
      })
      .default('https://tile.openstreetmap.org/{z}/{x}/{y}.png'),
  })
  // The data directory, whose `cache/maps` keeps the map around the house for when the internet
  // is away.
  .extend(dataEnvSchema.shape)
  .superRefine(requireDataDirInProduction);

/** Everything `api` needs from the environment. */
export type ApiConfig = z.output<typeof apiEnvSchema>;
