/**
 * What every source of the command palette shares: building an item with its search fields
 * folded once, and the words its keys say.
 */
import { defineMessage, text } from '@/i18n/messages';
import { foldForSearch } from '@/lib/search-text';
import type { PaletteCommand, PaletteItem } from '@/palette/palette-types';
import { foldAll } from '@/palette/rank';

/** What a source says about one item; the rest is worked out here. */
export type ItemDraft = Omit<
  PaletteItem,
  'id' | 'foldedTitle' | 'fields' | 'exactIds' | 'isName'
> & {
  /** What else it is found by, as written; the second text is added. */
  readonly fields?: readonly (string | null | undefined)[];

  /** Ids it is found by only whole, as written. */
  readonly exactIds?: readonly (string | null | undefined)[];

  /** A name the house gave. */
  readonly isName?: boolean;
};

/** The words the keys say. */
export const HINTS = {
  open: defineMessage('palette.hint.open', 'Open'),
  goTo: defineMessage('palette.hint.goTo', 'Go to'),
  run: defineMessage('palette.hint.run', 'Run'),
  apply: defineMessage('palette.hint.apply', 'Apply'),
  enable: defineMessage('palette.hint.enable', 'Enable'),
  disable: defineMessage('palette.hint.disable', 'Disable'),
  addDevice: defineMessage('palette.hint.addDevice', 'Add device'),
};

/**
 * Builds an item.
 *
 * @param draft - See {@link ItemDraft}.
 * @returns The item.
 */
export function makeItem(draft: ItemDraft): PaletteItem {
  const { fields = [], exactIds = [], isName = false, ...rest } = draft;

  return {
    ...rest,
    id: `${draft.group}:${draft.refId}`,
    foldedTitle: foldForSearch(draft.title),
    fields: foldAll([draft.secondary, ...fields]),
    exactIds: foldAll(exactIds),
    isName,
  };
}

/**
 * Enter or Tab that goes to a page.
 *
 * @param to - Where.
 * @param hint - What the key says; Open when not said.
 * @returns The action.
 */
export function goTo(
  to: string,
  hint = HINTS.open,
): { readonly hint: string; readonly command: PaletteCommand } {
  return { hint: text(hint), command: { type: 'go', to } };
}
