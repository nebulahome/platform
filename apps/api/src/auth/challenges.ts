/**
 * Pending two-factor challenges.
 *
 * A challenge is what sits between "the password was right" and "you are signed in". It has to
 * be short-lived, single-use, and worth nothing on its own - so it is a random id pointing at a
 * server-side record, not a token the client could learn anything from.
 *
 * Held in memory rather than in a table. A challenge lives five minutes and is used once; a row
 * for it would mean a write, a read, a delete and a sweep job for something whose entire
 * lifetime is shorter than a deploy. The cost is that a challenge does not survive a restart or
 * cross to another instance, which shows up as "the code did not work, sign in again" - the same
 * thing the user does when a code expires. That trade is recorded in API.md.
 */
import { randomBytes } from 'node:crypto';

import { TWO_FACTOR_CHALLENGE_TTL_SECONDS } from '@nebulahome/contracts';

/** What is remembered between the password step and the code step. */
export type Challenge = {
  /** Who is signing in. */
  readonly userId: string;

  /** Where from, carried so the session records the address that actually signed in. */
  readonly ipAddress: string | null;

  /** What with. */
  readonly userAgent: string | null;

  /** When it stops being usable, in epoch milliseconds. */
  readonly expiresAt: number;

  /** How many codes have been tried against it. */
  attempts: number;
};

/** How many wrong codes a challenge tolerates before it is thrown away. */
const MAX_ATTEMPTS = 5;

/** How many challenges may be pending at once. */
const CAPACITY = 1000;

/** A bounded, expiring set of pending challenges. */
export class ChallengeStore {
  /** The pending challenges, by id. */
  readonly #entries = new Map<string, Challenge>();

  /** The clock, injectable for tests. */
  readonly #now: () => number;

  /**
   * Creates the store.
   *
   * @param now - Where the time comes from.
   */
  public constructor(now: () => number = () => Date.now()) {
    this.#now = now;
  }

  /**
   * Opens a challenge.
   *
   * @param userId - Who passed the password step.
   * @param ipAddress - Where from.
   * @param userAgent - What with.
   * @returns The id to hand to the client, and when it expires.
   */
  public open(
    userId: string,
    ipAddress: string | null,
    userAgent: string | null,
  ): { id: string; expiresAt: Date } {
    this.sweep();

    if (this.#entries.size >= CAPACITY) {
      const oldest = this.#entries.keys().next();

      if (!oldest.done) {
        this.#entries.delete(oldest.value);
      }
    }

    const id = randomBytes(24).toString('base64url');
    const expiresAt = this.#now() + TWO_FACTOR_CHALLENGE_TTL_SECONDS * 1000;

    this.#entries.set(id, { userId, ipAddress, userAgent, expiresAt, attempts: 0 });

    return { id, expiresAt: new Date(expiresAt) };
  }

  /**
   * Reads a challenge and counts the attempt against it.
   *
   * @param id - What the client sent back.
   * @returns The challenge, or undefined when it is unknown, expired or exhausted.
   */
  public attempt(id: string): Challenge | undefined {
    const found = this.#entries.get(id);

    if (found === undefined) {
      return undefined;
    }

    if (found.expiresAt <= this.#now()) {
      this.#entries.delete(id);

      return undefined;
    }

    found.attempts += 1;

    // Thrown away rather than merely refused, so that a challenge id cannot be used as an
    // unlimited oracle for guessing six digits.
    if (found.attempts > MAX_ATTEMPTS) {
      this.#entries.delete(id);

      return undefined;
    }

    return found;
  }

  /**
   * Consumes a challenge.
   *
   * @param id - The challenge that has now been satisfied.
   */
  public close(id: string): void {
    this.#entries.delete(id);
  }

  /**
   * Drops everything that has expired.
   *
   * @returns How many were removed.
   */
  public sweep(): number {
    const now = this.#now();
    let removed = 0;

    for (const [id, challenge] of this.#entries) {
      if (challenge.expiresAt <= now) {
        this.#entries.delete(id);
        removed += 1;
      }
    }

    return removed;
  }

  /**
   * How many challenges are pending.
   *
   * @returns The count.
   */
  public get size(): number {
    return this.#entries.size;
  }
}
