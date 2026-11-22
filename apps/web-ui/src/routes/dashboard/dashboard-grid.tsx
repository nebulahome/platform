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
import { useTranslation } from 'react-i18next';

import {
  DASHBOARD_COLUMNS,
  type DashboardCard,
  type DashboardContainerCard,
  type DashboardLayout,
} from '@nebulahome/contracts';
import { AppIcon, cn } from '@nebulahome/ui';

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
  columnsFor,
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
import { useElementSize } from '@/lib/use-element-size';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { CardView, cardTitle } from '@/routes/dashboard/card-view';
import {
  CardHandles,
  CardOutline,
  EmptySpace,
  freeCells,
  PendingCard,
  SizeTag,
} from '@/routes/dashboard/edit-chrome';
import type { DashboardData } from '@/routes/dashboard/use-dashboard-data';
import { FRAME_MOTION, type PreviewFrame } from '@/routes/dashboard/width-preview';
import { DeviceIcon } from '@/routes/library/device-icon';

/** What the grid is told while the layout is being edited. */
export type GridEditor = {
  /** The card whose settings are open. */
  readonly selectedId: string | null;

  /** Opens a card's settings. */
  readonly onSelect: (cardId: string) => void;

  /** Takes a moved or resized layout. */
  readonly onChange: (layout: DashboardLayout) => void;

  /** Takes a card off. */
  readonly onRemove: (cardId: string) => void;

  /**
   * Whether cards may be moved and resized and the empty spaces offered: not in the tablet and
   * phone preview, where the grid is only looked at.
   */
  readonly canMove: boolean;

  /** The copied card's name, when there is one to paste; null otherwise. */
  readonly clipboardName: string | null;

  /** The cards that still wait for their entity, with the kind each will be. */
  readonly pending: Readonly<Record<string, string>>;

  /** Add card is chosen on an empty space. */
  readonly onAddAt: (place: CardPlace) => void;

  /** Paste is chosen on an empty space. */
  readonly onPasteAt: (place: CardPlace) => void;
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

  /**
   * What fills the room the editor keeps for a layout with no card yet: the grid stays where it
   * is - and keeps measuring the window - with this laid over the two empty rows.
   */
  readonly emptyState?: ReactNode;

  /**
   * In the editor's tablet or phone preview: the width the frame is going to, used in place of
   * the one measured, and whether the cards slide there with the frame.
   */
  readonly frame?: PreviewFrame;
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

      /** Where the pointer is, in the window, for the size written beside it. */
      readonly pointer: { readonly x: number; readonly y: number };
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

/** A container's border, each side (`border`): its cards' grid is this much narrower too. */
const CONTAINER_BORDER_PX = 1;

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
  const { t } = useTranslation();

  const { layout, data, editor, onNarrowChange, emptyState, frame } = props;
  // The grid's width is the browser's to decide, or the preview frame's it is going to; the columns
  // are measured from it.
  const { ref: rootRef, size: measured } = useElementSize<HTMLDivElement>();
  const width = frame?.width ?? measured.width;
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const isReduced = useReducedMotion();
  const isNarrow = width > 0 && width < NARROW_WIDTH_PX;
  const narrowReported = useRef<boolean | null>(null);

  useLayoutEffect(() => {
    if (width > 0 && narrowReported.current !== isNarrow) {
      narrowReported.current = isNarrow;
      onNarrowChange?.(isNarrow);
    }
  }, [isNarrow, onNarrowChange, width]);

  // The stored layout is four columns wide; a narrower grid is drawn on fewer, never edited there.
  const columns = editor?.canMove === true ? DASHBOARD_COLUMNS : columnsFor(width || 1200);
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
        setAnnouncement(
          t('dashboard.dashboardGrid.movedPreview', 'Moved. {{preview}}', {
            preview: whereIs(lifted.preview, card.id, data),
          }),
        );
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
    editor.onSelect(card.id);

    const rect = element.getBoundingClientRect();
    const gridColumns = Number(grid.dataset['columns'] ?? DASHBOARD_COLUMNS);
    const gridColumn = columnWidth(grid.getBoundingClientRect().width, gridColumns);
    const origin = { x: event.clientX, y: event.clientY };
    let current: Extract<Gesture, { kind: 'resize' }> = {
      kind: 'resize',
      id: card.id,
      start: layout,
      preview: layout,
      pointer: origin,
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

      current = { ...current, preview, pointer: { x: move.clientX, y: move.clientY } };
      setGesture(current);
    };

    /** Keeps the size the corner settled on. */
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);

      if (current.preview !== current.start) {
        editor.onChange(current.preview);
        setAnnouncement(
          t('dashboard.dashboardGrid.resizedPreview', 'Resized. {{preview}}', {
            preview: whereIs(current.preview, card.id, data),
          }),
        );
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
          t(
            'dashboard.dashboardGrid.pickedUpCardArrow',
            'Picked up {{card}}. Arrow keys move it, Shift and an arrow key change its size, Enter puts it down, Escape puts it back.',
            { card: cardTitle(card, data) },
          ),
        );
      }

      return;
    }

    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      editor.onChange(lifted.preview);
      setGesture(null);
      setAnnouncement(
        t('dashboard.dashboardGrid.putDownPreview', 'Put down. {{preview}}', {
          preview: whereIs(lifted.preview, card.id, data),
        }),
      );

      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setGesture(null);
      setAnnouncement(
        t('dashboard.dashboardGrid.putBackStart', 'Put back. {{start}}', {
          start: whereIs(lifted.start, card.id, data),
        }),
      );

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
   * Draws one card where its cells put it, with the editing outline and handles when editing.
   *
   * @param card - The card.
   * @param gridColumn - How wide one column of its grid is.
   * @param parentId - The container it is in, or null on the page.
   * @returns The placed card.
   */
  const place = (card: DashboardCard, gridColumn: number, parentId: string | null): ReactNode => {
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
          className="absolute top-0 left-0 rounded-card border-2 border-dashed border-primary/55 bg-primary/6"
          /* eslint-disable-next-line react/forbid-dom-props -- a slot sits where its cells work out to, in
          pixels measured from the window (RULES.md 15.3). */
          style={style}
        />
      );
    }

    const title = cardTitle(card, data);
    const selectedId = editor?.selectedId ?? null;
    const isSelected = selectedId === card.id;
    const isLifted = gesture?.kind === 'keyboard' && gesture.id === card.id;
    // With a card chosen, the others step back - but not the cards of the group chosen.
    const isDimmed =
      selectedId !== null && !isSelected && selectedId !== parentId && card.type !== 'container';

    return (
      <div
        key={card.id}
        data-card-id={card.id}
        className={cn(
          'group/card absolute top-0 left-0',
          // Only while editing, where a card that moves should be seen moving. On a dashboard being
          // looked at, a card only moves because the window changed, and sliding then is noise.
          // In a device's preview the cards slide with the frame, on its curve.
          editor === null || isReduced || gesture?.kind === 'resize' || frame?.slides === false
            ? undefined
            : frame === undefined
              ? 'transition-[transform,width,height] duration-200 ease-out'
              : cn('transition-[transform,width,height]', FRAME_MOTION),
          isSelected || isLifted ? 'z-10' : undefined,
        )}
        /* eslint-disable-next-line react/forbid-dom-props -- a card sits where its cells work out to, in
        pixels measured from the window (RULES.md 15.3). */
        style={style}
      >
        {card.type === 'container' ? (
          <ContainerView
            container={card}
            width={box.width}
            data={data}
            editor={editor}
            isSelected={isSelected}
            onSelect={() => editor?.onSelect(card.id)}
            place={place}
            spaces={spaces}
          />
        ) : (
          <div
            className={cn(
              'h-full rounded-card transition-[opacity,box-shadow] duration-200 ease-out',
              isDimmed ? 'opacity-50' : undefined,
              isLifted ? 'shadow-dialog' : undefined,
            )}
            inert={editor !== null}
          >
            {editor?.pending[card.id] === undefined ? (
              <CardView card={card} data={data} isEditing={editor !== null} />
            ) : (
              <PendingCard kind={editor.pending[card.id] ?? ''} />
            )}
          </div>
        )}

        {editor === null ? null : (
          <>
            {card.type === 'container' ? null : (
              <button
                type="button"
                aria-label={t('dashboard.dashboardGrid.editTitle', 'Edit {{title}}', { title })}
                aria-pressed={isSelected}
                className="absolute inset-0 cursor-pointer rounded-card focus-visible:outline-none"
                onClick={() => {
                  editor.onSelect(card.id);
                }}
              />
            )}
            <CardOutline isSelected={isSelected || isLifted} />
            <CardHandles
              title={title}
              isSelected={isSelected}
              isLifted={isLifted}
              canMove={editor.canMove}
              onGripDown={(event) => {
                startMove(event, card);
              }}
              onGripKey={(event) => {
                onGripKey(event, card);
              }}
              onGripBlur={() => {
                if (gesture?.kind === 'keyboard' && gesture.id === card.id) {
                  editor.onChange(gesture.preview);
                  setGesture(null);
                }
              }}
              onCornerDown={(event) => {
                startResize(event, card);
              }}
              onRemove={() => {
                editor.onRemove(card.id);
              }}
            />
          </>
        )}
      </div>
    );
  };

  /**
   * Draws the empty spaces of a grid while it is edited, each offering Add card and Paste.
   *
   * @param cards - The grid's cards.
   * @param gridColumns - How many columns it has.
   * @param rows - How many rows of it to fill.
   * @param gridColumn - How wide one of its columns is.
   * @param parentId - The container it is, or null for the page.
   * @returns The spaces.
   */
  const spaces = (
    cards: readonly DashboardCard[],
    gridColumns: number,
    rows: number,
    gridColumn: number,
    parentId: string | null,
  ): ReactNode => {
    if (editor === null || !editor.canMove || gesture?.kind === 'move' || gridColumn <= 0) {
      return null;
    }

    return freeCells(cards, gridColumns, rows).map(({ x, y }) => {
      const box = boxOf({ x, y, w: 1, h: 1 }, gridColumn);

      return (
        <EmptySpace
          key={`space-${String(x)}-${String(y)}`}
          style={{
            transform: `translate(${String(box.left)}px, ${String(box.top)}px)`,
            width: box.width,
            height: box.height,
          }}
          clipboardName={editor.clipboardName}
          onAdd={() => {
            editor.onAddAt({ parentId, x, y });
          }}
          onPaste={() => {
            editor.onPasteAt({ parentId, x, y });
          }}
        />
      );
    });
  };

  const moving = gesture?.kind === 'move' ? gesture : null;
  const carried = moving === null ? null : findCard(moving.start, moving.id)?.card;
  // While editing, one whole empty row is kept under the last card for the next one.
  const rows =
    editor === null
      ? bottomOf(shown.cards)
      : Math.max(2, bottomOf(shown.cards) + (editor.canMove ? 1 : 0));
  const resizing = gesture?.kind === 'resize' ? gesture : null;
  const resized = resizing === null ? null : findCard(resizing.preview, resizing.id)?.card;

  return (
    <div
      ref={rootRef}
      data-columns={columns}
      // In a preview it grows and shrinks with its cards, so the frame round it does too.
      className={cn(
        'relative',
        frame?.slides === true && !isReduced && cn('transition-[height]', FRAME_MOTION),
      )}
      /* eslint-disable-next-line react/forbid-dom-props -- the grid is as tall as the rows its cards
      reach, a number no class can carry (RULES.md 15.3). */
      style={{ height: rowsHeight(rows) + (editor === null ? 0 : GAP_PX) }}
    >
      {width === 0 ? null : spaces(shown.cards, columns, rows, column, null)}
      {width === 0 ? null : shown.cards.map((card) => place(card, column, null))}

      {resizing === null || resized === null || resized === undefined ? null : (
        <SizeTag size={sizeName(resized)} at={resizing.pointer} />
      )}

      {emptyState === undefined || editor === null || shown.cards.length > 0 ? null : (
        // Over the two rows the editor keeps, not the gap under them (GAP_PX, 16px).
        <div className="absolute inset-x-0 top-0 bottom-4 flex">{emptyState}</div>
      )}

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
          <div className="h-full origin-center scale-[1.02] -rotate-[1.6deg] rounded-card shadow-dialog ring-2 ring-primary/70">
            {carried.type === 'container' ? (
              <ContainerView
                container={carried}
                width={moving.size.width}
                data={data}
                editor={null}
                isSelected={false}
                onSelect={() => undefined}
                place={place}
                spaces={() => null}
              />
            ) : (
              <CardView card={carried} data={data} isEditing />
            )}
          </div>
        </div>
      )}

      <p id="dashboard-grid-help" className="sr-only">
        {t(
          'dashboard.dashboardGrid.pressSpaceToPick',
          'Press Space to pick the card up, then the arrow keys to move it and Shift with an arrow key to change its size.',
        )}
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

  /**
   * How wide it is drawn, in pixels. Its cards' grid is worked out from it rather than measured:
   * measured, it would follow the container's own slide a frame behind, and the cards, starting
   * a slide of their own each frame, would stick out of a preview frame narrowing under them.
   */
  readonly width: number;
  readonly data: DashboardData;

  /** The editor, while the layout is edited; null to only show it. */
  readonly editor: GridEditor | null;
  readonly isSelected: boolean;
  readonly onSelect: () => void;

  /** Draws one of its cards on its own grid. */
  readonly place: (card: DashboardCard, gridColumn: number, parentId: string | null) => ReactNode;

  /** Draws the empty spaces of its grid while it is edited. */
  readonly spaces: (
    cards: readonly DashboardCard[],
    gridColumns: number,
    rows: number,
    gridColumn: number,
    parentId: string | null,
  ) => ReactNode;
};

/**
 * Renders a container - a group: its heading, and its cards on a grid as wide as it is, with its
 * own empty spaces while it is edited. A group that is full has no space left: its heading offers
 * Add card and Paste instead, and what is added there makes it a row taller.
 *
 * @param props - See {@link ContainerViewProps}.
 * @returns The container.
 */
function ContainerView(props: ContainerViewProps) {
  const { t } = useTranslation();

  const { container, width, data, editor, isSelected, onSelect, place, spaces } = props;
  // Inside its border and its padding, as the cards' grid below is placed.
  const innerWidth = Math.max(0, width - 2 * (CONTAINER_BORDER_PX + CONTAINER_PADDING_PX));
  const icon = container.icon === null ? undefined : data.icons.get(container.icon);
  const count = container.cards.length;
  const isEditing = editor !== null;
  const innerRows = Math.max(1, container.h - 1);
  const isFull = freeCells(container.cards, container.w, innerRows).length === 0;

  const innerColumn = columnWidth(innerWidth, container.w);
  const below = { parentId: container.id, x: 0, y: bottomOf(container.cards) };

  return (
    <section
      aria-label={container.title}
      className={cn(
        'relative h-full rounded-[20px] border bg-rail transition-[border-color] duration-200',
        isEditing && !isSelected ? 'border-dashed border-border-strong' : 'border-border',
      )}
    >
      <div
        className="absolute inset-x-0 top-0 flex items-start justify-between gap-2.5 px-3 pt-3"
        /* eslint-disable-next-line react/forbid-dom-props -- the heading fills the container's first row,
        measured from the grid's own constants (RULES.md 15.3). */
        style={{ height: CONTAINER_HEADING_PX - CONTAINER_PADDING_PX / 2 }}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex size-7 shrink-0 items-center justify-center rounded-field bg-success/14 text-success"
          >
            {icon === undefined ? (
              <AppIcon id="layout-grid" size={14} />
            ) : (
              <DeviceIcon icon={icon} size={14} />
            )}
          </span>
          <span className="truncate text-ui font-medium">{container.title}</span>
          <span className="truncate text-caption text-foreground-subtle tabular">
            {count === 0
              ? t('dashboard.dashboardGrid.emptyGroup', 'Group · empty')
              : t('dashboard.dashboardGrid.groupCount', {
                  count,
                  defaultValue_one: 'Group · {{count}} card',
                  defaultValue_other: 'Group · {{count}} cards',
                })}
          </span>
        </span>
        {isEditing ? (
          <button
            type="button"
            aria-label={t('dashboard.dashboardGrid.editTitle', 'Edit {{title}}', {
              title: container.title,
            })}
            aria-pressed={isSelected}
            className="absolute inset-0 cursor-pointer rounded-t-[20px] focus-visible:outline-none"
            onClick={onSelect}
          />
        ) : null}
        {editor !== null && editor.canMove && isFull ? (
          <span className="relative z-10 flex shrink-0 items-center gap-1.5">
            {editor.clipboardName === null ? null : (
              <button
                type="button"
                className="press-scale inline-flex h-7 items-center gap-1.5 rounded-pill border border-primary/60 bg-primary/14 px-2.5 text-caption font-medium text-foreground"
                onClick={() => {
                  editor.onPasteAt(below);
                }}
              >
                <AppIcon id="clipboard-paste" size={13} />
                {t('dashboard.dashboardGrid.paste', 'Paste')}
              </button>
            )}
            <button
              type="button"
              className="press-scale inline-flex h-7 items-center gap-1.5 rounded-pill border border-border-strong bg-surface-raised px-2.5 text-caption font-medium text-foreground hover:bg-surface-high"
              onClick={() => {
                editor.onAddAt(below);
              }}
            >
              <AppIcon id="plus" size={13} />
              {t('dashboard.editChrome.addCard', 'Add card')}
            </button>
          </span>
        ) : null}
      </div>

      <div
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
        {innerWidth === 0 ? null : (
          <>
            {spaces(container.cards, container.w, innerRows, innerColumn, container.id)}
            {count === 0 && !isEditing ? (
              <div className="flex h-full items-center justify-center rounded-card border border-dashed border-border-strong text-caption text-foreground-subtle">
                {t('dashboard.dashboardGrid.nothingInThisGroup', 'Nothing in this group yet')}
              </div>
            ) : (
              container.cards.map((card) => place(card, innerColumn, container.id))
            )}
          </>
        )}
      </div>
    </section>
  );
}
