// @ts-check
/**
 * Finding the robots on the ECOVACS accounts the owner connected: every GOAT mower and DEEBOT
 * vacuum bound to each.
 *
 * The accounts are read at every pass (`context.accounts`), so one connected is heard without the
 * hub starting the listener again - and at once, since connecting one asks the vendor to look
 * (`scan`). Each robot is reported with the account it is on, which is what its device remembers
 * (`config.account`), and added on its own (`"adopt": "automatic"` in `discovery.json`): the
 * robots on the account are the ones the owner has.
 *
 * A robot this bundle does not drive - an AIRBOT, a WINBOT - is not reported: the vendor's page
 * lists it among those seen and not added, with why (`context.passedOver`).
 *
 * Each account is asked again every ten minutes - a robot bound in the app is found then - and
 * after a failure, every five. The broker is not ECOVACS's LAN, so this runs where the hub hears
 * no multicast too (`"lan": false`).
 */
import { accountFor } from './account.js';
import { robotKindOf } from './models.js';
import { maskedEmail } from './sign-in.js';
import { robotSighting } from './transport.js';

/** @typedef {import('@nebulahome/package-runtime').BundleSdk} BundleSdk */
/** @typedef {import('@nebulahome/package-runtime').DiscoverySource} DiscoverySource */
/** @typedef {import('@nebulahome/package-runtime').PassedOverSighting} PassedOverSighting */
/** @typedef {import('@nebulahome/package-runtime').Sighting} Sighting */
/** @typedef {import('@nebulahome/contracts').JsonObject} JsonObject */

/** How often each account is asked for its robots. */
const PASS_EVERY_MS = 10 * 60_000;

/** How soon after a failure it is asked again. */
const RETRY_AFTER_MS = 5 * 60_000;

/** How soon the accounts are read again while there is none. */
const NONE_AFTER_MS = 60_000;

/**
 * Builds the listener.
 *
 * @param {BundleSdk} sdk - What the hub hands a vendor's code.
 * @param {{ fetch?: typeof fetch }} [options] - For a test: the HTTP client.
 * @returns {DiscoverySource} The listener.
 */
export default function createEcovacsDiscovery(sdk, options = {}) {
  /** The last reason each account failed, so one is logged once. */
  const lastFailures = new Map();

  /** @type {(() => void) | undefined} */
  let wake;

  /**
   * Waits, or stops waiting the moment the signal or a scan says so.
   *
   * @param {number} ms - How long.
   * @param {AbortSignal} signal - Ends the wait.
   * @returns {Promise<void>} Once waited.
   */
  const pause = (ms, signal) =>
    new Promise((resolve) => {
      if (signal.aborted) {
        resolve();

        return;
      }

      const timer = setTimeout(done, ms);

      timer.unref();
      wake = done;

      /** Stops waiting. */
      function done() {
        clearTimeout(timer);
        signal.removeEventListener('abort', done);
        wake = undefined;
        resolve();
      }

      signal.addEventListener('abort', done, { once: true });
    });

  return {
    /**
     * Reports the robots on every account at every pass, until the signal ends it.
     *
     * @param {AbortSignal} signal - Ends the listening.
     * @param {import('@nebulahome/package-runtime').DiscoveryListenContext} context - The
     *   vendor's accounts.
     * @yields {Sighting} Each robot.
     */
    async *listen(signal, context) {
      while (!signal.aborted) {
        // One pass after another, by design: the accounts are asked, then left alone a while.
        // eslint-disable-next-line no-await-in-loop -- see above
        const handles = (await context.accounts?.()) ?? [];

        if (handles.length === 0) {
          context.passedOver?.([]);
          // eslint-disable-next-line no-await-in-loop -- see above
          await pause(NONE_AFTER_MS, signal);
          continue;
        }

        /** @type {PassedOverSighting[]} */
        const passedOver = [];
        let waitMs = PASS_EVERY_MS;

        for (const handle of handles) {
          let devices;

          try {
            // eslint-disable-next-line no-await-in-loop -- one account after another
            devices = await accountFor(handle, options).devices(true);
            lastFailures.delete(handle.id);
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);

            if (lastFailures.get(handle.id) !== reason) {
              lastFailures.set(handle.id, reason);
              sdk.logger.warn(
                { err: error, account: maskedEmail(handle.label) },
                'Could not list the robots on an ECOVACS account',
              );
            }

            waitMs = RETRY_AFTER_MS;
            continue;
          }

          for (const device of devices) {
            const kind = robotKindOf(device);

            if (kind === null) {
              passedOver.push({
                id: device.did,
                name: device.name,
                model: device.deviceName === '' ? null : device.deviceName,
                reason:
                  'Not a GOAT or a DEEBOT: NebulaHome does not drive this kind of ECOVACS robot yet',
              });
              continue;
            }

            yield {
              config: { account: handle.id, did: device.did },
              payload: /** @type {JsonObject} */ (robotSighting(device, kind)),
            };
          }
        }

        context.passedOver?.(passedOver);
        // eslint-disable-next-line no-await-in-loop -- see above
        await pause(waitMs, signal);
      }
    },

    /** Asks the accounts again now: one was connected, or the owner is looking. */
    scan() {
      wake?.();
    },
  };
}
