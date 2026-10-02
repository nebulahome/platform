// @ts-check
/**
 * What Govee's own cloud says a light did, heard as it happens.
 *
 * The LAN API pushes nothing: a light changed from the Govee app, its remote or its button is
 * only seen the next time it is asked. The Govee app hears such changes at once, over an MQTT
 * session with Amazon's IoT service that Govee's servers hand it a client certificate for - not a
 * documented API, the one govee2mqtt reads the same way. An owner who gives the bundle their
 * Govee account gets that session too; one who does not loses nothing but the speed.
 *
 * Only listened to. Commands still go over the LAN, which answers in milliseconds and works with
 * the internet down; the cloud only tells the hub sooner what a light is showing, and its word
 * goes through the same reading as a status the light itself answered. One session per account,
 * shared by every light of it and held while any of them is.
 *
 * Nothing here is logged with a credential in it: the email only as a digest, the password and
 * the certificate never.
 */
import { createHash, randomUUID } from 'node:crypto';

/** @typedef {import('@nebulahome/package-runtime').BundleSdk} BundleSdk */
/** @typedef {import('@nebulahome/package-runtime').ManagedMqtt} ManagedMqtt */

/** Where the Govee app signs in. */
const LOGIN_URL = 'https://app2.govee.com/account/rest/account/v1/login';

/** Where it is handed the certificate for the IoT session. */
const IOT_KEY_URL = 'https://app2.govee.com/app/v1/account/iot/key';

/** The app version the requests say they come from; the service checks that one is given. */
const APP_VERSION = '6.5.02';

/** What they say they are. */
const USER_AGENT = `GoveeHome/${APP_VERSION} (com.ihoment.GoVeeSensor; build:2; iOS 16.5.0) Alamofire/5.6.4`;

/** The DNS namespace of RFC 4122, which the app's client id is derived in. */
const DNS_NAMESPACE = '6ba7b8109dad11d180b400c04fd430c8';

/** How long a request to Govee's servers has. */
const REQUEST_TIMEOUT_MS = 15_000;

/** The shortest and longest pause before signing in again after a failure. */
const RETRY_MIN_MS = 30_000;
const RETRY_MAX_MS = 30 * 60_000;

/**
 * Called with what the cloud says one light is showing, in the LAN API's own words.
 *
 * @callback CloudListener
 * @param {Record<string, unknown>} state - `onOff`, `brightness`, `color`, `colorTemInKelvin`.
 * @returns {void}
 */

/**
 * One account's session, while any light of it is held.
 *
 * @typedef {object} Session
 * @property {Map<string, Set<CloudListener>>} listeners - Who hears each light, by its id.
 * @property {ManagedMqtt | undefined} mqtt - The session, once signed in.
 * @property {ReturnType<typeof setTimeout> | undefined} timer - The next sign-in.
 * @property {number} retryMs - The pause before the next sign-in after a failure.
 * @property {boolean} isClosed - Whether the last light let go.
 */

/** @type {Map<string, Session>} */
const sessions = new Map();

/**
 * A version-5 UUID, as the app derives its client id from the account's email.
 *
 * @param {string} name - The email.
 * @returns {string} The UUID, as 32 hexadecimal digits.
 */
export function uuidV5(name) {
  const hash = createHash('sha1')
    .update(Buffer.from(DNS_NAMESPACE, 'hex'))
    .update(name, 'utf8')
    .digest();
  const bytes = hash.subarray(0, 16);

  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  return bytes.toString('hex');
}

/**
 * A digest of the account's email, for a log line that must say which account without saying it.
 *
 * @param {string} email - The email.
 * @returns {string} Eight hexadecimal digits.
 */
function accountTag(email) {
  return createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 8);
}

/**
 * The headers every request to Govee's servers carries.
 *
 * @param {string} clientId - The app's client id.
 * @returns {Record<string, string>} The headers.
 */
function headersOf(clientId) {
  return {
    appVersion: APP_VERSION,
    clientId,
    clientType: '1',
    iotVersion: '0',
    timestamp: String(Date.now()),
    'user-agent': USER_AGENT,
  };
}

/**
 * Reads an object out of a value, or nothing.
 *
 * @param {unknown} value - The value.
 * @returns {Record<string, unknown> | undefined} It, when it is one.
 */
function recordOf(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : undefined;
}

/**
 * Signs in and asks for the certificate, as the app does.
 *
 * @param {string} email - The account.
 * @param {string} password - Its password.
 * @param {typeof fetch} request - How to ask.
 * @returns {Promise<{ accountId: string, topic: string, endpoint: string, p12: Buffer, passphrase: string, expiresInMs: number }>}
 * What the session needs.
 * @throws {Error} When the servers refused or said something unreadable.
 */
export async function signIn(email, password, request = fetch) {
  const clientId = uuidV5(email);
  const login = await request(LOGIN_URL, {
    method: 'POST',
    headers: { ...headersOf(clientId), 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, client: clientId }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const signed = recordOf(await login.json().catch(() => undefined));
  const client = recordOf(signed?.['client']);
  const token = client?.['token'];
  const topic = client?.['topic'];
  const accountId = client?.['accountId'];

  if (!login.ok || typeof token !== 'string' || typeof topic !== 'string') {
    const message = signed?.['message'];

    throw new Error(
      `Govee refused the sign-in${typeof message === 'string' ? `: ${message}` : ` (HTTP ${String(login.status)})`}`,
    );
  }

  const keyAnswer = await request(IOT_KEY_URL, {
    headers: { ...headersOf(clientId), authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const key = recordOf(recordOf(await keyAnswer.json().catch(() => undefined))?.['data']);
  const endpoint = key?.['endpoint'];
  const p12 = key?.['p12'];
  const passphrase = key?.['p12_pass'];

  if (
    !keyAnswer.ok ||
    typeof endpoint !== 'string' ||
    typeof p12 !== 'string' ||
    typeof passphrase !== 'string'
  ) {
    throw new Error(`Govee gave no IoT certificate (HTTP ${String(keyAnswer.status)})`);
  }

  const cycle = client?.['tokenExpireCycle'];

  return {
    accountId: String(accountId ?? ''),
    topic,
    endpoint,
    p12: Buffer.from(p12, 'base64'),
    passphrase,
    expiresInMs: typeof cycle === 'number' && cycle > 0 ? cycle * 1000 : 24 * 60 * 60_000,
  };
}

/**
 * Reads one message the session heard: which light, and what it is showing.
 *
 * @param {Buffer} payload - The message.
 * @returns {{ device: string, state: Record<string, unknown> } | undefined} What it says, or
 * nothing for a message that is not a light's state.
 */
export function stateMessageOf(payload) {
  /** @type {unknown} */
  let parsed;

  try {
    parsed = JSON.parse(payload.toString('utf8'));
  } catch {
    return undefined;
  }

  const message = recordOf(parsed);
  const device = message?.['device'];
  const state = recordOf(message?.['state']);

  return typeof device === 'string' && state !== undefined ? { device, state } : undefined;
}

/**
 * Starts, or starts again, one account's session.
 *
 * @param {BundleSdk} sdk - What the hub handed the vendor.
 * @param {Session} session - The session.
 * @param {string} email - The account.
 * @param {string} password - Its password.
 */
function begin(sdk, session, email, password) {
  const tag = accountTag(email);

  signIn(email, password)
    .then((granted) => {
      if (session.isClosed) {
        return;
      }

      session.retryMs = RETRY_MIN_MS;
      void session.mqtt?.close();
      session.mqtt = sdk.openMqtt({
        url: `mqtts://${granted.endpoint}:8883`,
        clientId: `AP/${granted.accountId}/${randomUUID().replaceAll('-', '')}`,
        tls: { pfx: granted.p12, passphrase: granted.passphrase },
        logger: sdk.logger,
        /** Says the account is being listened to. */
        onConnect: () => {
          sdk.logger.info({ account: tag }, 'Listening to the Govee cloud for light changes');
        },

        /**
         * Hands what the cloud says a light shows to whoever holds that light.
         *
         * @param {string} _topic - The account's topic; there is only the one.
         * @param {Buffer} payload - The message.
         */
        onMessage: (_topic, payload) => {
          const heard = stateMessageOf(payload);

          if (heard === undefined) {
            return;
          }

          for (const listener of session.listeners.get(heard.device) ?? []) {
            listener(heard.state);
          }
        },
      });
      session.mqtt.subscribe(granted.topic);

      // Signed in again a little before the token runs out, with a fresh certificate.
      schedule(sdk, session, email, password, Math.max(granted.expiresInMs * 0.9, RETRY_MIN_MS));
    })
    .catch((/** @type {unknown} */ error) => {
      if (session.isClosed) {
        return;
      }

      // One warning per failed sign-in, with no credential in it; the lights still answer on
      // the LAN, only more slowly.
      sdk.logger.warn(
        { account: tag, reason: error instanceof Error ? error.message : String(error) },
        'Could not listen to the Govee cloud; the lights are still read on the LAN',
      );
      schedule(sdk, session, email, password, session.retryMs);
      session.retryMs = Math.min(session.retryMs * 2, RETRY_MAX_MS);
    });
}

/**
 * Signs in again later.
 *
 * @param {BundleSdk} sdk - What the hub handed the vendor.
 * @param {Session} session - The session.
 * @param {string} email - The account.
 * @param {string} password - Its password.
 * @param {number} afterMs - When.
 */
function schedule(sdk, session, email, password, afterMs) {
  clearTimeout(session.timer);
  session.timer = setTimeout(() => {
    begin(sdk, session, email, password);
  }, afterMs);
  session.timer.unref();
}

/**
 * Listens to what the cloud says about one light, for as long as the hold lasts.
 *
 * @param {BundleSdk} sdk - What the hub handed the vendor.
 * @param {{ email: string, password: string }} account - The owner's Govee account.
 * @param {string} device - The light's id, as its scan answer gives it.
 * @param {CloudListener} listener - Called with each state the cloud reports for it.
 * @returns {{ release: () => Promise<void> }} The hold.
 */
export function listenToCloud(sdk, account, device, listener) {
  const key = `${account.email.toLowerCase()}\n${createHash('sha256').update(account.password).digest('hex')}`;
  let session = sessions.get(key);

  if (session === undefined) {
    session = {
      listeners: new Map(),
      mqtt: undefined,
      timer: undefined,
      retryMs: RETRY_MIN_MS,
      isClosed: false,
    };
    sessions.set(key, session);
    begin(sdk, session, account.email, account.password);
  }

  const held = session;
  const listeners = held.listeners.get(device) ?? new Set();

  listeners.add(listener);
  held.listeners.set(device, listeners);

  return {
    /**
     * Stops hearing the light, and ends the account's session when no light is heard any more.
     *
     * @returns {Promise<void>} Settles once let go.
     */
    release: async () => {
      listeners.delete(listener);

      if (listeners.size === 0) {
        held.listeners.delete(device);
      }

      if (held.listeners.size === 0 && sessions.get(key) === held) {
        sessions.delete(key);
        held.isClosed = true;
        clearTimeout(held.timer);
        await held.mqtt?.close();
      }
    },
  };
}
