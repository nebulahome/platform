// @ts-check
/**
 * One ECOVACS account signed in to, shared by the listener that finds its robots and the
 * transport that talks to them.
 *
 * The hub hands both the account as the owner connected it (`AccountHandle`): the email, password
 * and country, sealed until now, and what the sign-in kept - ECOVACS's session and the portal's
 * credentials made from it (`sign-in.js`). So a start goes straight to the robots, with no
 * sign-in at all while the credentials hold, which is about a week.
 *
 * **When they run out** the session is rotated, as the app does at every start, and the portal
 * asked for new credentials; what that gives is kept (`update`) for the next start. A session
 * ECOVACS no longer takes is replaced by signing in with the password. Only when ECOVACS wants the
 * owner - the password was changed, or it asks for an emailed code again - does the account say
 * so (`needsSignIn`): its card asks for a sign-in, and its robots stop until then. Nothing here
 * asks ECOVACS to email a code: that is for the owner to start, from the card.
 *
 * Nothing is logged with a credential in it.
 */
import { createHash } from 'node:crypto';

import { createApi, EcovacsError } from './api.js';
import { maskedEmail, signInValuesOf } from './sign-in.js';

/** @typedef {import('@nebulahome/package-runtime').AccountHandle} AccountHandle */
/** @typedef {import('./api.js').AccountSession} AccountSession */
/** @typedef {import('./api.js').CloudDevice} CloudDevice */
/** @typedef {import('./api.js').Credentials} Credentials */
/** @typedef {import('./api.js').EcovacsApi} EcovacsApi */

/** How long the list of robots is trusted before it is asked again. */
const DEVICES_TRUST_MS = 5 * 60_000;

/**
 * One account, signed in.
 *
 * @typedef {object} Account
 * @property {string} id - The account's id at ECOVACS, which its devices remember.
 * @property {string} label - Its email, for a log line or a sentence.
 * @property {EcovacsApi} api - Its calls.
 * @property {(force?: boolean) => Promise<Credentials>} credentials - The portal's credentials,
 *   renewed when they run out; `force` renews them whatever they say.
 * @property {(force?: boolean) => Promise<CloudDevice[]>} devices - The robots on the account.
 * @property {(device: CloudDevice) => Promise<string>} controlToken - The token a robot's
 *   commands carry.
 */

/**
 * One account, and the handle last given for it.
 *
 * @typedef {object} Held
 * @property {Account} account - The account.
 * @property {{ handle: AccountHandle }} current - The latest handle, for keeping a session.
 */

/** @type {Map<string, Held>} */
const accounts = new Map();

/**
 * Reads a session out of what the sign-in kept.
 *
 * @param {import('@nebulahome/contracts').JsonObject} kept - The handle's session.
 * @returns {{ session: AccountSession | undefined; credentials: Credentials | undefined }} What
 *   of it is usable.
 */
function keptOf(kept) {
  const { uid, accessToken, userId, token, expiresAtMs } = kept;
  const session =
    typeof uid === 'string' && typeof accessToken === 'string' ? { uid, accessToken } : undefined;
  const credentials =
    typeof userId === 'string' && typeof token === 'string' && typeof expiresAtMs === 'number'
      ? { userId, token, expiresAtMs }
      : undefined;

  return { session, credentials };
}

/**
 * The account for a handle, made once for everyone who asks. A new sign-in by the owner - a new
 * session - makes a new one.
 *
 * @param {AccountHandle} handle - The account, as the hub hands it.
 * @param {{ fetch?: typeof fetch; now?: () => number }} [options] - For a test: the HTTP client
 *   and the clock.
 * @returns {Account} The account.
 */
export function accountFor(handle, options = {}) {
  const values = signInValuesOf(handle.credentials);
  const key = [
    handle.id,
    String(handle.session['signedInAt'] ?? ''),
    values.email.toLowerCase(),
    values.country,
    createHash('sha256').update(values.password).digest('hex'),
  ].join('\0');
  const known = accounts.get(key);

  if (known !== undefined) {
    known.current.handle = handle;

    return known.account;
  }

  const current = { handle };
  const account = createAccount(current, options);

  accounts.set(key, { account, current });

  return account;
}

/**
 * Forgets every account, for a test.
 */
export function forgetAccounts() {
  accounts.clear();
}

/**
 * Makes an account.
 *
 * @param {{ handle: AccountHandle }} current - The latest handle for it.
 * @param {{ fetch?: typeof fetch; now?: () => number }} options - The HTTP client and the clock.
 * @returns {Account} The account.
 */
function createAccount(current, options) {
  const now = options.now ?? Date.now;
  const values = signInValuesOf(current.handle.credentials);
  const api = createApi({
    ...values,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  const kept = keptOf(current.handle.session);

  /** @type {AccountSession | undefined} */
  let session = kept.session;

  /** @type {Credentials | undefined} */
  let credentials = kept.credentials;

  /** @type {Promise<Credentials> | undefined} */
  let signingIn;

  /** @type {{ devices: CloudDevice[]; atMs: number } | undefined} */
  let listed;

  /** @type {Map<string, { token: string; expiresAtMs: number }>} */
  const tokens = new Map();

  /**
   * Says the owner has to sign in again, and fails with it.
   *
   * @param {string} message - Why.
   * @param {'credentials' | 'verification'} kind - What ECOVACS said.
   * @returns {Promise<never>} Nothing: it throws.
   * @throws {EcovacsError} Always.
   */
  const needsOwner = async (message, kind) => {
    await current.handle.needsSignIn(message).catch(() => undefined);

    throw new EcovacsError(kind, message);
  };

  /**
   * Opens a session with the password, when the one kept is gone.
   *
   * @returns {Promise<AccountSession>} The session.
   * @throws {EcovacsError} When ECOVACS wants the owner.
   */
  const openSession = async () => {
    try {
      return await api.login();
    } catch (error) {
      if (error instanceof EcovacsError && error.kind === 'credentials') {
        return needsOwner(
          `ECOVACS no longer takes the password of ${maskedEmail(values.email)}: sign in to the account again.`,
          'credentials',
        );
      }

      if (error instanceof EcovacsError && error.kind === 'verification') {
        return needsOwner(
          `ECOVACS wants to confirm the sign-in of ${maskedEmail(values.email)} again: sign in to the account again, with the code it emails.`,
          'verification',
        );
      }

      throw error;
    }
  };

  /**
   * New credentials: from the session kept when ECOVACS still takes it, from the password
   * otherwise - and kept for the next start.
   *
   * @returns {Promise<Credentials>} The portal's credentials.
   */
  const renew = async () => {
    let fresh;

    if (session !== undefined) {
      try {
        const rotated = await api.checkLogin(session);

        fresh = { session: rotated, credentials: await api.credentialsOf(rotated) };
      } catch {
        // The session is gone - revoked, too old: the password opens a new one.
      }
    }

    if (fresh === undefined) {
      const opened = await openSession();

      fresh = { session: opened, credentials: await api.credentialsOf(opened) };
    }

    session = fresh.session;
    await current.handle
      .update({
        ...current.handle.session,
        uid: fresh.session.uid,
        accessToken: fresh.session.accessToken,
        userId: fresh.credentials.userId,
        token: fresh.credentials.token,
        expiresAtMs: fresh.credentials.expiresAtMs,
      })
      // Kept or not, the credentials work for this run.
      .catch(() => undefined);

    return fresh.credentials;
  };

  /** @type {Account} */
  const account = {
    id: current.handle.id,
    label: values.email,
    api,

    /**
     * The portal's credentials, renewed when they run out.
     *
     * @param {boolean} [force] - Whether to renew them whatever they say.
     * @returns {Promise<Credentials>} The credentials.
     */
    credentials: async (force = false) => {
      if (!force && credentials !== undefined && credentials.expiresAtMs > now()) {
        return credentials;
      }

      // One renewal at a time, however many ask at once.
      signingIn ??= renew()
        .then((renewed) => {
          credentials = renewed;
          tokens.clear();

          return renewed;
        })
        .finally(() => {
          signingIn = undefined;
        });

      return signingIn;
    },

    /**
     * The robots on the account, asked again when the list is a few minutes old.
     *
     * @param {boolean} [force] - Whether to ask whatever the list held says.
     * @returns {Promise<CloudDevice[]>} The robots.
     */
    devices: async (force = false) => {
      if (!force && listed !== undefined && now() - listed.atMs < DEVICES_TRUST_MS) {
        return listed.devices;
      }

      const signed = await account.credentials();

      try {
        listed = { devices: await api.devices(signed), atMs: now() };
      } catch (error) {
        // A token the portal no longer takes: renewed, and asked once more.
        const fresh = await account.credentials(true);

        if (fresh === signed) {
          throw error;
        }

        listed = { devices: await api.devices(fresh), atMs: now() };
      }

      return listed.devices;
    },

    /**
     * The token a robot's commands carry, issued again once it runs out.
     *
     * @param {CloudDevice} device - The robot.
     * @returns {Promise<string>} The token.
     */
    controlToken: async (device) => {
      const held = tokens.get(device.did);

      if (held !== undefined && held.expiresAtMs > now()) {
        return held.token;
      }

      const issued = await api.controlToken(await account.credentials(), device);

      tokens.set(device.did, issued);

      return issued.token;
    },
  };

  return account;
}
