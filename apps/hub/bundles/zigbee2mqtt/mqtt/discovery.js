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
 * There is nothing to look for on demand: new devices come by pairing, which the bridge's
 * _Pairing_ switch opens - the vendor's page offers it (`pairing` in `discovery.json`), and
 * Zigbee2MQTT's own page opens the same.
 */
import { bridgeSighting, deviceSighting, devicesOf, isOfferable, readPayload } from './topics.js';
import { openBroker } from './transport.js';

/** @typedef {import('@nebula-home/package-runtime').BundleSdk} BundleSdk */
/** @typedef {import('@nebula-home/package-runtime').DiscoverySource} DiscoverySource */
/** @typedef {import('@nebula-home/package-runtime').Sighting} Sighting */
/** @typedef {import('@nebula-home/contracts').JsonObject} JsonObject */

/** Where Zigbee2MQTT speaks unless the owner changed it. */
const BASE = 'zigbee2mqtt';

/**
 * Builds the listener.
 *
 * @param {BundleSdk} sdk - What the hub hands a vendor's code.
 * @returns {DiscoverySource} The listener.
 */
export default function createZigbee2MqttDiscovery(sdk) {
  return {
    /**
     * Listens until the signal ends it.
     *
     * @param {AbortSignal} signal - Ends the listening.
     * @yields {Sighting} The bridge and every device ready to add, each time the bridge lists them.
     */
    async *listen(signal) {
      if (sdk.platform.mqtt === null) {
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

      const session = openBroker(sdk, 'discovery', {
        /**
         * Queues what the bridge lists.
         *
         * @param {string} topic - Where it arrived.
         * @param {Buffer} payload - What it said.
         */
        onMessage: (topic, payload) => {
          const value = readPayload(payload);

          if (topic === `${BASE}/bridge/devices`) {
            for (const device of devicesOf(value).filter(isOfferable)) {
              heard.push({
                config: {},
                payload: /** @type {JsonObject} */ (deviceSighting(device)),
              });
            }
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
        await session.close();
      }
    },
  };
}
