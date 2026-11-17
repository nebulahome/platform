/**
 * A row's glyph in the command palette: an interface icon, the catalogue icon the owner chose (or
 * the kind's own while there is none), an integration's logo or a package's.
 */
import type { IconView } from '@nebulahome/contracts';
import { AppIcon, CatalogueIcon } from '@nebulahome/ui';

import type { PaletteIcon } from '@/palette/palette-types';
import { VendorLogo } from '@/routes/library/vendor-card';
import { PackageLogo } from '@/routes/packages/package-tile';

/** The glyph's side, inside its 32px chip. */
const SIZE = 17;

/** What the glyph needs. */
export type PaletteGlyphProps = {
  readonly icon: PaletteIcon;

  /** The catalogue's icons the palette has read, by id. */
  readonly icons: ReadonlyMap<string, IconView>;
};

/**
 * Renders the glyph.
 *
 * @param props - See {@link PaletteGlyphProps}.
 * @returns The glyph.
 */
export function PaletteGlyph(props: PaletteGlyphProps) {
  const { icon, icons } = props;

  switch (icon.kind) {
    case 'ui':
      return <AppIcon id={icon.id} size={SIZE} />;
    case 'catalogue': {
      const found = icon.iconId === null ? undefined : icons.get(icon.iconId);

      return found === undefined ? (
        <AppIcon id={icon.fallback} size={SIZE} />
      ) : (
        <CatalogueIcon node={found.node} frame={found.frame} size={SIZE} />
      );
    }
    case 'vendor':
      return <VendorLogo vendor={icon.vendor} size={32} />;
    case 'package':
      return <PackageLogo found={icon.found} size={32} />;
  }
}
