/**
 * Where a list that hangs off a control should sit, and where it should be mounted.
 *
 * Shared by the dropdown and the tag field, which both open a list under a control they own.
 * The list is `position: fixed`, measured against the control and rendered through a portal,
 * so no ancestor has to make room for it; it opens upward when there is no room below; and it
 * is re-measured while open, because these sit in panels that scroll.
 *
 * The portal goes into the enclosing `<dialog>` when there is one, and only otherwise into the
 * body: a modal dialog makes the rest of the document inert, and a list portalled to the body
 * while one is open would render in the right place and refuse every click.
 */
import { useCallback, useEffect, useState, type RefObject } from 'react';

/** The gap between the control and the list. */
const GAP = 4;

/** The tallest the list is allowed to get before it scrolls on its own. */
const MAX_LIST_HEIGHT = 240;

/** How little room below the control still counts as room, rather than opening upward. */
const ROOM_NEEDED = 140;

/** Where the list sits, in viewport coordinates. */
export type Placement = {
  /** The left edge, matching the control's. */
  readonly left: number;

  /** The width, matching the control's. */
  readonly width: number;

  /** How tall it may grow before it scrolls. */
  readonly maxHeight: number;

  /** Distance from the top of the viewport, when the list hangs below the control. */
  readonly top?: number;

  /** Distance from the bottom of the viewport, when it opens upward instead. */
  readonly bottom?: number;
};

/**
 * Works out where a list should sit, given where its control is.
 *
 * @param element - The control the list belongs to.
 * @returns The placement, in viewport coordinates.
 */
export function placeUnder(element: HTMLElement): Placement {
  const rect = element.getBoundingClientRect();
  const below = globalThis.innerHeight - rect.bottom - GAP;
  const above = rect.top - GAP;
  const opensUpward = below < ROOM_NEEDED && above > below;

  const room = opensUpward ? above : below;

  return {
    left: rect.left,
    width: rect.width,
    maxHeight: Math.max(0, Math.min(MAX_LIST_HEIGHT, room)),
    ...(opensUpward
      ? { bottom: globalThis.innerHeight - rect.top + GAP }
      : { top: rect.bottom + GAP }),
  };
}

/**
 * Where a list should be mounted: the dialog the control is in, or the body.
 *
 * @param element - The control the list belongs to.
 * @returns The element to portal into.
 */
export function hostFor(element: HTMLElement): HTMLElement {
  return element.closest('dialog') ?? globalThis.document.body;
}

/** A list's placement, and the two things that change it. */
export type AnchoredList = {
  /** Where the list sits, or null while it is shut. */
  readonly placement: Placement | null;

  /** Measures against the control and opens. */
  readonly open: () => void;

  /** Shuts. */
  readonly close: () => void;
};

/**
 * Keeps a list placed against its control for as long as it is open.
 *
 * Open means placed: the placement is the open state, as it is in the dropdown, so the two can
 * never disagree. Opening measures once; scrolling or resizing anything measures again.
 *
 * @param anchor - The control the list hangs off.
 * @returns The placement, and how to open and shut the list.
 */
export function useAnchoredPlacement(anchor: RefObject<HTMLElement | null>): AnchoredList {
  const [placement, setPlacement] = useState<Placement | null>(null);
  const isOpen = placement !== null;

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    /** Measures the list against the control again. */
    const follow = (): void => {
      const element = anchor.current;

      if (element !== null) {
        setPlacement(placeUnder(element));
      }
    };

    // `capture` so a scroll in any ancestor is heard, not only one on the window: these sit in
    // a panel that scrolls, and that scroll event never reaches the window in the bubble phase.
    globalThis.addEventListener('scroll', follow, true);
    globalThis.addEventListener('resize', follow);

    return () => {
      globalThis.removeEventListener('scroll', follow, true);
      globalThis.removeEventListener('resize', follow);
    };
  }, [anchor, isOpen]);

  const open = useCallback((): void => {
    const element = anchor.current;

    if (element !== null) {
      setPlacement(placeUnder(element));
    }
  }, [anchor]);

  const close = useCallback((): void => {
    setPlacement(null);
  }, []);

  return { placement, open, close };
}
