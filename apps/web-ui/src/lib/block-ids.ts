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
