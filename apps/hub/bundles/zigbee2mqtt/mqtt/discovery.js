// @ts-check
/**
 * Finding what Zigbee2MQTT knows: the bridge, and every device paired with it.
 *
 * Nothing is asked of the network. Zigbee2MQTT keeps `bridge/info` and `bridge/devices` retained
 * on the platform's broker, so listening to them hears the bridge and every device the moment the
 * listener starts, and again whenever a device is paired, renamed or removed. Each is added on its
 * own (`"adopt": "automatic"` in `discovery.json`): a device paired with Zigbee2MQTT is one the
 * owner meant to have. The bridge is known by its coordinator's IEEE address, a device by its own,
 * the model code being which of the two it is - `bridge` or `device` - for the drivers'
 * `modelCodes` to name the driver.
 *
 * The broker is the platform's, not the house's network, so this listener runs where the hub
 * hears no multicast too (`"lan": false` in `discovery.json`).
 *
 * **It says how it is getting on** (`context.status`, since 1.5), because the one way this goes
 * wrong is silently: Zigbee2MQTT and NebulaHome on two different brokers, each fine on its own.
 * Once connected it waits a minute for Zigbee2MQTT to say anything on `bridge/state` and, hearing
 * nothing, says so with the broker it listens on; a broker it cannot reach is said at once. A
 * device Zigbee2MQTT lists and this does not report - still being paired, unsupported, disabled -
 * is said too (`context.passedOver`), with why.
 *
 * There is nothing to look for on demand: new devices come by pairing, which the bridge's
 * _Pairing_ switch opens - the vendor's page offers it (`pairing` in `discovery.json`), and
 * Zigbee2MQTT's own page opens the same.
 */
import {
  bridgeSighting,
  bridgeStateOf,
  deviceSighting,
  devicesOf,
  notOfferedBecause,
  readPayload,
} from './topics.js';
import { openBroker } from './transport.js';

/** @typedef {import('@nebula-home/package-runtime').BundleSdk} BundleSdk */
/** @typedef {import('@nebula-home/package-runtime').DiscoverySource} DiscoverySource */
/** @typedef {import('@nebula-home/package-runtime').DiscoveryListenContext} DiscoveryListenContext */
/** @typedef {import('@nebula-home/package-runtime').Sighting} Sighting */
/** @typedef {import('@nebula-home/contracts').JsonObject} JsonObject */

/** Where Zigbee2MQTT speaks unless the owner changed it. */
const BASE = 'zigbee2mqtt';

/** How long, connected, before hearing nothing of Zigbee2MQTT is said. */
export const SILENCE_WARNING_MS = 60_000;

/**
 * Builds the listener.
 *
 * @param {BundleSdk} sdk - What the hub hands a vendor's code.
 * @param {{ silenceMs?: number }} [options] - How long to wait before saying nothing
 *   was heard; a minute unless a test says otherwise.
 * @returns {DiscoverySource} The listener.
 */
export default function createZigbee2MqttDiscovery(sdk, options = {}) {
  const silenceMs = options.silenceMs ?? SILENCE_WARNING_MS;

  return {
    /**
     * Listens until the signal ends it.
     *
     * @param {AbortSignal} signal - Ends the listening.
     * @param {DiscoveryListenContext} context - Where to say how it is getting on.
     * @yields {Sighting} The bridge and every device ready to add, each time the bridge lists them.
     */
    async *listen(signal, context) {
      const broker = sdk.platform.mqtt;

      if (broker === null) {
        context?.status?.({
          level: 'error',
          message: 'This installation has no MQTT broker, so Zigbee2MQTT cannot be heard.',
        });

        // No broker: nothing to hear. Waiting rather than returning keeps the hub from
        // listening again every few seconds.
        await new Promise((resolve) => {
          signal.addEventListener('abort', () => resolve(undefined), { once: true });
        });

        return;
      }

      /** @type {Sighting[]} */
      const heard = [];

      /** @type {(() => void) | null} */
      let wake = null;

      /** Whether Zigbee2MQTT has said anything since the listener connected. */
      let isHeard = false;

      /** @type {NodeJS.Timeout | null} */
      let silence = null;

      /**
       * Says how listening goes.
       *
       * @param {'ok' | 'warning' | 'error'} level - How it goes.
       * @param {string} message - What to tell the owner.
       */
      const say = (level, message) => {
        context?.status?.({ level, message });
      };

      /** Starts the minute after which hearing nothing is said. */
      const awaitBridge = () => {
        if (silence !== null) {
          clearTimeout(silence);
        }

        silence = setTimeout(() => {
          if (!isHeard) {
            say(
              'warning',
              `NebulaHome is connected to its MQTT broker at ${broker.url} but has heard nothing from Zigbee2MQTT there. Is its container running, and connected to this broker? Its log says which broker it tried.`,
            );
          }
        }, silenceMs);
        silence.unref?.();
      };

      const session = openBroker(sdk, 'discovery', {
        /** Waits for Zigbee2MQTT, now that the broker answers. */
        onConnect: () => {
          if (!isHeard) {
            say('ok', `Listening for Zigbee2MQTT on ${broker.url}`);
            awaitBridge();
          }
        },

        /**
         * Says the broker cannot be reached; the session tries again by itself.
         *
         * @param {string} reason - Why the session dropped.
         */
        onClose: (reason) => {
          if (!signal.aborted) {
            say(
              'error',
              `NebulaHome cannot reach its MQTT broker at ${broker.url} (${reason}), so Zigbee2MQTT cannot be heard. It is tried again every few seconds.`,
            );
          }
        },

        /**
         * Queues what the bridge lists.
         *
         * @param {string} topic - Where it arrived.
         * @param {Buffer} payload - What it said.
         */
        onMessage: (topic, payload) => {
          const value = readPayload(payload);

          if (topic.startsWith(`${BASE}/bridge/`)) {
            isHeard = true;
          }

          if (topic === `${BASE}/bridge/state`) {
            const state = bridgeStateOf(value);

            say(
              state === 'offline' ? 'warning' : 'ok',
              state === 'offline'
                ? 'Zigbee2MQTT says it is offline: its coordinator may be unreachable. Its log says why.'
                : `Zigbee2MQTT is online on ${broker.url}`,
            );
          } else if (topic === `${BASE}/bridge/devices`) {
            /** @type {import('@nebula-home/package-runtime').PassedOverSighting[]} */
            const passedOver = [];

            for (const device of devicesOf(value)) {
              if (device.type === 'Coordinator') {
                continue;
              }

              const reason = notOfferedBecause(device);

              if (reason === null) {
                heard.push({
                  config: {},
                  payload: /** @type {JsonObject} */ (deviceSighting(device)),
                });
              } else {
                const sighting = deviceSighting(device);

                passedOver.push({
                  id: device.ieee_address,
                  name: String(sighting['name']),
                  model: typeof sighting['model'] === 'string' ? sighting['model'] : null,
                  reason,
                });
              }
            }

            context?.passedOver?.(passedOver);
          } else if (
            topic === `${BASE}/bridge/info` &&
            typeof value === 'object' &&
            value !== null
          ) {
            const sighting = bridgeSighting(/** @type {Record<string, unknown>} */ (value));

            if (sighting !== null) {
              heard.push({ config: {}, payload: /** @type {JsonObject} */ (sighting) });
            }
          }

          wake?.();
        },
      });
      session.subscribe(`${BASE}/bridge/state`);
      session.subscribe(`${BASE}/bridge/devices`);
      session.subscribe(`${BASE}/bridge/info`);

      /**
       * Wakes the loop, which then sees the signal ended.
       *
       * @returns {void} Nothing.
       */
      const stop = () => wake?.();

      signal.addEventListener('abort', stop, { once: true });

      try {
        while (!signal.aborted) {
          const next = heard.shift();

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

        if (silence !== null) {
          clearTimeout(silence);
        }

        await session.close();
      }
    },
  };
}
