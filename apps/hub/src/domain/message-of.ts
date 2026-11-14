/**
 * A failure in a sentence, as the brokers hand it to the page.
 */

/**
 * A failure in a sentence, cut to a length a page and a stored row can carry.
 *
 * @param error - Whatever was thrown.
 * @returns Its message, cut.
 */
export function messageOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 512);
}
