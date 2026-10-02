// @ts-check
/**
 * Shelly Gen1's own API: HTTP for everything asked, CoIoT for being told when to ask.
 *
 * A Gen1 Shelly has no RPC and no socket to keep open. It answers plain HTTP - `/shelly` for who
 * it is, `/status` for everything it is doing, `/relay/0?turn=on`, `/light/0?brightness=40`,
 * `/roller/0?go=to_pos&roller_pos=30` for what it is told - behind basic authentication when a
 * login is switched on in its web page. What it does not do is say anything over HTTP on its own.
 *
 * It does say something over CoIoT: a small CoAP packet multicast to the house whenever its state
 * changes (`coiot.js`). This transport takes such a packet from the device it drives as the signal
 * to read `/status` at once, so a relay switched at the wall shows in the row within a fraction of
 * a second rather than at the next poll. The poll stays, at the interval the owner chose, as the
 * safety net for what CoIoT loses: a packet dropped, a device on another subnet the multicast does
 * not cross, a port the hub could not bind. A command is followed by a read of its own, since the
 * device's answer to a command is the one channel it changed and not the power that followed.
 *
 * Two things are translated here rather than in the profiles, because they are the wire's and not
 * the device's meaning. Every `meters[]` entry gains `total_wh`: the device counts energy in
 * watt-minutes, and the catalogue has no such unit. And a `brightness` or `roller_pos` sent to the
 * device is rounded and held to what the API accepts: 1 to 100, and 0 to 100.
 *
 * This file is what ships in the bundle. It imports nothing from the platform: what it needs
 * - zod, `defineTransport`, the UDP socket - arrives as the `sdk` it is called with.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { acquire } from './coiot.js';

/** @typedef {import('@nebulahome/package-runtime').BundleSdk} BundleSdk */
/** @typedef {import('@nebulahome/package-runtime').Transport} Transport */
/** @typedef {import('@nebulahome/package-runtime').TransportConnection} TransportConnection */
/** @typedef {import('@nebulahome/package-runtime').TransportContext} TransportContext */
/** @typedef {import('@nebulahome/package-runtime').TransportRequest} TransportRequest */
/** @typedef {import('@nebulahome/package-runtime').TransportSubscription} TransportSubscription */
/** @typedef {import('@nebulahome/package-runtime').TransportStatus} TransportStatus */
/** @typedef {import('@nebulahome/package-runtime').Discovered} Discovered */
/** @typedef {import('@nebulahome/package-runtime').UdpPeer} UdpPeer */
/** @typedef {import('@nebulahome/contracts').JsonObject} JsonObject */
/** @typedef {import('./coiot.js').CoiotStatus} CoiotStatus */

/**
 * What an owner configures to reach one device.
 *
 * @typedef {object} Config
 * @property {string} host - `host` or `host:port`.
 * @property {string} username - The login's user, `admin` unless it was changed.
 * @property {string | undefined} [password] - Set when a login is switched on in the device.
 * @property {number} timeoutMs - How long a request has.
 */

/** The id this transport registers under: the vendor's, then the name in `manifest.json`. */
const ID = 'shelly/gen1';

/** What every Gen1 device answers who it is on, without a password. */
const INFO_PATH = '/shelly';

/** Everything the device is doing, in one object. */
const STATUS_PATH = '/status';

/** The user a Gen1 login has until the owner changes it. */
const DEFAULT_USERNAME = 'admin';

/** How often the status is read when the profile does not say. */
const DEFAULT_POLL_MS = 30_000;

/** Never more often than this: a Gen1 is a small microcontroller on Wi-Fi. */
const MIN_POLL_MS = 5000;

/**
 * How long a CoIoT packet waits before the read it asks for.
 *
 * A dimmer being turned publishes several packets in a second; they are one read, not several.
 */
const NUDGE_DELAY_MS = 250;

/** What a request path may be: the device's own, never a URL or a query. */
const PATH_PATTERN = /^\/[A-Za-z0-9/_.-]*$/;

/**
 * Whether a value is a plain object.
 *
 * @param {unknown} value - Anything.
 * @returns {value is Record<string, unknown>} True for an object that is not an array.
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads a string field.
 *
 * @param {unknown} record - Where to read.
 * @param {string} key - Which field.
 * @returns {string | undefined} The value when it is a non-empty string.
 */
function textOf(record, key) {
  const value = isRecord(record) ? record[key] : undefined;

  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Holds a number to a range, rounded to a whole one.
 *
 * @param {number} value - The number.
 * @param {number} low - The least allowed.
 * @param {number} high - The most allowed.
 * @returns {number} The whole number within the range nearest to it.
 */
function clamp(value, low, high) {
  return Math.min(high, Math.max(low, Math.round(value)));
}

/**
 * Writes one query value the way the device reads it.
 *
 * @param {string} name - The parameter.
 * @param {unknown} value - What the profile filled in.
 * @returns {string} The text that goes in the URL. A brightness is 1 to 100 and a roller
 * position 0 to 100, whole: a level of 0 or 37.5 from the platform is not an error to the owner,
 * and the device would answer it with one.
 */
function wireValue(name, value) {
  if (typeof value === 'number' && name === 'brightness') {
    return String(clamp(value, 1, 100));
  }

  if (typeof value === 'number' && name === 'roller_pos') {
    return String(clamp(value, 0, 100));
  }

  return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
}

/**
 * Adds the energy each meter has counted in watt-hours, beside the watt-minutes it counts in.
 *
 * @param {unknown} status - What `/status` answered.
 * @returns {unknown} The status, each `meters[]` entry with `total_wh` when it has a `total`.
 */
function normalised(status) {
  if (!isRecord(status) || !Array.isArray(status['meters'])) {
    return status;
  }

  return {
    ...status,
    meters: status['meters'].map((meter) => {
      const total = isRecord(meter) ? meter['total'] : undefined;

      return isRecord(meter) && typeof total === 'number'
        ? { ...meter, total_wh: Math.round((total / 60) * 1000) / 1000 }
        : meter;
    }),
  };
}

/**
 * The headers every request carries.
 *
 * @param {Config} config - The device.
 * @returns {Record<string, string>} The headers, basic authentication included when the owner
 * gave a password.
 */
function headersFor(config) {
  /** @type {Record<string, string>} */
  const headers = { accept: 'application/json' };

  if (config.password !== undefined) {
    const credentials = Buffer.from(`${config.username}:${config.password}`).toString('base64');

    headers['authorization'] = `Basic ${credentials}`;
  }

  return headers;
}

/**
 * Why a request did not reach the device, in the words an owner can act on.
 *
 * @param {unknown} error - What `fetch` threw.
 * @returns {string} `ECONNREFUSED`, `ENOTFOUND`, `timed out` - the cause rather than the
 * "fetch failed" that wraps it.
 */
function reasonOf(error) {
  if (!(error instanceof Error)) {
    return String(error);
  }

  if (error.name === 'TimeoutError' || error.name === 'AbortError') {
    return 'timed out';
  }

  const cause = error.cause;

  if (cause instanceof Error) {
    return 'code' in cause && typeof cause.code === 'string' ? cause.code : cause.message;
  }

  return error.message;
}

/**
 * Asks the device one thing over HTTP.
 *
 * @param {Config} config - The device and its login.
 * @param {string} path - What to ask: `/status`, `/relay/0`.
 * @param {Record<string, unknown>} query - The parameters, as the profile filled them in.
 * @param {AbortSignal | undefined} signal - Gives up early, beside the configured timeout.
 * @returns {Promise<unknown>} The decoded JSON, or the text when it is not JSON.
 * @throws {Error} When nothing answered, the login was missing or refused, or the device
 * answered with an error.
 */
async function get(config, path, query, signal) {
  const url = new URL(path, `http://${config.host}`);

  for (const [name, value] of Object.entries(query)) {
    url.searchParams.set(name, wireValue(name, value));
  }

  const timeout = AbortSignal.timeout(config.timeoutMs);

  /** @type {Response} */
  let response;

  try {
    response = await fetch(url, {
      headers: headersFor(config),
      signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
    });
  } catch (error) {
    throw new Error(`${config.host} did not answer: ${reasonOf(error)}`, { cause: error });
  }

  if (response.status === 401) {
    await response.body?.cancel();

    throw new Error(
      config.password === undefined
        ? `${config.host} asks for a username and password`
        : `${config.host} refused the username or password`,
    );
  }

  if (!response.ok) {
    await response.body?.cancel();

    throw new Error(`${config.host} answered ${String(response.status)} for ${path}`);
  }

  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Finds the address the device's CoIoT packets come from.
 *
 * @param {string} host - What the owner typed: an address or a name, with a port or without.
 * @returns {Promise<string | undefined>} The IPv4 address, or nothing when the name does not
 * resolve - the device is then recognised by its MAC alone, once a status has said it.
 */
async function addressOf(host) {
  const name = host.replace(/:\d+$/, '');

  if (isIP(name) !== 0) {
    return name;
  }

  try {
    return (await lookup(name, { family: 4 })).address;
  } catch {
    return undefined;
  }
}

/**
 * The last six hex digits of a MAC or a device id, which is what a CoIoT packet may carry.
 *
 * @param {string | undefined} value - A MAC, `A4CF12F45CC4`, or a CoIoT device id.
 * @returns {string | undefined} Its tail, upper case, or nothing when there is none.
 */
function tailOf(value) {
  return value === undefined || value.length < 6 ? undefined : value.slice(-6).toUpperCase();
}

/**
 * Reads the path a probe asks, from an integration's search terms.
 *
 * @param {JsonObject} terms - The integration's `discovery`.
 * @returns {string} The path its probe names, or `/shelly`.
 */
function probePathOf(terms) {
  const probe = terms['probe'];
  const args = isRecord(probe) ? probe['args'] : undefined;
  const path = isRecord(args) ? args['path'] : undefined;

  return typeof path === 'string' && PATH_PATTERN.test(path) ? path : INFO_PATH;
}

/**
 * Builds the transport.
 *
 * @param {BundleSdk} sdk - What the hub hands a bundle.
 * @returns {Transport} The transport, registered as `shelly/gen1`.
 */
export default function createShellyGen1(sdk) {
  const { z } = sdk;

  return sdk.defineTransport({
    id: ID,
    configSchema: z.object({
      /** The device, as `host` or `host:port`. */
      host: z.string().min(1).max(256),

      /** The login's user: `admin` unless it was changed in the device's web page. */
      username: z.string().min(1).max(128).default(DEFAULT_USERNAME),

      /** The login's password, when a login is switched on. */
      password: z.string().min(1).max(512).optional(),

      /** How long a request has. */
      timeoutMs: z.coerce.number().int().min(100).max(60_000).default(5000),
    }),

    /**
     * One connection per device: two instances at one address share it.
     *
     * @param {Config} config - The settings.
     * @returns {string} The key.
     */
    connectionKey: (config) => `${ID}:${config.host}`,

    /**
     * Reads the device once, listens for its CoIoT packets, and waits for its poll.
     *
     * @param {Config} config - The settings.
     * @param {TransportContext} context - Where statuses and health go.
     * @returns {Promise<TransportConnection>} The connection.
     */
    connect: (config, context) => {
      const key = `${ID}:${config.host}`;
      /**
       * The address the device's CoIoT packets come from, once the host has been resolved.
       *
       * @type {string | undefined}
       */
      let address;
      /**
       * The tail of the device's MAC, once a status has said it: what a packet from a device
       * whose address changed is still recognised by.
       *
       * @type {string | undefined}
       */
      let macTail;
      /**
       * The serial of the last CoIoT packet that asked for a read.
       *
       * @type {number | undefined}
       */
      let lastSerial;
      /** @type {ReturnType<typeof setInterval> | undefined} */
      let timer;
      /** @type {number | undefined} */
      let everyMs;
      /** @type {ReturnType<typeof setTimeout> | undefined} */
      let nudgeTimer;
      /** @type {Promise<void> | null} */
      let reading = null;
      /** Whether something changed while a read was under way, which that read may have missed. */
      let isStale = false;
      /** @type {TransportStatus | null} */
      let health = null;
      let isClosed = false;

      /**
       * Tells the hub whether the device answers, when that changed.
       *
       * @param {TransportStatus} status - Whether it answered.
       */
      function reportHealth(status) {
        if (health !== status) {
          health = status;
          context.report(status);
        }
      }

      /**
       * Reads the status and delivers it.
       *
       * @param {boolean} isChange - Whether the device said it changed: a read already under way
       * may have started before the change, so one more follows it. A poll joins the one under way.
       * @returns {Promise<void>} Settled either way: a device that is off is the normal case for
       * a house, and its entities go stale, which `core` reads as unavailable.
       */
      function refresh(isChange) {
        if (reading !== null) {
          isStale ||= isChange;

          return reading;
        }

        reading = (async () => {
          try {
            const status = normalised(await get(config, STATUS_PATH, {}, undefined));

            if (isClosed) {
              return;
            }

            macTail ??= tailOf(textOf(status, 'mac'));
            reportHealth('up');
            context.deliver({ connectionKey: key, deviceKey: config.host, payload: status });
          } catch (error) {
            context.logger.debug({ err: error, host: config.host }, 'Status not read');

            if (!isClosed) {
              reportHealth('down');
            }
          } finally {
            reading = null;

            if (isStale && !isClosed) {
              isStale = false;
              void refresh(false);
            }
          }
        })();

        return reading;
      }

      /**
       * Reads the device shortly, however many packets ask for it in the meantime.
       */
      function nudge() {
        if (nudgeTimer !== undefined || isClosed) {
          return;
        }

        nudgeTimer = setTimeout(() => {
          nudgeTimer = undefined;
          void refresh(true);
        }, NUDGE_DELAY_MS);
        nudgeTimer.unref();
      }

      const link = acquire(
        sdk,
        /**
         * Reads the device when a packet it published says its status changed.
         *
         * @param {CoiotStatus} status - What the packet says of its sender.
         * @param {UdpPeer} from - Where it came from.
         */
        (status, from) => {
          const isOurs =
            (address !== undefined && from.address === address) ||
            (macTail !== undefined && tailOf(status.deviceId) === macTail);

          if (!isOurs) {
            return;
          }

          // The periodic packet repeats the serial of the last change: nothing new to read.
          if (status.serial !== undefined && status.serial === lastSerial) {
            return;
          }

          lastSerial = status.serial;
          nudge();
        },
      );

      void addressOf(config.host).then((found) => {
        address = found;
      });

      // The status on connect: the rows have something to show before the first poll, and the
      // hub hears at once whether the device answers.
      void refresh(false);

      /** @type {TransportConnection} */
      const connection = {
        key,

        /**
         * Tells the device something, then reads what it did.
         *
         * @param {TransportRequest} request - A `get`, with `path` and `query`.
         * @param {AbortSignal} signal - Gives up.
         * @returns {Promise<unknown>} What the device answered.
         * @throws {Error} When the request is not one this transport speaks, or it failed.
         */
        send: async (request, signal) => {
          if (request.op !== 'get') {
            throw new Error(`${ID} does not know the ${request.op} op; it speaks get`);
          }

          const path = request.args['path'];
          const query = request.args['query'];

          if (typeof path !== 'string' || !PATH_PATTERN.test(path)) {
            throw new Error(`${ID} was asked for no path it can send`);
          }

          const answer = await get(config, path, isRecord(query) ? query : {}, signal);

          if (path !== STATUS_PATH && path !== INFO_PATH) {
            // The answer is the channel the command changed; the power it now draws, the other
            // channel, the firmware's state are in the status.
            void refresh(true);
          }

          return answer;
        },

        /**
         * Replaces the poll.
         *
         * @param {readonly TransportSubscription[]} subscriptions - The `poll` ones count.
         * @returns {Promise<void>} Settled once the timer matches.
         */
        apply: (subscriptions) => {
          const intervals = subscriptions
            .filter((subscription) => subscription.op === 'poll')
            .map((subscription) => {
              const asked = Number(subscription.args['everyMs'] ?? DEFAULT_POLL_MS);

              return Math.max(Number.isFinite(asked) ? asked : DEFAULT_POLL_MS, MIN_POLL_MS);
            });
          const wanted = intervals.length === 0 ? undefined : Math.min(...intervals);

          if (wanted !== everyMs) {
            clearInterval(timer);
            timer = undefined;
            everyMs = wanted;

            if (wanted !== undefined) {
              timer = setInterval(() => {
                void refresh(false);
              }, wanted);
              timer.unref();
            }
          }

          if (wanted !== undefined) {
            // Joins the read on connect when it is still under way, rather than asking twice.
            void refresh(false);
          }

          return Promise.resolve();
        },

        /**
         * Stops the poll and lets go of the CoIoT socket.
         *
         * @returns {Promise<void>} Settled once nothing is left running.
         */
        close: async () => {
          isClosed = true;
          clearInterval(timer);
          clearTimeout(nudgeTimer);
          timer = undefined;
          nudgeTimer = undefined;
          await link.release();
        },
      };

      return Promise.resolve(connection);
    },

    /**
     * Asks the one configured address who it is.
     *
     * @param {Config} config - The settings.
     * @param {JsonObject} terms - The integration's search terms, whose probe names the path.
     * @param {AbortSignal} signal - Ends the scan.
     * @yields {Discovered} The address, when it answered.
     */
    scan: async function* scan(config, terms, signal) {
      /** @type {unknown} */
      let payload;

      try {
        payload = await get(config, probePathOf(terms), {}, signal);
      } catch (error) {
        // An address with nothing behind it is the ordinary outcome of a typo, or of a device
        // that is off, and the instance keeps asking.
        sdk.logger.debug({ err: error, host: config.host }, 'Probe not answered');

        return;
      }

      yield { deviceKey: config.host, payload };
    },

    /**
     * Tries the address once, and the login with it.
     *
     * @param {Config} config - What the owner typed.
     * @param {AbortSignal} signal - Gives up.
     * @returns {Promise<string>} What answered.
     * @throws {Error} When nothing answered, it is not a Gen1 Shelly, a login is missing, or it
     * was refused.
     */
    probe: async (config, signal) => {
      const info = await get(config, INFO_PATH, {}, signal);
      const type = textOf(info, 'type');

      if (type === undefined) {
        const model = textOf(info, 'model');

        throw new Error(
          model === undefined
            ? `${config.host} answered, but not as a Shelly`
            : `${config.host} is a later Shelly (${model}): add it with a family that is not Gen1`,
        );
      }

      if (isRecord(info) && info['auth'] === true && config.password === undefined) {
        throw new Error(`${config.host} asks for a username and password`);
      }

      if (config.password !== undefined) {
        // Asked now, so a wrong login fails under the Test button rather than at the first
        // status after the device was saved: `/shelly` answers without one.
        await get(config, STATUS_PATH, {}, signal);
      }

      const firmware = textOf(info, 'fw');

      return `${config.host} answered: ${type}${firmware === undefined ? '' : `, firmware ${firmware}`}`;
    },
  });
}
