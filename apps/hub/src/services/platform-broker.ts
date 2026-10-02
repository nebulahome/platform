/**
 * The house's MQTT broker, as the hub reaches it: `sdk.platform.mqtt` for the bundles that
 * speak to it - Zigbee2MQTT (PACKAGES.md 2, 13).
 *
 * The broker is whichever package provides `mqtt-broker` - the `mqtt` package, unless another
 * stands in - found on the packet-manager's list. It runs beside the hub and makes it a username
 * of its own the first time it is asked (`svc.<package>.credentials`); the hub asks when it starts
 * and whenever a package starts or stops, and a bundle reads the answer each time it opens a
 * session. A broker the environment names (`NEBULA_MQTT_URL`) - an external one, the tests' - is
 * used instead, and nothing is asked.
 */
import type { BusClient } from '@nebulahome/bus';
import {
  busSubjects,
  MQTT_BROKER_SERVICE,
  MQTT_CREDENTIALS_METHOD,
  mqttCredentialsReplySchema,
  PACKET_MANAGER_METHODS,
  PACKET_MANAGER_SERVICE,
  packageListReplySchema,
  providerOf,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';
import type { PlatformMqtt } from '@nebulahome/package-runtime';

/** How long the packet-manager and the broker each have to answer: the hub starts without them. */
const TIMEOUT_MS = 2000;

/** What the broker needs. */
export type PlatformBrokerOptions = {
  readonly client: BusClient;
  readonly logger: PlatformLogger;

  /** The broker the environment names; null to ask the package that provides one. */
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
   * Asks the house's broker for the hub's username again.
   *
   * @returns Once answered, or given up on: the last answer stands until the next, and no
   *   package providing a broker any more is no broker.
   */
  public async refresh(): Promise<void> {
    const { client, fixed, logger } = this.#options;

    if (fixed !== null) {
      return;
    }

    try {
      const listed = await client.request(
        busSubjects.service(PACKET_MANAGER_SERVICE, PACKET_MANAGER_METHODS.list),
        {},
        packageListReplySchema,
        { timeoutMs: TIMEOUT_MS },
      );
      const provider = providerOf(
        MQTT_BROKER_SERVICE,
        listed.items.map((item) => ({
          id: item.id,
          provides: item.provides,
          isRunning: item.state === 'running',
        })),
      );

      if (provider === undefined) {
        this.#current = null;

        return;
      }

      const reply = await client.request(
        busSubjects.service(provider, MQTT_CREDENTIALS_METHOD),
        { principal: 'hub' },
        mqttCredentialsReplySchema,
        { timeoutMs: TIMEOUT_MS },
      );

      this.#current = {
        url: `mqtt://127.0.0.1:${String(reply.port)}`,
        username: reply.username,
        password: reply.password,
      };
    } catch (error: unknown) {
      logger.debug({ err: error }, 'The MQTT broker did not answer');
    }
  }
}
