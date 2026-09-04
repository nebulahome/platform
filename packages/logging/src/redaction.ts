/**
 * The central list of log fields that must never reach the log stream in clear.
 *
 * Redaction is centralised here for one reason: it has to be reviewable. A grep for a secret
 * name should land in a single file that a reviewer can read end to end, not in whichever
 * service happened to remember. Adding a path is cheap and always allowed; removing one needs
 * review (RULES.md 10.1).
 */

/**
 * Field names redacted wherever they appear in a log record.
 *
 * Each name is listed twice: once at the root of the record and once as `*.<name>`, because
 * pino matches literal paths rather than searching the object, and a wildcard segment covers
 * exactly one level. Most secrets arrive nested one level deep - inside a `user`, `session` or
 * `body` object - so both forms are needed.
 */
const SECRET_FIELD_NAMES = [
  'password',
  'passwordHash',
  'currentPassword',
  'newPassword',
  'token',
  'accessToken',
  'refreshToken',
  'idToken',
  'apiKey',
  'secret',
  'jwt',
  'authorization',
  'cookie',
  'sessionId',
  'totpSecret',
  'privateKey',
] as const;

/**
 * Every path pino redacts, expanded from {@link SECRET_FIELD_NAMES} plus the transport headers
 * that carry credentials under fixed names.
 */
export const REDACTED_PATHS: readonly string[] = [
  ...SECRET_FIELD_NAMES,
  ...SECRET_FIELD_NAMES.map((name) => `*.${name}`),
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

/** The placeholder written in place of a redacted value. */
export const REDACTION_PLACEHOLDER = '[redacted]';
