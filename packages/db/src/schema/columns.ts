/**
 * Column types PostgreSQL has and Drizzle does not ship a builder for.
 *
 * Each one is declared once here rather than inline at every use, so that the SQL type in the
 * migration and the TypeScript type in the query builder cannot drift apart table by table.
 */
import { customType } from 'drizzle-orm/pg-core';

/**
 * Case-insensitive text, from the `citext` extension.
 *
 * Used for usernames and email addresses, where `Mattia` and `mattia` must be the same person.
 * Note that a regular-expression CHECK on a `citext` column is itself case-insensitive, which
 * is why the constraints in DATABASE.md cast to `text` first.
 */
export const citext = customType<{ data: string; driverData: string }>({
  /**
   * Names the underlying PostgreSQL type.
   *
   * @returns The SQL type name.
   */
  dataType() {
    return 'citext';
  },
});

/**
 * Raw bytes.
 *
 * Used for values that are hashes or ciphertext rather than text: refresh token digests, access
 * token digests, encrypted TOTP secrets. Storing a digest as `text` invites someone to compare
 * it with `=` against a string that was never hashed.
 */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  /**
   * Names the underlying PostgreSQL type.
   *
   * @returns The SQL type name.
   */
  dataType() {
    return 'bytea';
  },
});
