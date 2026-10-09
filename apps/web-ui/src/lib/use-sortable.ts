/**
 * Reordering a list of blocks by dragging their grips, or with the arrow keys on a grip.
 *
 * Pointer events, as the dashboard's grid uses, and no library: the block follows the pointer up
 * and down, a line shows where it will land, and letting go moves it there. Only the blocks of
 * one list take part - a block does not leave its branch by being dragged. On the keyboard, the
 * grip is a button: Arrow Up and Arrow Down move its block one place.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from 'react';

/** A drag in progress. */
type Drag = {
  readonly from: number;
  readonly startY: number;
  readonly offsetY: number;
  readonly over: number;
};

/** What a sortable list gives the blocks in it. */
export type Sortable = {
  /**
   * What one item's wrapper takes: its place in the list, and its offset while it is dragged.
   *
   * @param index - Its place.
   * @returns Its attributes.
   */
  readonly itemProps: (index: number) => {
    readonly 'data-sort-item': number;
    readonly style: CSSProperties | undefined;
  };

  /**
   * What one item's grip takes.
   *
   * @param index - Its place.
   * @returns Its handlers.
   */
  readonly gripProps: (index: number) => {
    readonly onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
    readonly onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  };

  /**
   * Where the line goes: before or after an item, while a drag would move something there.
   *
   * @param index - An item's place.
   * @returns `before`, `after`, or null.
   */
  readonly dropSide: (index: number) => 'before' | 'after' | null;
};

/**
 * Works out where a dragged item would land.
 *
 * @param middles - The middle of each item, top to bottom.
 * @param from - The dragged item's place.
 * @param middle - Where the dragged item's middle now is.
 * @returns Its new place.
 */
export function landingIndex(middles: readonly number[], from: number, middle: number): number {
  let over = from;

  middles.forEach((itemMiddle, index) => {
    if (index < from && middle < itemMiddle && index < over) {
      over = index;
    }

    if (index > from && middle > itemMiddle) {
      over = index;
    }
  });

  return over;
}

/**
 * Makes a list of blocks reorderable.
 *
 * @param listRef - The element that holds the list's items.
 * @param count - How many items it has.
 * @param onMove - Moves the item at one place to another.
 * @returns What the list's items take.
 */
export function useSortable(
  listRef: RefObject<HTMLDivElement | null>,
  count: number,
  onMove: (from: number, to: number) => void,
): Sortable {
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const middles = useRef<number[]>([]);
  const moveRef = useRef(onMove);
  const isDragging = drag !== null;

  useEffect(() => {
    moveRef.current = onMove;
  }, [onMove]);

  useEffect(() => {
    if (!isDragging) {
      return undefined;
    }

    /**
     * Follows the pointer.
     *
     * @param event - The move.
     */
    const onPointerMove = (event: globalThis.PointerEvent): void => {
      const current = dragRef.current;

      if (current === null) {
        return;
      }

      const offsetY = event.clientY - current.startY;
      const ownMiddle = middles.current[current.from] ?? 0;
      const moved: Drag = {
        ...current,
        offsetY,
        over: landingIndex(middles.current, current.from, ownMiddle + offsetY),
      };

      dragRef.current = moved;
      setDrag(moved);
    };

    /** Lets go: moves the item where the line was. */
    const onPointerUp = (): void => {
      const current = dragRef.current;

      dragRef.current = null;
      setDrag(null);

      if (current !== null && current.over !== current.from) {
        moveRef.current(current.from, current.over);
      }
    };

    globalThis.addEventListener('pointermove', onPointerMove);
    globalThis.addEventListener('pointerup', onPointerUp);
    globalThis.addEventListener('pointercancel', onPointerUp);

    return () => {
      globalThis.removeEventListener('pointermove', onPointerMove);
      globalThis.removeEventListener('pointerup', onPointerUp);
      globalThis.removeEventListener('pointercancel', onPointerUp);
    };
  }, [isDragging]);

  const itemProps = useCallback(
    (index: number) => ({
      'data-sort-item': index,
      style:
        drag?.from === index
          ? ({
              transform: `translateY(${String(drag.offsetY)}px)`,
              position: 'relative',
              zIndex: 20,
            } satisfies CSSProperties)
          : undefined,
    }),
    [drag],
  );

  const gripProps = useCallback(
    (index: number) => ({
      /**
       * Starts a drag from the grip, measuring where every item's middle is.
       *
       * @param event - The press.
       */
      onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
        if (event.button !== 0 || count < 2) {
          return;
        }

        event.preventDefault();

        const items = listRef.current?.querySelectorAll<HTMLElement>(':scope > [data-sort-item]');

        middles.current = [...(items ?? [])].map((item) => {
          const box = item.getBoundingClientRect();

          return box.top + box.height / 2;
        });
        const started: Drag = { from: index, startY: event.clientY, offsetY: 0, over: index };

        dragRef.current = started;
        setDrag(started);
      },
      /**
       * Moves the item one place up or down from the keyboard.
       *
       * @param event - The key press.
       */
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
        if (event.key === 'ArrowUp' && index > 0) {
          event.preventDefault();
          onMove(index, index - 1);
        }

        if (event.key === 'ArrowDown' && index < count - 1) {
          event.preventDefault();
          onMove(index, index + 1);
        }
      },
    }),
    [count, listRef, onMove],
  );

  const dropSide = useCallback(
    (index: number): 'before' | 'after' | null => {
      if (drag === null || drag.over === drag.from || drag.over !== index) {
        return null;
      }

      return drag.over < drag.from ? 'before' : 'after';
    },
    [drag],
  );

  return { itemProps, gripProps, dropSide };
}

/**
 * Moves one item of a list to another place.
 *
 * @param items - The list.
 * @param from - Where the item is.
 * @param to - Where it goes.
 * @returns A new list.
 */
export function moveItem<TItem>(items: readonly TItem[], from: number, to: number): TItem[] {
  const result = [...items];
  const [item] = result.splice(from, 1);

  if (item === undefined) {
    return result;
  }

  result.splice(to, 0, item);

  return result;
}
