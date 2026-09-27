/**
 * What the supervisor reads from the environment.
 *
 * No database: what it knows about a container lives in Docker - on the container itself, as
 * labels - and what the registry should say about it, `core` writes when told. The broker,
 * because the containers an integration runs are handed the platform's MQTT broker, and the data
 * directory, because their volumes live in it.
 */
import { z } from 'zod';

import {
  busEnvSchema,
  dataEnvSchema,
  mqttEnvSchema,
  requireDataDirInProduction,
  runtimeEnvSchema,
} from '@nebula-home/config';

/** Name this service reports in log records and bus envelopes. */
export const SERVICE_NAME = 'supervisor';

/**
 * Version this build reports on every log record.
 *
 * Kept in step with `package.json` by hand, as in every other service.
 */
export const SERVICE_VERSION = '0.0.0';

/** Everything the supervisor needs from the environment. */
export const supervisorEnvSchema = runtimeEnvSchema
  .extend(busEnvSchema.shape)
  .extend(mqttEnvSchema.shape)
  .extend({
    /**
     * Where Docker's API is: the socket the container is given with `-v
     * /var/run/docker.sock:/var/run/docker.sock`. Absent from the container, Docker cannot be
     * reached and the containers page says how to give it.
     */
    SUPERVISOR_DOCKER_SOCKET: z.string().min(1).default('/var/run/docker.sock'),

    /** How often every running container is measured. */
    SUPERVISOR_SAMPLE_INTERVAL_MS: z.coerce.number().int().min(2000).max(60_000).default(10_000),

    /** How often the containers' entities take a state: the mean of the samples since. */
    SUPERVISOR_PUBLISH_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(10_000)
      .max(3_600_000)
      .default(60_000),

    /** How often the registries are asked whether a newer image is out. */
    SUPERVISOR_UPDATE_CHECK_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(600_000)
      .max(604_800_000)
      .default(21_600_000),

    /** How long one call to Docker may take, a pull aside. */
    SUPERVISOR_DOCKER_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(15_000),

    /**
     * The network the containers an integration runs are put on, beside the platform's own
     * container when it is on a bridge, so they reach each other by name.
     */
    SUPERVISOR_NETWORK: z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/)
      .default('nebulahome'),

    /** The name the platform's own container answers to on that network. */
    SUPERVISOR_PLATFORM_ALIAS: z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,62}$/)
      .default('nebulahome'),

    /** The time zone handed to the containers an integration runs, as `Europe/Rome`. */
    TZ: z.string().min(1).max(64).default('UTC'),
  })
  .extend(dataEnvSchema.shape)
  .superRefine(requireDataDirInProduction);

/** Everything the supervisor needs from the environment. */
export type SupervisorConfig = z.output<typeof supervisorEnvSchema>;
