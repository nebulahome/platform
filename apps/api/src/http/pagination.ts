/**
 * Keyset pagination.
 *
 * RULES.md 14 forbids offsets on anything that grows, and the reason is visible in the two
 * tables this API pages most: `history.state_history` and `history.telemetry` both gain rows
 * while a client is reading them, and an offset into a growing table silently repeats or skips
 * exactly as many rows as arrived in between. A cursor names the last row seen, so new arrivals
 * change nothing about where the next page starts.
 *
 * The cursor is base64url of a small JSON object. Opaque to the client - encoding it as
 * something readable invites clients to construct their own, and then its shape can never
 * change again.
 */
import { ValidationError } from '@nebulahome/contracts';

/** What a cursor remembers: the sort key of the last row on the previous page. */
export type Cursor = {
  /** The primary sort value, as an ISO timestamp or an opaque string. */
  readonly key: string;

  /** The tiebreaker, for rows sharing a key. */
  readonly id?: string;
};

/**
 * Encodes a cursor for the response.
 *
 * @param cursor - What the next page should start after.
 * @returns The base64url string to hand back as `nextCursor`.
 */
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/**
 * Reads a cursor a client sent back.
 *
 * @param value - The `cursor` query parameter.
 * @returns What the page should start after.
 * @throws {ValidationError} When the string is not a cursor this API produced. Rejected rather
 * than ignored: silently returning the first page for a corrupted cursor turns a client bug
 * into an infinite loop over page one.
 */
export function decodeCursor(value: string): Cursor {
  let parsed: unknown;

  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch (cause: unknown) {
    throw new ValidationError('Cursor is not readable', { cause, details: { cursor: value } });
  }

  if (typeof parsed !== 'object' || parsed === null || !('key' in parsed)) {
    throw new ValidationError('Cursor is not readable', { details: { cursor: value } });
  }

  const { key, id } = parsed as { key: unknown; id?: unknown };

  if (typeof key !== 'string' || (id !== undefined && typeof id !== 'string')) {
    throw new ValidationError('Cursor is not readable', { details: { cursor: value } });
  }

  return id === undefined ? { key } : { key, id };
}

/** A page of rows, plus whether there are more. */
export type PageResult<TItem> = {
  /** The rows, at most the requested limit. */
  readonly items: TItem[];

  /** Pass back as `cursor` to continue. Absent on the last page. */
  readonly nextCursor?: string;
};

/**
 * Turns one over-fetched row into the answer to "is there more?".
 *
 * Every paginated query asks for `limit + 1` rows. If the extra one came back there is another
 * page, and the alternative - a second `COUNT(*)` per request - costs a full scan to learn one
 * bit.
 *
 * @param rows - Up to `limit + 1` rows, already ordered.
 * @param limit - What the caller asked for.
 * @param toCursor - Reads the sort key out of the last row kept.
 * @returns The rows to return and the cursor for the next page.
 */
export function toPage<TItem>(
  rows: readonly TItem[],
  limit: number,
  toCursor: (row: TItem) => Cursor,
): PageResult<TItem> {
  const items = rows.slice(0, limit);

  if (rows.length <= limit || items.length === 0) {
    return { items };
  }

  const last = items[items.length - 1];

  // Guarded rather than asserted: `noUncheckedIndexedAccess` is on, and the length check above
  // is a fact about this function, not something the type system can see.
  if (last === undefined) {
    return { items };
  }

  return { items, nextCursor: encodeCursor(toCursor(last)) };
}
