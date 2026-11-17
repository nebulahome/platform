/**
 * Whether the command palette is open (docs: command palette, 5.2). The shortcut and the sidebar's
 * Search row both open it through here; the palette itself is mounted once, by the shell.
 */
import { create } from 'zustand';

/** The palette's state, and what changes it. */
type PaletteState = {
  /** Whether it is open. */
  readonly isOpen: boolean;

  /** Opens it. */
  readonly open: () => void;

  /** Closes it. */
  readonly close: () => void;

  /** Opens it when shut, shuts it when open. */
  readonly toggle: () => void;
};

export const usePaletteStore = create<PaletteState>((set) => ({
  isOpen: false,

  /** Opens it. */
  open: () => {
    set({ isOpen: true });
  },
  /** Closes it. */
  close: () => {
    set({ isOpen: false });
  },
  /** Opens it when shut, shuts it when open. */
  toggle: () => {
    set((state) => ({ isOpen: !state.isOpen }));
  },
}));
