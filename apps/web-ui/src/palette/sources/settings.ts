/**
 * Settings in the command palette: the rows of the settings index whose page the person may open.
 * Enter goes to the page with the row lit, as the settings search does (`SettingsRow`).
 */
import { text } from '@/i18n/messages';
import type { PaletteItem } from '@/palette/palette-types';
import { goTo, HINTS, makeItem } from '@/palette/sources/make-item';
import { SETTINGS_INDEX } from '@/routes/settings/settings-index';
import type { SettingsGroup } from '@/routes/settings/settings-tree';
import { settingDescription } from '@/settings/setting-descriptions';

/**
 * The settings' rows.
 *
 * @param tree - The settings tree, as far as the person may open it (`reachableTree`).
 * @param at - What makes this visit its own, so finding the same row twice lights it twice.
 * @returns The rows.
 */
export function settingItems(tree: readonly SettingsGroup[], at: number): PaletteItem[] {
  const where = new Map(tree.flatMap((group) => group.pages.map((page) => [page.path, page])));

  return SETTINGS_INDEX.flatMap((entry) => {
    const page = where.get(entry.path);

    if (page === undefined) {
      return [];
    }

    const note =
      entry.note === 'catalogue' ? settingDescription(entry.id, undefined) : text(entry.note);

    return [
      makeItem({
        group: 'settings',
        refId: entry.id,
        title: text(entry.title),
        secondary: `${text(page.label)} › ${text(entry.section)}`,
        fields: [note],
        icon: { kind: 'ui', id: entry.icon },
        primary: goTo(
          `${entry.path}?highlight=${encodeURIComponent(entry.id)}&at=${String(at)}`,
          HINTS.goTo,
        ),
      }),
    ];
  });
}
