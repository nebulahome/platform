/**
 * Installed packages in the command palette: found by name, description and category; Enter opens
 * the package.
 */
import type { ApiPackage } from '@nebulahome/contracts';

import { defineMessage, text } from '@/i18n/messages';
import type { PaletteItem } from '@/palette/palette-types';
import { goTo, makeItem } from '@/palette/sources/make-item';
import { PACKAGE_STATE_OF } from '@/routes/packages/package-tile';

const KIND = defineMessage('palette.kinds.package', 'Package');

/**
 * The packages' rows.
 *
 * @param packages - The installed packages.
 * @returns The rows.
 */
export function packageItems(packages: readonly ApiPackage[]): PaletteItem[] {
  return packages.map((found) =>
    makeItem({
      group: 'packages',
      refId: found.id,
      title: found.name,
      secondary: text(PACKAGE_STATE_OF[found.state].label),
      kindLabel: text(KIND),
      fields: [found.description, found.category, found.id],
      icon: { kind: 'package', found },
      isName: true,
      primary: goTo(`/packages/${encodeURIComponent(found.id)}`),
    }),
  );
}
