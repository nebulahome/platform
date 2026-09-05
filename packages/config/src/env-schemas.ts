/**
 * Reusable environment-variable schemas that services compose into their own configuration.
 *
 * A service declares its configuration by intersecting the fragments it needs with its own
 * variables, so that `DATABASE_URL` means the same thing and is validated the same way in
 * `core`, `api` and `logger` rather than three times, three ways.
 *
 * Every variable defined here has a matching entry in `.env.example`, per RULES.md 11.
 */
import { z } from 'zod';

import { LOG_LEVELS } from '@nebula-home/contracts';

/** The environments a service can run in. */
export const NODE_ENVIRONMENTS = ['development', 'test', 'production'] as const;

/** The environment a service is running in. */
export type NodeEnvironment = (typeof NODE_ENVIRONMENTS)[number];

/**
 * Builds a schema for a URL that must use one of the given schemes.
 *
 * Validating the scheme and not merely the syntax turns a whole class of startup failure into a
 * readable message: pointing `DATABASE_URL` at an `http://` address fails here, naming the
 * variable, instead of surfacing later as an opaque driver error.
 *
 * @param schemes - Accepted URL schemes, each written with its trailing colon, as `URL` reports them.
 * @returns A string schema that accepts only absolute URLs using one of those schemes.
 */
export function urlWithScheme(schemes: readonly string[]): z.ZodType<string> {
  return z.string().refine(
    (value) => {
      try {
        return schemes.includes(new URL(value).protocol);
      } catch {
        // An unparseable string is simply not a URL; the message below says so.
        return false;
      }
    },
    { message: `Must be a URL using one of these schemes: ${schemes.join(', ')}` },
  );
}

/**
 * Builds a schema for a TCP port supplied as an environment variable.
 *
 * Environment variables are always strings, so the value is coerced before being range-checked.
 *
 * @param defaultPort - Port used when the variable is absent.
 * @returns A schema producing a valid, non-privileged-checked port number.
 */
export function portSchema(defaultPort: number): z.ZodType<number> {
  return z.coerce.number().int().min(1).max(65_535).default(defaultPort);
}

/** Variables every service reads, whatever else it needs. */
export const runtimeEnvSchema = z.object({
  NODE_ENV: z.enum(NODE_ENVIRONMENTS).default('development'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
});

/** Variables read by the services that hold a database connection. */
export const databaseEnvSchema = z.object({
  DATABASE_URL: urlWithScheme(['postgres:', 'postgresql:']),
});

/** Variables read by every service that attaches to the message bus. */
export const busEnvSchema = z.object({
  NATS_URL: urlWithScheme(['nats:', 'tls:']),
});
