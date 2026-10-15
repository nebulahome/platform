/**
 * Moving blocks in the automation editor: dragged by their grip anywhere a block of their family
 * can go - into an If's else, out of a loop, into an OR group - or stepped with the arrow keys.
 *
 * **One controller for the whole editor**, rather than one per list, because a drag that may end
 * in any list has to see all of them. Every list marks itself with its path and its family
 * (`data-block-list`, `data-family`) and every block with its id; under the pointer the nearest
 * list of the dragged block's family that is not inside the block itself is where it would land,
 * before the first block whose middle is below the pointer. A line shows the place, an empty list
 * offers a zone, the block itself fades, its header follows the pointer, the page scrolls near its
 * edges and a closed block held over for a moment opens. Letting go moves it; Escape does not.
 *
 * **On the keyboard** the grip's Up and Down move the block one place in reading order, walking
 * into and out of the lists other blocks hold, as an outliner does; the blocks it lands in open,
 * the grip keeps the focus and the move is said aloud.
 *
 * What a move does to the draft is `block-path.ts`'s; this decides only where.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import { AppIcon, BlockDragGhost, type BlockLane, type UiIconId } from '@nebulahome/ui';

import { useBlockUiStoreHandle } from '@/lib/block-ui';
import { describePath } from '@/library/automation-draft';
import { isInside, type BlockFamily, type BlockSlot } from '@/library/block-path';

/** How a dragged block looks under the pointer. */
export type DragLook = {
  readonly lane: BlockLane;
  readonly glyph: UiIconId;
  readonly kind: string;
  readonly summary: string;
};

/** The block being moved. */
export type DragSource = {
  readonly id: string;
  readonly slot: BlockSlot;
  readonly family: BlockFamily;
  readonly look: DragLook;
};

/** A drag going on. */
type DragState = {
  readonly source: DragSource;
  readonly x: number;
  readonly y: number;
  readonly drop: BlockSlot | null;
};

/** What the editor's lists share about moving. */
type DragContextValue = {
  /** The drag going on, if any. */
  readonly drag: DragState | null;

  /** Starts watching a grip pressed: past a few pixels, it is a drag. */
  readonly startPointer: (event: ReactPointerEvent<HTMLElement>, source: DragSource) => void;

  /** Moves a block with the arrow keys on its grip. */
  readonly onGripKey: (event: KeyboardEvent<HTMLElement>, source: DragSource) => void;
};

/** Outside an editor, nothing moves. */
const NONE: DragContextValue = {
  drag: null,
  /**
   * Moves nothing.
   *
   * @returns Nothing.
   */
  startPointer: () => undefined,
  /**
   * Moves nothing.
   *
   * @returns Nothing.
   */
  onGripKey: () => undefined,
};

const DragContext = createContext<DragContextValue>(NONE);

/** How far the pointer goes before a press is a drag. */
const DRAG_THRESHOLD_PX = 4;

/** How close to an edge of the scrolling area the page starts to scroll. */
const SCROLL_EDGE_PX = 56;

/** How far the page scrolls each frame there. */
const SCROLL_STEP_PX = 14;

/** How long a closed block is held over before it opens. */
const OPEN_ON_HOVER_MS = 700;

/**
 * The nearest ancestor that scrolls, for the edges a drag scrolls at.
 *
 * @param element - Where to start.
 * @returns The scrolling element, or the document's.
 */
function scrollParentOf(element: Element | null): Element {
  let node = element?.parentElement ?? null;

  while (node !== null) {
    const overflow = getComputedStyle(node).overflowY;

    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }

    node = node.parentElement;
  }

  return document.scrollingElement ?? document.documentElement;
}

/**
 * Where in a list a block let go at a height would land.
 *
 * @param list - The list's element.
 * @param y - The pointer's height.
 * @returns The place: before the first block whose middle is below it, or the end.
 */
function landingIndex(list: Element, y: number): number {
  const items = [...list.querySelectorAll(':scope > [data-sort-item]')];
  const index = items.findIndex((item) => {
    const rect = item.getBoundingClientRect();

    return rect.top + rect.height / 2 > y;
  });

  return index === -1 ? items.length : index;
}

/**
 * Where a dragged block would land with the pointer here.
 *
 * @param x - The pointer.
 * @param y - The pointer.
 * @param source - The block.
 * @returns The place, or null where nothing of its family can go.
 */
function dropAt(x: number, y: number, source: DragSource): BlockSlot | null {
  const blockPath = `${source.slot.list}.${String(source.slot.index)}`;

  for (const element of document.elementsFromPoint(x, y)) {
    let list = element.closest<HTMLElement>('[data-block-list]');

    while (list !== null) {
      const path = list.dataset['blockList'];

      if (
        path !== undefined &&
        list.dataset['family'] === source.family &&
        !isInside(path, blockPath)
      ) {
        return { list: path, index: landingIndex(list, y) };
      }

      list = list.parentElement?.closest<HTMLElement>('[data-block-list]') ?? null;
    }
  }

  return null;
}

/** What the controller needs from the editor. */
export type BlockDragProviderProps = {
  /** Moves a block; the editor rewrites the draft. */
  readonly onMove: (from: BlockSlot, to: BlockSlot) => void;

  /**
   * Moves a block one place in reading order; the editor rewrites the draft.
   *
   * @returns Where the block now is, or null when it cannot go further.
   */
  readonly onStep: (from: BlockSlot, step: -1 | 1) => BlockSlot | null;

  readonly children: ReactNode;
};

/**
 * Lets the blocks inside it be moved.
 *
 * @param props - See {@link BlockDragProviderProps}.
 * @returns The provider, the dragged block's ghost and the live region.
 */
export function BlockDragProvider(props: BlockDragProviderProps) {
  const { onMove, onStep, children } = props;
  const store = useBlockUiStoreHandle();
  const [drag, setDrag] = useState<DragState | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const latest = useRef<{ readonly onMove: typeof onMove; readonly onStep: typeof onStep }>({
    onMove,
    onStep,
  });

  useEffect(() => {
    latest.current = { onMove, onStep };
  }, [onMove, onStep]);

  const startPointer = useCallback(
    (event: ReactPointerEvent<HTMLElement>, source: DragSource): void => {
      if (event.button !== 0) {
        return;
      }

      const grip = event.currentTarget;
      const { pointerId, clientX: startX, clientY: startY } = event;
      const scroller = scrollParentOf(grip);
      let isDragging = false;
      let drop: BlockSlot | null = null;
      let pointerY = startY;
      let hovered: string | null = null;
      let hoverTimer: number | undefined;

      /** Scrolls the page while the pointer rests near one of its edges. */
      const scrollTimer = window.setInterval(() => {
        if (!isDragging) {
          return;
        }

        const area =
          scroller === document.scrollingElement
            ? { top: 0, bottom: window.innerHeight }
            : scroller.getBoundingClientRect();

        if (pointerY < area.top + SCROLL_EDGE_PX) {
          scroller.scrollBy(0, -SCROLL_STEP_PX);
        } else if (pointerY > area.bottom - SCROLL_EDGE_PX) {
          scroller.scrollBy(0, SCROLL_STEP_PX);
        }
      }, 16);

      /**
       * Opens a closed block the pointer has rested over for a moment.
       *
       * @param x - The pointer.
       * @param y - The pointer.
       */
      const watchHover = (x: number, y: number): void => {
        const closed = document
          .elementsFromPoint(x, y)
          .map((element) => element.closest<HTMLElement>('[data-block-closed]'))
          .find((element) => element !== null);
        const id = closed?.dataset['blockClosed'] ?? null;

        if (id === hovered) {
          return;
        }

        hovered = id;
        window.clearTimeout(hoverTimer);

        if (id !== null && id !== source.id) {
          hoverTimer = window.setTimeout(() => {
            store.setOpen(id, true);
          }, OPEN_ON_HOVER_MS);
        }
      };

      /**
       * Follows the pointer.
       *
       * @param moved - The pointer event.
       */
      const onPointerMove = (moved: PointerEvent): void => {
        pointerY = moved.clientY;

        if (!isDragging) {
          if (Math.hypot(moved.clientX - startX, moved.clientY - startY) < DRAG_THRESHOLD_PX) {
            return;
          }

          isDragging = true;
          grip.setPointerCapture(pointerId);
          document.body.classList.add('select-none');
        }

        drop = dropAt(moved.clientX, moved.clientY, source);
        watchHover(moved.clientX, moved.clientY);
        setDrag({ source, x: moved.clientX, y: moved.clientY, drop });
      };

      /**
       * Ends the drag, moving the block or not.
       *
       * @param isCommitted - Whether to move it to where it would land.
       */
      const finish = (isCommitted: boolean): void => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('keydown', onKeyDown, true);
        window.clearInterval(scrollTimer);
        window.clearTimeout(hoverTimer);
        document.body.classList.remove('select-none');

        if (grip.hasPointerCapture(pointerId)) {
          grip.releasePointerCapture(pointerId);
        }

        if (isDragging && isCommitted && drop !== null) {
          latest.current.onMove(source.slot, drop);
        }

        setDrag(null);
      };

      /** Lets go. */
      const onPointerUp = (): void => {
        finish(true);
      };

      /**
       * Escape: the block goes back where it was.
       *
       * @param pressed - The key.
       */
      const onKeyDown = (pressed: globalThis.KeyboardEvent): void => {
        if (pressed.key === 'Escape') {
          pressed.preventDefault();
          pressed.stopPropagation();
          finish(false);
        }
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('keydown', onKeyDown, true);
    },
    [store],
  );

  const onGripKey = useCallback((event: KeyboardEvent<HTMLElement>, source: DragSource): void => {
    if (
      (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return;
    }

    event.preventDefault();

    const at = latest.current.onStep(source.slot, event.key === 'ArrowUp' ? -1 : 1);

    if (at === null) {
      setAnnouncement(`${source.look.kind} cannot move further`);

      return;
    }

    setAnnouncement(
      `${source.look.kind} moved to ${describePath(at.list.split('.'))}, place ${String(at.index + 1)}`,
    );

    // The grip is drawn again where the block landed: give it the focus back there.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`[data-grip="${source.id}"]`)?.focus();
      });
    });
  }, []);

  const value = useMemo<DragContextValue>(
    () => ({ drag, startPointer, onGripKey }),
    [drag, onGripKey, startPointer],
  );

  return (
    <DragContext value={value}>
      {children}
      {drag === null
        ? null
        : createPortal(
            <BlockDragGhost
              lane={drag.source.look.lane}
              glyph={<AppIcon id={drag.source.look.glyph} size={15} />}
              kind={drag.source.look.kind}
              summary={drag.source.look.summary}
              x={drag.x}
              y={drag.y}
            />,
            document.body,
          )}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </DragContext>
  );
}

/**
 * The drag going on in the editor, and how to start one.
 *
 * @returns See {@link DragContextValue}.
 */
export function useBlockDrag(): DragContextValue {
  return useContext(DragContext);
}
