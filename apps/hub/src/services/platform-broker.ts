/**
 * The house's MQTT broker, as the hub reaches it: `sdk.platform.mqtt` for the bundles that
 * speak to it - Zigbee2MQTT (PACKAGES.md 13).
 *
 * The broker is `pkg-mqtt`, which runs beside the hub and makes it a username of its own the
 * first time it is asked (`svc.mqtt.credentials`); the hub asks when it starts and whenever a
 * package starts or stops, and a bundle reads the answer each time it opens a session. A broker
 * the environment names (`NEBULA_MQTT_URL`) - an external one, the tests' - is used instead, and
 * nothing is asked.
 */
import { z } from 'zod';

import type { BusClient } from '@nebulahome/bus';
import { busSubjects } from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';
import type { PlatformMqtt } from '@nebulahome/package-runtime';

/** What `svc.mqtt.credentials` answers. */
const credentialsReplySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  port: z.int().min(1).max(65_535),
});

/** How long the broker has to answer: the hub starts without it. */
const TIMEOUT_MS = 2000;

/** What the broker needs. */
export type PlatformBrokerOptions = {
  readonly client: BusClient;
  readonly logger: PlatformLogger;

  /** The broker the environment names; null to ask `pkg-mqtt`. */
  readonly fixed: PlatformMqtt | null;
};

/** The broker the bundles reach. */
export class PlatformBroker {
  readonly #options: PlatformBrokerOptions;
  #current: PlatformMqtt | null;

  /**
   * Keeps the options.
   *
   * @param options - See {@link PlatformBrokerOptions}.
   */
  public constructor(options: PlatformBrokerOptions) {
    this.#options = options;
    this.#current = options.fixed;
  }

  /**
   * The broker, as a bundle reaches it now.
   *
   * @returns It, or null while there is none.
   */
  public get current(): PlatformMqtt | null {
    return this.#current;
  }

  /**
   * Asks `pkg-mqtt` for the hub's username again.
   *
   * @returns Once answered, or given up on: the last answer stands until the next.
   */
  public async refresh(): Promise<void> {
    if (this.#options.fixed !== null) {
      return;
    }

    try {
      const reply = await this.#options.client.request(
        busSubjects.service('mqtt', 'credentials'),
        { principal: 'hub' },
        credentialsReplySchema,
        { timeoutMs: TIMEOUT_MS },
      );

      this.#current = {
        url: `mqtt://127.0.0.1:${String(reply.port)}`,
        username: reply.username,
        password: reply.password,
      };
    } catch (error: unknown) {
      this.#options.logger.debug({ err: error }, 'The MQTT broker did not answer');
    }
  }
}
