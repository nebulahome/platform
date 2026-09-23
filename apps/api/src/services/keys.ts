/**
 * The keys the registry gives things that permission scopes name: tags, areas.
 *
 * A key is a slug of the name at creation and never changes, so that a scope granted on it
 * keeps meaning the same thing after a rename. Two things can be given the same name, and the
 * second gets the slug with a number on it. Both tables enforce the same shape with the same
 * CHECK, so the one derivation and the one way of numbering serve both.
 */

/** What Postgres says when a unique index refuses a row. */
const UNIQUE_VIOLATION = '23505';

/** How long a key may be: the CHECK on both tables. */
const KEY_MAXIMUM_LENGTH = 64;

/** The room a numbered key is guaranteed for its number: `_` and up to four digits. */
const SUFFIX_ROOM = 5;

/**
 * What every key a base can be numbered into starts with, to look the taken ones up by.
 *
 * Not the base itself: a base already at the length limit loses its end to the number, so
 * `…_2` does not start with the whole base, and a lookup by the base would miss it and hand
 * out the same key twice.
 *
 * @param base - The name's slug.
 * @returns The prefix to look taken keys up by.
 */
export function keyPrefixOf(base: string): string {
  return base.slice(0, KEY_MAXIMUM_LENGTH - SUFFIX_ROOM);
}

/**
 * Whether an error is Postgres refusing a duplicate.
 *
 * @param error - What was thrown.
 * @returns True for a unique violation.
 */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === UNIQUE_VIOLATION
  );
}

/**
 * The key a new row gets: the base when it is free, or the base with a number when it is taken.
 *
 * @param base - The name's slug, already non-empty.
 * @param taken - Every key that starts with the base.
 * @returns A key none of them is.
 */
export function chooseFreeKey(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) {
    return base;
  }

  for (let suffix = 2; ; suffix += 1) {
    // The suffix takes room from the end of the base, never from the sixty-four the column
    // allows: `_2` on a key already at the limit would otherwise be refused by the CHECK.
    const tail = `_${String(suffix)}`;
    const candidate = `${base.slice(0, KEY_MAXIMUM_LENGTH - tail.length)}${tail}`;

    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}
