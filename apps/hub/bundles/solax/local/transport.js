// @ts-check
/**
 * SolaX's local API, over plain HTTP to the Pocket WiFi or Pocket LAN dongle on the inverter.
 *
 * The dongle answers one question on port 80 - `optType=ReadRealTimeData`, with its password in
 * `pwd` - and the answer is a JSON object: the dongle's serial `sn`, its firmware `ver`, the
 * inverter's `type`, its `Information`, and `Data`, a flat list of registers. The platform's
 * `http` transport cannot ask it: the password travels in a form body or a query string, not in
 * a header or a path, and the registers need what a profile cannot do - divisors, signs, two
 * registers making one counter, a code standing for a word. So the bundle ships this transport,
 * and it hands the profiles named values already scaled (`families.js`), the way `govee/lan`
 * hands them mireds: a profile reads `values.battery_power` and nothing else.
 *
 * Three ways of asking have been seen, and which one a dongle takes depends on its firmware, so
 * the transport tries them in turn and keeps the one that worked:
 *
 * - `body`: a POST to `/` with the form `optType=ReadRealTimeData&pwd=…` as its body, what the
 *   V3 dongles and the Hybrid G4 generation take;
 * - `query`: a POST to `/` with the same as a query string, and a trailing `&` when there is a
 *   password - without it the 2.x firmware has been reported to crash;
 * - `legacy`: a GET of `/api/realTimeData.htm`, the X-Hybrid's own page, without a password.
 *
 * The two POSTs carry `X-Forwarded-For: 5.8.8.8`, the dongle's own hotspot address: firmware
 * 2.034 closes the connection on a request it takes to come from the LAN, and the library Home
 * Assistant uses sends it for the same reason.
 *
 * Which family answered is decided from `type` - an integer code, or a model string on the
 * older firmware - and from how many registers came back, where two families share a code. The
 * owner may pick the table for those two codes; the pick counts only for an answer it can read.
 *
 * This file is what ships in the bundle. It imports nothing from the platform: zod and
 * `defineTransport` arrive as the `sdk` it is called with, and the requests go through Node's
 * own `fetch`.
 */
import { createHash } from 'node:crypto';

import { FAMILIES } from './families.js';

/** @typedef {import('@nebula-home/package-runtime').BundleSdk} BundleSdk */
/** @typedef {import('@nebula-home/package-runtime').Transport} Transport */
/** @typedef {import('@nebula-home/package-runtime').TransportConnection} TransportConnection */
/** @typedef {import('@nebula-home/package-runtime').TransportContext} TransportContext */
/** @typedef {import('@nebula-home/package-runtime').TransportSubscription} TransportSubscription */
/** @typedef {import('@nebula-home/package-runtime').Discovered} Discovered */
/** @typedef {import('@nebula-home/contracts').JsonObject} JsonObject */
/** @typedef {import('./families.js').Family} Family */
/** @typedef {import('./families.js').Reading} Reading */

/**
 * What an owner configures to reach one dongle.
 *
 * @typedef {object} Config
 * @property {string} host - `host` or `host:port`.
 * @property {string} password - The dongle's password: its registration number, unless changed.
 * @property {string} family - `auto`, or the table to read an answer two tables take with.
 * @property {number} timeoutMs - How long one request has.
 */

/**
 * A way of asking; see the head of this file.
 *
 * @typedef {'body' | 'query' | 'legacy'} Variant
 */

/**
 * Why a way of asking gave no data, from the most telling to the least.
 *
 * @typedef {'refused' | 'unknown' | 'empty' | 'unreadable' | 'status' | 'closed' | 'timeout' | 'unreachable'} Failure
 */

/**
 * How one request went.
 *
 * @typedef {{ kind: 'data', payload: JsonObject } | { kind: Failure, reason: string }} Outcome
 */

/** The id this transport registers under: the vendor's, then the name in `manifest.json`. */
const ID = 'solax/local';

/** The ways of asking, in the order a dongle nobody has asked yet is tried. */
const VARIANTS = /** @type {const} */ (['body', 'query', 'legacy']);

/** What the dongle is asked. */
const QUESTION = 'optType=ReadRealTimeData';

/** The address the dongle's own hotspot has, which it answers as if from there. */
const FORWARDED_FOR = '5.8.8.8';

/** The shortest a poll may be: a request may take five seconds, and the dongle is small. */
const MIN_POLL_MS = 5000;

/** Every family id the owner may pick, besides `auto`. */
const FAMILY_IDS = FAMILIES.map((family) => family.id);

/**
 * Which failure says most about why a dongle gave nothing, when every way of asking failed: a
 * refused password first, then what an answer said, then an HTTP error - a way the dongle does
 * not take - and silence last.
 *
 * @type {readonly Failure[]}
 */
const PRIORITY = [
  'refused',
  'unknown',
  'empty',
  'unreadable',
  'status',
  'closed',
  'timeout',
  'unreachable',
];

/** The network errors that mean nothing listens there, so asking another way is pointless. */
const UNREACHABLE_CODES = new Set([
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

/**
 * Reads one reading out of the registers.
 *
 * @param {readonly number[]} data - The registers.
 * @param {Reading} reading - Where it is and what is done to it.
 * @returns {number | string | undefined} The value, or nothing when the answer is too short for
 * it or a code has no word.
 */
export function readValue(data, reading) {
  const [at, ...steps] = reading;
  /** @type {number | undefined} */
  let value;

  if (typeof at === 'number') {
    value = data[at];
  } else {
    const low = data[at[0]];
    const high = data[at[1]];

    value = low === undefined || high === undefined ? undefined : low + high * 0x1_0000;
  }

  if (value === undefined) {
    return undefined;
  }

  for (const step of steps) {
    if (typeof step === 'object') {
      return step[String(value)];
    }

    switch (step) {
      case 'int16':
        value = value > 0x7f_ff ? value - 0x1_00_00 : value;
        break;
      case 'int32':
        value = value > 0x7f_ff_ff_ff ? value - 0x1_00_00_00_00 : value;
        break;
      case '/10':
        value /= 10;
        break;
      case '/100':
        value /= 100;
        break;
    }
  }

  return value;
}

/**
 * Adds what the registers say only in parts: the panels together, the three phases together,
 * the two battery ports together, and the house.
 *
 * @param {Record<string, number | string>} values - The readings; completed in place.
 */
function derive(values) {
  /**
   * A reading, when it is a number.
   *
   * @param {string} name - Which.
   * @returns {number | undefined} It.
   */
  const number = (name) => {
    const value = values[name];

    return typeof value === 'number' ? value : undefined;
  };

  /**
   * Adds up readings, an absent one counting as nothing.
   *
   * @param {readonly (number | undefined)[]} parts - The readings.
   * @returns {number} Their sum.
   */
  const total = (parts) => parts.reduce((/** @type {number} */ sum, each) => sum + (each ?? 0), 0);

  const panels = ['pv1_power', 'pv2_power', 'pv3_power'].map(number);

  if (number('pv_power') === undefined && panels.some((each) => each !== undefined)) {
    values['pv_power'] = total(panels);
  }

  const phases = ['ac_power_l1', 'ac_power_l2', 'ac_power_l3'].map(number);

  if (number('ac_power') === undefined && phases.every((each) => each !== undefined)) {
    values['ac_power'] = total(phases);
  }

  const first = number('battery1_power');

  if (number('battery_power') === undefined && first !== undefined) {
    values['battery_power'] = first + (number('battery2_power') ?? 0);
  }

  // What the house uses: what the inverter puts out, less what goes to the grid (plus what comes
  // from it). The load Home Assistant's own documentation derives for this integration, and the
  // house load the Modbus integration computes.
  const output = number('ac_power');
  const grid = number('grid_power');

  if (number('home_power') === undefined && output !== undefined && grid !== undefined) {
    values['home_power'] = output - grid;
  }
}

/**
 * Says whether a family reads an answer.
 *
 * @param {Family} family - The family.
 * @param {unknown} type - What the answer says the inverter is.
 * @param {number} length - How many registers it holds.
 * @param {Variant} variant - How it was asked.
 * @returns {boolean} True when the family's table fits it.
 */
function fits(family, type, length, variant) {
  if (!family.lengths.some(([min, max]) => length >= min && length <= max)) {
    return false;
  }

  if (family.isLegacy === true) {
    return variant === 'legacy' && typeof type === 'string';
  }

  if (variant === 'legacy') {
    return false;
  }

  if (typeof type === 'number') {
    return family.types?.includes(type) ?? false;
  }

  return typeof type === 'string' && family.prefix !== undefined && type.startsWith(family.prefix);
}

/**
 * The family an answer is read with: the owner's pick when it fits, else the first that does.
 *
 * @param {unknown} type - What the answer says the inverter is.
 * @param {number} length - How many registers it holds.
 * @param {Variant} variant - How it was asked.
 * @param {string} chosen - `auto`, or the owner's pick.
 * @returns {Family | undefined} The family, or nothing when no table fits.
 */
export function familyOf(type, length, variant, chosen) {
  const fitting = FAMILIES.filter((family) => fits(family, type, length, variant));

  return fitting.find((family) => family.id === chosen) ?? fitting[0];
}

/**
 * Parses what the dongle said, the way the older firmware writes it: an empty slot in `Data`
 * (`1.9,,,0`) is a zero, and the keys come in either case (`SN`, `sn`).
 *
 * @param {string} text - The body.
 * @returns {Record<string, unknown> | undefined} The object, keys in lower case, or nothing
 * when it is not a JSON object.
 */
function parseAnswer(text) {
  /** @type {unknown} */
  let parsed;

  try {
    parsed = JSON.parse(text.replaceAll(/,(?=\s*,)/g, ',0'));
  } catch {
    return undefined;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [key.toLowerCase(), value]),
  );
}

/**
 * Turns an answer into what a profile reads.
 *
 * @param {string} text - The body the dongle sent.
 * @param {Variant} variant - How it was asked.
 * @param {string} chosen - `auto`, or the owner's pick of table.
 * @returns {Outcome} The payload - `sn`, `ver`, `type`, `family`, `model`, `values` and, when
 * known, `inverterSn` and `manufacturer` - or why there is none.
 */
export function decodeAnswer(text, variant, chosen) {
  const answer = parseAnswer(text);
  const sn = answer?.['sn'];
  const type = answer?.['type'];
  const ver = answer?.['ver'] ?? answer?.['version'];
  const raw = answer?.['data'];

  if (
    answer === undefined ||
    typeof sn !== 'string' ||
    sn.length === 0 ||
    (typeof type !== 'number' && typeof type !== 'string') ||
    !Array.isArray(raw)
  ) {
    return { kind: 'unreadable', reason: 'answered, but not with real-time data' };
  }

  const data = raw.map(Number);

  if (data.some((each) => !Number.isFinite(each))) {
    return { kind: 'unreadable', reason: 'answered with registers that are not numbers' };
  }

  if (data.every((each) => each === 0)) {
    // The library refuses these too: a dongle whose inverter is asleep or starting up.
    return { kind: 'empty', reason: 'answered with nothing but zeros: is the inverter asleep?' };
  }

  const family = familyOf(type, data.length, variant, chosen);

  if (family === undefined) {
    return {
      kind: 'unknown',
      reason: `answered as type ${JSON.stringify(type)} with ${String(data.length)} registers, which no SolaX table here reads`,
    };
  }

  /** @type {Record<string, number | string>} */
  const values = {};

  for (const [name, reading] of Object.entries(family.values)) {
    const value = readValue(data, reading);

    if (value !== undefined) {
      values[name] = value;
    }
  }

  derive(values);

  const information = answer['information'];
  const serial =
    family.serialAt !== undefined && Array.isArray(information)
      ? /** @type {unknown[]} */ (information)[family.serialAt]
      : undefined;
  const model = typeof type === 'string' ? type : (family.models?.[String(type)] ?? family.id);

  return {
    kind: 'data',
    payload: {
      sn,
      ver: typeof ver === 'string' ? ver : '',
      type,
      family: family.id,
      model,
      ...(typeof serial === 'string' && serial.length > 0 ? { inverterSn: serial } : {}),
      ...(family.manufacturer === undefined ? {} : { manufacturer: family.manufacturer }),
      values,
    },
  };
}

/**
 * Why a request never got an answer, in the words an owner can act on.
 *
 * @param {unknown} error - What `fetch` threw.
 * @returns {{ code: string, words: string }} The cause's code, and a sentence part.
 */
function causeOf(error) {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return { code: 'TIMEOUT', words: 'did not answer in time' };
    }

    const cause = error.cause;

    if (cause instanceof Error) {
      const code = 'code' in cause && typeof cause.code === 'string' ? cause.code : '';

      return { code, words: code === '' ? cause.message : `did not answer: ${code}` };
    }

    return { code: '', words: error.message };
  }

  return { code: '', words: String(error) };
}

/**
 * The form the dongle is asked with.
 *
 * @param {string} password - The password, possibly empty.
 * @param {boolean} isQuery - Whether it goes in the URL, where the older firmware wants a
 * trailing `&` after a password.
 * @returns {string} The form.
 */
function formOf(password, isQuery) {
  if (password === '') {
    return QUESTION;
  }

  return `${QUESTION}&pwd=${encodeURIComponent(password)}${isQuery ? '&' : ''}`;
}

/**
 * Asks the dongle once, one way.
 *
 * @param {Config} config - The dongle, its password and the table picked.
 * @param {string} host - Where to ask.
 * @param {Variant} variant - How.
 * @param {AbortSignal} signal - Gives up.
 * @returns {Promise<Outcome>} What came of it.
 */
async function askOnce(config, host, variant, signal) {
  /** @type {Response} */
  let response;

  try {
    const timed = AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)]);

    if (variant === 'legacy') {
      response = await fetch(`http://${host}/api/realTimeData.htm`, { signal: timed });
    } else if (variant === 'query') {
      response = await fetch(`http://${host}/?${formOf(config.password, true)}`, {
        method: 'POST',
        headers: { 'x-forwarded-for': FORWARDED_FOR },
        signal: timed,
      });
    } else {
      response = await fetch(`http://${host}/`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-forwarded-for': FORWARDED_FOR,
        },
        body: formOf(config.password, false),
        signal: timed,
      });
    }
  } catch (error) {
    const { code, words } = causeOf(error);

    if (code === 'TIMEOUT') {
      return { kind: 'timeout', reason: words };
    }

    return { kind: UNREACHABLE_CODES.has(code) ? 'unreachable' : 'closed', reason: words };
  }

  const text = await response.text().catch(() => '');

  if (response.status === 401 || response.status === 403) {
    return {
      kind: 'refused',
      reason: `refused the password (HTTP ${String(response.status)}): it is the dongle's registration number unless it was changed`,
    };
  }

  if (!response.ok) {
    return { kind: 'status', reason: `answered HTTP ${String(response.status)}` };
  }

  return decodeAnswer(text, variant, config.family);
}

/**
 * What a dongle is known by: where it is, and a digest of its password, since a key ends up in
 * logs.
 *
 * @param {Config} config - The settings.
 * @param {string} host - The dongle.
 * @returns {string} The key.
 */
function dongleKey(config, host) {
  return `${host}:${createHash('sha256').update(config.password).digest('hex').slice(0, 16)}`;
}

/**
 * What a connection is shared under: one per dongle and table.
 *
 * @param {Config} config - The settings.
 * @returns {string} The key.
 */
function connectionKeyOf(config) {
  return `${ID}:${dongleKey(config, config.host)}:${config.family}`;
}

/**
 * Makes the transport.
 *
 * @param {BundleSdk} sdk - What the hub hands a bundle.
 * @returns {Transport} The transport, registered as `solax/local`.
 */
export default function createSolaxLocal(sdk) {
  const { z } = sdk;

  /**
   * The way each dongle answered last, shared by scans, probes and polls.
   *
   * @type {Map<string, Variant>}
   */
  const preferred = new Map();

  /**
   * Reads a dongle: the way that worked last first, then the others, until one answers with
   * data. A dongle that did not answer at all is not asked the other ways when a way is known:
   * that is a dongle that is off, as a grid-tie one is every night, not one that changed its
   * mind about how it is asked.
   *
   * @param {Config} config - The dongle's settings.
   * @param {string} host - The dongle.
   * @param {AbortSignal} signal - Gives up.
   * @returns {Promise<JsonObject>} The payload.
   * @throws {Error} When no way gave data, with the most telling reason; its `cause` is the
   * kind of failure.
   */
  const read = async (config, host, signal) => {
    const key = dongleKey(config, host);
    const known = preferred.get(key);
    const order =
      known === undefined ? [...VARIANTS] : [known, ...VARIANTS.filter((each) => each !== known)];
    /** @type {{ kind: Failure, reason: string }[]} */
    const failures = [];

    /**
     * Tries the ways from one onwards.
     *
     * @param {number} index - The way to try now.
     * @returns {Promise<JsonObject>} The payload.
     * @throws {Error} When none is left.
     */
    const attempt = async (index) => {
      const variant = order[index];

      if (variant === undefined || signal.aborted) {
        const [worst] = failures.toSorted(
          (a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind),
        );

        throw new Error(`${host} ${worst?.reason ?? 'was not asked'}`, {
          cause: worst?.kind ?? 'timeout',
        });
      }

      const outcome = await askOnce(config, host, variant, signal);

      if (outcome.kind === 'data') {
        preferred.set(key, variant);

        return outcome.payload;
      }

      failures.push(outcome);

      // Nothing listening is nothing listening, whichever way it is asked. Silence is the same
      // once a way is known - a dongle that is off - but not before: an older firmware may sit
      // on a way it does not take.
      const isGone =
        outcome.kind === 'unreachable' || (outcome.kind === 'timeout' && known !== undefined);

      return attempt(isGone ? order.length : index + 1);
    };

    return attempt(0);
  };

  return sdk.defineTransport({
    id: ID,
    configSchema: z.object({
      host: z.string().min(1).max(256),
      password: z.string().max(128).default(''),
      family: z.enum(['auto', ...FAMILY_IDS]).default('auto'),
      timeoutMs: z.coerce.number().int().min(500).max(60_000).default(5000),
    }),

    /**
     * One connection per dongle and way of reading it. The password is in the key as a digest,
     * since a key ends up in logs.
     *
     * @param {Config} config - The dongle.
     * @returns {string} The key.
     */
    connectionKey: connectionKeyOf,

    /**
     * Starts the timers the subscriptions ask for, each reading its dongle and delivering what
     * it said.
     *
     * @param {Config} config - The dongle.
     * @param {TransportContext} context - Where readings go.
     * @returns {Promise<TransportConnection>} The connection.
     */
    connect: async (config, context) => {
      const key = connectionKeyOf(config);
      const stop = new AbortController();
      /** @type {Map<string, ReturnType<typeof setInterval>>} */
      const timers = new Map();
      /**
       * Polls still waiting on their dongle, so a slow one is not asked twice at once.
       *
       * @type {Set<string>}
       */
      const busy = new Set();
      /**
       * The last failure each dongle was warned about, so one that keeps refusing is one line.
       *
       * @type {Map<string, string>}
       */
      const warned = new Map();

      /**
       * Reads one dongle and delivers what it said.
       *
       * @param {string} id - The poll's key.
       * @param {string} deviceKey - The dongle.
       */
      const poll = (id, deviceKey) => {
        if (busy.has(id)) {
          return;
        }

        busy.add(id);
        read(config, deviceKey, stop.signal)
          .then((payload) => {
            warned.delete(deviceKey);
            context.deliver({ connectionKey: key, deviceKey, payload });
          })
          .catch((/** @type {unknown} */ error) => {
            const reason = error instanceof Error ? error.message : String(error);
            const kind = error instanceof Error ? error.cause : undefined;

            // A grid-tie inverter's dongle is off every night, which is the normal case and
            // logged at debug. A dongle that answers but not with data - a changed password, a
            // firmware that closed the local API - is worth one warning until it recovers.
            if (kind === 'timeout' || kind === 'unreachable' || stop.signal.aborted) {
              context.logger.debug({ err: error, deviceKey }, 'SolaX poll failed');
            } else if (warned.get(deviceKey) !== reason) {
              warned.set(deviceKey, reason);
              context.logger.warn({ deviceKey, reason }, 'SolaX dongle answered without data');
            }
          })
          .finally(() => {
            busy.delete(id);
          });
      };

      context.report('up');

      return {
        key,

        /**
         * Refuses: the local API only reads.
         *
         * @returns {Promise<unknown>} Never.
         * @throws {Error} Always.
         */
        send: () =>
          Promise.reject(new Error(`${ID} only reads: the dongle's local API takes no commands`)),

        /**
         * Replaces the polling timers.
         *
         * @param {readonly TransportSubscription[]} subscriptions - The polls to run.
         * @returns {Promise<void>} Settles once the timers match.
         */
        apply: (subscriptions) => {
          /** @type {Map<string, TransportSubscription>} */
          const wanted = new Map();

          for (const subscription of subscriptions) {
            if (subscription.op === 'poll' && typeof subscription.args['deviceKey'] === 'string') {
              wanted.set(JSON.stringify(subscription), subscription);
            }
          }

          for (const [id, timer] of timers) {
            if (!wanted.has(id)) {
              clearInterval(timer);
              timers.delete(id);
            }
          }

          for (const [id, subscription] of wanted) {
            const deviceKey = subscription.args['deviceKey'];

            if (timers.has(id) || typeof deviceKey !== 'string') {
              continue;
            }

            const everyMs = Math.max(Number(subscription.args['everyMs'] ?? 30_000), MIN_POLL_MS);
            const timer = setInterval(() => {
              poll(id, deviceKey);
            }, everyMs);

            timer.unref();
            timers.set(id, timer);

            // Read at once: until the first answer the entities have nothing to show.
            poll(id, deviceKey);
          }

          return Promise.resolve();
        },

        /**
         * Stops every timer and every request in flight.
         *
         * @returns {Promise<void>} Settles once nothing is left running.
         */
        close: () => {
          stop.abort();

          for (const timer of timers.values()) {
            clearInterval(timer);
          }

          timers.clear();

          return Promise.resolve();
        },
      };
    },

    /**
     * Reads the dongle at the address an owner typed, once, and says what answered.
     *
     * @param {Config} config - The dongle.
     * @param {JsonObject} terms - Unused: there is one question to ask.
     * @param {AbortSignal} signal - Ends the scan.
     * @yields {Discovered} The dongle, when it answered with data.
     */
    scan: async function* scan(config, terms, signal) {
      void terms;

      /** @type {JsonObject | undefined} */
      let payload;

      try {
        payload = await read(config, config.host, signal);
      } catch (error) {
        // Nothing there, or nothing readable, is not a scan's to report: identification asks
        // again, and the Test button says why.
        sdk.logger.debug({ err: error, host: config.host }, 'SolaX dongle not identified');

        return;
      }

      yield { deviceKey: config.host, payload };
    },

    /**
     * Reads the dongle once, the way identification will.
     *
     * @param {Config} config - The dongle.
     * @param {AbortSignal} signal - Gives up.
     * @returns {Promise<string>} What answered.
     * @throws {Error} When nothing answered with data - naming why.
     */
    probe: async (config, signal) => {
      const payload = await read(config, config.host, signal);
      const values = payload['values'];
      const soc =
        typeof values === 'object' && values !== null && !Array.isArray(values)
          ? values['battery_soc']
          : undefined;

      return `${config.host} answered: ${String(payload['model'])}, dongle ${String(payload['sn'])}${
        typeof soc === 'number' ? `, battery at ${String(soc)} %` : ''
      }`;
    },
  });
}
