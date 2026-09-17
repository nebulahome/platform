/**
 * One of the interface's own icons, by catalogue id.
 *
 * Bundled until the catalogue has been asked, the catalogue's once it has: the same id draws
 * the same thing in the sidebar as on a device row, and an owner who changes it in Settings
 * changes both. Sized for text by default - the height of a line of interface type.
 */
import { useIconOverride } from '../icons/icon-overrides.js';
import { BUILTIN_UI_FRAME, BUILTIN_UI_NODES, type UiIconId } from '../icons/ui-set.js';

import { CatalogueIcon, type CatalogueIconProps } from './catalogue-icon.js';

/** What an interface icon needs. */
export type AppIconProps = Omit<CatalogueIconProps, 'node' | 'frame'> & {
  /** Which icon, from the ids the interface uses. */
  readonly id: UiIconId;
};

/**
 * Draws one of the interface's own icons.
 *
 * @param props - See {@link AppIconProps}.
 * @returns The svg.
 */
export function AppIcon(props: AppIconProps) {
  const { id, ...rest } = props;
  const override = useIconOverride(id);

  return (
    <CatalogueIcon
      node={override?.node ?? BUILTIN_UI_NODES[id]}
      frame={override?.frame ?? BUILTIN_UI_FRAME}
      {...rest}
    />
  );
}
