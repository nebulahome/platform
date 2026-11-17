/**
 * What the command palette's list shows for a query (docs: command palette, 6.1 to 6.5): with an
 * empty field, the id just copied, the recent things and the first actions; with words, the groups
 * of results. Each row is an option the arrows walk, in the order it reads: a group's "Show all"
 * after its rows, the Hub after nothing found.
 */
import type { PaletteGroupId, PaletteItem } from '@/palette/palette-types';
import {
  rankItems,
  groupResults,
  ROWS_EXPANDED,
  type PaletteSection,
  type PaletteSectionId,
} from '@/palette/rank';
import { ACTIONS_WHEN_EMPTY } from '@/palette/sources/actions';

/** One row the arrows can reach. */
export type PaletteOption =
  | {
      readonly kind: 'item';
      readonly key: string;
      readonly section: PaletteSectionId;
      readonly item: PaletteItem;
    }
  | {
      readonly kind: 'more';
      readonly key: string;
      readonly group: PaletteGroupId;
      readonly total: number;
    }
  | { readonly kind: 'hub'; readonly key: string };

/** What the list shows. */
export type PaletteLayout = {
  readonly sections: readonly PaletteSection[];

  /** Every row the arrows reach, in order. */
  readonly options: readonly PaletteOption[];
};

/** What the layout is worked out from. */
export type PaletteLayoutInput = {
  readonly items: readonly PaletteItem[];

  /** The query's words, folded; none for an empty field. */
  readonly words: readonly string[];

  /** The ids of the items opened lately, the latest first. */
  readonly recents: readonly string[];

  /** The group asked for in full. */
  readonly expanded: PaletteGroupId | null;

  /** The item whose id was just copied, for an empty field. */
  readonly clipboard: PaletteItem | null;

  /** Whether nothing found offers to search the Hub. */
  readonly canSearchHub: boolean;
};

/**
 * Works out the list.
 *
 * @param input - See {@link PaletteLayoutInput}.
 * @returns The sections and the options.
 */
export function layoutPalette(input: PaletteLayoutInput): PaletteLayout {
  const { items, words, recents, expanded, clipboard, canSearchHub } = input;
  const sections: PaletteSection[] = [];

  if (words.length === 0) {
    const byId = new Map(items.map((item) => [item.id, item]));
    const recent = recents.flatMap((id) => {
      const item = byId.get(id);

      return item === undefined ? [] : [item];
    });
    const actions = items
      .filter((item) => item.group === 'actions' && item.requiresVerb !== true)
      .slice(0, ACTIONS_WHEN_EMPTY);

    for (const [id, found] of [
      ['clipboard', clipboard === null ? [] : [clipboard]],
      ['recent', recent],
      ['actions', actions],
    ] as const) {
      if (found.length > 0) {
        sections.push({ id, items: found, total: found.length, isExpanded: false });
      }
    }
  } else {
    sections.push(...groupResults(rankItems(items, words, new Set(recents)), expanded));
  }

  const options = sections.flatMap((section): PaletteOption[] => {
    const rows = section.items.map((item): PaletteOption => ({
      kind: 'item',
      key: `${section.id}/${item.id}`,
      section: section.id,
      item,
    }));
    // Past the most a group shows in full, the list says to narrow the search instead.
    const hasMore =
      section.total > section.items.length &&
      !(section.isExpanded && section.total > ROWS_EXPANDED);
    const { id } = section;

    return hasMore && id !== 'clipboard' && id !== 'recent'
      ? [...rows, { kind: 'more', key: `more/${id}`, group: id, total: section.total }]
      : rows;
  });

  if (words.length > 0 && options.length === 0 && canSearchHub) {
    options.push({ kind: 'hub', key: 'hub' });
  }

  return { sections, options };
}
