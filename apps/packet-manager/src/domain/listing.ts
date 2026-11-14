/**
 * What the package and the integration managers share to list and install releases: where a
 * release comes from, and how a sentence is cut to fit a reply.
 */

/**
 * How old a read of an index may be before a search reads it again for an item the Hub lists and
 * it lacks: one published since the index was read is installable at once.
 */
export const INDEX_RECHECK_MS = 60_000;

/** How many of a local folder's items one search lists at most. */
export const LOCAL_LISTINGS_LIMIT = 50;

/**
 * Where a release comes from, by its archive's address: a file of the local folder, or the index.
 *
 * @param url - The archive's address.
 * @returns The source.
 */
export function sourceOf(url: string): 'index' | 'local' {
  return url.startsWith('file:') ? 'local' : 'index';
}

/**
 * Cuts a sentence to the length a reply keeps.
 *
 * @param text - The sentence.
 * @param length - The most characters kept.
 * @returns It, cut.
 */
export function clipped(text: string, length: number): string {
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}

/**
 * The message of a failure, for a reply.
 *
 * @param error - What was thrown.
 * @returns Its message.
 */
export function messageOf(error: unknown): string {
  return clipped(error instanceof Error ? error.message : String(error), 1024);
}
