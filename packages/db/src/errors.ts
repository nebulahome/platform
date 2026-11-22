/**
 * Telling which refusal a failed write was, whatever the driver wrapped it in.
 *
 * drizzle throws its own `DrizzleQueryError` with the driver's `PostgresError` as `cause`, so the
 * SQLSTATE a caller branches on is one level down rather than on what was caught.
 */

/** PostgreSQL's `unique_violation`. */
const UNIQUE_VIOLATION = '23505';

/** How far down a chain of causes to look for the driver's error. Wrapping is one level deep. */
const MAXIMUM_CAUSE_DEPTH = 5;

/**
 * Says whether a failure is PostgreSQL refusing a duplicate, however deep the driver wrapped it.
 *
 * Bounded, because a cause chain is whatever somebody constructed and nothing stops it being a
 * cycle.
 *
 * @param error - Whatever was thrown.
 * @returns True when the code `23505` is anywhere in the chain.
 */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;

  for (
    let depth = 0;
    depth < MAXIMUM_CAUSE_DEPTH && typeof current === 'object' && current !== null;
    depth += 1
  ) {
    if ('code' in current && current.code === UNIQUE_VIOLATION) {
      return true;
    }

    current = 'cause' in current ? current.cause : undefined;
  }

  return false;
}
