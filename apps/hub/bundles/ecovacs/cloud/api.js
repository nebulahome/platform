// @ts-check
/**
 * ECOVACS's cloud, spoken the way the ECOVACS HOME app speaks it.
 *
 * A GOAT mower has no local API: the app reaches it through ECOVACS's servers, and so does this
 * bundle. Nothing here is a documented API - it is what the app sends, as the community's
 * `ecovacs-goat-g1` integration for Home Assistant (MIT) observed it - so every request says it
 * comes from the app, and every answer is read defensively.
 *
 * Signing in is four steps. The account's password, as an MD5 digest, is exchanged for an account
 * session (`user/login`); the session for an authorisation code (`getAuthCode`); the code for the
 * portal's credentials (`loginByItToken`), which every later call and the MQTT session carry. A
 * sign-in from a client ECOVACS has not seen before is refused until that client is confirmed with
 * a code ECOVACS emails to the account (`sendEmailVerifyCode`, then `verifyDevice`), after which
 * the same client signs in with the password alone. The client is named by eight characters
 * derived from the account's email, so it is the same client at every start.
 *
 * A command is posted to the N-GIoT control endpoint with a short-lived token issued for that one
 * mower (`sst/issue`), in the app's envelope: `{ header, body: { data } }`.
 *
 * Imports nothing from the platform; `fetch` is Node's, or a test's.
 */
import { createHash, createPublicKey, publicEncrypt, constants } from 'node:crypto';

/** The app's own keys and secrets, the same in every copy of it: not a user's credential. */
const CLIENT_KEY = '1520391301804';
const CLIENT_SECRET = '6c319b2a5cd3e66e39159c2e28f2fce9';
const AUTH_CLIENT_KEY = '1520391491841';
const AUTH_CLIENT_SECRET = '77ef58ce3afbe337da74aa8c5ab963a9';

/** What the requests say they come from. */
const META = {
  lang: 'EN',
  appCode: 'global_e',
  appVersion: '3.14.0',
  channel: 'google_play',
  deviceType: '1',
};

/** The phone the app says it runs on, when a client is confirmed. */
const PHONE_MODEL = 'Pixel 7';
const PHONE_SYSTEM = 'Android 14';

/** The realm every portal call names. */
const REALM = 'ecouser.net';

/** What the control endpoint's envelope says it is. */
const ENVELOPE_VERSION = '0.0.22';

/** How long one request to ECOVACS's servers has. */
export const REQUEST_TIMEOUT_MS = 20_000;

/** How long a mower's control token is trusted: it is issued for ten minutes. */
const SST_TRUST_MS = 540_000;

/** The countries whose accounts live in ECOVACS's European data centre. */
const EU_COUNTRIES = new Set(
  (
    'AD AL AT AX BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI ' +
    'LT LU LV MC MD ME MK MT NL NO PL PT RO RS SE SI SK SM UA VA'
  ).split(' '),
);

/**
 * Why ECOVACS said no, in words the device's page shows.
 *
 * `kind` says what the caller can do about it: `credentials` - the email or the password is
 * wrong; `verification` - the client has to be confirmed with an emailed code; `code` - the code
 * given was not taken; `unsupported` - the mower does not know the command; `unavailable` - the
 * servers did not answer, or answered something else.
 */
export class EcovacsError extends Error {
  /**
   * Makes one.
   *
   * @param {'credentials' | 'verification' | 'code' | 'unsupported' | 'unavailable'} kind - What
   *   went wrong.
   * @param {string} message - In an owner's words.
   * @param {{ cause?: unknown }} [options] - What caused it.
   */
  constructor(kind, message, options) {
    super(message, options);
    this.name = 'EcovacsError';
    this.kind = kind;
  }
}

/**
 * MD5, as the app hashes a password and signs a request. Not a protection: the service's wire
 * format.
 *
 * @param {string} text - What to hash.
 * @returns {string} 32 hexadecimal digits.
 */
export function md5(text) {
  return createHash('md5').update(text).digest('hex');
}

/**
 * Signs a request's parameters the way the app does: the key, every parameter sorted by name as
 * `name=value`, the secret, hashed together.
 *
 * @param {Record<string, string | number>} params - The request's own parameters.
 * @param {Record<string, string | number>} extra - What is signed without being sent.
 * @param {string} key - The app key.
 * @param {string} secret - Its secret.
 * @returns {Record<string, string | number>} The parameters with the signature and the key.
 */
export function signParams(params, extra, key, secret) {
  /** @type {Record<string, string | number>} */
  const signed = { ...extra, ...params };
  const text =
    key +
    Object.keys(signed)
      .sort()
      .map((name) => `${name}=${String(signed[name])}`)
      .join('') +
    secret;

  return { ...params, authSign: md5(text), authAppkey: key };
}

/**
 * Which of ECOVACS's data centres an account lives in.
 *
 * @param {string} country - Its country, two letters.
 * @returns {'eu' | 'ww'} Europe, or the rest of the world (China included).
 */
export function continentOf(country) {
  return EU_COUNTRIES.has(country.toUpperCase()) ? 'eu' : 'ww';
}

/**
 * A country as the API names it: in lower case, and `uk` for Great Britain.
 *
 * @param {string} country - Two letters.
 * @returns {string} The API's word.
 */
export function apiCountryOf(country) {
  const code = country.toLowerCase();

  return code === 'gb' ? 'uk' : code;
}

/**
 * The client this installation signs in as: eight upper-case letters and digits, as the app's
 * are, derived from the account's email so that it is the same client after every start - the
 * one ECOVACS was told to trust when it was confirmed with the emailed code.
 *
 * @param {string} email - The account.
 * @returns {string} The client's id.
 */
export function clientIdOf(email) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const digest = createHash('sha256').update(`nebulahome\0${email.trim().toLowerCase()}`).digest();

  return [...digest.subarray(0, 8)].map((byte) => alphabet[byte % alphabet.length]).join('');
}

/**
 * The envelope the app puts a command's data in.
 *
 * @param {unknown} data - What the command carries.
 * @param {number} [nowMs] - The clock.
 * @returns {Record<string, unknown>} The envelope.
 */
export function envelopeOf(data, nowMs = Date.now()) {
  const offset = -new Date(nowMs).getTimezoneOffset();

  return {
    header: { pri: 2, ts: String(nowMs), tzm: offset, ver: ENVELOPE_VERSION },
    body: { data },
  };
}

/**
 * Reads an object out of a value, or nothing.
 *
 * @param {unknown} value - The value.
 * @returns {Record<string, unknown> | undefined} It, when it is one.
 */
export function recordOf(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : undefined;
}

/**
 * Reads what a command answered: the data in its envelope, the envelope being sent as text
 * inside the reply or as the reply itself.
 *
 * @param {string} command - The command, for the error.
 * @param {unknown} reply - What the control endpoint answered.
 * @returns {unknown} The data.
 * @throws {EcovacsError} When the reply says the command failed.
 */
export function dataOfReply(command, reply) {
  // Some firmware answers a command it only has to carry out with nothing at all.
  if (reply === null || reply === undefined) {
    return undefined;
  }

  const outer = recordOf(reply);

  if (outer === undefined) {
    throw new EcovacsError('unavailable', `${command} answered ${JSON.stringify(reply)}`);
  }

  if ('ret' in outer && outer['ret'] !== 'ok') {
    throw new EcovacsError(
      'unavailable',
      `${command} failed: ${String(outer['errno'] ?? outer['error'] ?? outer['ret'])}`,
    );
  }

  /** @type {Record<string, unknown> | undefined} */
  let message = outer;

  if (typeof outer['resp'] === 'string') {
    try {
      message = recordOf(JSON.parse(outer['resp']));
    } catch {
      return undefined;
    }
  }

  const body = recordOf(message?.['body']) ?? message;

  if (body !== undefined && 'code' in body) {
    const code = Number(body['code']);

    if (code !== 0) {
      const text = String(body['msg'] ?? body['message'] ?? 'unknown error');

      throw new EcovacsError(
        code === 20003 || /not support/iu.test(text) ? 'unsupported' : 'unavailable',
        `${command} failed with code ${String(body['code'])}: ${text}`,
      );
    }
  }

  return body !== undefined && 'data' in body ? body['data'] : body;
}

/**
 * An account's portal credentials: who, the token every later call carries, and until when.
 *
 * @typedef {object} Credentials
 * @property {string} userId - The portal's id for the account.
 * @property {string} token - Its token.
 * @property {number} expiresAtMs - When it stops being accepted.
 */

/**
 * An account session: what the password is exchanged for, and a sign-in is completed from.
 *
 * @typedef {object} AccountSession
 * @property {string} uid - The account.
 * @property {string} accessToken - Its session.
 */

/**
 * One robot on the account, as the device list names it.
 *
 * @typedef {object} CloudDevice
 * @property {string} did - Its id.
 * @property {string} deviceClass - Its class: which kind of robot it is to the servers.
 * @property {string} resource - Its resource, the third part of its address.
 * @property {string} name - What the owner called it in the app.
 * @property {string} deviceName - What ECOVACS calls the product: `GOAT G1-800`.
 * @property {string | null} category - Its product category: `GOATBOT` for a mower.
 */

/**
 * What talking to ECOVACS needs.
 *
 * @typedef {object} ApiOptions
 * @property {string} email - The account.
 * @property {string} password - Its password, in the clear; only its digest is sent.
 * @property {string} country - Two letters.
 * @property {typeof fetch} [fetch] - The HTTP client; Node's when not said.
 */

/**
 * The calls one account makes.
 *
 * @typedef {object} EcovacsApi
 * @property {string} clientId - The client this installation signs in as.
 * @property {'eu' | 'ww'} continent - Which data centre the account lives in.
 * @property {string} brokerUrl - The broker the account's robots report through.
 * @property {() => Promise<AccountSession>} login - Exchanges the password for a session.
 * @property {(session: AccountSession) => Promise<AccountSession>} checkLogin - Rotates a session.
 * @property {() => Promise<void>} sendVerificationCode - Has ECOVACS email a confirmation code.
 * @property {(code: string) => Promise<AccountSession>} verify - Confirms this client with it.
 * @property {(session: AccountSession) => Promise<Credentials>} credentialsOf - Completes a
 *   sign-in.
 * @property {(credentials: Credentials) => Promise<CloudDevice[]>} devices - Lists the robots.
 * @property {(credentials: Credentials, device: CloudDevice)
 *   => Promise<{ token: string; expiresAtMs: number }>} controlToken - Issues a robot's token.
 * @property {(token: string, device: CloudDevice, command: string, data: unknown)
 *   => Promise<unknown>} control - Sends one command.
 */

/**
 * A client of ECOVACS's servers for one account.
 *
 * @param {ApiOptions} options - The account.
 * @returns {EcovacsApi} The calls.
 */
export function createApi(options) {
  const request = options.fetch ?? globalThis.fetch;
  const country = options.country.toUpperCase();
  const apiCountry = apiCountryOf(country);
  const isChina = country === 'CN';
  const continent = continentOf(country);
  const tld = isChina ? 'cn' : 'com';
  const clientId = clientIdOf(options.email);
  const loginUrl = `https://gl-${apiCountry}-api.ecovacs.${tld}`;
  const authCodeUrl = `https://gl-${apiCountry}-openapi.ecovacs.${tld}`;
  const portalUrl = `https://portal${isChina ? '' : `-${continent}`}.ecouser.net`;
  const passwordHash = md5(options.password);

  /** @type {import('node:crypto').KeyObject | undefined} */
  let publicKey;

  /**
   * Sends one request, with the time the servers have.
   *
   * @param {string} url - Where.
   * @param {RequestInit} init - What.
   * @returns {Promise<unknown>} The answer, read as JSON.
   * @throws {EcovacsError} When the servers did not answer, or not with JSON.
   */
  const call = async (url, init) => {
    let response;

    try {
      response = await request(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (error) {
      throw new EcovacsError(
        'unavailable',
        `ECOVACS's servers did not answer: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }

    if (!response.ok) {
      throw new EcovacsError(
        'unavailable',
        `ECOVACS's servers answered HTTP ${String(response.status)}`,
      );
    }

    const text = await response.text();

    try {
      return text === '' ? null : JSON.parse(text);
    } catch {
      throw new EcovacsError('unavailable', 'ECOVACS answered something that is not JSON');
    }
  };

  /**
   * A signed GET to the account service, reading its `{ code, data }` answer.
   *
   * @param {string} url - Where.
   * @param {Record<string, string | number>} params - What.
   * @param {Record<string, string | number>} extra - What is signed without being sent.
   * @param {string} key - The app key.
   * @param {string} secret - Its secret.
   * @returns {Promise<unknown>} The data.
   * @throws {EcovacsError} When ECOVACS refused.
   */
  const signedGet = async (url, params, extra, key, secret) => {
    const signed = signParams(params, extra, key, secret);
    const query = new URLSearchParams(
      Object.fromEntries(Object.entries(signed).map(([name, value]) => [name, String(value)])),
    );
    const answer = recordOf(await call(`${url}?${query.toString()}`, { method: 'GET' })) ?? {};
    const code = String(answer['code'] ?? '');

    if (code === '0000') {
      return answer['data'];
    }

    const said = typeof answer['msg'] === 'string' ? answer['msg'] : '';

    if (code === '1005' || code === '1010') {
      throw new EcovacsError('credentials', 'ECOVACS refused the email or the password');
    }

    if (code === '1012') {
      throw new EcovacsError('code', said === '' ? 'The verification code was not accepted' : said);
    }

    if (code === '1013') {
      throw new EcovacsError('verification', 'ECOVACS asks to confirm this sign-in by email');
    }

    throw new EcovacsError(
      'unavailable',
      `ECOVACS refused the sign-in (code ${code === '' ? 'none' : code}${said === '' ? '' : `: ${said}`})`,
    );
  };

  /**
   * A call to the app's private account API.
   *
   * @param {string} endpoint - `user/login` and the like.
   * @param {Record<string, string | number>} params - What.
   * @param {string} [version] - The API version.
   * @returns {Promise<unknown>} The data.
   */
  const privateCall = async (endpoint, params, version = 'v1') => {
    const meta = { ...META, country: apiCountry, deviceId: clientId };
    const path = [
      version,
      'private',
      meta.country,
      meta.lang,
      meta.deviceId,
      meta.appCode,
      meta.appVersion,
      meta.channel,
      meta.deviceType,
      endpoint,
    ].join('/');
    const nowMs = Date.now();

    return signedGet(
      `${loginUrl}/${path}`,
      {
        ...params,
        requestId: md5(String(nowMs)),
        authTimespan: nowMs,
        authTimeZone: 'GMT-8',
      },
      meta,
      CLIENT_KEY,
      CLIENT_SECRET,
    );
  };

  /**
   * Reads an account session out of an answer.
   *
   * @param {unknown} data - The answer's data.
   * @param {string} step - Which step, for the error.
   * @returns {AccountSession} The session.
   * @throws {EcovacsError} When it holds none.
   */
  const sessionOf = (data, step) => {
    const record = recordOf(data);
    const uid = record?.['uid'];
    const accessToken = record?.['accessToken'];

    if (typeof uid !== 'string' || uid === '' || typeof accessToken !== 'string') {
      throw new EcovacsError('unavailable', `ECOVACS's ${step} answer holds no session`);
    }

    return { uid, accessToken };
  };

  /**
   * Encrypts the account's email with ECOVACS's public key, as a confirmation asks for it.
   *
   * @returns {Promise<string>} The email, encrypted, in base64.
   */
  const encryptedEmail = async () => {
    if (publicKey === undefined) {
      const entries = await privateCall('common/getConfig', { keys: 'PUBLIC.KEY.CONFIG' });
      const entry = Array.isArray(entries)
        ? entries.map(recordOf).find((each) => each?.['key'] === 'PUBLIC.KEY.CONFIG')
        : undefined;
      const value = entry?.['value'];

      if (typeof value !== 'string') {
        throw new EcovacsError('unavailable', 'ECOVACS gave no key to confirm the sign-in with');
      }

      const der = recordOf(JSON.parse(value))?.['publicKey'];

      if (typeof der !== 'string') {
        throw new EcovacsError('unavailable', 'ECOVACS gave no key to confirm the sign-in with');
      }

      publicKey = createPublicKey({ key: Buffer.from(der, 'base64'), format: 'der', type: 'spki' });
    }

    return publicEncrypt(
      { key: publicKey, padding: constants.RSA_PKCS1_PADDING },
      Buffer.from(options.email.trim()),
    ).toString('base64');
  };

  /**
   * A POST to the portal, reading its answer.
   *
   * @param {string} path - `users/user.do` and the like.
   * @param {Record<string, unknown>} body - What.
   * @returns {Promise<Record<string, unknown>>} The answer.
   */
  const portal = async (path, body) =>
    recordOf(
      await call(`${portalUrl}/api/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    ) ?? {};

  return {
    /** The client this installation signs in as. */
    clientId,

    /** Which data centre the account lives in. */
    continent,

    /**
     * Exchanges the password for an account session.
     *
     * @returns {Promise<AccountSession>} The session.
     * @throws {EcovacsError} With `verification` when the client has to be confirmed first.
     */
    login: async () =>
      sessionOf(
        await privateCall(isChina ? 'user/loginCheckMobile' : 'user/login', {
          account: options.email.trim(),
          password: passwordHash,
        }),
        'sign-in',
      ),

    /**
     * Rotates a session, as the app does at every start rather than signing in again.
     *
     * @param {AccountSession} session - The session.
     * @returns {Promise<AccountSession>} The one to use from now on.
     */
    checkLogin: async (session) =>
      sessionOf(
        await privateCall(
          'user/checkLogin',
          { uid: session.uid, accessToken: session.accessToken },
          'v2',
        ),
        'session',
      ),

    /**
     * Asks ECOVACS to email a code that confirms this client.
     *
     * @returns {Promise<void>} Once it is sent.
     */
    sendVerificationCode: async () => {
      await privateCall('user/sendEmailVerifyCode', {
        encryptEmail: await encryptedEmail(),
        verifyType: 'EMAIL_VERIFY_DEVICE',
        supportChar: 'N',
        isForce: 'N',
      });
    },

    /**
     * Confirms this client with the emailed code.
     *
     * @param {string} code - The code.
     * @returns {Promise<AccountSession>} The session the confirmation opens.
     * @throws {EcovacsError} With `code` when the code is not taken.
     */
    verify: async (code) =>
      sessionOf(
        await privateCall('user/verifyDevice', {
          encryptAccount: await encryptedEmail(),
          backUpEmail: '',
          verifyCode: code.trim(),
          model: PHONE_MODEL,
          system: PHONE_SYSTEM,
        }),
        'confirmation',
      ),

    /**
     * Completes a sign-in from an account session: the portal's credentials.
     *
     * @param {AccountSession} session - The session.
     * @returns {Promise<Credentials>} The credentials.
     * @throws {EcovacsError} When ECOVACS refused.
     */
    credentialsOf: async (session) => {
      const nowMs = Date.now();
      const code = recordOf(
        await signedGet(
          `${authCodeUrl}/v1/global/auth/getAuthCode`,
          {
            uid: session.uid,
            accessToken: session.accessToken,
            bizType: 'ECOVACS_IOT',
            deviceId: clientId,
            authTimespan: nowMs,
          },
          { openId: 'global' },
          AUTH_CLIENT_KEY,
          AUTH_CLIENT_SECRET,
        ),
      )?.['authCode'];

      if (typeof code !== 'string') {
        throw new EcovacsError('unavailable', 'ECOVACS gave no authorisation code');
      }

      const body = {
        edition: 'ECOGLOBLE',
        userId: session.uid,
        token: code,
        realm: REALM,
        resource: clientId,
        org: isChina ? 'ECOCN' : 'ECOWW',
        last: '',
        country: isChina ? 'Chinese' : apiCountry.toUpperCase(),
        todo: 'loginByItToken',
      };

      // The portal says "set token error." now and then, and takes the same request again.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        // One attempt after another, by design: see above.
        // eslint-disable-next-line no-await-in-loop -- see above
        const answer = await portal('users/user.do', body);

        if (answer['result'] === 'ok' && typeof answer['token'] === 'string') {
          const lastMs = Number(answer['last'] ?? 604_800_000);

          return {
            userId: String(answer['userId']),
            token: answer['token'],
            // A little before it runs out, so no call is sent with a token about to expire.
            expiresAtMs: nowMs + (Number.isFinite(lastMs) ? lastMs : 604_800_000) * 0.99,
          };
        }

        if (answer['error'] !== 'set token error.') {
          throw new EcovacsError(
            'unavailable',
            `ECOVACS did not complete the sign-in: ${String(answer['error'] ?? answer['result'])}`,
          );
        }
      }

      throw new EcovacsError('unavailable', 'ECOVACS did not complete the sign-in');
    },

    /**
     * Lists the robots bound to the account, with what the global list adds about each.
     *
     * @param {Credentials} credentials - The portal's credentials.
     * @returns {Promise<CloudDevice[]>} Every robot still bound, whatever it is.
     */
    devices: async (credentials) => {
      const auth = {
        with: 'users',
        userid: credentials.userId,
        realm: REALM,
        token: credentials.token,
        resource: clientId,
      };
      const [bound, global] = await Promise.all([
        portal('users/user.do', { userid: credentials.userId, todo: 'GetDeviceList', auth }),
        portal('appsvr/app.do', { userid: credentials.userId, todo: 'GetGlobalDeviceList', auth }),
      ]);

      if (bound['result'] !== 'ok' && !Array.isArray(bound['devices'])) {
        throw new EcovacsError(
          'unavailable',
          `ECOVACS did not list the robots: ${String(bound['error'] ?? bound['result'])}`,
        );
      }

      const globalByDid = new Map(
        (Array.isArray(global['devices']) ? global['devices'] : [])
          .map(recordOf)
          .filter((each) => each !== undefined && typeof each['did'] === 'string')
          .map((each) => [String(each?.['did']), each]),
      );

      return (
        (Array.isArray(bound['devices']) ? bound['devices'] : [])
          .map(recordOf)
          .filter((each) => each !== undefined && typeof each['did'] === 'string')
          .map((each) => {
            const device = { ...globalByDid.get(String(each?.['did'])), ...each };
            const nick = typeof device['nick'] === 'string' ? device['nick'].trim() : '';
            const deviceName = typeof device['deviceName'] === 'string' ? device['deviceName'] : '';

            return {
              isNg: device['company'] === 'eco-ng',
              device: {
                did: String(device['did']),
                deviceClass: String(device['class'] ?? ''),
                resource: String(device['resource'] ?? ''),
                name: nick === '' ? deviceName || String(device['name'] ?? 'Robot') : nick,
                deviceName,
                category:
                  typeof device['product_category'] === 'string'
                    ? device['product_category']
                    : null,
              },
            };
          })
          // The robots on the N-GIoT platform: the older ones speak another protocol.
          .filter((each) => each.isNg)
          .map((each) => each.device)
      );
    },

    /**
     * Issues the short-lived token commands to one robot carry.
     *
     * @param {Credentials} credentials - The portal's credentials.
     * @param {CloudDevice} device - The robot.
     * @returns {Promise<{ token: string; expiresAtMs: number }>} The token.
     */
    controlToken: async (credentials, device) => {
      const answer = recordOf(
        await call(`https://api-base.dc-${continent}.ww.ecouser.net/api/new-perm/token/sst/issue`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${credentials.token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            acl: [
              {
                policy: [
                  { obj: [`Endpoint:${device.deviceClass}:${device.did}`], perms: ['Control'] },
                ],
                svc: 'dim',
              },
            ],
            exp: 600,
            sub: credentials.userId,
          }),
        }),
      );
      const token = recordOf(recordOf(answer?.['data'])?.['data'])?.['token'];

      if (typeof token !== 'string') {
        throw new EcovacsError('unavailable', 'ECOVACS issued no token to command the robot with');
      }

      return { token, expiresAtMs: Date.now() + SST_TRUST_MS };
    },

    /**
     * Sends one command to a robot, and reads what it answered.
     *
     * @param {string} token - The robot's control token.
     * @param {CloudDevice} device - The robot.
     * @param {string} command - The command: `getInfo`, `clean_V2`, `setRainDelay`.
     * @param {unknown} data - What it carries.
     * @returns {Promise<unknown>} The data of the answer.
     */
    control: async (token, device, command, data) => {
      const id = createHash('md5')
        .update(`${String(Date.now())}${Math.random()}`)
        .digest('hex');
      const query = new URLSearchParams({
        si: id,
        ct: 'q',
        eid: device.did,
        et: device.deviceClass,
        er: device.resource,
        apn: command,
        fmt: 'j',
      });
      const reply = await call(
        `https://api-ngiot.dc-${continent}.ww.ecouser.net/api/iot/endpoint/control?${query.toString()}`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'x-eco-request-id': id,
            'content-type': 'application/octet-stream',
          },
          body: JSON.stringify(envelopeOf(data)),
        },
      );

      return dataOfReply(command, reply);
    },

    /** The broker the account's robots report through. */
    brokerUrl: `mqtts://mq-${continent}.ecouser.net:443`,
  };
}
