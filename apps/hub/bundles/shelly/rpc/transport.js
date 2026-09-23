// @ts-check
/**
 * Shelly's own RPC, over the WebSocket every Gen2+ device serves at `ws://<host>/rpc`.
 *
 * One socket per device, kept open. Requests are JSON-RPC frames matched by id; the device
 * pushes `NotifyStatus` on its own once it has seen one request with a source, which is what
 * makes a dimmer's row move the instant a wall switch is pressed instead of at the next poll.
 *
 * A notification is a delta. The docs say to lay it over a known status, and that is done here
 * rather than in the profiles: the transport keeps the last `Shelly.GetStatus` of the device,
 * merges each notification into it - per component, attribute by attribute, `null` removing
 * one - and delivers the whole. A profile therefore never sees a partial report, and a cover
 * that was told only that it is `opening` keeps the position it had.
 *
 * Authentication is RFC 7616 digest, SHA-256, carried inside the frame the way Shelly does it:
 * a 401 error whose message is the challenge, then the same request again with an `auth`
 * object. The nonce is kept and its count moved on for the requests that follow, and the count
 * travels as a number and enters the hash in decimal - which is how Home Assistant's client
 * talks to every firmware, the ones before 2.0 included. A stale nonce is replaced once; a
 * second refusal is a wrong password.
 *
 * This file is what ships in the bundle. It imports nothing from the platform: what it needs
 * - zod, `defineTransport`, the managed socket - arrives as the `sdk` it is called with.
 */
import { createHash, randomInt } from 'node:crypto';

/** @typedef {import('@nebula-home/package-runtime').BundleSdk} BundleSdk */
/** @typedef {import('@nebula-home/package-runtime').Transport} Transport */
/** @typedef {import('@nebula-home/package-runtime').TransportConnection} TransportConnection */
/** @typedef {import('@nebula-home/package-runtime').TransportContext} TransportContext */
/** @typedef {import('@nebula-home/package-runtime').TransportRequest} TransportRequest */
/** @typedef {import('@nebula-home/package-runtime').TransportSubscription} TransportSubscription */
/** @typedef {import('@nebula-home/package-runtime').Discovered} Discovered */
/** @typedef {import('@nebula-home/logging').PlatformLogger} PlatformLogger */
/** @typedef {import('@nebula-home/contracts').JsonObject} JsonObject */

/**
 * What an owner configures to reach one device.
 *
 * @typedef {object} Config
 * @property {string} host - `host` or `host:port`.
 * @property {string | undefined} [password] - Set when authentication is on in the device.
 * @property {number} timeoutMs - How long a request has before the socket is reset.
 */

/**
 * The nonce in use, and the count its next request carries.
 *
 * @typedef {object} AuthState
 * @property {string} realm - The device's realm, which is its id.
 * @property {string | number} nonce - The nonce, echoed with the JSON type it came in.
 * @property {number} count - The next nonce count.
 */

/**
 * A challenge, as the device words it.
 *
 * @typedef {object} Challenge
 * @property {string} realm - The device's realm.
 * @property {string | number} nonce - The nonce to answer with.
 * @property {number} count - Where the count starts: what an older firmware says, else one.
 */

/**
 * One request in flight.
 *
 * @typedef {object} Pending
 * @property {number} id - The id of the frame last sent for it.
 * @property {string} method - What was asked, for the words a failure uses.
 * @property {JsonObject | undefined} params - Its parameters.
 * @property {boolean} isRetry - Whether a challenge was already answered for it.
 * @property {(value: unknown) => void} resolve - Settles it.
 * @property {(reason: Error) => void} reject - Fails it.
 * @property {ReturnType<typeof setTimeout> | undefined} timer - Its timeout.
 * @property {(() => void) | undefined} stopListening - Drops its abort listener.
 */

/**
 * Somebody waiting for the socket to open.
 *
 * @typedef {object} Waiter
 * @property {() => void} resolve - Called on open.
 * @property {(reason: Error) => void} reject - Called when it will not open.
 */

/**
 * What a session calls back.
 *
 * @typedef {object} SessionHooks
 * @property {boolean} reconnect - Whether to come back after a drop.
 * @property {(() => void) | undefined} [onOpen] - Called after each connection.
 * @property {((reason: string) => void) | undefined} [onClose] - Called after each drop.
 * @property {((method: string, params: Record<string, unknown>) => void) | undefined} [onNotification] - Called per status notification.
 */

/**
 * A socket to one device and the request bookkeeping over it.
 *
 * @typedef {object} Session
 * @property {(method: string, params?: JsonObject, signal?: AbortSignal) => Promise<unknown>} call - Asks the device one thing.
 * @property {(signal: AbortSignal) => Promise<void>} whenOpen - Settles once the socket is open.
 * @property {() => boolean} isOpen - Whether it is open now.
 * @property {() => Promise<void>} close - Closes for good.
 */

/** The id this transport registers under: the vendor's, then the name in `manifest.json`. */
const ID = 'shelly/rpc';

/** The source every frame names, which is what the device addresses its notifications to. */
const SOURCE = 'nebula-hub';

/** Shelly's one user. */
const USERNAME = 'admin';

/** The method every status comes from. */
const STATUS_METHOD = 'Shelly.GetStatus';

/** The method a probe asks when the profile does not say: exempt from authentication. */
const INFO_METHOD = 'Shelly.GetDeviceInfo';

/** How often the whole status is asked for when the profile does not say: a keepalive too. */
const DEFAULT_STATUS_MS = 60_000;

/** Never more often than this, so a profile cannot sit on a device. */
const MIN_STATUS_MS = 5000;

/** The error code that carries a challenge. */
const UNAUTHORIZED = 401;

/** What the device is told when it calls the hub, which answers nothing. */
const NOT_IMPLEMENTED = { code: 500, message: 'Not Implemented' };

/** The notifications that carry status. */
const STATUS_NOTIFICATIONS = new Set(['NotifyStatus', 'NotifyFullStatus']);

/**
 * Hashes text the way the digest wants it.
 *
 * @param {string} text - What to hash.
 * @returns {string} The hex digest.
 */
function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

/** The one-request half of the digest, fixed for a WebSocket by the docs. */
const HA2 = sha256('dummy_method:dummy_uri');

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
 * Reads a challenge out of an error object, when it is one.
 *
 * @param {unknown} error - The frame's error.
 * @returns {Challenge | null} The challenge, or null when the error is something else.
 */
function challengeOf(error) {
  if (!isRecord(error) || error['code'] !== UNAUTHORIZED) {
    return null;
  }

  const message = error['message'];

  if (typeof message !== 'string') {
    return null;
  }

  /** @type {unknown} */
  let parsed;

  try {
    parsed = JSON.parse(message);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const realm = parsed['realm'];
  const nonce = parsed['nonce'];
  // A Wall Display sends the count as a string; everything else as a number, or not at all.
  const count = Number.parseInt(String(parsed['nc'] ?? 1), 10);

  if (typeof realm !== 'string' || (typeof nonce !== 'string' && typeof nonce !== 'number')) {
    return null;
  }

  return { realm, nonce, count: Number.isFinite(count) && count > 0 ? count : 1 };
}

/**
 * Builds the auth object for one request and moves the count on.
 *
 * @param {string} password - The device's password.
 * @param {AuthState} state - The nonce in use.
 * @returns {Record<string, unknown>} What a frame carries as `auth`.
 */
function authFor(password, state) {
  const ha1 = sha256(`${USERNAME}:${state.realm}:${password}`);
  const cnonce = randomInt(1, 2 ** 31);
  const nc = state.count;
  const response = sha256(
    `${ha1}:${String(state.nonce)}:${String(nc)}:${String(cnonce)}:auth:${HA2}`,
  );

  state.count += 1;

  return {
    realm: state.realm,
    username: USERNAME,
    nonce: state.nonce,
    cnonce,
    nc,
    response,
    algorithm: 'SHA-256',
  };
}

/**
 * Words an error frame the device sent, for a person.
 *
 * @param {unknown} error - The frame's error.
 * @returns {string} Its message and code, or the object as it came.
 */
function describeError(error) {
  if (isRecord(error) && typeof error['message'] === 'string') {
    const code = error['code'];

    return typeof code === 'number' ? `${error['message']} (${String(code)})` : error['message'];
  }

  return JSON.stringify(error);
}

/**
 * Lays a notification over a status.
 *
 * @param {Record<string, unknown>} snapshot - The status known so far.
 * @param {Record<string, unknown>} params - The notification's params.
 * @returns {Record<string, unknown>} The status with the changes in.
 */
function overlay(snapshot, params) {
  /** @type {Record<string, unknown>} */
  const next = { ...snapshot };

  for (const [component, changes] of Object.entries(params)) {
    if (component === 'ts') {
      continue;
    }

    if (!isRecord(changes)) {
      next[component] = changes;
      continue;
    }

    const current = next[component];

    // What the notification sets to null is gone; what the status already held as null stays.
    next[component] = Object.fromEntries(
      Object.entries({ ...(isRecord(current) ? current : {}), ...changes }).filter(
        ([attribute]) => changes[attribute] !== null,
      ),
    );
  }

  return next;
}

/**
 * Reads a string field.
 *
 * @param {unknown} record - Where to read.
 * @param {string} key - Which field.
 * @returns {string | undefined} The value when it is a string.
 */
function textOf(record, key) {
  const value = isRecord(record) ? record[key] : undefined;

  return typeof value === 'string' ? value : undefined;
}

/**
 * Opens a session: a socket and the request/response bookkeeping over it.
 *
 * @param {BundleSdk} sdk - The platform pieces.
 * @param {Config} config - The device.
 * @param {PlatformLogger} logger - Where to write.
 * @param {SessionHooks} hooks - What to call back.
 * @returns {Session} The session, connecting in the background.
 */
function openSession(sdk, config, logger, hooks) {
  /** @type {Map<number, Pending>} */
  const pending = new Map();
  /** @type {AuthState | null} */
  let auth = null;
  /** @type {Waiter[]} */
  let waiting = [];
  /** @type {string | null} */
  let peer = null;
  let nextId = 1;

  /**
   * Stops a request's timer and abort listener, once it is settled either way.
   *
   * @param {Pending} request - The request.
   */
  function finish(request) {
    clearTimeout(request.timer);
    request.stopListening?.();
  }

  /**
   * Fails everything in flight.
   *
   * @param {string} reason - Why, as the end of a sentence about the device.
   */
  function failAll(reason) {
    const requests = [...pending.values()];

    pending.clear();

    for (const request of requests) {
      finish(request);
      request.reject(new Error(`${config.host} ${reason} before answering ${request.method}`));
    }
  }

  /**
   * Sends a request under a fresh id, with the auth object when there is a nonce to use.
   *
   * @param {Pending} request - The request.
   */
  function dispatch(request) {
    const id = nextId;
    nextId += 1;
    request.id = id;

    const frame = {
      id,
      src: SOURCE,
      method: request.method,
      ...(request.params === undefined ? {} : { params: request.params }),
      ...(auth === null || config.password === undefined
        ? {}
        : { auth: authFor(config.password, auth) }),
    };

    pending.set(id, request);

    try {
      socket.send(JSON.stringify(frame));
    } catch {
      pending.delete(id);
      finish(request);
      request.reject(new Error(`${config.host} is not connected right now`));
    }
  }

  /**
   * Settles the request a response frame answers.
   *
   * @param {Record<string, unknown>} frame - The response.
   */
  function settle(frame) {
    const id = frame['id'];
    const request = typeof id === 'number' ? pending.get(id) : undefined;

    if (request === undefined) {
      // The answer to a request already given up on.
      return;
    }

    pending.delete(request.id);

    if (!('error' in frame)) {
      finish(request);
      request.resolve(frame['result']);

      return;
    }

    const challenge = challengeOf(frame['error']);

    if (challenge === null) {
      finish(request);
      request.reject(
        new Error(`${config.host} answered ${request.method}: ${describeError(frame['error'])}`),
      );

      return;
    }

    if (config.password === undefined) {
      finish(request);
      request.reject(new Error(`${config.host} asks for a password`));

      return;
    }

    if (request.isRetry) {
      auth = null;
      finish(request);
      request.reject(new Error(`${config.host} refused the password`));

      return;
    }

    // The first challenge, or a nonce gone stale: take the new one and ask again, once.
    auth = { realm: challenge.realm, nonce: challenge.nonce, count: challenge.count };
    request.isRetry = true;
    dispatch(request);
  }

  /**
   * Declines a call the device makes, so that it is not left waiting for an answer.
   *
   * @param {unknown} id - The id of its call.
   */
  function decline(id) {
    try {
      socket.send(
        JSON.stringify({
          id,
          src: SOURCE,
          ...(peer === null ? {} : { dst: peer }),
          error: NOT_IMPLEMENTED,
        }),
      );
    } catch {
      // The socket went in the meantime; the device has stopped waiting too.
    }
  }

  const socket = sdk.openWebSocket({
    url: `ws://${config.host}/rpc`,
    logger,
    reconnect: hooks.reconnect ? {} : false,

    /**
     * Lets whoever waited for the socket go ahead.
     */
    onOpen: () => {
      const waiters = waiting;
      waiting = [];

      for (const waiter of waiters) {
        waiter.resolve();
      }

      hooks.onOpen?.();
    },

    /**
     * Fails what was in flight, and - for a socket that will not come back - whoever waited.
     *
     * @param {string} reason - Why it went.
     */
    onClose: (reason) => {
      failAll(`dropped (${reason})`);

      if (!hooks.reconnect) {
        const waiters = waiting;
        waiting = [];

        for (const waiter of waiters) {
          waiter.reject(new Error(`${config.host} did not answer: ${reason}`));
        }
      }

      hooks.onClose?.(reason);
    },

    /**
     * Tells a response from a notification from a call, and hands each to its reader.
     *
     * @param {string} text - One frame.
     */
    onMessage: (text) => {
      /** @type {unknown} */
      let frame;

      try {
        frame = JSON.parse(text);
      } catch {
        logger.debug({ host: config.host }, 'A frame that is not JSON');

        return;
      }

      if (!isRecord(frame)) {
        return;
      }

      const source = frame['src'];

      if (typeof source === 'string') {
        peer = source;
      }

      const method = frame['method'];

      if (typeof method !== 'string') {
        settle(frame);

        return;
      }

      if (frame['id'] !== undefined && frame['id'] !== null) {
        decline(frame['id']);

        return;
      }

      const params = frame['params'];

      if (STATUS_NOTIFICATIONS.has(method) && isRecord(params)) {
        hooks.onNotification?.(method, params);
      } else {
        logger.debug({ host: config.host, method }, 'A notification that carries no status');
      }
    },
  });

  return {
    /**
     * Says whether a frame can be sent now.
     *
     * @returns {boolean} True while the socket is open.
     */
    isOpen: () => socket.isOpen,

    /**
     * Waits for the socket to open.
     *
     * @param {AbortSignal} signal - Gives up.
     * @returns {Promise<void>} Settled on open; rejected when the signal fires or, for a socket
     * that will not come back, when it closed without opening.
     */
    whenOpen: (signal) =>
      new Promise((resolve, reject) => {
        if (socket.isOpen) {
          resolve();

          return;
        }

        if (signal.aborted) {
          reject(new Error(`${config.host} did not answer: timed out`));

          return;
        }

        /** @type {Waiter} */
        const waiter = {
          /**
           * Stops listening for the abort and lets the caller go ahead.
           */
          resolve: () => {
            signal.removeEventListener('abort', onAbort);
            resolve();
          },

          /**
           * Stops listening for the abort and fails the caller.
           *
           * @param {Error} reason - Why the socket will not open.
           */
          reject: (reason) => {
            signal.removeEventListener('abort', onAbort);
            reject(reason);
          },
        };

        /**
         * Gives up waiting.
         */
        function onAbort() {
          waiting = waiting.filter((each) => each !== waiter);
          reject(new Error(`${config.host} did not answer: timed out`));
        }

        signal.addEventListener('abort', onAbort, { once: true });
        waiting.push(waiter);
      }),

    /**
     * Asks the device one thing.
     *
     * @param {string} method - The method.
     * @param {JsonObject} [params] - Its parameters.
     * @param {AbortSignal} [signal] - Gives up.
     * @returns {Promise<unknown>} What the device answered.
     */
    call: (method, params, signal) =>
      new Promise((resolve, reject) => {
        if (signal?.aborted === true) {
          reject(new Error(`${config.host}: ${method} was given up on`));

          return;
        }

        /** @type {Pending} */
        const request = {
          id: 0,
          method,
          params,
          isRetry: false,
          resolve,
          reject,
          timer: undefined,
          stopListening: undefined,
        };

        // One timeout for the whole call, the answer to a challenge included.
        request.timer = setTimeout(() => {
          pending.delete(request.id);
          request.stopListening?.();
          reject(
            new Error(
              `${config.host} did not answer ${method} within ${String(config.timeoutMs)} ms`,
            ),
          );
          socket.reset('request timed out');
        }, config.timeoutMs);
        request.timer.unref();

        if (signal !== undefined) {
          /**
           * Gives the request up.
           */
          const onAbort = () => {
            if (pending.delete(request.id)) {
              clearTimeout(request.timer);
              reject(new Error(`${config.host}: ${method} was given up on`));
            }
          };

          signal.addEventListener('abort', onAbort, { once: true });

          /**
           * Stops listening for the abort, once the request is settled.
           */
          request.stopListening = () => {
            signal.removeEventListener('abort', onAbort);
          };
        }

        dispatch(request);
      }),

    /**
     * Fails what is in flight and closes the socket for good.
     *
     * @returns {Promise<void>} Settled once closed.
     */
    close: async () => {
      failAll('closed');
      await socket.close();
    },
  };
}

/**
 * Asks a device something over a socket opened for it and closed again.
 *
 * @param {BundleSdk} sdk - The platform pieces.
 * @param {Config} config - The device.
 * @param {AbortSignal} signal - Gives up.
 * @param {(session: Session) => Promise<unknown>} ask - What to ask once the socket is open.
 * @returns {Promise<unknown>} What `ask` returned.
 */
async function once(sdk, config, signal, ask) {
  const session = openSession(sdk, config, sdk.logger, { reconnect: false });

  try {
    await session.whenOpen(signal);

    return await ask(session);
  } finally {
    await session.close();
  }
}

/**
 * Reads the probe method out of an integration's search terms.
 *
 * @param {JsonObject} terms - The integration's `discovery`.
 * @returns {string} The method its probe names, or the device-info one.
 */
function probeMethodOf(terms) {
  const probe = terms['probe'];
  const args = isRecord(probe) ? probe['args'] : undefined;
  const method = isRecord(args) ? args['method'] : undefined;

  return typeof method === 'string' ? method : INFO_METHOD;
}

/**
 * Builds the transport.
 *
 * @param {BundleSdk} sdk - What the hub hands a bundle.
 * @returns {Transport} The transport, registered as `shelly/rpc`.
 */
export default function createShellyRpc(sdk) {
  const configSchema = sdk.z.object({
    /** The device, as `host` or `host:port`. */
    host: sdk.z.string().min(1).max(256),

    /** The password set in the device's web page, when authentication is on. */
    password: sdk.z.string().min(1).max(512).optional(),

    /** How long a request has before the socket is reset. */
    timeoutMs: sdk.z.coerce.number().int().min(100).max(60_000).default(5000),
  });

  return sdk.defineTransport({
    id: ID,
    configSchema,

    /**
     * One socket per device: two instances at one address share it.
     *
     * @param {Config} config - The settings.
     * @returns {string} The key.
     */
    connectionKey: (config) => `${ID}:${config.host}`,

    /**
     * Opens the socket and the status timers.
     *
     * @param {Config} config - The settings.
     * @param {TransportContext} context - Where statuses and drops go.
     * @returns {Promise<TransportConnection>} The connection, connecting in the background.
     */
    connect: (config, context) => {
      const key = `${ID}:${config.host}`;
      /** @type {Map<string, ReturnType<typeof setInterval>>} */
      const timers = new Map();
      /** @type {Record<string, unknown> | null} */
      let snapshot = null;

      /**
       * Hands the status over, as the device knows it now.
       */
      function deliver() {
        if (snapshot !== null) {
          context.deliver({ connectionKey: key, deviceKey: config.host, payload: snapshot });
        }
      }

      /**
       * Asks for the whole status and delivers it.
       *
       * @returns {Promise<void>} Settled either way: a device that is off is the normal case for
       * a house, and the entities go stale, which `core` reads as unavailable.
       */
      async function refresh() {
        try {
          const status = await session.call(STATUS_METHOD);

          if (isRecord(status)) {
            snapshot = status;
            deliver();
          }
        } catch (error) {
          context.logger.debug({ err: error, host: config.host }, 'Status not answered');
        }
      }

      const session = openSession(sdk, config, context.logger, {
        reconnect: true,

        /**
         * Says the device is reachable, and asks what it is doing when anything is listening.
         */
        onOpen: () => {
          context.report('up');

          if (timers.size > 0) {
            void refresh();
          }
        },
        /**
         * Says the device is not reachable.
         */
        onClose: () => {
          // What the device said before the drop is not what it says now; the status asked
          // for on the next open says it all again.
          snapshot = null;
          context.report('down');
        },
        /**
         * Lays a notification over the status and delivers the whole.
         *
         * @param {string} method - `NotifyStatus` or `NotifyFullStatus`.
         * @param {Record<string, unknown>} params - What changed.
         */
        onNotification: (method, params) => {
          if (snapshot === null) {
            return;
          }

          snapshot = overlay(snapshot, params);
          deliver();
        },
      });

      /** @type {TransportConnection} */
      const connection = {
        key,

        /**
         * Asks the device one thing.
         *
         * @param {TransportRequest} request - A `call`, with `method` and `params`.
         * @param {AbortSignal} signal - Gives up.
         * @returns {Promise<unknown>} What the device answered.
         */
        send: (request, signal) => {
          if (request.op !== 'call') {
            return Promise.reject(new Error(`${ID} does not know the ${request.op} op`));
          }

          const method = request.args['method'];
          const params = request.args['params'];

          if (typeof method !== 'string') {
            return Promise.reject(new Error(`${ID} was asked to call no method`));
          }

          return session.call(method, isRecord(params) ? params : undefined, signal);
        },

        /**
         * Replaces the status timers.
         *
         * @param {readonly TransportSubscription[]} subscriptions - The `status` ones count.
         * @returns {Promise<void>} Settled once the timers match.
         */
        apply: (subscriptions) => {
          /** @type {Map<string, number>} */
          const wanted = new Map();

          for (const subscription of subscriptions) {
            if (subscription.op === 'status') {
              const everyMs = Math.max(
                Number(subscription.args['everyMs'] ?? DEFAULT_STATUS_MS),
                MIN_STATUS_MS,
              );

              wanted.set(JSON.stringify(subscription), everyMs);
            }
          }

          for (const [id, timer] of timers) {
            if (!wanted.has(id)) {
              clearInterval(timer);
              timers.delete(id);
            }
          }

          for (const [id, everyMs] of wanted) {
            if (timers.has(id)) {
              continue;
            }

            const timer = setInterval(() => {
              void refresh();
            }, everyMs);
            timer.unref();
            timers.set(id, timer);
          }

          if (wanted.size > 0 && session.isOpen()) {
            void refresh();
          }

          return Promise.resolve();
        },

        /**
         * Stops the timers and closes the socket.
         *
         * @returns {Promise<void>} Settled once closed.
         */
        close: async () => {
          for (const timer of timers.values()) {
            clearInterval(timer);
          }

          timers.clear();
          await session.close();
        },
      };

      return Promise.resolve(connection);
    },

    /**
     * Asks the one configured address who it is.
     *
     * @param {Config} config - The settings.
     * @param {JsonObject} terms - The integration's search terms, whose probe names the method.
     * @param {AbortSignal} signal - Ends the scan.
     * @yields {Discovered} The address, when it answered.
     */
    scan: async function* scan(config, terms, signal) {
      /** @type {unknown} */
      let payload;

      try {
        payload = await once(sdk, config, signal, (session) =>
          session.call(probeMethodOf(terms), undefined, signal),
        );
      } catch (error) {
        // An address with nothing behind it is the ordinary outcome of a typo, or of a device
        // that is off, and the instance keeps asking.
        sdk.logger.debug({ err: error, host: config.host }, 'Probe not answered');

        return;
      }

      yield { deviceKey: config.host, payload };
    },

    /**
     * Tries the address once, and the password with it.
     *
     * @param {Config} config - What the owner typed.
     * @param {AbortSignal} signal - Gives up.
     * @returns {Promise<string>} What answered.
     * @throws {Error} When nothing answered, a password is missing, or it was refused.
     */
    probe: async (config, signal) => {
      const verdict = await once(sdk, config, signal, async (session) => {
        const info = await session.call(INFO_METHOD, undefined, signal);
        const model = textOf(info, 'model') ?? textOf(info, 'app') ?? 'a Shelly';
        const version = textOf(info, 'ver');

        if (isRecord(info) && info['auth_en'] === true && config.password === undefined) {
          throw new Error(`${config.host} asks for a password`);
        }

        if (config.password !== undefined) {
          // Asked now so that a wrong password fails under the Test button rather than at the
          // first status after the device was saved.
          await session.call(STATUS_METHOD, undefined, signal);
        }

        return `${config.host} answered: ${model}${version === undefined ? '' : `, firmware ${version}`}`;
      });

      return String(verdict);
    },
  });
}
