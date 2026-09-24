/**
 * The dashboard's grid: where every card is drawn, and - while the layout is being edited - how
 * cards are moved, resized and picked up from the keyboard.
 *
 * Cards are placed absolutely, at the pixels their cells work out to, so that when one moves the
 * others slide to their new places rather than jumping; a person who asked for less motion gets the
 * jump. A container draws its own cards on a grid inside it, under its heading.
 *
 * **Moving.** The grip on a card's top edge lifts it: the card follows the pointer, a dashed slot
 * shows where it would land, and the rest of the page makes room as it goes. Every preview is
 * worked out from the layout as it was when the card was lifted, so passing over a card and coming
 * back leaves it where it was. Over a container, the card goes into the container, at the nearest
 * size it is drawn for that fits there; a container never goes into another one.
 *
 * **Resizing.** The corner is dragged freely, and the card settles on the nearest size it is drawn
 * for. A container takes only a width; its height follows what it holds.
 *
 * **From the keyboard.** The grip is a button. Space or Enter lifts the card, the arrow keys move
 * it a cell at a time, Shift and an arrow key make it the next size up or down, and Enter or Space
 * puts it down; Escape puts it back where it was. Each step is said aloud.
 */
import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

import {
  DASHBOARD_COLUMNS,
  type DashboardCard,
  type DashboardContainerCard,
  type DashboardLayout,
} from '@nebula-home/contracts';
import { AppIcon, cn } from '@nebula-home/ui';

import { sizeName, snapSize, stepSize } from '@/dashboard/card-sizes';
import {
  findCard,
  narrowLayout,
  placeCard,
  resizeCard,
  type CardPlace,
} from '@/dashboard/dashboard-layout';
import {
  boxOf,
  columnWidth,
  CONTAINER_HEADING_PX,
  dropPlace,
  CONTAINER_PADDING_PX,
  GAP_PX,
  NARROW_WIDTH_PX,
  rowsHeight,
  spanOf,
  type Box,
} from '@/dashboard/geometry';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { CardView, cardTitle } from '@/routes/dashboard/card-view';
import type { DashboardData } from '@/routes/dashboard/use-dashboard-data';
import { DeviceIcon } from '@/routes/library/device-icon';

/** What the grid is told while the layout is being edited. */
export type GridEditor = {
  /** The card open in the inspector. */
  readonly selectedId: string | null;

  /** Opens a card in the inspector. */
  readonly onSelect: (cardId: string) => void;

  /** Takes a moved or resized layout. */
  readonly onChange: (layout: DashboardLayout) => void;

  /** Takes a card off. */
  readonly onRemove: (cardId: string) => void;
};

/** What the grid needs. */
export type DashboardGridProps = {
  /** The layout to draw. */
  readonly layout: DashboardLayout;

  /** What the page read for its cards. */
  readonly data: DashboardData;

  /** The editor, while the layout is being edited; null to only show it. */
  readonly editor: GridEditor | null;

  /** Told whether the window is too narrow to edit in. */
  readonly onNarrowChange?: (isNarrow: boolean) => void;
};

/** A card in the air, and where it would land. */
type Gesture =
  | {
      readonly kind: 'move';
      readonly id: string;
      readonly start: DashboardLayout;
      readonly preview: DashboardLayout;

      /** Where the pointer is, in the window. */
      readonly pointer: { readonly x: number; readonly y: number };

      /** Where on the card it was picked up, from the card's top-left corner. */
      readonly offset: { readonly x: number; readonly y: number };

      /** How large the card was when it was picked up. */
      readonly size: { readonly width: number; readonly height: number };
    }
  | {
      readonly kind: 'resize';
      readonly id: string;
      readonly start: DashboardLayout;
      readonly preview: DashboardLayout;
    }
  | {
      readonly kind: 'keyboard';
      readonly id: string;
      readonly start: DashboardLayout;
      readonly preview: DashboardLayout;
    };

/** How far the pointer must travel before a press on the grip becomes a drag. */
const DRAG_THRESHOLD_PX = 4;

/** How close to the top or bottom of the scrolling page a dragged card scrolls it. */
const SCROLL_EDGE_PX = 64;

/**
 * The lowest row any card on a grid reaches.
 *
 * @param cards - The grid's cards.
 * @returns The first free row under all of them.
 */
function bottomOf(cards: readonly Pick<DashboardCard, 'y' | 'h'>[]): number {
  return Math.max(0, ...cards.map((card) => card.y + card.h));
}

/**
 * The element the page scrolls in.
 *
 * @param element - Somewhere inside it.
 * @returns The nearest ancestor that scrolls, if any.
 */
function scrollerOf(element: HTMLElement): HTMLElement | null {
  let current = element.parentElement;

  while (current !== null) {
    const overflow = getComputedStyle(current).overflowY;

    if (overflow === 'auto' || overflow === 'scroll') {
      return current;
    }

    current = current.parentElement;
  }

  return null;
}

/**
 * Says where a card is, for a screen reader.
 *
 * @param layout - The layout.
 * @param id - The card.
 * @param data - What the page read, for the names.
 * @returns "Kitchen light: column 2, row 3, Card".
 */
function whereIs(layout: DashboardLayout, id: string, data: DashboardData): string {
  const found = findCard(layout, id);

  if (found === null) {
    return '';
  }

  const { card, parentId } = found;
  const parent = parentId === null ? null : findCard(layout, parentId)?.card;
  const inside = parent === undefined || parent === null ? '' : ` in ${cardTitle(parent, data)}`;

  return `${cardTitle(card, data)}${inside}: column ${String(card.x + 1)}, row ${String(card.y + 1)}, ${sizeName(card)}`;
}

/**
 * Renders the grid.
 *
 * @param props - See {@link DashboardGridProps}.
 * @returns The grid.
 */
export function DashboardGrid(props: DashboardGridProps) {
  const { layout, data, editor, onNarrowChange } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const isReduced = useReducedMotion();
  const isNarrow = width > 0 && width < NARROW_WIDTH_PX;
  const narrowReported = useRef<boolean | null>(null);

  // The grid's width is the browser's to decide; the columns are measured from it.
  useLayoutEffect(() => {
    const element = rootRef.current;

    if (element === null) {
      return undefined;
    }

    setWidth(element.getBoundingClientRect().width);

    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];

      if (entry !== undefined) {
        setWidth(entry.contentRect.width);
      }
    });

    observer.observe(element);

    return (): void => {
      observer.disconnect();
    };
  }, []);

  useLayoutEffect(() => {
    if (width > 0 && narrowReported.current !== isNarrow) {
      narrowReported.current = isNarrow;
      onNarrowChange?.(isNarrow);
    }
  }, [isNarrow, onNarrowChange, width]);

  const columns = isNarrow && editor === null ? 2 : DASHBOARD_COLUMNS;
  const base = gesture?.preview ?? layout;
  const shown = columns < DASHBOARD_COLUMNS ? narrowLayout(base, columns, data.sizesOf) : base;
  const column = columnWidth(width, columns);
  const movingId = gesture?.kind === 'move' ? gesture.id : null;

  /**
   * Works out where a lifted card would land with the pointer at a point.
   *
   * @param current - The gesture so far.
   * @param x - The pointer, across the window.
   * @param y - The pointer, down the window.
   * @returns The gesture with its new preview.
   */
  const previewAt = (
    current: Extract<Gesture, { kind: 'move' }>,
    x: number,
    y: number,
  ): Gesture => {
    const root = rootRef.current;
    const carried = findCard(current.start, current.id)?.card;

    if (root === null || carried === undefined) {
      return { ...current, pointer: { x, y } };
    }

    const rect = root.getBoundingClientRect();
    const place: CardPlace = dropPlace(
      current.start.cards.map((card) => ({ ...card, isContainer: card.type === 'container' })),
      { id: current.id, isContainer: carried.type === 'container' },
      { x: x - rect.left, y: y - rect.top },
      current.offset,
      rect.width,
      DASHBOARD_COLUMNS,
    );
    const preview = placeCard(current.start, current.id, place, data.sizesOf);

    // A drop that cannot be made - a camera into a container too narrow for it - keeps the last
    // preview that could, rather than snapping the card back to where it began.
    return {
      ...current,
      pointer: { x, y },
      preview: preview === current.start && place.parentId !== null ? current.preview : preview,
    };
  };

  /**
   * Lifts a card by its grip.
   *
   * @param event - The press.
   * @param card - The card.
   */
  const startMove = (event: ReactPointerEvent<HTMLElement>, card: DashboardCard): void => {
    if (editor === null || event.button !== 0) {
      return;
    }

    const element = event.currentTarget.closest<HTMLElement>('[data-card-id]');

    if (element === null) {
      return;
    }

    event.preventDefault();

    const rect = element.getBoundingClientRect();
    const origin = { x: event.clientX, y: event.clientY };
    const offset = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const size = { width: rect.width, height: rect.height };
    let lifted: Extract<Gesture, { kind: 'move' }> | null = null;
    const scroller = scrollerOf(event.currentTarget);

    /**
     * Follows the pointer.
     *
     * @param move - The pointer's move.
     */
    const onMove = (move: PointerEvent): void => {
      if (
        lifted === null &&
        Math.hypot(move.clientX - origin.x, move.clientY - origin.y) < DRAG_THRESHOLD_PX
      ) {
        return;
      }

      lifted ??= {
        kind: 'move',
        id: card.id,
        start: layout,
        preview: layout,
        pointer: origin,
        offset,
        size,
      };

      if (scroller !== null) {
        const bounds = scroller.getBoundingClientRect();

        if (move.clientY > bounds.bottom - SCROLL_EDGE_PX) {
          scroller.scrollBy({ top: 12 });
        } else if (move.clientY < bounds.top + SCROLL_EDGE_PX) {
          scroller.scrollBy({ top: -12 });
        }
      }

      const next = previewAt(lifted, move.clientX, move.clientY);

      if (next.kind === 'move') {
        lifted = next;
        setGesture(next);
      }
    };

    /** Puts the card down where it would land. */
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);

      if (lifted !== null && lifted.preview !== lifted.start) {
        editor.onChange(lifted.preview);
        setAnnouncement(`Moved. ${whereIs(lifted.preview, card.id, data)}`);
      }

      setGesture(null);
    };

    /** Puts the card back where it was. */
    const onCancel = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      setGesture(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  };

  /**
   * Starts resizing a card by its corner.
   *
   * @param event - The press.
   * @param card - The card.
   */
  const startResize = (event: ReactPointerEvent<HTMLElement>, card: DashboardCard): void => {
    if (editor === null || event.button !== 0) {
      return;
    }

    const element = event.currentTarget.closest<HTMLElement>('[data-card-id]');
    const grid = element?.parentElement?.closest<HTMLElement>('[data-columns]');

    if (element === null || grid === null || grid === undefined) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const rect = element.getBoundingClientRect();
    const gridColumns = Number(grid.dataset['columns'] ?? DASHBOARD_COLUMNS);
    const gridColumn = columnWidth(grid.getBoundingClientRect().width, gridColumns);
    const origin = { x: event.clientX, y: event.clientY };
    let current: Extract<Gesture, { kind: 'resize' }> = {
      kind: 'resize',
      id: card.id,
      start: layout,
      preview: layout,
    };

    /**
     * Follows the corner.
     *
     * @param move - The pointer's move.
     */
    const onMove = (move: PointerEvent): void => {
      const span = spanOf(
        rect.width + move.clientX - origin.x,
        rect.height + move.clientY - origin.y,
        gridColumn,
      );
      const size =
        card.type === 'container'
          ? { w: Math.min(gridColumns, span.w), h: card.h }
          : snapSize(data.sizesOf(card), span.w, span.h, gridColumns);
      const preview = resizeCard(current.start, card.id, size, data.sizesOf);

      if (preview !== current.preview) {
        current = { ...current, preview };
        setGesture(current);
      }
    };

    /** Keeps the size the corner settled on. */
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);

      if (current.preview !== current.start) {
        editor.onChange(current.preview);
        setAnnouncement(`Resized. ${whereIs(current.preview, card.id, data)}`);
      }

      setGesture(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  /**
   * Moves and resizes a card from the keyboard, once it has been lifted.
   *
   * @param event - The key.
   * @param card - The card whose grip has the focus.
   */
  const onGripKey = (event: KeyboardEvent<HTMLButtonElement>, card: DashboardCard): void => {
    if (editor === null) {
      return;
    }

    const lifted = gesture?.kind === 'keyboard' && gesture.id === card.id ? gesture : null;

    if (lifted === null) {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        setGesture({ kind: 'keyboard', id: card.id, start: layout, preview: layout });
        setAnnouncement(
          `Picked up ${cardTitle(card, data)}. Arrow keys move it, Shift and an arrow key change its size, Enter puts it down, Escape puts it back.`,
        );
      }

      return;
    }

    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      editor.onChange(lifted.preview);
      setGesture(null);
      setAnnouncement(`Put down. ${whereIs(lifted.preview, card.id, data)}`);

      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setGesture(null);
      setAnnouncement(`Put back. ${whereIs(lifted.start, card.id, data)}`);

      return;
    }

    const steps: Readonly<Record<string, readonly [number, number]>> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const step = steps[event.key];
    const found = findCard(lifted.preview, card.id);

    if (step === undefined || found === null) {
      return;
    }

    event.preventDefault();

    const now = found.card;
    let preview: DashboardLayout;

    if (event.shiftKey) {
      const direction = step[0] + step[1] > 0 ? 1 : -1;
      const parent =
        found.parentId === null ? null : findCard(lifted.preview, found.parentId)?.card;
      const gridColumns = parent === null || parent === undefined ? DASHBOARD_COLUMNS : parent.w;
      const size =
        now.type === 'container'
          ? { w: Math.min(DASHBOARD_COLUMNS, Math.max(1, now.w + direction)), h: now.h }
          : stepSize(data.sizesOf(now), now, direction, gridColumns);

      preview = resizeCard(lifted.preview, card.id, size, data.sizesOf);
    } else {
      preview = placeCard(
        lifted.preview,
        card.id,
        {
          parentId: found.parentId,
          x: Math.max(0, now.x + step[0]),
          y: Math.max(0, now.y + step[1]),
        },
        data.sizesOf,
      );
    }

    setGesture({ ...lifted, preview });
    setAnnouncement(whereIs(preview, card.id, data));
  };

  /**
   * Draws one card where its cells put it, with the editing controls when editing.
   *
   * @param card - The card.
   * @param gridColumn - How wide one column of its grid is.
   * @returns The placed card.
   */
  const place = (card: DashboardCard, gridColumn: number): ReactNode => {
    const box: Box = boxOf(card, gridColumn);
    const style = {
      transform: `translate(${String(box.left)}px, ${String(box.top)}px)`,
      width: box.width,
      height: box.height,
    };

    if (card.id === movingId) {
      return (
        <div
          key={card.id}
          aria-hidden="true"
          className="absolute top-0 left-0 rounded-panel border-2 border-dashed border-primary/55 bg-primary/6"
          /* eslint-disable-next-line react/forbid-dom-props -- a slot sits where its cells work out to, in
          pixels measured from the window (RULES.md 15.3). */
          style={style}
        />
      );
    }

    const title = cardTitle(card, data);
    const isSelected = editor?.selectedId === card.id;
    const isLifted = gesture?.kind === 'keyboard' && gesture.id === card.id;

    return (
      <div
        key={card.id}
        data-card-id={card.id}
        className={cn(
          'absolute top-0 left-0',
          isReduced || gesture?.kind === 'resize'
            ? undefined
            : 'transition-[transform,width,height] duration-200 ease-out',
          isSelected || isLifted ? 'z-10' : undefined,
        )}
        /* eslint-disable-next-line react/forbid-dom-props -- a card sits where its cells work out to, in
        pixels measured from the window (RULES.md 15.3). */
        style={style}
      >
        {card.type === 'container' ? (
          <ContainerView
            container={card}
            data={data}
            isEditing={editor !== null}
            isSelected={isSelected}
            onSelect={() => editor?.onSelect(card.id)}
            place={place}
          />
        ) : (
          <div
            className={cn(
              'h-full rounded-panel',
              isSelected ? 'ring-2 ring-primary ring-offset-2 ring-offset-canvas' : undefined,
              isLifted ? 'shadow-dialog ring-2 ring-primary' : undefined,
            )}
            inert={editor !== null}
          >
            <CardView card={card} data={data} />
          </div>
        )}

        {editor === null ? null : (
          <>
            {card.type === 'container' ? null : (
              <button
                type="button"
                aria-label={`Edit ${title}`}
                className="absolute inset-0 cursor-pointer rounded-panel"
                onClick={() => {
                  editor.onSelect(card.id);
                }}
              />
            )}
            <button
              type="button"
              aria-label={`Move ${title}`}
              aria-pressed={isLifted}
              aria-describedby="dashboard-grid-help"
              className={cn(
                'absolute top-0 left-1/2 z-20 flex h-4.5 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none items-center rounded-full border border-border-strong face-raised px-2 text-foreground-subtle',
                'focus-visible:ring-2 focus-visible:ring-primary',
                isLifted ? 'cursor-grabbing text-primary' : undefined,
              )}
              onPointerDown={(event) => {
                startMove(event, card);
              }}
              onKeyDown={(event) => {
                onGripKey(event, card);
              }}
              onBlur={() => {
                if (gesture?.kind === 'keyboard' && gesture.id === card.id) {
                  editor.onChange(gesture.preview);
                  setGesture(null);
                }
              }}
            >
              <AppIcon id="grip-horizontal" size={14} />
            </button>
            <button
              type="button"
              aria-label={`Remove ${title}`}
              className="absolute -top-2 -left-2 z-20 flex size-6 items-center justify-center rounded-full border border-border-strong face-raised text-foreground-muted hover:text-danger"
              onClick={() => {
                editor.onRemove(card.id);
              }}
            >
              <AppIcon id="x" size={12} />
            </button>
            <div
              aria-hidden="true"
              className="absolute right-1 bottom-1 z-20 flex size-5 cursor-nwse-resize touch-none items-end justify-end p-0.5 text-foreground-subtle hover:text-foreground"
              onPointerDown={(event) => {
                startResize(event, card);
              }}
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <path d="M9 1L1 9M9 5.5L5.5 9" />
              </svg>
            </div>
          </>
        )}
      </div>
    );
  };

  const moving = gesture?.kind === 'move' ? gesture : null;
  const carried = moving === null ? null : findCard(moving.start, moving.id)?.card;
  const rows = bottomOf(shown.cards);

  return (
    <div
      ref={rootRef}
      data-columns={columns}
      className="relative"
      /* eslint-disable-next-line react/forbid-dom-props -- the grid is as tall as the rows its cards
      reach, a number no class can carry (RULES.md 15.3). */
      style={{
        height:
          Math.max(rowsHeight(rows), editor === null ? 0 : rowsHeight(2)) +
          (editor === null ? 0 : GAP_PX),
      }}
    >
      {width === 0 ? null : shown.cards.map((card) => place(card, column))}

      {moving === null || carried === null || carried === undefined ? null : (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-50"
          /* eslint-disable-next-line react/forbid-dom-props -- a lifted card follows the pointer (RULES.md
          15.3). */
          style={{
            left: moving.pointer.x - moving.offset.x,
            top: moving.pointer.y - moving.offset.y,
            width: moving.size.width,
            height: moving.size.height,
          }}
        >
          <div className="h-full origin-center scale-[1.02] -rotate-[1.6deg] rounded-panel shadow-dialog ring-2 ring-primary/70">
            {carried.type === 'container' ? (
              <ContainerView
                container={carried}
                data={data}
                isEditing
                isSelected={false}
                onSelect={() => undefined}
                place={place}
              />
            ) : (
              <CardView card={carried} data={data} />
            )}
          </div>
        </div>
      )}

      <p id="dashboard-grid-help" className="sr-only">
        Press Space to pick the card up, then the arrow keys to move it and Shift with an arrow key
        to change its size.
      </p>
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}

/** What a container needs. */
type ContainerViewProps = {
  readonly container: DashboardContainerCard;
  readonly data: DashboardData;
  readonly isEditing: boolean;
  readonly isSelected: boolean;
  readonly onSelect: () => void;

  /** Draws one of its cards on its own grid. */
  readonly place: (card: DashboardCard, gridColumn: number) => ReactNode;
};

/**
 * Renders a container: its heading, and its cards on a grid as wide as it is.
 *
 * @param props - See {@link ContainerViewProps}.
 * @returns The container.
 */
function ContainerView(props: ContainerViewProps) {
  const { container, data, isEditing, isSelected, onSelect, place } = props;
  const [innerWidth, setInnerWidth] = useState(0);
  const innerRef = useRef<HTMLDivElement>(null);
  const icon = container.icon === null ? undefined : data.icons.get(container.icon);
  const count = container.cards.length;

  useLayoutEffect(() => {
    const element = innerRef.current;

    if (element === null) {
      return undefined;
    }

    setInnerWidth(element.getBoundingClientRect().width);

    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];

      if (entry !== undefined) {
        setInnerWidth(entry.contentRect.width);
      }
    });

    observer.observe(element);

    return (): void => {
      observer.disconnect();
    };
  }, []);

  const innerColumn = columnWidth(innerWidth, container.w);

  return (
    <section
      aria-label={container.title}
      className={cn(
        'relative h-full rounded-panel border border-border-soft bg-sunk/45',
        isSelected ? 'ring-2 ring-primary ring-offset-2 ring-offset-canvas' : undefined,
      )}
    >
      <div
        className="absolute inset-x-0 top-0 flex items-center gap-3 px-4"
        /* eslint-disable-next-line react/forbid-dom-props -- the heading fills the container's first row,
        measured from the grid's own constants (RULES.md 15.3). */
        style={{ height: CONTAINER_HEADING_PX - CONTAINER_PADDING_PX / 2 }}
      >
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-tile border border-border bg-surface-raised text-foreground-muted"
        >
          {icon === undefined ? (
            <AppIcon id="layout-grid" size={18} />
          ) : (
            <DeviceIcon icon={icon} size={18} />
          )}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-subhead font-semibold tracking-tight">
            {container.title}
          </span>
          <span className="text-caption text-foreground-subtle tabular">
            {count === 0 ? 'Empty' : `${String(count)} ${count === 1 ? 'card' : 'cards'}`}
          </span>
        </span>
        {isEditing ? (
          <button
            type="button"
            aria-label={`Edit ${container.title}`}
            className="absolute inset-0 cursor-pointer rounded-t-panel"
            onClick={onSelect}
          />
        ) : null}
      </div>

      <div
        ref={innerRef}
        data-container-grid={container.id}
        data-columns={container.w}
        className="absolute"
        /* eslint-disable-next-line react/forbid-dom-props -- the cards' grid starts under the heading,
        measured from the grid's own constants (RULES.md 15.3). */
        style={{
          top: CONTAINER_HEADING_PX,
          left: CONTAINER_PADDING_PX,
          right: CONTAINER_PADDING_PX,
          bottom: CONTAINER_PADDING_PX,
        }}
      >
        {count === 0 ? (
          <div className="flex h-full items-center justify-center rounded-panel border border-dashed border-border-strong text-caption text-foreground-subtle">
            {isEditing ? 'Drag cards here' : 'Nothing in this group yet'}
          </div>
        ) : innerWidth === 0 ? null : (
          container.cards.map((card) => place(card, innerColumn))
        )}
      </div>
    </section>
  );
}
