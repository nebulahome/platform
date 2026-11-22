/**
 * A duplicate as drizzle reports it: the driver's error one level down, as the `cause` of its
 * own. A check of the top alone answered a second house with a 500 rather than a 409.
 */
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { describe, expect, it } from 'vitest';

import { isUniqueViolation } from './errors.js';

/**
 * What `postgres` throws: an `Error` carrying the SQLSTATE in `code`.
 *
 * @param code - The five-character SQLSTATE.
 * @returns The error, shaped as the driver shapes it.
 */
function postgresError(code: string): Error & { code: string } {
  return Object.assign(new Error('refused'), { code });
}

describe('isUniqueViolation', () => {
  it('finds the duplicate wrapped in drizzle’s error, as well as bare', () => {
    expect(isUniqueViolation(new DrizzleQueryError('INSERT', [], postgresError('23505')))).toBe(
      true,
    );
    expect(isUniqueViolation(postgresError('23505'))).toBe(true);
  });

  it('says no to any other refusal, to what is not an error, and to a chain that loops', () => {
    const looped: { cause?: unknown } = {};

    looped.cause = looped;

    expect(isUniqueViolation(new DrizzleQueryError('INSERT', [], postgresError('23503')))).toBe(
      false,
    );
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation('23505')).toBe(false);
    expect(isUniqueViolation(looped)).toBe(false);
  });
});
