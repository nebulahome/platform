/**
 * An id for every block of the automation being edited, that follows it wherever it goes.
 *
 * The draft is plain objects, replaced on every edit: a block that was edited is a new object, a
 * block that was dragged is the same object in another list. The id is kept by object, editor-
 * wide, so a dragged block keeps its id - and with it its React key, whether it is open, whether
 * it is selected, what its test said - in whatever list it lands. An edit makes a new object;
 * {@link carryBlockId} hands it the id of the one it replaces, at the one place every edit of a
 * block passes through.
 */
import { useState } from 'react';

/** The ids, by the object each was given to. Weak: a block gone from the draft is let go. */
const ids = new WeakMap<object, string>();

/** A source of fresh ids, shared so an id is unique across the page. */
let next = 0;

/**
 * An id nothing has had.
 *
 * @returns The id.
 */
export function freshBlockId(): string {
  next += 1;

  return `block-${String(next)}`;
}

/**
 * A block's id, given the first time it is asked for.
 *
 * @param block - The block.
 * @returns Its id.
 */
export function blockIdOf(block: object): string {
  let id = ids.get(block);

  if (id === undefined) {
    id = freshBlockId();
    ids.set(block, id);
  }

  return id;
}

/**
 * Hands an edited block the id of the block it replaces, so it is the same block to the editor.
 *
 * @param previous - The block as it was.
 * @param replacement - The block as it now is.
 * @returns The replacement.
 */
export function carryBlockId<TBlock extends object>(previous: object, replacement: TBlock): TBlock {
  // The block as it was may not have been drawn yet - a block inside a closed one - and so may
  // have no id; it is given one now, so both are the same block from here on.
  if (previous !== replacement && !ids.has(replacement)) {
    ids.set(replacement, blockIdOf(previous));
  }

  return replacement;
}

/** The draft ids of a list's rows, from {@link useRowIds}. */
export type RowIds = {
  /** The React key of the row at an index. */
  readonly keyOf: (index: number) => string;

  /** Called when a row is added at the end. */
  readonly added: () => void;

  /** Called with the index of a row as it is removed. */
  readonly removed: (index: number) => void;
};

/**
 * Draft ids for the rows of a list whose entries carry none - name and entity pairs - so a row
 * keeps its React key, and with it its focus, when one above it is removed. The ids live in the
 * editor only, never in the document.
 *
 * @param count - How many rows there are when the list is first drawn.
 * @returns The rows' ids.
 */
export function useRowIds(count: number): RowIds {
  const [ids, setIds] = useState(() => Array.from({ length: count }, () => freshBlockId()));

  /**
   * The key of a row.
   *
   * @param index - Its index.
   * @returns Its draft id.
   */
  const keyOf = (index: number): string =>
    // A rename onto a name already there merges two rows, so the lists can drift apart.
    ids[index] ?? `row-${String(index)}`;

  /** Gives a row added at the end an id. */
  const added = (): void => {
    setIds([...ids, freshBlockId()]);
  };

  /**
   * Lets a removed row's id go.
   *
   * @param index - The row's index.
   */
  const removed = (index: number): void => {
    setIds(ids.filter((id) => id !== ids[index]));
  };

  return { keyOf, added, removed };
}
