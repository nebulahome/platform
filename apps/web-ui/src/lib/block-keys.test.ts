import { describe, expect, it } from 'vitest';

import { reconcileKeys } from './block-keys';
import { landingIndex, moveItem } from './use-sortable';

/**
 * A source of keys for a test: k1, k2, …
 *
 * @returns The source.
 */
function counter(): () => string {
  let next = 0;

  return () => {
    next += 1;

    return `k${String(next)}`;
  };
}

describe('reconcileKeys', () => {
  const a = { id: 'a' };
  const b = { id: 'b' };
  const c = { id: 'c' };

  it('lets a key follow its block when the list is reordered', () => {
    expect(reconcileKeys([a, b, c], ['ka', 'kb', 'kc'], [c, a, b])).toEqual(['kc', 'ka', 'kb']);
  });

  it('keeps the key of a block that was edited, which is a new object in the same place', () => {
    const edited = { id: 'b', changed: true };

    expect(reconcileKeys([a, b, c], ['ka', 'kb', 'kc'], [a, edited, c])).toEqual([
      'ka',
      'kb',
      'kc',
    ]);
  });

  it('gives a new block a new key, and drops a removed one', () => {
    const fresh = counter();

    expect(reconcileKeys([a, b], ['ka', 'kb'], [a, { id: 'new' }, b], fresh)).toEqual([
      'ka',
      'k1',
      'kb',
    ]);
    expect(reconcileKeys([a, b, c], ['ka', 'kb', 'kc'], [a, c])).toEqual(['ka', 'kc']);
  });
});

describe('moving a block', () => {
  it('lands where its middle has passed the middle of another', () => {
    const middles = [10, 50, 90, 130];

    expect(landingIndex(middles, 1, 50)).toBe(1);
    expect(landingIndex(middles, 1, 100)).toBe(2);
    expect(landingIndex(middles, 1, 140)).toBe(3);
    expect(landingIndex(middles, 2, 5)).toBe(0);
  });

  it('moves an item to its new place', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']);
  });
});
