/**
 * What the tag field offers as somebody types: the tags that match, and the one it could make.
 *
 * Pure, so the field's behaviour is testable without a field: which tags a query narrows to,
 * and when what was typed is a name no tag has yet and so could become one.
 */
import { TAG_NAME_MAXIMUM_LENGTH, type TagView } from '@nebula-home/contracts';

/**
 * The tags a query narrows to, leaving out those already on the row.
 *
 * A substring match rather than a prefix one: "monitored" should find "Energy monitored", and
 * there are never enough tags for the difference to cost anything.
 *
 * @param tags - Every tag, in the order they should read.
 * @param selectedIds - The tags already on the row, which are not offered again.
 * @param query - What was typed; blank offers everything.
 * @returns The tags to offer, in the order given.
 */
export function filterTagChoices(
  tags: readonly TagView[],
  selectedIds: readonly string[],
  query: string,
): TagView[] {
  const chosen = new Set(selectedIds);
  const needle = query.trim().toLowerCase();

  return tags.filter(
    (tag) => !chosen.has(tag.id) && (needle === '' || tag.name.toLowerCase().includes(needle)),
  );
}

/**
 * The name a new tag would get from what was typed, when no tag has it already.
 *
 * Case-insensitive on purpose: "exterior" beside "Exterior" would be two tags for one idea, and
 * the field offers the existing one instead.
 *
 * @param tags - Every tag.
 * @param query - What was typed.
 * @returns The trimmed name, or null when nothing should be offered.
 */
export function creatableTagName(tags: readonly TagView[], query: string): string | null {
  const name = query.trim();

  if (name === '' || name.length > TAG_NAME_MAXIMUM_LENGTH) {
    return null;
  }

  const lowered = name.toLowerCase();

  return tags.some((tag) => tag.name.toLowerCase() === lowered) ? null : name;
}
