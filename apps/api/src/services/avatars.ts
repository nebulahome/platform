/**
 * The picture that stands in for a person.
 *
 * Avatars are handed to the interface as `data:` URLs rather than served from a route of their
 * own, and the reason is narrow: an `<img>` cannot send an `Authorization` header, so a URL an
 * image tag could use would have to be readable without a credential - and a photograph of
 * somebody in a house is not a thing to serve anonymously. The alternative, a token in the query
 * string, puts a credential in every access log.
 *
 * What makes inlining affordable is the size, and the size is enforced twice: the interface
 * resizes to a 128-pixel square before sending, and `user_avatars_size` refuses anything over
 * 64 KiB whatever sent it. A list of a household's accounts is therefore tens of kilobytes.
 *
 * The bytes are never inspected beyond their length. This service does not decode the image, and
 * nothing in the platform renders it server-side; the declared type is checked against a list of
 * three, and the browser is left to decide whether what arrived is really a PNG.
 */
import { eq, inArray } from 'drizzle-orm';

import { AVATAR_MAXIMUM_BYTES, ValidationError, type AvatarMimeType } from '@nebulahome/contracts';
import { schema, type Database } from '@nebulahome/db';

/**
 * Builds the `data:` URL for one stored avatar.
 *
 * @param mime - The declared format.
 * @param image - The bytes.
 * @returns The URL an `<img src>` can use.
 */
function toDataUrl(mime: string, image: Buffer): string {
  return `data:${mime};base64,${image.toString('base64')}`;
}

/**
 * Reads the avatars of a set of people.
 *
 * Takes a list rather than one id, so a table of accounts costs one query instead of one per
 * row - which is the shape that turns a page of twenty people into twenty round trips.
 *
 * @param db - The database.
 * @param userIds - Whose avatars to read.
 * @returns A `data:` URL for each person who has one. People with none are simply absent.
 */
export async function readAvatarUrls(
  db: Database,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  if (userIds.length === 0) {
    return new Map();
  }

  const rows = await db
    .select({
      userId: schema.auth.userAvatars.userId,
      image: schema.auth.userAvatars.image,
      mime: schema.auth.userAvatars.mime,
    })
    .from(schema.auth.userAvatars)
    .where(inArray(schema.auth.userAvatars.userId, [...userIds]));

  return new Map(rows.map((row) => [row.userId, toDataUrl(row.mime, row.image)]));
}

/**
 * Reads one person's avatar.
 *
 * @param db - The database.
 * @param userId - Whose.
 * @returns The `data:` URL, or null when they have not set one.
 */
export async function readAvatarUrl(db: Database, userId: string): Promise<string | null> {
  return (await readAvatarUrls(db, [userId])).get(userId) ?? null;
}

/**
 * Stores or replaces somebody's avatar.
 *
 * @param db - The database.
 * @param userId - Whose.
 * @param mime - The declared format.
 * @param encoded - The image, base64 encoded.
 * @throws {ValidationError} When the decoded image is empty or larger than the database will
 * hold. The length is checked here rather than only by the CHECK because base64 length is an
 * upper bound on the byte count, not the byte count - a body that passed the schema can still
 * decode to something too big, and a constraint violation is a 500 where this is a 400.
 */
export async function writeAvatar(
  db: Database,
  userId: string,
  mime: AvatarMimeType,
  encoded: string,
): Promise<void> {
  const image = Buffer.from(encoded, 'base64');

  if (image.length === 0 || image.length > AVATAR_MAXIMUM_BYTES) {
    throw new ValidationError('That image is not a size this can store', {
      details: { bytes: image.length, maximumBytes: AVATAR_MAXIMUM_BYTES },
    });
  }

  await db.insert(schema.auth.userAvatars).values({ userId, image, mime }).onConflictDoUpdate({
    target: schema.auth.userAvatars.userId,
    set: { image, mime },
  });
}

/**
 * Removes somebody's avatar.
 *
 * Silent when there was none: the caller asked for a state, and that state is the one they get.
 *
 * @param db - The database.
 * @param userId - Whose.
 */
export async function deleteAvatar(db: Database, userId: string): Promise<void> {
  await db.delete(schema.auth.userAvatars).where(eq(schema.auth.userAvatars.userId, userId));
}
