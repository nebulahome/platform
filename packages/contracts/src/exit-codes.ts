/**
 * Process exit codes shared by every NebulaHome service.
 *
 * A supervisor - `packet-manager`, systemd or Docker - decides whether to restart a service
 * from the code it exited with. A configuration error must not be retried in a crash loop,
 * while an unhandled error usually should be, so the two never share a code.
 *
 * Defined in RULES.md 8.4. Codes are stable: never repurpose one, add a new code instead.
 */

/** The exit code a service terminates with, by reason. */
export const EXIT_CODES = {
  /** Shutdown completed normally after SIGTERM or SIGINT. */
  SUCCESS: 0,
  /** An error escaped to the top level. Restarting may help. */
  UNHANDLED_ERROR: 1,
  /** Environment configuration was missing or invalid. Restarting will not help. */
  INVALID_CONFIGURATION: 78,
  /** The database schema is not the version this build expects. */
  SCHEMA_VERSION_MISMATCH: 79,
  /** The bus contract version does not match the one this build speaks. */
  BUS_VERSION_MISMATCH: 80,
} as const;

/** One of the codes a NebulaHome process may exit with. */
export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];
