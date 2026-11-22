/**
 * The dashboard at a tablet's or a phone's width, while it is edited (`N-Dashboard-Edit-Tablet`,
 * `-Phone`): the grid in a frame of that width, centred on a dotted floor, with the width and the
 * number of columns written above it. Either edge of the frame can be dragged for any width.
 *
 * It is the real grid, not a copy, laid out on the columns its width has, as it is in a narrow
 * window. It is only looked at: cards are not moved or resized here and the empty spaces are not
 * drawn, but a card's settings still open.
 *
 * The grid is told the width the frame is going to rather than measuring the frame on its way
 * there. A device chosen, the frame slides to its width and the cards slide to their places at
 * that width on the same curve, so they move as one. Measured, the grid would see a new width
 * every frame, each restarting the cards' slide, and they stood still until the frame stopped.
 */
import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@nebulahome/ui';

import { columnsFor } from '@/dashboard/geometry';
import { useElementSize } from '@/lib/use-element-size';

/** How the frame slides to a width, and the cards in it with it. */
export const FRAME_MOTION = 'duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]';

/** The frame's border, each side: the grid is this much narrower too. */
const FRAME_BORDER_PX = 1;

/** What the grid is told of the frame it is drawn in. */
export type PreviewFrame = {
  /** How wide the grid is going to be, before the frame has slid there. */
  readonly width: number;

  /** Whether the cards slide there with the frame: not while an edge is dragged. */
  readonly slides: boolean;
};

/** The narrowest and widest a frame may be dragged to. */
const NARROWEST_PX = 320;
const WIDEST_PX = 1200;

/** How wide each device starts. */
export const PREVIEW_WIDTHS = { tablet: 768, phone: 390 } as const;

/** The page's own gutter inside the frame, by how wide it is. */
const GUTTER_PX = { wide: 24, narrow: 16 } as const;

/** What the preview needs. */
export type WidthPreviewProps = {
  /** Which device it is drawn as. */
  readonly device: 'tablet' | 'phone';

  /** The frame's width, in pixels. */
  readonly width: number;

  /** Takes a width dragged to. */
  readonly onWidth: (width: number) => void;

  /** Draws the grid, for the frame it is in. */
  readonly children: (frame: PreviewFrame) => ReactNode;
};

/**
 * Renders the grid in a frame of a device's width.
 *
 * @param props - See {@link WidthPreviewProps}.
 * @returns The preview.
 */
export function WidthPreview(props: WidthPreviewProps) {
  const { t } = useTranslation();

  const { device, width, onWidth, children } = props;
  // The room the frame has; a frame wider than that is drawn as wide as it, and so is its grid.
  // Not known before the floor is laid out.
  const { ref: floor, size: floorSize } = useElementSize<HTMLDivElement>();
  const room = floorSize.width > 0 ? floorSize.width : null;
  const shown = room === null ? width : Math.min(width, room);
  const gutter = width >= 600 ? GUTTER_PX.wide : GUTTER_PX.narrow;
  const inner = Math.max(0, shown - 2 * gutter - 2 * FRAME_BORDER_PX);
  const columns = columnsFor(inner);
  const start = useRef<{ readonly x: number; readonly width: number } | null>(null);
  // While an edge is dragged the frame follows the pointer at once; a device chosen slides to it.
  const [isDragging, setDragging] = useState(false);

  /**
   * Starts dragging an edge.
   *
   * @param event - The press.
   * @param sign - 1 for the right edge, -1 for the left: the frame is centred, so an edge moves
   *   half as far as the width changes.
   */
  const drag = (event: ReactPointerEvent<HTMLButtonElement>, sign: 1 | -1): void => {
    event.preventDefault();
    start.current = { x: event.clientX, width };
    setDragging(true);

    /**
     * Follows the pointer.
     *
     * @param move - Where it went.
     */
    const onMove = (move: PointerEvent): void => {
      if (start.current !== null) {
        const next = start.current.width + 2 * sign * (move.clientX - start.current.x);

        onWidth(Math.round(Math.min(WIDEST_PX, Math.max(NARROWEST_PX, next))));
      }
    };

    /** Lets go. */
    const onUp = (): void => {
      start.current = null;
      setDragging(false);
      globalThis.removeEventListener('pointermove', onMove);
      globalThis.removeEventListener('pointerup', onUp);
    };

    globalThis.addEventListener('pointermove', onMove);
    globalThis.addEventListener('pointerup', onUp);
  };

  const label =
    device === 'tablet'
      ? t('dashboard.widthPreview.tablet', 'Tablet')
      : t('dashboard.widthPreview.phone', 'Phone');
  const handle = cn(
    'absolute top-1/2 z-10 h-14 w-2 -translate-y-1/2 cursor-ew-resize touch-none rounded-pill border border-border-strong bg-surface-high',
    'transition-colors duration-150 hover:border-primary hover:bg-primary/30 focus-visible:outline-2 focus-visible:outline-primary',
  );

  return (
    <div
      ref={floor}
      className="flex min-h-full animate-fade-in flex-col items-center gap-4 rounded-card border border-border bg-well bg-[radial-gradient(var(--color-border)_1px,transparent_1px)] bg-size-[16px_16px] px-4 pt-6 pb-8"
    >
      <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-caption">
        <span className="font-mono text-label tracking-[0.08em] text-primary-hover uppercase tabular">
          {t('dashboard.widthPreview.measure', {
            device: label,
            width,
            count: columns,
            defaultValue_one: '{{device}} · {{width}} px · {{count}} column',
            defaultValue_other: '{{device}} · {{width}} px · {{count}} columns',
          })}
        </span>
        <span className="text-foreground-subtle">
          {t('dashboard.widthPreview.dragAnEdge', 'Drag an edge for any width')}
        </span>
      </p>
      <div
        className={cn(
          'relative max-w-full rounded-[28px] border border-border-strong bg-canvas shadow-float',
          isDragging ? undefined : cn('transition-[width,padding]', FRAME_MOTION),
        )}
        /* eslint-disable-next-line react/forbid-dom-props -- the frame is as wide as the device chosen
        or the edge dragged to. */
        style={{ width, padding: gutter }}
      >
        <button
          type="button"
          aria-label={t('dashboard.widthPreview.leftEdge', 'Drag the left edge')}
          className={cn(handle, '-left-1')}
          onPointerDown={(event) => {
            drag(event, -1);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault();
              onWidth(
                Math.min(
                  WIDEST_PX,
                  Math.max(NARROWEST_PX, width + (event.key === 'ArrowLeft' ? 20 : -20)),
                ),
              );
            }
          }}
        />
        {children({ width: inner, slides: !isDragging })}
        <button
          type="button"
          aria-label={t('dashboard.widthPreview.rightEdge', 'Drag the right edge')}
          className={cn(handle, '-right-1')}
          onPointerDown={(event) => {
            drag(event, 1);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault();
              onWidth(
                Math.min(
                  WIDEST_PX,
                  Math.max(NARROWEST_PX, width + (event.key === 'ArrowRight' ? 20 : -20)),
                ),
              );
            }
          }}
        />
      </div>
    </div>
  );
}
