/**
 * Which block of the automation editor is selected.
 *
 * One at a time, by the block's key, which follows it as lists change (`block-keys.ts`) - so a
 * selected block stays selected when it is dragged or when the blocks around it are edited, and a
 * removed one is simply never matched again. Escape clears it, unless a dialog is open and the
 * Escape is the dialog's; so does a click on the page outside every block.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/** What the editor's blocks share about the selection. */
type SelectionState = {
  readonly selected: string | null;
  readonly select: (key: string) => void;
  readonly clear: () => void;
};

/** Nothing selected, and nothing to select with: outside an editor. */
const NONE: SelectionState = {
  selected: null,
  /**
   * Selects nothing: there is no editor.
   *
   * @returns Nothing.
   */
  select: () => undefined,
  /**
   * Clears nothing: there is no editor.
   *
   * @returns Nothing.
   */
  clear: () => undefined,
};

const SelectionContext = createContext<SelectionState>(NONE);

/**
 * Holds the selection for the blocks inside it.
 *
 * @param props - What it wraps.
 * @param props.children - The editor.
 * @returns The provider.
 */
export function BlockSelectionProvider(props: { readonly children: ReactNode }) {
  const { children } = props;
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    /**
     * Clears the selection on Escape, when no dialog is there to take it.
     *
     * @param event - The key press.
     */
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && document.querySelector('dialog[open]') === null) {
        setSelected(null);
      }
    };

    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const value = useMemo<SelectionState>(
    () => ({
      selected,
      select: setSelected,
      /** Lets the selected block go. */
      clear: () => {
        setSelected(null);
      },
    }),
    [selected],
  );

  return <SelectionContext value={value}>{children}</SelectionContext>;
}

/**
 * Whether one block is selected, and how to select it.
 *
 * @param key - The block's key.
 * @returns Its selection.
 */
export function useBlockSelection(key: string): {
  readonly isSelected: boolean;
  readonly select: () => void;
} {
  const { selected, select } = useContext(SelectionContext);

  return useMemo(
    () => ({
      isSelected: selected === key,
      /** Selects this block. */
      select: () => {
        select(key);
      },
    }),
    [key, select, selected],
  );
}

/**
 * Clears the selection, for a click outside every block.
 *
 * @returns The function that clears it.
 */
export function useClearBlockSelection(): () => void {
  return useContext(SelectionContext).clear;
}
