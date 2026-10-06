/**
 * The proof of work the Community Hub asks of a house before it registers it.
 *
 * The Hub hands out a challenge and a number of bits; a solution is any short text such that the
 * SHA-256 of `<challenge>:<solution>` starts with that many zero bits - the Hub's own
 * `apps/api/src/domain/proof-of-work.ts`, which checks it. Finding one takes a few hundred
 * thousand hashes at the Hub's usual difficulty: a second or two, done in slices that hand the
 * event loop back between them, so the packet-manager keeps answering while it works.
 */
import { createHash } from 'node:crypto';

/** How many candidates are tried before the event loop is handed back. */
const SLICE = 20_000;

/** Never more than this: a difficulty no house could meet is a Hub misconfigured. */
const MAXIMUM_BITS = 32;

/**
 * How many zero bits a digest starts with.
 *
 * @param digest - The digest.
 * @returns The count.
 */
function leadingZeroBits(digest: Buffer): number {
  let bits = 0;

  for (const byte of digest) {
    if (byte === 0) {
      bits += 8;
      continue;
    }

    return bits + Math.clz32(byte) - 24;
  }

  return bits;
}

/**
 * Says whether a solution solves a challenge, as the Hub checks it.
 *
 * @param challenge - The challenge, as the Hub handed it out.
 * @param solution - The candidate.
 * @param difficultyBits - The zero bits the digest must start with.
 * @returns True when it does.
 */
export function solves(challenge: string, solution: string, difficultyBits: number): boolean {
  const digest = createHash('sha256').update(`${challenge}:${solution}`).digest();

  return leadingZeroBits(digest) >= difficultyBits;
}

/**
 * Finds a solution to a challenge, a slice at a time.
 *
 * @param challenge - The challenge.
 * @param difficultyBits - The zero bits the digest must start with.
 * @param signal - Stops the search, on shutdown.
 * @returns A solution: a counter in base 36.
 * @throws {Error} When the difficulty is past what a house can meet, or the search is stopped.
 */
export async function solveChallenge(
  challenge: string,
  difficultyBits: number,
  signal?: AbortSignal,
): Promise<string> {
  if (difficultyBits > MAXIMUM_BITS) {
    throw new Error(`The Community Hub asks for ${String(difficultyBits)} bits of work`);
  }

  for (let start = 0; ; start += SLICE) {
    signal?.throwIfAborted();

    for (let counter = start; counter < start + SLICE; counter += 1) {
      const solution = counter.toString(36);

      if (solves(challenge, solution, difficultyBits)) {
        return solution;
      }
    }

    // eslint-disable-next-line no-await-in-loop -- a slice at a time, on purpose
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}
