/**
 * Reusable environment-variable schemas that services compose into their own configuration.
 *
 * A service declares its configuration by intersecting the fragments it needs with its own
 * variables, so that `DATABASE_URL` means the same thing and is validated the same way in
 * `core`, `api` and `logger` rather than three times, three ways.
 *
 * Every variable defined here has a matching entry in `.env.example`, per RULES.md 11.
 */
import path from 'node:path';

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

/**
 * Variables read by the services that seal or open secrets stored in the registry.
 *
 * One key for the whole installation, shared by `api` (which seals what an owner types) and
 * `hub` (which opens it to connect). Generated once with `openssl rand -hex 32` and never
 * rotated casually: a value sealed under one key cannot be opened under another, and every
 * stored secret would have to be typed again.
 */
export const secretsEnvSchema = z.object({
  NEBULA_SECRETS_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'Must be 64 hexadecimal characters (openssl rand -hex 32)'),
});

/**
 * Variables read by the services that reach the house's MQTT broker: `hub`, whose integrations
 * speak it, and the supervisor, which hands it to the containers an integration runs.
 *
 * The house's broker is the `mqtt` package, which `hub` and the supervisor ask over the bus for a
 * username of their own; these variables name an external broker to use instead, and are unset
 * otherwise. An installation without a broker runs every integration that does not need one.
 */
export const mqttEnvSchema = z.object({
  NEBULA_MQTT_URL: urlWithScheme(['mqtt:', 'mqtts:']).optional(),
  NEBULA_MQTT_USERNAME: z.string().min(1).max(128).optional(),
  NEBULA_MQTT_PASSWORD: z.string().min(1).max(512).optional(),
});

/**
 * Variables read by the services that keep files: where the data directory is.
 *
 * Absolute, because a relative path would be resolved against the working directory, which in
 * development is each service's own package and so a different place for every service. Absent,
 * `resolveDataLayout` falls back to the repository's `infra/data` - which is only right outside
 * production, so a service schema that composes this also applies
 * {@link requireDataDirInProduction}.
 */
export const dataEnvSchema = z.object({
  NEBULA_DATA_DIR: z
    .string()
    .min(1)
    .refine((value) => path.isAbsolute(value), 'Must be an absolute path')
    .optional(),
});

/**
 * Refuses a production service that was not told where its data directory is.
 *
 * Without it the fallback would be a directory inside the image, and everything written there
 * would be lost with the container the next time it is recreated - silently, which is the part
 * worth a startup failure. Applied last to a service schema, with `superRefine`, because it reads
 * two fragments at once and zod does not extend an object schema that already carries a
 * refinement.
 *
 * @param config - The parsed environment: the runtime fragment and the data fragment.
 * @param config.NODE_ENV - The environment the service runs in.
 * @param config.NEBULA_DATA_DIR - The data directory, when one was given.
 * @param context - Where the issue is reported.
 */
export function requireDataDirInProduction(
  config: { readonly NODE_ENV: NodeEnvironment; readonly NEBULA_DATA_DIR?: string | undefined },
  context: z.RefinementCtx,
): void {
  if (config.NODE_ENV === 'production' && config.NEBULA_DATA_DIR === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['NEBULA_DATA_DIR'],
      message: 'Required in production: without it the data would be kept inside the container',
    });
  }
}
