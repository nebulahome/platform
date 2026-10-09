/**
 * Keys that stay with a block when the list it is in changes.
 *
 * The draft is a list of plain objects, replaced on every edit: a block that was edited is a new
 * object, one that moved is the same object somewhere else. Keyed by position, React would hand a
 * moved block the open state, the focus and the selection of the block that was there before;
 * these keys follow the block instead.
 *
 * A key follows its object; an edited block - a new object - keeps the key of the one it replaced
 * at its position, unless that key moved on with its object. Anything else is new.
 */
import { useState } from 'react';

/** A source of fresh keys, shared so a key is unique across every list in the page. */
let next = 0;

/**
 * A key nothing has had.
 *
 * @returns The key.
 */
export function freshBlockKey(): string {
  next += 1;

  return `block-${String(next)}`;
}

/**
 * Works out the keys of a list from the keys of what it was.
 *
 * @param previous - The list as it was.
 * @param previousKeys - Its keys.
 * @param items - The list as it is.
 * @param fresh - Where new keys come from.
 * @returns A key for every item, in order.
 */
export function reconcileKeys<TItem>(
  previous: readonly TItem[],
  previousKeys: readonly string[],
  items: readonly TItem[],
  fresh: () => string = freshBlockKey,
): string[] {
  const byItem = new Map<TItem, string>();

  previous.forEach((item, index) => {
    const key = previousKeys[index];

    if (key !== undefined && !byItem.has(item)) {
      byItem.set(item, key);
    }
  });

  const used = new Set<string>();
  const keys: (string | undefined)[] = items.map((item) => {
    const key = byItem.get(item);

    if (key === undefined || used.has(key)) {
      return undefined;
    }

    used.add(key);

    return key;
  });

  return keys.map((key, index) => {
    if (key !== undefined) {
      return key;
    }

    const inherited = previousKeys[index];

    if (inherited !== undefined && !used.has(inherited)) {
      used.add(inherited);

      return inherited;
    }

    const made = fresh();

    used.add(made);

    return made;
  });
}

/**
 * Keys for a list's blocks that follow each block as the list changes.
 *
 * @param items - The list.
 * @returns A key for every item, in order.
 */
export function useBlockKeys(items: readonly unknown[]): readonly string[] {
  const [memory, setMemory] = useState(() => ({
    items,
    keys: items.map(() => freshBlockKey()),
  }));

  if (
    memory.items === items ||
    (memory.items.length === items.length &&
      memory.items.every((item, index) => item === items[index]))
  ) {
    return memory.keys;
  }

  // Derived during render from the list it was last given, as React's own advice for state that
  // follows a prop: the update is applied before the next render is committed.
  const keys = reconcileKeys(memory.items, memory.keys, items);

  setMemory({ items, keys });

  return keys;
}
