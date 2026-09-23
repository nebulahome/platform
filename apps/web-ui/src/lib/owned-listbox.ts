/**
 * Whether a press landed in a list that a control inside some element owns.
 *
 * A sheet that shuts on a press outside itself has to know about the one thing that is outside
 * it in the document and inside it in meaning: the list a dropdown in the sheet has portalled
 * to the body. The link is the one the dropdown already declares for a screen reader -
 * `aria-controls` on the combobox naming the listbox's id - so nothing is added for this.
 * Attribute values are compared rather than built into a selector, because the ids React makes
 * carry characters a selector would need escaping for.
 */

/**
 * Whether a node is inside a listbox that a combobox within `root` controls.
 *
 * @param root - The element whose controls may own a list.
 * @param target - Where the press landed.
 * @returns True when the press is in a list one of the root's controls opened.
 */
export function isOwnedListbox(root: Element, target: Node): boolean {
  const list = target instanceof Element ? target.closest('[role="listbox"]') : null;

  if (list === null || list.id === '') {
    return false;
  }

  return [...root.querySelectorAll('[aria-controls]')].some(
    (owner) => owner.getAttribute('aria-controls') === list.id,
  );
}
