// @ts-check
/**
 * Govee's LAN API, over UDP.
 *
 * A light with **LAN Control** switched on in the Govee app speaks plain JSON datagrams: asked a
 * scan on port 4001 or a status on port 4003, it answers on port 4002 of whoever asked; told
 * `turn`, `brightness` or `colorwc` on port 4003, it does it and says nothing. There is no
 * authentication and no session, so a connection is a hold on the vendor's one socket
 * (`socket.js`) and the timers that ask each light for its status.
 *
 * Two things are translated here rather than in the profile, because they are the wire's and not
 * the device's meaning: the light speaks colour temperature in kelvin and the platform in mireds,
 * one the reciprocal of the other; and the light reports on and off as 1 and 0.
 *
 * This file is what ships in the bundle. It imports nothing from the platform: what it needs
 * - zod, `defineTransport`, the UDP socket - arrives as the `sdk` it is called with.
 */
import { acquire, addressOf, COMMAND_PORT, SCAN_PORT } from './socket.js';

/** @typedef {import('@nebula-home/package-runtime').BundleSdk} BundleSdk */
/** @typedef {import('@nebula-home/package-runtime').Transport} Transport */
/** @typedef {import('@nebula-home/package-runtime').TransportConnection} TransportConnection */
/** @typedef {import('@nebula-home/package-runtime').TransportContext} TransportContext */
/** @typedef {import('@nebula-home/package-runtime').TransportRequest} TransportRequest */
/** @typedef {import('@nebula-home/package-runtime').TransportSubscription} TransportSubscription */
/** @typedef {import('@nebula-home/package-runtime').Discovered} Discovered */
/** @typedef {import('@nebula-home/contracts').JsonObject} JsonObject */
/** @typedef {import('./socket.js').LanMessage} LanMessage */

/**
 * What an owner configures to reach one light.
 *
 * @typedef {object} Config
 * @property {string} host - The light's address.
 * @property {number} timeoutMs - How long it has to answer a scan or a status request.
 */

/** How often a poll may run at most. */
const MIN_POLL_MS = 1000;

/** The warmest and coolest a Govee light goes, in kelvin. */
const KELVIN_RANGE = /** @type {const} */ ([2000, 9000]);

/**
 * Turns kelvin into mireds, and back: the one is a million over the other.
 *
 * @param {number} value - Either.
 * @returns {number} The other, rounded.
 */
function reciprocal(value) {
  return Math.round(1_000_000 / value);
}

/**
 * A number from a request's arguments.
 *
 * @param {JsonObject} args - The arguments.
 * @param {string} key - Which.
 * @returns {number} The number.
 * @throws {Error} When it is not one.
 */
function numberOf(args, key) {
  const value = args[key];

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`govee/lan needs a number for ${key}`);
  }

  return value;
}

/**
 * What a request becomes on the wire.
 *
 * @param {TransportRequest} request - What the profile asked for.
 * @returns {LanMessage} The message.
 * @throws {Error} When the request is not one the LAN API has.
 */
function messageFor(request) {
  const { op, args } = request;

  switch (op) {
    case 'turn':
      return { cmd: 'turn', data: { value: numberOf(args, 'value') === 0 ? 0 : 1 } };
    case 'brightness':
      return {
        cmd: 'brightness',
        data: { value: Math.min(100, Math.max(1, Math.round(numberOf(args, 'value')))) },
      };
    case 'colortemp': {
      const kelvin = reciprocal(numberOf(args, 'mireds'));

      return {
        cmd: 'colorwc',
        data: {
          color: { r: 0, g: 0, b: 0 },
          colorTemInKelvin: Math.min(KELVIN_RANGE[1], Math.max(KELVIN_RANGE[0], kelvin)),
        },
      };
    }
    case 'status':
      return { cmd: 'devStatus', data: {} };
    default:
      throw new Error(
        `govee/lan does not speak ${JSON.stringify(op)}; it speaks turn, brightness, colortemp and status`,
      );
  }
}

/**
 * A status, as the profile reads it: the light's own fields, and the colour temperature in mireds
 * when the light is in white mode.
 *
 * @param {Record<string, unknown>} data - What the light answered.
 * @returns {JsonObject} The status.
 */
function statusOf(data) {
  const kelvin = data['colorTemInKelvin'];
  /** @type {JsonObject} */
  const status = JSON.parse(JSON.stringify(data));

  if (typeof kelvin === 'number' && kelvin > 0) {
    status['mireds'] = reciprocal(kelvin);
  }

  return status;
}

/**
 * Makes the transport.
 *
 * @param {BundleSdk} sdk - What the hub hands a bundle.
 * @returns {Transport} The transport, registered as `govee/lan`.
 */
export default function createGoveeLan(sdk) {
  const { z } = sdk;

  /**
   * Asks one light something on the socket and waits for its first answer of a kind.
   *
   * @param {Config} config - Which light, and how long it has.
   * @param {LanMessage} message - What to ask.
   * @param {number} port - Where to ask it.
   * @param {string} answeredWith - The command its answer carries.
   * @param {AbortSignal} signal - Gives up early.
   * @returns {Promise<Record<string, unknown> | undefined>} What it answered, or nothing.
   */
  const ask = (config, message, port, answeredWith, signal) =>
    new Promise((resolve) => {
      /** @type {ReturnType<typeof setTimeout> | undefined} */
      let timer;
      const link = acquire(sdk, (answer, from) => {
        if (answer.cmd === answeredWith && addressOf(answer, from) === config.host) {
          finish(answer.data);
        }
      });

      /**
       * Settles once, letting go of the socket.
       *
       * @param {Record<string, unknown> | undefined} data - The answer, if any.
       */
      function finish(data) {
        clearTimeout(timer);
        signal.removeEventListener('abort', abandon);
        void link.release();
        resolve(data);
      }

      /** Gives up without an answer. */
      function abandon() {
        finish(undefined);
      }

      timer = setTimeout(abandon, config.timeoutMs);
      signal.addEventListener('abort', abandon, { once: true });
      link.send(message, config.host, port).catch(abandon);
    });

  return sdk.defineTransport({
    id: 'govee/lan',
    configSchema: z.object({
      host: z.string().min(1).max(256),
      timeoutMs: z.coerce.number().int().min(100).max(60_000).default(3000),
    }),

    /**
     * One connection per light: nothing is shared but the socket, which is shared anyway.
     *
     * @param {Config} config - The light.
     * @returns {string} The key.
     */
    connectionKey: (config) => `govee/lan:${config.host}`,

    /**
     * Holds the socket for one light and delivers every status it sends.
     *
     * @param {Config} config - The light.
     * @param {TransportContext} context - Where statuses go.
     * @returns {Promise<TransportConnection>} The connection.
     */
    connect: async (config, context) => {
      const key = `govee/lan:${config.host}`;
      /** @type {Map<string, ReturnType<typeof setInterval>>} */
      const timers = new Map();
      const link = acquire(sdk, (answer, from) => {
        if (answer.cmd === 'devStatus' && from.address === config.host) {
          context.deliver({
            connectionKey: key,
            deviceKey: config.host,
            payload: statusOf(answer.data),
          });
        }
      });

      context.report('up');

      return {
        key,

        /**
         * Tells the light something.
         *
         * @param {TransportRequest} request - What the profile asked for.
         * @returns {Promise<unknown>} Nothing: the LAN API does not answer a command.
         */
        send: async (request) => {
          await link.send(messageFor(request), request.deviceKey, COMMAND_PORT);

          return undefined;
        },

        /**
         * Replaces the status requests.
         *
         * @param {readonly TransportSubscription[]} subscriptions - The polls to run.
         * @returns {Promise<void>} Settles once the timers match.
         */
        apply: async (subscriptions) => {
          for (const timer of timers.values()) {
            clearInterval(timer);
          }

          timers.clear();

          for (const subscription of subscriptions) {
            const deviceKey = subscription.args['deviceKey'];

            if (subscription.op !== 'poll' || typeof deviceKey !== 'string') {
              continue;
            }

            const everyMs = Math.max(Number(subscription.args['everyMs'] ?? 10_000), MIN_POLL_MS);
            /** Asks the light for its status. */
            const asking = () => {
              link.send({ cmd: 'devStatus', data: {} }, deviceKey, COMMAND_PORT).catch((error) => {
                context.logger.debug({ err: error, deviceKey }, 'Could not ask for a status');
              });
            };

            asking();

            const timer = setInterval(asking, everyMs);

            timer.unref();
            timers.set(JSON.stringify(subscription), timer);
          }
        },

        /**
         * Stops asking, and lets go of the socket.
         *
         * @returns {Promise<void>} Settles once nothing is left running.
         */
        close: async () => {
          for (const timer of timers.values()) {
            clearInterval(timer);
          }

          timers.clear();
          await link.release();
        },
      };
    },

    /**
     * Asks the light at the address an owner typed who it is, with a scan sent to it alone.
     *
     * @param {Config} config - The light.
     * @param {JsonObject} terms - Unused: a scan is the only question there is.
     * @param {AbortSignal} signal - Ends the scan.
     * @yields {Discovered} The light, when it answered.
     */
    scan: async function* scan(config, terms, signal) {
      void terms;

      const data = await ask(
        config,
        { cmd: 'scan', data: { account_topic: 'reserve' } },
        SCAN_PORT,
        'scan',
        signal,
      );

      if (data !== undefined) {
        yield { deviceKey: config.host, payload: statusOf(data) };
      }
    },

    /**
     * Asks the light for its status once.
     *
     * @param {Config} config - The light.
     * @param {AbortSignal} signal - Gives up.
     * @returns {Promise<string>} That it answered.
     * @throws {Error} When it did not: LAN Control off, or nothing at that address.
     */
    probe: async (config, signal) => {
      const data = await ask(
        config,
        { cmd: 'devStatus', data: {} },
        COMMAND_PORT,
        'devStatus',
        signal,
      );

      if (data === undefined) {
        throw new Error(
          `${config.host} did not answer: is LAN Control switched on for it in the Govee app?`,
        );
      }

      return `${config.host} answered: ${data['onOff'] === 1 ? 'on' : 'off'}, brightness ${String(data['brightness'])}`;
    },
  });
}
