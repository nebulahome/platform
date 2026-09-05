/**
 * The command replay store.
 *
 * The three behaviours worth pinning: a repeat of the same request replays the same answer, a
 * repeat of a *different* request under the same key is refused rather than answered wrongly,
 * and nothing is remembered forever.
 */
import { ConflictError, IDEMPOTENCY_TTL_SECONDS } from '@nebula-home/contracts';
import { describe, expect, it } from 'vitest';

import { IdempotencyStore } from './idempotency.js';

/**
 * A store whose clock the test moves by hand.
 *
 * @param start - The moment it begins at, in epoch milliseconds.
 * @returns The store and a way to move its clock.
 */
function storeAt(start: number): { store: IdempotencyStore; advance: (ms: number) => void } {
  let now = start;
  const store = new IdempotencyStore({
    now: (): number => now,
  });

  return {
    store,
    advance: (ms: number): void => {
      now += ms;
    },
  };
}

describe('IdempotencyStore', () => {
  it('does not know a key it has never seen', () => {
    const { store } = storeAt(0);

    expect(store.lookup('k', 'fingerprint')).toBeUndefined();
  });

  it('replays what the same request answered', () => {
    const { store } = storeAt(0);

    store.record('k', 'fingerprint', 202, { accepted: true });

    expect(store.lookup('k', 'fingerprint')).toEqual({ status: 202, body: { accepted: true } });
  });

  it('refuses a key reused for a different request', () => {
    const { store } = storeAt(0);

    store.record('k', 'turn-on', 202, { accepted: true });

    expect(() => store.lookup('k', 'turn-off')).toThrow(ConflictError);
  });

  it('forgets an entry once its lifetime is over', () => {
    const { store, advance } = storeAt(0);

    store.record('k', 'fingerprint', 202, {});
    advance(IDEMPOTENCY_TTL_SECONDS * 1000 + 1);

    expect(store.lookup('k', 'fingerprint')).toBeUndefined();
  });

  it('still replays just before the lifetime is over', () => {
    const { store, advance } = storeAt(0);

    store.record('k', 'fingerprint', 202, {});
    advance(IDEMPOTENCY_TTL_SECONDS * 1000 - 1);

    expect(store.lookup('k', 'fingerprint')).toBeDefined();
  });

  it('sweeps only what has expired', () => {
    const { store, advance } = storeAt(0);

    store.record('old', 'f', 202, {});
    advance(IDEMPOTENCY_TTL_SECONDS * 1000 - 10);
    store.record('new', 'f', 202, {});
    advance(20);

    expect(store.sweep()).toBe(1);
    expect(store.size).toBe(1);
  });

  it('drops the oldest rather than growing without bound', () => {
    const { store } = storeAt(0);
    const bounded = new IdempotencyStore({ capacity: 3 });

    for (const key of ['a', 'b', 'c', 'd']) {
      bounded.record(key, 'f', 202, {});
    }

    expect(bounded.size).toBe(3);
    expect(bounded.lookup('a', 'f')).toBeUndefined();
    expect(bounded.lookup('d', 'f')).toBeDefined();
    expect(store.size).toBe(0);
  });

  it('scopes a key to one caller and one route', () => {
    const mine = IdempotencyStore.keyFor('user-1', 'entities.command', 'abc');
    const theirs = IdempotencyStore.keyFor('user-2', 'entities.command', 'abc');
    const elsewhere = IdempotencyStore.keyFor('user-1', 'scenes.apply', 'abc');

    expect(mine).not.toBe(theirs);
    expect(mine).not.toBe(elsewhere);
  });
});
