/**
 * The command palette's place in the signed-in app (docs: command palette): mounted once, by the
 * shell, and drawn only while open - its lists are read only then, so nobody who never opens it
 * pays for it. Closing unmounts it, and the dialog fades out as it goes (`modal.tsx`).
 */
import { PalettePanel } from '@/palette/palette-panel';
import { usePaletteStore } from '@/palette/palette-store';

/**
 * Renders the palette while it is open.
 *
 * @returns The palette, or nothing.
 */
export function CommandPalette() {
  const isOpen = usePaletteStore((state) => state.isOpen);

  return isOpen ? <PalettePanel /> : null;
}
