/**
 * The colours of named values in a template: an HTTP request's parameters, each `{{ name }}`
 * painted in its own colour.
 *
 * **A name keeps its colour.** The colour follows from the name - the same name is the same
 * colour on every visit - and only when two names land on one colour does the second move to the
 * next free one.
 */
import { TAG_COLORS, type TagColor } from '@nebulahome/contracts';

/** One source as the form holds it. */
export type SourceDraft = {
  /** Which row this is, for React: fixed when the row is made, never an index. */
  readonly rowKey: string;
  readonly variableName: string;
  readonly entityId: string;
};

/** What a variable name must look like, as the contract checks it. */
export const VARIABLE_PATTERN = /^[a-z][a-z0-9_]{0,31}$/u;

/**
 * The colour a name would take on its own.
 *
 * @param name - The variable name.
 * @returns A palette colour that follows from the name.
 */
function preferredColor(name: string): TagColor {
  let hash = 0;

  for (const character of name) {
    hash = (hash * 31 + character.charCodeAt(0)) % 1_000_003;
  }

  return TAG_COLORS[hash % TAG_COLORS.length] ?? TAG_COLORS[0];
}

/**
 * The colour of every source row.
 *
 * @param sources - The rows, in order.
 * @returns Each row's colour, by its key: the name's own, or the next free one on a clash.
 */
export function sourceColors(sources: readonly SourceDraft[]): ReadonlyMap<string, TagColor> {
  const colors = new Map<string, TagColor>();
  const taken = new Set<TagColor>();

  for (const source of sources) {
    const preferred = preferredColor(source.variableName.trim());
    const start = TAG_COLORS.indexOf(preferred);
    const free =
      TAG_COLORS.map((unused, offset) => TAG_COLORS[(start + offset) % TAG_COLORS.length]).find(
        (color) => color !== undefined && !taken.has(color),
      ) ?? preferred;

    colors.set(source.rowKey, free);
    taken.add(free);
  }

  return colors;
}
