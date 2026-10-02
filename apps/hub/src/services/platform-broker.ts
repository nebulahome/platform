/**
 * The house's MQTT broker, as the hub reaches it: `sdk.platform.mqtt` for the bundles that
 * speak to it - Zigbee2MQTT (PACKAGES.md 2, 13).
 *
 * The broker is whichever package provides `mqtt-broker` - the `mqtt` package, unless another
 * stands in - found on the packet-manager's list. It runs beside the hub and makes it a username
 * of its own the first time it is asked (`svc.<package>.credentials`); a bundle reads the answer
 * each time it opens a session. The hub asks when it starts, at every package event - one
 * installed, started, stopped, configured with another port - and again every little while as long
 * as it has no broker, since the broker may come up after the hub with nothing more to say. A
 * broker the environment names (`NEBULA_MQTT_URL`) - an external one, the tests' - is used
 * instead, and nothing is asked.
 */
import type { BusClient, BusSubscription } from '@nebulahome/bus';
import {
  BUS_PATTERNS,
  busSubjects,
  jsonObjectSchema,
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

/** How often the broker is asked for again while there is none. */
const RETRY_MS = 15_000;

/** What the broker needs. */
export type PlatformBrokerOptions = {
  readonly client: BusClient;
  readonly logger: PlatformLogger;

  /** The broker the environment names; null to ask the package that provides one. */
  readonly fixed: PlatformMqtt | null;

  /** How often to ask again while there is no broker; fifteen seconds when not said. */
  readonly retryMs?: number;
};

/** The broker the bundles reach. */
export class PlatformBroker {
  readonly #options: PlatformBrokerOptions;
  #current: PlatformMqtt | null;
  #subscription: BusSubscription | undefined;
  #retry: NodeJS.Timeout | undefined;

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
   * Asks for the broker, and keeps asking: at every package event, and every little while as long
   * as there is none.
   *
   * @returns Once asked the first time.
   */
  public async start(): Promise<void> {
    if (this.#options.fixed !== null) {
      return;
    }

    this.#subscription = this.#options.client.subscribe(
      BUS_PATTERNS.allPackageEvents,
      jsonObjectSchema,

      /** Asks again: a package was installed, started, stopped, configured or removed. */
      (): void => {
        void this.refresh();
      },
    );
    await this.refresh();
  }

  /** Stops asking. */
  public stop(): void {
    this.#subscription?.unsubscribe();
    this.#subscription = undefined;
    clearTimeout(this.#retry);
    this.#retry = undefined;
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
        this.#retryWhileMissing();

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

    this.#retryWhileMissing();
  }

  /** Asks again in a while, as long as there is no broker and the hub listens for one. */
  #retryWhileMissing(): void {
    clearTimeout(this.#retry);
    this.#retry = undefined;

    if (this.#current !== null || this.#subscription === undefined) {
      return;
    }

    this.#retry = setTimeout(() => {
      void this.refresh();
    }, this.#options.retryMs ?? RETRY_MS);
    this.#retry.unref();
  }
}
