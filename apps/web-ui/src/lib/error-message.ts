/**
 * Turning a caught failure into a line a person can read.
 *
 * One function, used by every form in the interface, and the reason it is one is that the
 * fallbacks have to agree. A component that wrote its own would eventually say "Unknown error"
 * where another said "Nebula Home is not responding", for the same unreachable server.
 *
 * The API's own message is passed through rather than rewritten. It is written for a person, it
 * is the only thing that knows what actually went wrong, and a second sentence composed here
 * from the code alone would be a worse guess than the server's first-hand account.
 */
import { isApiError } from '@/lib/api-error';

/**
 * Reads a failure as a sentence.
 *
 * @param error - Whatever was thrown.
 * @returns The message to show.
 */
export function toMessage(error: unknown): string {
  if (isApiError(error)) {
    return error.code === 'NETWORK'
      ? 'Nebula Home is not responding. Check that the server is running.'
      : error.message;
  }

  return 'Something went wrong. Try again.';
}
