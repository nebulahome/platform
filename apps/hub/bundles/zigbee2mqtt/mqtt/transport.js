// @ts-check
/**
 * Zigbee2MQTT on the platform's broker.
 *
 * Why a transport of its own rather than the platform's `mqtt`: there a device is the topic it
 * reports on, so a device's state and its availability would be two devices, and a renamed device
 * would be a new one. Here one session to the broker - shared by every Zigbee device and the
 * bridge, under their base topic - hears everything Zigbee2MQTT publishes, and hands each message
 * to the device it is about by IEEE address, the one name a Zigbee device keeps:
 *
 * - `bridge` gets what the bridge says of itself: whether it is online, its `info`, how many
 *   devices it knows;
 * - a device gets `{ kind: 'state', state }`, `{ kind: 'availability', isOnline }`, and
 *   `{ kind: 'definition', device }` whenever the bridge lists the devices again.
 *
 * Commands go back by IEEE address, which Zigbee2MQTT accepts in place of a friendly name:
 * `set` and `get` to `<base>/<ieee>/set|get`, `permit_join` and `ota_update` to the bridge.
 *
 * This file imports nothing from the platform: the broker, the session and zod come in the SDK.
 */
import {
  bridgeSighting,
  bridgeStateOf,
  deviceSighting,
  devicesOf,
  isOnline,
  isOfferable,
  readPayload,
  topicOf,
} from './topics.js';

/** @typedef {import('@nebula-home/package-runtime').BundleSdk} BundleSdk */
/** @typedef {import('@nebula-home/package-runtime').Discovered} Discovered */
/** @typedef {import('@nebula-home/package-runtime').ManagedMqtt} ManagedMqtt */
/** @typedef {import('@nebula-home/package-runtime').PlatformMqtt} PlatformMqtt */
/** @typedef {import('@nebula-home/package-runtime').Transport} Transport */
/** @typedef {import('@nebula-home/package-runtime').TransportConnection} TransportConnection */
/** @typedef {import('@nebula-home/package-runtime').TransportContext} TransportContext */
/** @typedef {import('@nebula-home/package-runtime').TransportRequest} TransportRequest */
/** @typedef {import('@nebula-home/package-runtime').TransportSubscription} TransportSubscription */
/** @typedef {import('./topics.js').BridgeDevice} BridgeDevice */
/** @typedef {import('./topics.js').BridgeSnapshot} BridgeSnapshot */

/**
 * What a device's configuration holds: only where Zigbee2MQTT speaks, the broker being the
 * platform's.
 *
 * @typedef {object} Config
 * @property {string} baseTopic - `zigbee2mqtt` unless the owner changed it in Zigbee2MQTT.
 */

/** The device key the bridge is delivered under. */
export const BRIDGE_KEY = 'bridge';

/** How long a probe waits for the bridge to say something. */
const PROBE_WAIT_MS = 5000;

/**
 * The platform's broker, or a sentence saying there is none.
 *
 * @param {BundleSdk} sdk - The SDK.
 * @returns {PlatformMqtt} The broker.
 * @throws {Error} When the installation has no broker.
 */
function brokerOf(sdk) {
  const broker = sdk.platform.mqtt;

  if (broker === null) {
    throw new Error('This installation has no MQTT broker for Zigbee2MQTT (NEBULA_MQTT_URL)');
  }

  return broker;
}

/**
 * Opens a session to the platform's broker.
 *
 * @param {BundleSdk} sdk - The SDK.
 * @param {string} purpose - What the session is for, in its client id.
 * @param {Omit<import('@nebula-home/package-runtime').ManagedMqttOptions, 'url' | 'logger'>} handlers
 *   - What to call.
 * @returns {ManagedMqtt} The session, connecting.
 */
export function openBroker(sdk, purpose, handlers) {
  const broker = brokerOf(sdk);

  return sdk.openMqtt({
    url: broker.url,
    clientId: `nebulahome-z2m-${purpose}-${Math.random().toString(36).slice(2, 10)}`,
    ...(broker.username === undefined ? {} : { username: broker.username }),
    ...(broker.password === undefined ? {} : { password: broker.password }),
    logger: sdk.logger,
    ...handlers,
  });
}

/**
 * Builds the transport.
 *
 * @param {BundleSdk} sdk - What the hub hands a vendor's code.
 * @returns {Transport} `zigbee2mqtt/mqtt`.
 */
export default function createZigbee2MqttTransport(sdk) {
  const { z } = sdk;
  const configSchema = z.object({
    baseTopic: z
      .string()
      .regex(/^[A-Za-z0-9_-][A-Za-z0-9_/-]{0,63}$/u)
      .default('zigbee2mqtt'),
  });

  /**
   * Opens one session for every device on a base topic.
   *
   * @param {Config} config - The base topic.
   * @param {TransportContext} context - Where messages and the link's state go.
   * @returns {Promise<TransportConnection>} The connection.
   */
  async function connect(config, context) {
    const base = config.baseTopic;
    const key = connectionKey(config);

    /** @type {Map<string, string>} */
    const ieeeByName = new Map();

    /** @type {BridgeSnapshot} */
    const bridge = { state: null, info: null, deviceCount: 0 };

    /** @type {readonly TransportSubscription[]} */
    let standing = [];

    /**
     * Hands one message on to the device it is about.
     *
     * @param {string} deviceKey - The IEEE address, or the bridge's key.
     * @param {unknown} payload - What to hand on.
     */
    const deliver = (deviceKey, payload) => {
      context.deliver({ connectionKey: key, deviceKey, payload });
    };

    const session = openBroker(sdk, 'link', {
      /** Asks every device the instances want read afresh, now that the link is up. */
      onConnect: () => {
        context.report('up');
        void refresh();
      },

      /**
       * Reads one message.
       *
       * @param {string} topic - Where it arrived.
       * @param {Buffer} payload - What it said.
       */
      onMessage: (topic, payload) => {
        if (!topic.startsWith(`${base}/`)) {
          return;
        }

        const about = topicOf(topic.slice(base.length + 1), ieeeByName);
        const value = readPayload(payload);

        if (about === null) {
          return;
        }

        if (about.kind === 'state') {
          deliver(about.ieee, { kind: 'state', state: value });

          return;
        }

        if (about.kind === 'availability') {
          const online = isOnline(value);

          if (online !== null) {
            deliver(about.ieee, { kind: 'availability', isOnline: online });
          }

          return;
        }

        if (about.what === 'state') {
          bridge.state = bridgeStateOf(value);
        } else if (about.what === 'info' && typeof value === 'object' && value !== null) {
          bridge.info = /** @type {Record<string, unknown>} */ (value);
        } else if (about.what === 'devices') {
          const devices = devicesOf(value);

          ieeeByName.clear();

          for (const device of devices) {
            ieeeByName.set(device.friendly_name, device.ieee_address);
            deliver(device.ieee_address, { kind: 'definition', device });
          }

          bridge.deviceCount = devices.filter((device) => device.type !== 'Coordinator').length;
        } else {
          return;
        }

        deliver(BRIDGE_KEY, { ...bridge });
      },

      /** Says the link is down; the session comes back by itself. */
      onClose: () => {
        context.report('down');
      },
    });

    // Everything under the base topic: a friendly name may hold slashes, and `+` would miss it.
    session.subscribe(`${base}/#`);

    /**
     * Asks the devices the instances want read for their state, which Zigbee2MQTT does not keep
     * on the broker, so that a device that reports only on change is not unknown until then.
     */
    async function refresh() {
      for (const subscription of standing) {
        if (subscription.op !== 'refresh' || !session.isConnected) {
          continue;
        }

        const { ieee, payload } = subscription.args;

        if (typeof ieee === 'string' && typeof payload === 'object' && payload !== null) {
          // eslint-disable-next-line no-await-in-loop -- one device after another, not a burst on the radio
          await session.publish(`${base}/${ieee}/get`, JSON.stringify(payload)).catch(() => {
            // The device answers the next time it reports; a get lost here costs nothing.
          });
        }
      }
    }

    return {
      key,

      /**
       * Sends a command.
       *
       * @param {TransportRequest} request - What to do, to which device.
       * @returns {Promise<null>} Nothing: Zigbee2MQTT answers by publishing the new state.
       */
      send: async (request) => {
        const payload = request.args['payload'] ?? {};

        switch (request.op) {
          case 'set':
          case 'get': {
            await session.publish(
              `${base}/${request.deviceKey}/${request.op}`,
              JSON.stringify(payload),
            );
            break;
          }

          case 'permit_join': {
            await session.publish(
              `${base}/bridge/request/permit_join`,
              JSON.stringify({ time: Number(request.args['time'] ?? 0) }),
            );
            break;
          }

          case 'ota_update': {
            await session.publish(
              `${base}/bridge/request/device/ota_update/update`,
              JSON.stringify({ id: request.deviceKey }),
            );
            break;
          }

          default: {
            throw new Error(`zigbee2mqtt/mqtt does not do ${request.op}`);
          }
        }

        return null;
      },

      /**
       * Takes in what the instances want read; the session already hears everything.
       *
       * @param {readonly TransportSubscription[]} subscriptions - What they want.
       */
      apply: async (subscriptions) => {
        standing = subscriptions;
        await refresh();
      },

      /**
       * Closes the session.
       *
       * @returns {Promise<void>} Once it is closed.
       */
      close: async () => session.close(),
    };
  }

  /**
   * One connection per broker and base topic.
   *
   * @param {Config} config - The base topic.
   * @returns {string} The key.
   */
  function connectionKey(config) {
    return `zigbee2mqtt:${sdk.platform.mqtt?.url ?? 'none'}:${config.baseTopic}`;
  }

  /**
   * Lists the bridge and every device it knows, as they are retained on the broker, then keeps
   * listening until told to stop - for a device paired while identification listens.
   *
   * @param {Config} config - The base topic.
   * @param {unknown} terms - Unused: everything under the base topic is looked at.
   * @param {AbortSignal} signal - Ends the scan.
   * @yields {Discovered} The bridge and the devices, as they are heard.
   */
  async function* scan(config, terms, signal) {
    /** @type {Discovered[]} */
    const found = [];

    /** @type {(() => void) | null} */
    let wake = null;
    const base = config.baseTopic;
    const session = openBroker(sdk, 'scan', {
      /**
       * Queues what the bridge lists.
       *
       * @param {string} topic - Where it arrived.
       * @param {Buffer} payload - What it said.
       */
      onMessage: (topic, payload) => {
        const value = readPayload(payload);

        if (topic === `${base}/bridge/devices`) {
          for (const device of devicesOf(value).filter(isOfferable)) {
            found.push({ deviceKey: device.ieee_address, payload: deviceSighting(device) });
          }
        } else if (topic === `${base}/bridge/info` && typeof value === 'object' && value !== null) {
          const sighting = bridgeSighting(/** @type {Record<string, unknown>} */ (value));

          if (sighting !== null) {
            found.push({ deviceKey: BRIDGE_KEY, payload: sighting });
          }
        }

        wake?.();
      },
    });

    session.subscribe(`${base}/bridge/devices`);
    session.subscribe(`${base}/bridge/info`);

    /**
     * Wakes the loop, which then sees the signal ended.
     *
     * @returns {void} Nothing.
     */
    const stop = () => wake?.();

    signal.addEventListener('abort', stop, { once: true });

    try {
      while (!signal.aborted) {
        const next = found.shift();

        if (next !== undefined) {
          yield next;
          continue;
        }

        // One message after another: the next is waited for until the broker delivers it.
        // eslint-disable-next-line no-await-in-loop -- see above
        await new Promise((resolve) => {
          /** Lets the loop take the next message. */
          wake = () => {
            wake = null;
            resolve(undefined);
          };
        });
      }
    } finally {
      signal.removeEventListener('abort', stop);
      await session.close();
    }
  }

  /**
   * Says whether Zigbee2MQTT answers on the broker.
   *
   * @param {Config} config - The base topic.
   * @param {AbortSignal} signal - Ends the wait.
   * @returns {Promise<string>} What answered.
   * @throws {Error} When the broker cannot be reached, or the bridge says nothing.
   */
  async function probe(config, signal) {
    const base = config.baseTopic;

    return new Promise((resolve, reject) => {
      /** @type {ManagedMqtt | null} */
      let session = null;
      const timer = setTimeout(() => {
        finish(
          new Error(
            `The broker answers, but Zigbee2MQTT has said nothing on ${base}/bridge: is its container running?`,
          ),
        );
      }, PROBE_WAIT_MS);

      /**
       * Settles once, closing the session.
       *
       * @param {string | Error} outcome - The answer, or why there is none.
       */
      function finish(outcome) {
        clearTimeout(timer);
        signal.removeEventListener('abort', abandon);
        void session?.close();

        if (outcome instanceof Error) {
          reject(outcome);
        } else {
          resolve(outcome);
        }
      }

      /** Gives up when the caller does. */
      function abandon() {
        finish(new Error('The probe was given up on'));
      }

      signal.addEventListener('abort', abandon, { once: true });

      try {
        session = openBroker(sdk, 'probe', {
          /**
           * Waits for the bridge's info.
           *
           * @param {string} topic - Where it arrived.
           * @param {Buffer} payload - What it said.
           */
          onMessage: (topic, payload) => {
            const info = readPayload(payload);

            if (topic === `${base}/bridge/info` && typeof info === 'object' && info !== null) {
              const version = /** @type {Record<string, unknown>} */ (info)['version'];

              finish(
                `Zigbee2MQTT ${typeof version === 'string' ? version : ''} answers on ${base}`,
              );
            }
          },
        });
        session.subscribe(`${base}/bridge/info`);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  return sdk.defineTransport({
    id: 'zigbee2mqtt/mqtt',
    configSchema,
    connectionKey,
    connect,
    scan,
    probe,
  });
}
