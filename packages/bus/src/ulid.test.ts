import { describe, expect, it } from 'vitest';

import { ULID_PATTERN } from '@nebula-home/contracts';

import { createUlidFactory, ulid } from './ulid.js';

/**
 * A deterministic randomness source, so an assertion is about the algorithm rather than a sample.
 *
 * @param fill - The byte written into every position.
 * @returns A function that fills a buffer with that byte.
 */
function constantBytes(fill: number): (into: Uint8Array) => void {
  return (into: Uint8Array): void => {
    into.fill(fill);
  };
}

describe('ulid', () => {
  it('produces what the contract validates', () => {
    expect(ULID_PATTERN.test(ulid())).toBe(true);
  });

  it('is 26 characters', () => {
    expect(ulid()).toHaveLength(26);
  });

  it('sorts in publication order', () => {
    // The whole reason the platform uses ULIDs rather than UUIDs: a list of ids sorted as text
    // is a list sorted by time.
    let clock = 1_788_525_319_852;
    const next = createUlidFactory({
      now: () => clock,
      fillRandom: constantBytes(0),
    });

    const first = next();
    clock += 1;
    const second = next();
    clock += 1000;
    const third = next();

    expect([third, first, second].toSorted()).toStrictEqual([first, second, third]);
  });

  it('still increases within a single millisecond', () => {
    const next = createUlidFactory({
      now: () => 1_788_525_319_852,
      fillRandom: constantBytes(0),
    });

    const first = next();
    const second = next();

    expect(second > first).toBe(true);
    expect(second.slice(0, 10)).toBe(first.slice(0, 10));
  });

  it('does not go backwards when the clock does', () => {
    // NTP steps the clock backwards. An identifier that went backwards with it would break the
    // ordering guarantee exactly when the logs are hardest to read.
    let clock = 1_788_525_319_852;
    const next = createUlidFactory({ now: () => clock, fillRandom: constantBytes(0) });

    const before = next();
    clock -= 5000;
    const after = next();

    expect(after > before).toBe(true);
  });

  it('advances the clock rather than repeating when randomness is exhausted', () => {
    // Every symbol at the top of the alphabet, so the very next call has nothing left to
    // increment. It must still produce something larger.
    const next = createUlidFactory({
      now: () => 1_788_525_319_852,
      fillRandom: constantBytes(31),
    });

    const first = next();
    const second = next();

    expect(second > first).toBe(true);
    expect(ULID_PATTERN.test(second)).toBe(true);
  });

  it('never repeats across a burst', () => {
    const produced = new Set(Array.from({ length: 2000 }, () => ulid()));

    expect(produced.size).toBe(2000);
  });
});
