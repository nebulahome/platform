import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { usePaletteStore } from '@/palette/palette-store';
import { canOpenPalette, usePaletteShortcut } from '@/palette/use-palette-shortcut';

/**
 * Presses a key on an element, as the browser would.
 *
 * @param target - Where.
 * @param init - The key and its modifiers.
 * @returns The event, to read `defaultPrevented` from.
 */
function press(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });

  target.dispatchEvent(event);

  return event;
}

/**
 * Puts an open dialog in the page.
 *
 * @returns The dialog.
 */
function openDialog(): HTMLDialogElement {
  const dialog = document.createElement('dialog');

  dialog.setAttribute('open', '');
  document.body.append(dialog);

  return dialog;
}

describe('canOpenPalette', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('allows the page with no dialog open', () => {
    expect(canOpenPalette(document.body, document, '')).toBe(true);
  });

  it('refuses over a form dialog', () => {
    openDialog();

    expect(canOpenPalette(document.body, document, '')).toBe(false);
  });

  it('allows the entity dialog, and only it', () => {
    openDialog();

    expect(canOpenPalette(document.body, document, '?entity=light.hall')).toBe(true);

    openDialog();

    expect(canOpenPalette(document.body, document, '?entity=light.hall')).toBe(false);
  });

  it('ignores the copy of a dialog fading out', () => {
    openDialog().classList.add('modal-ghost');

    expect(canOpenPalette(document.body, document, '')).toBe(true);
  });

  it('refuses inside a code editor', () => {
    const editor = document.createElement('div');
    const line = document.createElement('span');

    editor.className = 'cm-editor';
    editor.append(line);
    document.body.append(editor);

    expect(canOpenPalette(line, document, '')).toBe(false);
  });

  it('refuses while the platform overlay is up', () => {
    const overlay = document.createElement('div');

    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-modal', 'true');
    document.body.append(overlay);

    expect(canOpenPalette(document.body, document, '')).toBe(false);
  });
});

describe('usePaletteShortcut', () => {
  beforeEach(() => {
    usePaletteStore.setState({ isOpen: false });
    renderHook(() => {
      usePaletteShortcut();
    });
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('opens on Ctrl+K and on Cmd+K, and closes on a second press', () => {
    const first = press(document.body, { key: 'k', ctrlKey: true });

    expect(usePaletteStore.getState().isOpen).toBe(true);
    expect(first.defaultPrevented).toBe(true);

    press(document.body, { key: 'K', metaKey: true });

    expect(usePaletteStore.getState().isOpen).toBe(false);
  });

  it('opens from inside a text field', () => {
    const field = document.createElement('input');

    document.body.append(field);
    press(field, { key: 'k', ctrlKey: true });

    expect(usePaletteStore.getState().isOpen).toBe(true);
  });

  it('ignores a held key, but still keeps the browser from acting on it', () => {
    const held = press(document.body, { key: 'k', ctrlKey: true, repeat: true });

    expect(usePaletteStore.getState().isOpen).toBe(false);
    expect(held.defaultPrevented).toBe(true);
  });

  it('keeps the browser from acting on the key over a form dialog, and stays shut', () => {
    openDialog();

    const event = press(document.body, { key: 'k', ctrlKey: true });

    expect(usePaletteStore.getState().isOpen).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves Ctrl+Shift+K and plain K alone', () => {
    const shifted = press(document.body, { key: 'K', ctrlKey: true, shiftKey: true });

    press(document.body, { key: 'k' });

    expect(usePaletteStore.getState().isOpen).toBe(false);
    expect(shifted.defaultPrevented).toBe(false);
  });
});
