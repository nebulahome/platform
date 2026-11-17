/**
 * The command palette's list as it moves (docs: command palette, 12.5): the one highlight under
 * the rows, sliding to the active row or jumping there; the active row scrolled into view at once;
 * a height that follows the rows, so the panel grows and shrinks with them; and the fade at the
 * foot while there is more below.
 *
 * All of it is laid out by hand, on the elements, after React has drawn the rows: where a row
 * stands is only known then, and a value that changes on every key is no state to render again.
 */
import { useLayoutEffect, useRef, type RefObject } from 'react';

import { useElementSize } from '@/lib/use-element-size';

/** What the list hands its elements. */
export type PaletteHighlight = {
  /** The box that scrolls, and whose height follows the rows. */
  readonly scroller: RefObject<HTMLDivElement | null>;

  /** What the rows are measured in. */
  readonly content: RefObject<HTMLDivElement | null>;

  /** The highlight. */
  readonly highlight: RefObject<HTMLDivElement | null>;

  /** The rows' own box, whose height the scroller follows. */
  readonly measured: RefObject<HTMLDivElement | null>;

  /** Fades the foot of the list while there is more below; for its scroll and its transitions. */
  readonly fade: () => void;
};

/**
 * Lays out the highlight and the list's height.
 *
 * @param activeId - The id of the active row's element.
 * @param snapRef - Set when the next move should jump; read and cleared here.
 * @returns See {@link PaletteHighlight}.
 */
export function usePaletteHighlight(
  activeId: string,
  snapRef: RefObject<boolean>,
): PaletteHighlight {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const highlight = useRef<HTMLDivElement>(null);
  const { ref: measured, size } = useElementSize<HTMLDivElement>();

  /** Fades the foot of the list while there is more below it. */
  const fade = (): void => {
    const box = scroller.current;

    box?.toggleAttribute('data-overflow', box.scrollTop + box.clientHeight < box.scrollHeight - 1);
  };

  useLayoutEffect(() => {
    const box = scroller.current;

    if (box !== null && size.height > 0) {
      box.style.height = `${String(size.height)}px`;
      box.toggleAttribute('data-overflow', box.scrollTop + box.clientHeight < box.scrollHeight - 1);
    }
  }, [size.height]);

  // After every drawing: a row moves when a list arrives or a group opens, not only on a key.
  useLayoutEffect(() => {
    const mark = highlight.current;
    const row = globalThis.document.getElementById(activeId);

    if (mark === null) {
      return;
    }

    if (row === null || content.current?.contains(row) !== true) {
      mark.style.setProperty('--palette-h', '0px');

      return;
    }

    const isSnap = snapRef.current;

    snapRef.current = false;
    mark.toggleAttribute('data-snap', isSnap);
    mark.style.setProperty('--palette-y', `${String(row.offsetTop)}px`);
    mark.style.setProperty('--palette-h', `${String(row.offsetHeight)}px`);

    if (isSnap) {
      // Laid out at the new place before the slide is allowed again.
      mark.getBoundingClientRect();
      mark.removeAttribute('data-snap');
    }

    row.scrollIntoView({ block: 'nearest' });
  });

  return { scroller, content, highlight, measured, fade };
}
