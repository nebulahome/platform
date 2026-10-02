/**
 * The one check that has to happen before the database sees an avatar.
 *
 * Base64 length is an upper bound on the byte count, not the byte count: a body that satisfied
 * the request schema can still decode to something the column will not take. Without this check
 * that arrives as a CHECK violation, which reaches the caller as a 500 - a server error for
 * something the caller did, and a log line that says nothing about a picture.
 */
import { describe, expect, it } from 'vitest';

import { AVATAR_MAXIMUM_BYTES, ValidationError } from '@nebulahome/contracts';
import type { Database } from '@nebulahome/db';

import { writeAvatar } from './avatars.js';

/**
 * A database that refuses to be touched.
 *
 * The cases below are all about what happens *before* a statement is built, so reaching one is
 * itself the failure.
 */
const REFUSING_DB = {
  /**
   * Stands in for a database nothing should reach.
   *
   * @throws {Error} Always.
   */
  insert: (): never => {
    throw new Error('the database was reached');
  },
} as unknown as Database;

/**
 * Base64 for a run of bytes.
 *
 * @param length - How many.
 * @returns The encoded string.
 */
function bytes(length: number): string {
  return Buffer.alloc(length, 1).toString('base64');
}

describe('writeAvatar', () => {
  it('refuses an image larger than the column will hold', async () => {
    await expect(
      writeAvatar(REFUSING_DB, 'a-user', 'image/webp', bytes(AVATAR_MAXIMUM_BYTES + 1)),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses an empty image', async () => {
    // `user_avatars_size` has a floor of one byte, so an empty body would be a constraint
    // violation rather than a stored picture of nothing.
    await expect(writeAvatar(REFUSING_DB, 'a-user', 'image/png', '')).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('says how big it was and how big it may be', async () => {
    // A refusal a person can act on: "too large" without a number is a guess about how much to
    // crop.
    await expect(
      writeAvatar(REFUSING_DB, 'a-user', 'image/webp', bytes(AVATAR_MAXIMUM_BYTES + 100)),
    ).rejects.toMatchObject({
      details: { bytes: AVATAR_MAXIMUM_BYTES + 100, maximumBytes: AVATAR_MAXIMUM_BYTES },
    });
  });

  it('lets an image at exactly the limit through to the database', async () => {
    // The boundary belongs to the caller, not to the guard. Reaching the stub is the pass.
    await expect(
      writeAvatar(REFUSING_DB, 'a-user', 'image/webp', bytes(AVATAR_MAXIMUM_BYTES)),
    ).rejects.toThrow('the database was reached');
  });
});
