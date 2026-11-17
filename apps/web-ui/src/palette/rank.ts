/**
 * How the command palette orders what it found (docs: command palette, 6.2): one score per item,
 * then groups, each as high as its best row, each cut to a few rows until it is asked for in full.
 *
 * Matching is the interface's own rule (`search-text.ts`): every word must be found, in any order,
 * case and accents aside. What a word is found in decides how high the row goes: the name itself
 * first, from its start, then from the start of one of its words, then anywhere in it; a row found
 * only by its area, device or aliases comes last. An id is found only whole, so a pasted entity id
 * or uuid is the first row and a fragment of a uuid finds nothing.
 */
import { foldForSearch } from '@/lib/search-text';
import { GROUP_ORDER, type PaletteGroupId, type PaletteItem } from '@/palette/palette-types';

/** Rows a group shows before "Show all". */
export const ROWS_PER_GROUP = 5;

/** Rows the whole list shows, groups shown in full aside. */
export const ROWS_IN_ALL = 30;

/** Rows a group shown in full goes up to; past them the search has to be narrowed. */
export const ROWS_EXPANDED = 50;

/** The score of an item a word was not found in. */
const EXCLUDED = -1;

/** A heading of the list: a group of results, or one of the lists of the empty field. */
export type PaletteSectionId = PaletteGroupId | 'clipboard' | 'recent';

/** One heading and its rows. */
export type PaletteSection = {
  readonly id: PaletteSectionId;
  readonly items: readonly PaletteItem[];

  /** How many it found, shown or not. */
  readonly total: number;

  /** Whether it was asked for in full. */
  readonly isExpanded: boolean;
};

/**
 * Folds the fields an item is found by, dropping the empty ones.
 *
 * @param values - As written.
 * @returns Folded, non-blank.
 */
export function foldAll(values: readonly (string | null | undefined)[]): string[] {
  return values.flatMap((value) => {
    const folded = value === null || value === undefined ? '' : foldForSearch(value);

    return folded === '' ? [] : [folded];
  });
}

/**
 * Scores one item against the words typed.
 *
 * @param item - The item.
 * @param words - The query's words, folded (`queryWords`).
 * @returns Higher first; negative when a word was not found.
 */
export function scoreItem(item: PaletteItem, words: readonly string[]): number {
  if (words.length === 0) {
    return 0;
  }

  const query = words.join(' ');
  const title = item.foldedTitle;

  if (item.exactIds.includes(query)) {
    return 600;
  }

  // "Add device · Shelly" waits for its verb: "add shelly" finds it, "shelly" alone does not.
  if (item.requiresVerb === true && !(title.split(' ')[0] ?? '').startsWith(words[0] ?? '')) {
    return EXCLUDED;
  }

  /**
   * Whether a word is in the title or another field.
   *
   * @param word - The word, folded.
   * @returns True when found.
   */
  const isFound = (word: string): boolean =>
    title.includes(word) || item.fields.some((field) => field.includes(word));

  if (!words.every(isFound)) {
    return EXCLUDED;
  }

  if (title === query) {
    return 500;
  }

  if (title.startsWith(query)) {
    return 400;
  }

  if (title.includes(` ${query}`)) {
    return 300;
  }

  if (title.includes(query)) {
    return 200;
  }

  return words.every((word) => title.includes(word)) ? 150 : 100;
}

/**
 * Finds and orders the items for a query: by score, a recent one first in a tie, one that is off
 * last.
 *
 * @param items - Everything the palette may offer.
 * @param words - The query's words, folded.
 * @param recents - The ids of the items opened lately.
 * @returns The items found, best first.
 */
export function rankItems(
  items: readonly PaletteItem[],
  words: readonly string[],
  recents: ReadonlySet<string>,
): { readonly item: PaletteItem; readonly score: number }[] {
  /**
   * What breaks a tie: a recent item wins it, one that is off loses it.
   *
   * @param item - The item.
   * @returns Higher first.
   */
  const tieBreak = (item: PaletteItem): number =>
    (recents.has(item.id) ? 2 : 1) - (item.isDimmed === true ? 1 : 0);

  return items
    .map((item) => ({ item, score: scoreItem(item, words) }))
    .filter((found) => found.score >= 0)
    .toSorted((a, b) => b.score - a.score || tieBreak(b.item) - tieBreak(a.item));
}

/**
 * Groups what was found: each group as high as its best row, a tie in the fixed order of the
 * kinds; a few rows a group, and a few in all, but every row of a group asked for in full.
 *
 * @param found - The items found, best first (`rankItems`).
 * @param expanded - The group asked for in full, if any.
 * @returns The sections, in order.
 */
export function groupResults(
  found: readonly { readonly item: PaletteItem; readonly score: number }[],
  expanded: PaletteGroupId | null,
): PaletteSection[] {
  const byGroup = new Map<PaletteGroupId, { best: number; items: PaletteItem[] }>();

  for (const { item, score } of found) {
    const group = byGroup.get(item.group);

    if (group === undefined) {
      byGroup.set(item.group, { best: score, items: [item] });
    } else {
      group.items.push(item);
    }
  }

  const ordered = [...byGroup].toSorted(
    ([a, left], [b, right]) =>
      right.best - left.best || GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b),
  );
  const sections: PaletteSection[] = [];
  let room = ROWS_IN_ALL;

  for (const [id, { items }] of ordered) {
    const isExpanded = id === expanded;
    const shown = isExpanded ? ROWS_EXPANDED : Math.min(ROWS_PER_GROUP, room);

    if (shown <= 0) {
      continue;
    }

    sections.push({ id, items: items.slice(0, shown), total: items.length, isExpanded });
    room -= isExpanded ? 0 : Math.min(shown, items.length);
  }

  return sections;
}
