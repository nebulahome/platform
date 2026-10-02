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
 * Three things are translated here rather than in the profile, because they are the wire's and
 * not the device's meaning: the light speaks colour temperature in kelvin and the platform in
 * mireds, one the reciprocal of the other; it speaks colour as red, green and blue and the
 * platform as a hue and a saturation, brightness being the light's own setting; and it reports on
 * and off as 1 and 0.
 *
 * The API answers no command and pushes nothing, so what a command changed is read by asking,
 * twice, right after it; and a light that changed - from here, from the app, from its remote -
 * is asked every second for a few seconds, since whoever is changing it may not be done.
 *
 * This file is what ships in the bundle. It imports nothing from the platform: what it needs
 * - zod, `defineTransport`, the UDP socket - arrives as the `sdk` it is called with.
 */
import { listenToCloud } from './cloud.js';
import { acquire, addressOf, COMMAND_PORT, SCAN_PORT } from './socket.js';

/** @typedef {import('@nebulahome/package-runtime').BundleSdk} BundleSdk */
/** @typedef {import('@nebulahome/package-runtime').Transport} Transport */
/** @typedef {import('@nebulahome/package-runtime').TransportConnection} TransportConnection */
/** @typedef {import('@nebulahome/package-runtime').TransportContext} TransportContext */
/** @typedef {import('@nebulahome/package-runtime').TransportRequest} TransportRequest */
/** @typedef {import('@nebulahome/package-runtime').TransportSubscription} TransportSubscription */
/** @typedef {import('@nebulahome/package-runtime').Discovered} Discovered */
/** @typedef {import('@nebulahome/contracts').JsonObject} JsonObject */
/** @typedef {import('./socket.js').LanMessage} LanMessage */

/**
 * What an owner configures to reach one light.
 *
 * @typedef {object} Config
 * @property {string} host - The light's address.
 * @property {number} timeoutMs - How long it has to answer a scan or a status request.
 * @property {string | undefined} [cloudEmail] - The owner's Govee account, for changes to be
 *   heard at once.
 * @property {string | undefined} [cloudPassword] - Its password.
 */

/** How often a poll may run at most. */
const MIN_POLL_MS = 1000;

/** When a light is asked how it is after a command, in milliseconds after it. */
const FOLLOW_UP_MS = /** @type {const} */ ([150, 900]);

/** How long a light that just changed is asked every second, and how often that is. */
const BURST_MS = 10_000;
const BURST_EVERY_MS = 1000;

/** The warmest and coolest a Govee light goes, in kelvin. */
const KELVIN_RANGE = /** @type {const} */ ([2000, 9000]);

/**
 * Turns a hue and a saturation into the red, green and blue the light takes, at full value: how
 * bright it is, is the light's brightness, set on its own.
 *
 * @param {number} hue - From 0 to 360.
 * @param {number} saturation - From 0 to 100.
 * @returns {{ r: number, g: number, b: number }} Each from 0 to 255.
 */
export function rgbOf(hue, saturation) {
  const h = (((hue % 360) + 360) % 360) / 60;
  const s = Math.min(100, Math.max(0, saturation)) / 100;
  const chroma = s;
  const x = chroma * (1 - Math.abs((h % 2) - 1));
  const base = 1 - chroma;
  /** @type {[number, number, number]} */
  const [r, g, b] =
    h < 1
      ? [chroma, x, 0]
      : h < 2
        ? [x, chroma, 0]
        : h < 3
          ? [0, chroma, x]
          : h < 4
            ? [0, x, chroma]
            : h < 5
              ? [x, 0, chroma]
              : [chroma, 0, x];

  return {
    r: Math.round((r + base) * 255),
    g: Math.round((g + base) * 255),
    b: Math.round((b + base) * 255),
  };
}

/**
 * Turns the red, green and blue a light reports into a hue and a saturation.
 *
 * @param {number} r - From 0 to 255.
 * @param {number} g - From 0 to 255.
 * @param {number} b - From 0 to 255.
 * @returns {{ hue: number, saturation: number }} The hue from 0 to 360, the saturation from 0
 * to 100, both rounded.
 */
export function hsOf(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  if (max === 0 || delta === 0) {
    return { hue: 0, saturation: 0 };
  }

  const sector =
    max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;

  return {
    hue: Math.round(sector * 60) % 360,
    saturation: Math.round((delta / max) * 100),
  };
}

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
    case 'color':
      return {
        cmd: 'colorwc',
        data: {
          color: rgbOf(numberOf(args, 'hue'), numberOf(args, 'saturation')),
          colorTemInKelvin: 0,
        },
      };
    case 'status':
      return { cmd: 'devStatus', data: {} };
    default:
      throw new Error(
        `govee/lan does not speak ${JSON.stringify(op)}; it speaks turn, brightness, colortemp, color and status`,
      );
  }
}

/**
 * A status, as the profile reads it: the light's own fields, and the colour it is showing - in
 * mireds when it is in white mode, as a hue and a saturation when it is in colour mode.
 *
 * In white mode the colour is reported too, as white - no saturation - rather than left out: a
 * state keeps what a report does not say, so a light turned white would otherwise go on showing
 * the colour it had before.
 *
 * @param {Record<string, unknown>} data - What the light answered.
 * @returns {JsonObject} The status.
 */
export function statusOf(data) {
  const kelvin = data['colorTemInKelvin'];
  const color = data['color'];
  /** @type {JsonObject} */
  const status = JSON.parse(JSON.stringify(data));

  if (typeof kelvin === 'number' && kelvin > 0) {
    status['mireds'] = reciprocal(kelvin);
    status['hue'] = 0;
    status['saturation'] = 0;
  } else if (typeof color === 'object' && color !== null) {
    const { r, g, b } = /** @type {Record<string, unknown>} */ (color);

    if (typeof r === 'number' && typeof g === 'number' && typeof b === 'number') {
      const { hue, saturation } = hsOf(r, g, b);

      status['hue'] = hue;
      status['saturation'] = saturation;
    }
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

      /** The owner's Govee account, when they gave it for changes to be heard at once. */
      cloudEmail: z.string().min(3).max(256).optional(),
      cloudPassword: z.string().min(1).max(256).optional(),
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
      /**
       * The follow-up questions after a command, and the quick polling after a change.
       *
       * @type {Set<ReturnType<typeof setTimeout>>}
       */
      const soon = new Set();
      /** @type {ReturnType<typeof setInterval> | undefined} */
      let burst;
      let burstUntilMs = 0;
      /** @type {string | undefined} */
      let lastStatus;
      let isPolled = false;

      /** Asks the light for its status, once. */
      const askStatus = () => {
        link.send({ cmd: 'devStatus', data: {} }, config.host, COMMAND_PORT).catch((error) => {
          context.logger.debug(
            { err: error, deviceKey: config.host },
            'Could not ask for a status',
          );
        });
      };

      /**
       * Asks the light every second for a while: something changed it - a command, the app, a
       * remote, the wall switch - and whatever did may not be done changing it.
       */
      const hurry = () => {
        burstUntilMs = Date.now() + BURST_MS;

        if (burst !== undefined) {
          return;
        }

        burst = setInterval(() => {
          if (Date.now() >= burstUntilMs) {
            clearInterval(burst);
            burst = undefined;

            return;
          }

          askStatus();
        }, BURST_EVERY_MS);
        burst.unref();
      };

      /** @type {Record<string, unknown>} */
      let lastData = {};

      /**
       * Delivers what the light is showing.
       *
       * @param {Record<string, unknown>} data - The light's fields, as the LAN API words them.
       * @param {boolean} isPushed - Whether the cloud said it, rather than the light answering.
       */
      const take = (data, isPushed) => {
        lastData = { ...lastData, ...data };

        const payload = statusOf(lastData);
        const seen = JSON.stringify(payload);

        // A status unlike the last is a light somebody is changing: follow it closely. The
        // first one is not a change, only the first thing heard; and a light the cloud tells
        // about needs no hurrying, since the cloud will say the next change too.
        if (!isPushed && isPolled && lastStatus !== undefined && seen !== lastStatus) {
          hurry();
        }

        lastStatus = seen;
        context.deliver({ connectionKey: key, deviceKey: config.host, payload });
      };

      const link = acquire(sdk, (answer, from) => {
        if (answer.cmd === 'devStatus' && from.address === config.host) {
          take(answer.data, false);
        }
      });

      /** @type {{ release: () => Promise<void> } | undefined} */
      let cloud;
      const stop = new AbortController();

      if (config.cloudEmail !== undefined && config.cloudPassword !== undefined) {
        const account = { email: config.cloudEmail, password: config.cloudPassword };

        // The cloud names a light by its id, which only its scan answer says.
        void ask(
          config,
          { cmd: 'scan', data: { account_topic: 'reserve' } },
          SCAN_PORT,
          'scan',
          stop.signal,
        ).then((answer) => {
          const device = answer?.['device'];

          if (typeof device === 'string' && !stop.signal.aborted) {
            cloud = listenToCloud(sdk, account, device, (state) => {
              take(state, true);
            });
          }
        });
      }

      context.report('up');

      return {
        key,

        /**
         * Tells the light something, then asks it how it is now.
         *
         * The LAN API answers no command, so without asking, what a command changed shows only
         * at the next poll - seconds later. Asked twice: a datagram can be lost, and a light
         * fading to a new colour says the old one for a moment.
         *
         * @param {TransportRequest} request - What the profile asked for.
         * @returns {Promise<unknown>} Nothing: the LAN API does not answer a command.
         */
        send: async (request) => {
          await link.send(messageFor(request), request.deviceKey, COMMAND_PORT);

          if (request.op !== 'status') {
            for (const afterMs of FOLLOW_UP_MS) {
              const timer = setTimeout(() => {
                soon.delete(timer);
                askStatus();
              }, afterMs);

              timer.unref();
              soon.add(timer);
            }
          }

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
          isPolled = false;

          for (const subscription of subscriptions) {
            const deviceKey = subscription.args['deviceKey'];

            if (subscription.op !== 'poll' || typeof deviceKey !== 'string') {
              continue;
            }

            isPolled = true;

            const everyMs = Math.max(Number(subscription.args['everyMs'] ?? 5000), MIN_POLL_MS);
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

          for (const timer of soon) {
            clearTimeout(timer);
          }

          clearInterval(burst);
          burst = undefined;
          timers.clear();
          soon.clear();
          stop.abort();
          await cloud?.release();
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
