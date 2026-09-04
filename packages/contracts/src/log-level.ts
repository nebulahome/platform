/**
 * The logging severity scale, shared by the logger, the configuration schemas and the bus.
 *
 * This lives in `contracts` rather than in `logging` because a level is part of two contracts
 * at once: it is the last segment of the `nebula.v1.log.<service>.<level>` bus subject, and it
 * is the value of the `LOG_LEVEL` environment variable. Both must agree with what the logger
 * accepts, so all three read the list from here.
 *
 * Semantics of each level are defined in RULES.md 10.2.
 */

/**
 * Every severity, ordered from most to least severe.
 *
 * The order is meaningful: the index of a level is its threshold rank, so a service configured
 * at `warn` emits everything at or before index 2.
 */
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;

/** A single logging severity. */
export type LogLevel = (typeof LOG_LEVELS)[number];
