/**
 * Choosing a key for a tag or an area, and looking up the ones it must not collide with.
 */
import { describe, expect, it } from 'vitest';

import { chooseFreeKey, keyPrefixOf } from './keys.js';

describe('chooseFreeKey', () => {
  it('takes the base when it is free, and numbers it when it is not', () => {
    expect(chooseFreeKey('exterior', new Set())).toBe('exterior');
    expect(chooseFreeKey('exterior', new Set(['exterior']))).toBe('exterior_2');
    expect(chooseFreeKey('exterior', new Set(['exterior', 'exterior_2']))).toBe('exterior_3');
  });

  it('numbers a base at the length limit within the limit', () => {
    const base = 'a'.repeat(64);

    expect(chooseFreeKey(base, new Set([base]))).toBe(`${'a'.repeat(62)}_2`);
  });
});

describe('keyPrefixOf', () => {
  it('finds the numbered keys a long base was cut to make room for', () => {
    // The third tag named the same sixty-four letters: its lookup must see the second one's
    // key, which lost its end to the number and so does not start with the whole base.
    const base = 'a'.repeat(64);
    const taken = [base, `${'a'.repeat(62)}_2`].filter((key) => key.startsWith(keyPrefixOf(base)));

    expect(chooseFreeKey(base, new Set(taken))).toBe(`${'a'.repeat(62)}_3`);
  });

  it('is the base itself when there is room for a number after it', () => {
    expect(keyPrefixOf('exterior')).toBe('exterior');
  });
});
