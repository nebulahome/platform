// @ts-check
/**
 * Finding Govee lights: the LAN API's own scan.
 *
 * Govee lights do not announce themselves over mDNS. They answer a scan: one JSON datagram to the
 * multicast group 239.255.255.250 on port 4001, which every light with LAN Control on answers, on
 * port 4002, with its address, its id and its model. That is the question the protocol exists to
 * be asked - no address is swept - and it is asked when listening starts, every few minutes
 * after for the lights switched on in the meantime, and whenever the owner asks to look now.
 *
 * What a light answers is reported as it is; which driver takes it, and as which model, is the
 * vendor's `discovery.json` and not this module's to decide.
 */
import { acquire, addressOf, SCAN_GROUP, SCAN_PORT } from './socket.js';

/** @typedef {import('@nebulahome/package-runtime').BundleSdk} BundleSdk */
/** @typedef {import('@nebulahome/package-runtime').DiscoverySource} DiscoverySource */
/** @typedef {import('@nebulahome/package-runtime').Sighting} Sighting */
/** @typedef {import('@nebulahome/contracts').JsonObject} JsonObject */

/** How often the scan is asked again. */
const SCAN_INTERVAL_MS = 5 * 60_000;

/**
 * Makes the listener.
 *
 * @param {BundleSdk} sdk - What the hub hands a bundle.
 * @returns {DiscoverySource} The listener.
 */
export default function createGoveeDiscovery(sdk) {
  /** @type {(() => void) | undefined} */
  let askNow;

  return {
    /**
     * Scans, and reports every light that answers, until told to stop.
     *
     * @param {AbortSignal} signal - Ends the listening.
     * @yields {Sighting} Each light, each time it answers.
     */
    listen: async function* listen(signal) {
      /** @type {Sighting[]} */
      const heard = [];
      /** @type {(() => void) | undefined} */
      let wake;
      const link = acquire(sdk, (answer, from) => {
        if (answer.cmd === 'scan') {
          /** @type {JsonObject} */
          const payload = JSON.parse(JSON.stringify(answer.data));

          heard.push({ config: { host: addressOf(answer, from) }, payload });
          wake?.();
        }
      });
      /** Asks every light on the network who it is. */
      const scan = () => {
        link
          .send({ cmd: 'scan', data: { account_topic: 'reserve' } }, SCAN_GROUP, SCAN_PORT)
          .catch((error) => {
            sdk.logger.debug({ err: error }, 'Could not send the Govee scan');
          });
      };
      const timer = setInterval(scan, SCAN_INTERVAL_MS);

      timer.unref();
      askNow = scan;
      scan();

      try {
        while (!signal.aborted) {
          const next = heard.shift();

          if (next !== undefined) {
            yield next;
            continue;
          }

          // One wait at a time, by design: the next answer, or the end of listening.
          // eslint-disable-next-line no-await-in-loop -- see above
          await new Promise((resolve) => {
            /** Wakes the loop for the answer that just arrived, or for the end. */
            wake = () => {
              resolve(undefined);
            };
            signal.addEventListener('abort', wake, { once: true });
          });
          wake = undefined;
        }
      } finally {
        clearInterval(timer);
        askNow = undefined;
        await link.release();
      }
    },

    /**
     * Asks every light again now, while listening; answers arrive through `listen`.
     */
    scan: () => {
      askNow?.();
    },
  };
}
