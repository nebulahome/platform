/**
 * ULID generation for message identifiers and trace identifiers.
 *
 * Every envelope carries a ULID rather than a UUID because a ULID's leading 48 bits are the
 * publication timestamp: sorting a list of message ids lexicographically puts them in the order
 * they were published, so a log file sorted by id is a log file sorted by time even when the
 * records arrived out of order from several services.
 *
 * Implemented here rather than taken from a dependency because it is forty lines of arithmetic
 * with an exactly specified output, and `@nebulahome/contracts` already owns the pattern that
 * validates the result.
 */
import { randomFillSync } from 'node:crypto';

/**
 * Crockford's base32 alphabet.
 *
 * `I`, `L`, `O` and `U` are absent: the first three are excluded because they are confusable
 * with `1` and `0` when someone reads an identifier off a screen, and `U` because it keeps
 * accidental obscenities out of generated identifiers.
 */
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Number of symbols in the alphabet, and therefore the base of both halves. */
const ENCODING_BASE = 32;

/** Symbols spent on the timestamp: 10 base32 symbols hold the 48 bits of a millisecond clock. */
const TIME_LENGTH = 10;

/** Symbols spent on randomness: 16 base32 symbols hold 80 bits. */
const RANDOM_LENGTH = 16;

/** The largest millisecond timestamp 48 bits can hold, reached in the year 10889. */
const MAX_TIME_MS = 281_474_976_710_655;

/** Where the two halves of a ULID come from, replaceable so a test can make one deterministic. */
export type UlidSources = {
  /** Current time in milliseconds since the Unix epoch. Defaults to `Date.now`. */
  readonly now?: () => number;

  /** Fills the given buffer with random bytes. Defaults to the platform CSPRNG. */
  readonly fillRandom?: (into: Uint8Array) => void;
};

/**
 * Encodes a millisecond timestamp as the first ten symbols of a ULID.
 *
 * @param timeMs - Milliseconds since the Unix epoch.
 * @returns Ten base32 symbols, most significant first.
 * @throws {RangeError} When the timestamp does not fit in 48 bits, which means the clock is
 * either before the epoch or wrong by several thousand years. Silently truncating it would
 * produce identifiers that sort before every existing one.
 */
function encodeTime(timeMs: number): string {
  if (!Number.isInteger(timeMs) || timeMs < 0 || timeMs > MAX_TIME_MS) {
    throw new RangeError(`Timestamp ${String(timeMs)} is not representable in a ULID`);
  }

  let remaining = timeMs;
  let encoded = '';

  for (let position = 0; position < TIME_LENGTH; position += 1) {
    encoded = ENCODING.charAt(remaining % ENCODING_BASE) + encoded;
    remaining = Math.floor(remaining / ENCODING_BASE);
  }

  return encoded;
}

/**
 * Renders an array of alphabet positions as symbols.
 *
 * @param positions - One index into {@link ENCODING} per symbol.
 * @returns The symbols those indices name, in order.
 */
function encodePositions(positions: readonly number[]): string {
  let encoded = '';

  for (const position of positions) {
    encoded += ENCODING.charAt(position);
  }

  return encoded;
}

/**
 * Adds one to the random half, treating it as a big-endian base32 number.
 *
 * @param positions - The random half, mutated in place.
 * @returns True when the increment fit, false when every symbol was already the last one and
 * the value wrapped - a one-in-2^80 event the caller resolves by advancing the clock instead.
 */
function incrementPositions(positions: number[]): boolean {
  for (let index = positions.length - 1; index >= 0; index -= 1) {
    const current = positions[index] ?? 0;

    if (current < ENCODING_BASE - 1) {
      positions[index] = current + 1;
      return true;
    }

    positions[index] = 0;
  }

  return false;
}

/**
 * Builds a ULID generator that never repeats and never goes backwards.
 *
 * Two ULIDs generated in the same millisecond are ordered by incrementing the random half of the
 * previous one rather than drawing fresh randomness. Without that, a burst of state reports
 * inside one millisecond would produce identifiers whose sort order is arbitrary, and the
 * ordering guarantee that justifies using ULIDs at all would hold only between milliseconds.
 *
 * @param sources - Clock and randomness, defaulted to the real ones.
 * @returns A function returning one new 26-character ULID per call.
 */
export function createUlidFactory(sources: UlidSources = {}): () => string {
  const now = sources.now ?? Date.now;
  const fillRandom = sources.fillRandom ?? ((into: Uint8Array): void => void randomFillSync(into));

  const buffer = new Uint8Array(RANDOM_LENGTH);
  let lastTimeMs = -1;
  let lastPositions: number[] = [];

  return function nextUlid(): string {
    const observedMs = now();

    if (observedMs > lastTimeMs) {
      fillRandom(buffer);
      lastTimeMs = observedMs;
      // One byte per symbol, reduced into the alphabet. The two bits lost per symbol cost 32 of
      // the 80 bits of entropy and buy an implementation with no bit packing in it.
      lastPositions = [...buffer].map((byte) => byte % ENCODING_BASE);

      return encodeTime(lastTimeMs) + encodePositions(lastPositions);
    }

    // The clock has not advanced - either two calls landed in the same millisecond, or it went
    // backwards, which NTP does. Either way the previous identifier is the floor.
    if (!incrementPositions(lastPositions)) {
      lastTimeMs += 1;
      fillRandom(buffer);
      lastPositions = [...buffer].map((byte) => byte % ENCODING_BASE);
    }

    return encodeTime(lastTimeMs) + encodePositions(lastPositions);
  };
}

/**
 * The platform's ULID generator.
 *
 * One instance per process, so that monotonicity holds across every message the process
 * publishes rather than only within whichever module happened to build a factory.
 */
export const ulid = createUlidFactory();
