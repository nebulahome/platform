/**
 * Ctrl+K, and Cmd+K on a Mac, opens the command palette from anywhere in the signed-in app, and
 * closes it again. Mounted once, by the shell.
 *
 * It opens over the page, and over the entity dialog (`?entity=`): "I am looking at one light,
 * take me to another" is what the palette is for. It does not open over any other dialog, where a
 * half-filled form would be lost; nor inside a code editor, which owns its keys; nor while the
 * platform is restarting or updating. The browser's own Ctrl+K (its search) is held back every
 * time all the same.
 */
import { useEffect } from 'react';

import { usePaletteStore } from '@/palette/palette-store';
import { ENTITY_PARAM } from '@/routes/library/entity/entity-path';

/** A dialog that is really open: not the copy of a closed one fading out (`modal.tsx`). */
const OPEN_DIALOG = 'dialog[open]:not(.modal-ghost)';

/** The restarting and updating screens (`platform-overlay.tsx`, `maintenance-overlay.tsx`). */
const PLATFORM_OVERLAY = '[role="alertdialog"][aria-modal="true"]';

/**
 * The shortcut as this platform writes it.
 *
 * @returns `⌘K` on a Mac, `Ctrl K` everywhere else and when the browser does not say.
 */
export function paletteShortcutLabel(): string {
  const { navigator } = globalThis;
  const platform =
    (navigator as Navigator & { readonly userAgentData?: { readonly platform: string } })
      .userAgentData?.platform ??
    // The only answer Firefox and Safari give.
    navigator.platform;

  return /mac|iphone|ipad/iu.test(platform) ? '⌘K' : 'Ctrl K';
}

/**
 * Whether a key press is the palette's shortcut.
 *
 * @param event - The key press.
 * @returns True for Ctrl+K or Cmd+K, with no other modifier.
 */
export function isPaletteShortcut(event: KeyboardEvent): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === 'k'
  );
}

/**
 * Whether the palette may open now.
 *
 * @param target - Where the key was pressed.
 * @param document - The page.
 * @param search - The address's query string.
 * @returns True when nothing in the way: no dialog but the entity's, no code editor, no overlay.
 */
export function canOpenPalette(
  target: EventTarget | null,
  document: Document,
  search: string,
): boolean {
  if (
    target instanceof Element &&
    (target.closest('.cm-editor') !== null ||
      (target instanceof HTMLElement && target.isContentEditable))
  ) {
    return false;
  }

  if (document.querySelector(PLATFORM_OVERLAY) !== null) {
    return false;
  }

  const dialogs = document.querySelectorAll(OPEN_DIALOG).length;

  return dialogs === 0 || (dialogs === 1 && new URLSearchParams(search).has(ENTITY_PARAM));
}

/**
 * Listens for the shortcut while mounted.
 */
export function usePaletteShortcut(): void {
  useEffect(() => {
    /**
     * Opens or closes the palette on Ctrl+K.
     *
     * @param event - The key press.
     */
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isPaletteShortcut(event)) {
        return;
      }

      event.preventDefault();

      if (event.repeat) {
        return;
      }

      const { isOpen, open, close } = usePaletteStore.getState();

      if (isOpen) {
        close();
      } else if (canOpenPalette(event.target, globalThis.document, globalThis.location.search)) {
        open();
      }
    };

    globalThis.document.addEventListener('keydown', onKeyDown);

    return () => {
      globalThis.document.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}
