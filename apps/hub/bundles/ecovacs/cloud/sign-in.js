// @ts-check
/**
 * Signing in to an ECOVACS HOME account, as `account.json` names it: the steps the account's
 * card walks the owner through.
 *
 * 1. **The password.** Most of the time ECOVACS takes it and the account is connected at once.
 * 2. **The code.** The first sign-in of a client ECOVACS has not seen is refused until the client
 *    is confirmed with a code it emails to the account. Refused so, this asks ECOVACS for the
 *    email - at most once a quarter of an hour, however often the owner tries - and asks the
 *    owner for the code. A code ECOVACS does not take - a typo, one that expired - is said so,
 *    and asked for again. Confirmed once, the client signs in with the password alone from then
 *    on: the client's id is made from the email, so it is the same one every time.
 *
 * What a connected account keeps is the session ECOVACS gave and the portal's credentials made
 * from it, so a restart goes straight to the robots (`account.js`). The password stays with the
 * hub, sealed, for when the session runs out.
 */
import { createHash } from 'node:crypto';

import { createApi, EcovacsError } from './api.js';

/** @typedef {import('@nebula-home/package-runtime').AccountModule} AccountModule */
/** @typedef {import('@nebula-home/package-runtime').AccountModuleStep} AccountModuleStep */
/** @typedef {import('@nebula-home/package-runtime').BundleSdk} BundleSdk */
/** @typedef {import('@nebula-home/contracts').JsonObject} JsonObject */
/** @typedef {import('./api.js').AccountSession} AccountSession */
/** @typedef {import('./api.js').EcovacsApi} EcovacsApi */

/** The shortest time between two emails asking to confirm the sign-in. */
const CODE_EMAIL_EVERY_MS = 15 * 60_000;

/** When each account last asked ECOVACS for a confirmation email, by a digest of it. */
const emailedAtMs = new Map();

/**
 * What the owner typed.
 *
 * @typedef {object} SignInValues
 * @property {string} email - The account's email.
 * @property {string} password - Its password.
 * @property {string} country - Two letters.
 */

/** The question the code is asked with. */
const CODE_FIELDS = [
  {
    key: 'code',
    type: 'text',
    label: 'Verification code',
    help: 'The code in the email ECOVACS just sent. It confirms NebulaHome once; from then on the password is enough.',
    placeholder: '123456',
    isRequired: true,
    maxLength: 16,
    pattern: '^[A-Za-z0-9]{4,16}$',
    patternMessage: 'The code from ECOVACS’s email, letters and digits',
  },
];

/**
 * The email, hidden but for enough to recognise it: `ow…@example.com`.
 *
 * @param {string} email - The email.
 * @returns {string} It, hidden.
 */
export function maskedEmail(email) {
  const [name = '', domain = ''] = email.trim().split('@');

  return `${name.slice(0, 2)}…@${domain}`;
}

/**
 * A digest of the account's email and country: which account, without saying it.
 *
 * @param {Pick<SignInValues, 'email' | 'country'>} values - The account.
 * @returns {string} Sixteen hexadecimal digits.
 */
export function accountTagOf(values) {
  return createHash('sha256')
    .update(`${values.email.trim().toLowerCase()}\0${values.country.toUpperCase()}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Reads what the owner typed, or what a pending step carried.
 *
 * @param {JsonObject} values - The values.
 * @returns {SignInValues} The account.
 * @throws {Error} When something is missing: `api` checked the form, so it is a bug.
 */
export function signInValuesOf(values) {
  const { email, password, country } = values;

  if (
    typeof email !== 'string' ||
    email.trim() === '' ||
    typeof password !== 'string' ||
    password === '' ||
    typeof country !== 'string' ||
    !/^[A-Za-z]{2}$/u.test(country)
  ) {
    throw new Error('Signing in to ECOVACS takes an email, a password and a country');
  }

  return { email: email.trim(), password, country: country.toUpperCase() };
}

/**
 * Forgets when codes were emailed, for a test.
 */
export function forgetEmailedCodes() {
  emailedAtMs.clear();
}

/**
 * Builds the sign-in module.
 *
 * @param {BundleSdk} sdk - What the hub hands a vendor's code.
 * @param {{ fetch?: typeof fetch; now?: () => number }} [options] - For a test: the HTTP client
 *   and the clock.
 * @returns {AccountModule} The steps.
 */
export default function createEcovacsSignIn(sdk, options = {}) {
  const now = options.now ?? Date.now;

  /**
   * The calls one account makes.
   *
   * @param {SignInValues} values - The account.
   * @returns {EcovacsApi} The calls.
   */
  const apiOf = (values) =>
    createApi({ ...values, ...(options.fetch === undefined ? {} : { fetch: options.fetch }) });

  /**
   * Asks ECOVACS to email a code, unless one was asked for a moment ago.
   *
   * @param {EcovacsApi} api - The account's calls.
   * @param {SignInValues} values - The account.
   * @returns {Promise<boolean>} Whether an email was asked for now.
   */
  const emailCode = async (api, values) => {
    const tag = accountTagOf(values);
    const lastMs = emailedAtMs.get(tag);

    if (lastMs !== undefined && now() - lastMs < CODE_EMAIL_EVERY_MS) {
      return false;
    }

    emailedAtMs.set(tag, now());
    await api.sendVerificationCode();

    return true;
  };

  /**
   * The step that asks for the code.
   *
   * @param {SignInValues} values - The account, carried to the answer.
   * @param {string} message - What to say.
   * @returns {AccountModuleStep} The question.
   */
  const askForCode = (values, message) => ({
    kind: 'ask',
    message,
    fields: /** @type {import('@nebula-home/contracts').SetupField[]} */ (CODE_FIELDS),
    // Held by the hub in memory, for a quarter of an hour: the answer signs in with it.
    pending: { email: values.email, password: values.password, country: values.country },
  });

  /**
   * Completes a sign-in from a session, into the account to keep.
   *
   * @param {EcovacsApi} api - The account's calls.
   * @param {SignInValues} values - The account.
   * @param {AccountSession} session - The session ECOVACS opened.
   * @returns {Promise<AccountModuleStep>} Connected.
   */
  const connected = async (api, values, session) => {
    const credentials = await api.credentialsOf(session);

    return {
      kind: 'connected',
      identity: { id: session.uid, label: values.email },
      session: {
        uid: session.uid,
        accessToken: session.accessToken,
        userId: credentials.userId,
        token: credentials.token,
        expiresAtMs: credentials.expiresAtMs,
        signedInAt: new Date(now()).toISOString(),
      },
    };
  };

  /**
   * What a failure says to the owner.
   *
   * @param {unknown} error - What went wrong.
   * @returns {AccountModuleStep} Failed, and which field is to blame when one is.
   */
  const failed = (error) => {
    if (error instanceof EcovacsError && error.kind === 'credentials') {
      return {
        kind: 'failed',
        message:
          'ECOVACS refused the email or the password - the ones the ECOVACS HOME app signs in with.',
        field: 'password',
      };
    }

    return {
      kind: 'failed',
      message: error instanceof Error ? error.message : String(error),
    };
  };

  return sdk.defineAccount({
    /**
     * Signs in with the password, or asks for the code ECOVACS emails.
     *
     * @param {JsonObject} typed - What the owner typed.
     * @returns {Promise<AccountModuleStep>} Where it stands.
     */
    signIn: async (typed) => {
      const values = signInValuesOf(typed);
      const api = apiOf(values);

      try {
        return await connected(api, values, await api.login());
      } catch (error) {
        if (!(error instanceof EcovacsError) || error.kind !== 'verification') {
          return failed(error);
        }
      }

      try {
        const isEmailed = await emailCode(api, values);

        return askForCode(
          values,
          isEmailed
            ? `ECOVACS wants to confirm NebulaHome's sign-in: it emailed a code to ${maskedEmail(values.email)}.`
            : `ECOVACS wants to confirm NebulaHome's sign-in with the code it emailed to ${maskedEmail(values.email)} a few minutes ago.`,
        );
      } catch (error) {
        return failed(error);
      }
    },

    /**
     * Confirms the client with the code, and completes the sign-in.
     *
     * @param {JsonObject} pending - The account, as the question carried it.
     * @param {JsonObject} answers - `{ code }`.
     * @returns {Promise<AccountModuleStep>} Connected, or the question again.
     */
    answer: async (pending, answers) => {
      const values = signInValuesOf(pending);
      const api = apiOf(values);
      const code = typeof answers['code'] === 'string' ? answers['code'].trim() : '';

      try {
        return await connected(api, values, await api.verify(code));
      } catch (error) {
        if (!(error instanceof EcovacsError) || error.kind !== 'code') {
          return failed(error);
        }
      }

      try {
        const isEmailed = await emailCode(api, values);

        return askForCode(
          values,
          isEmailed
            ? `ECOVACS did not take that code - it may have expired. A new one was emailed to ${maskedEmail(values.email)}.`
            : 'ECOVACS did not take that code. Check it against the latest email from ECOVACS.',
        );
      } catch (error) {
        return failed(error);
      }
    },
  });
}
