/**
 * Where the app windows go (docs: app windows, 4.2): the spots a window snaps to, the spot under
 * the pointer while one is dragged, and the stretch of the right edge the hidden windows' tabs share
 * with the packages' floating windows and the toasts. Pure: every size is the layer's, in pixels,
 * from its top-left; the layer is the page's box beside the sidebar.
 */
import { PEEK_PX, type Size, type Vector } from '@/packages/floating/spring';

/** A rectangle in the layer. */
export type Rect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/** A place a window snaps to: the whole page, a half, a quarter. */
export type Spot =
  'large' | 'left' | 'right' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** Every spot, for a reader to check a remembered one against. */
export const SPOTS: readonly Spot[] = [
  'large',
  'left',
  'right',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
];

/** A stretch of the right edge, top to bottom. */
export type Band = { readonly top: number; readonly bottom: number };

/** How far the spots sit from the layer's edges: the sidebar card's own margin. */
export const EDGE_PX = 16;

/** The room between two halves, or two quarters. */
export const GAP_PX = 16;

/** How far the spots and the tabs keep from anything on the right edge. */
export const CLEAR_PX = 12;

/** How far from the top and the bottom the tabs may go: the floating windows' corner inset. */
export const RAIL_INSET_PX = 24;

/** The smallest a window can be made. */
export const MIN_SIZE: Size = { width: 480, height: 360 };

/** How close to an edge the pointer goes before the spot there shows. */
export const SNAP_EDGE_PX = 24;

/** How far along an edge from a corner the pointer counts as in that corner. */
export const SNAP_CORNER_PX = 64;

/** A tab's height while there is room, and the least it is squeezed to. */
export const TAB_HEIGHT_PX = 52;
export const TAB_MIN_HEIGHT_PX = 40;

/** The room between two tabs. */
export const TAB_GAP_PX = 8;

/**
 * Where the windows' right side may reach: short of the rail while anything is on it.
 *
 * @param width - The layer's width.
 * @param isRailBusy - Whether a tab or a tucked floating window is on the right edge.
 * @returns The x the windows end at.
 */
export function rightLimit(width: number, isRailBusy: boolean): number {
  return isRailBusy ? width - PEEK_PX - CLEAR_PX : width - EDGE_PX;
}

/**
 * The rectangle of a spot.
 *
 * @param spot - Which.
 * @param bounds - The layer's size.
 * @param isRailBusy - Whether the right edge has something on it, which the spots stay clear of.
 * @returns Its rectangle.
 */
export function spotRect(spot: Spot, bounds: Size, isRailBusy: boolean): Rect {
  const left = EDGE_PX;
  const top = EDGE_PX;
  const right = rightLimit(bounds.width, isRailBusy);
  const bottom = bounds.height - EDGE_PX;
  const halfWidth = Math.floor((right - left - GAP_PX) / 2);
  const halfHeight = Math.floor((bottom - top - GAP_PX) / 2);
  const second = { x: left + halfWidth + GAP_PX, y: top + halfHeight + GAP_PX };
  const column = spot.endsWith('left')
    ? { x: left, width: halfWidth }
    : { x: second.x, width: right - second.x };
  const row = spot.startsWith('top')
    ? { y: top, height: halfHeight }
    : { y: second.y, height: bottom - second.y };

  switch (spot) {
    case 'large': {
      return { x: left, y: top, width: right - left, height: bottom - top };
    }
    case 'left':
    case 'right': {
      return { ...column, y: top, height: bottom - top };
    }
    default: {
      return { ...column, ...row };
    }
  }
}

/**
 * The spot the pointer is at while a window is dragged: the top edge for Large, a side for its
 * half, a corner for its quarter. The bottom edge has none.
 *
 * @param pointer - Where the pointer is, in the layer; past the left edge too (over the sidebar).
 * @param bounds - The layer's size.
 * @returns The spot, or null away from the edges (the window is then let go where it is).
 */
export function spotAt(pointer: Vector, bounds: Size): Spot | null {
  const isLeft = pointer.x <= SNAP_EDGE_PX;
  const isRight = pointer.x >= bounds.width - SNAP_EDGE_PX;
  const isTop = pointer.y <= SNAP_EDGE_PX;
  const isBottom = pointer.y >= bounds.height - SNAP_EDGE_PX;
  const isTopEnd = pointer.y <= SNAP_CORNER_PX;
  const isBottomEnd = pointer.y >= bounds.height - SNAP_CORNER_PX;
  const isLeftEnd = pointer.x <= SNAP_CORNER_PX;
  const isRightEnd = pointer.x >= bounds.width - SNAP_CORNER_PX;

  if (
    ((isLeft || isRight) && (isTopEnd || isBottomEnd)) ||
    ((isTop || isBottom) && (isLeftEnd || isRightEnd))
  ) {
    const vertical = pointer.y < bounds.height / 2 ? 'top' : 'bottom';
    const side = pointer.x < bounds.width / 2 ? 'left' : 'right';

    return `${vertical}-${side}`;
  }

  if (isLeft) {
    return 'left';
  }

  if (isRight) {
    return 'right';
  }

  return isTop ? 'large' : null;
}

/**
 * Holds a free window inside the layer, no smaller than the least size (or the layer, when the
 * layer is smaller still) and short of the rail while it is busy.
 *
 * @param rect - Where the window would be.
 * @param bounds - The layer's size.
 * @param isRailBusy - Whether the right edge has something on it.
 * @returns Where it is.
 */
export function clampRect(rect: Rect, bounds: Size, isRailBusy: boolean): Rect {
  const right = isRailBusy ? rightLimit(bounds.width, true) : bounds.width;
  const width = Math.min(Math.max(rect.width, MIN_SIZE.width), Math.max(right, 0));
  const height = Math.min(Math.max(rect.height, MIN_SIZE.height), Math.max(bounds.height, 0));

  return {
    x: Math.min(Math.max(rect.x, 0), Math.max(right - width, 0)),
    y: Math.min(Math.max(rect.y, 0), Math.max(bounds.height - height, 0)),
    width,
    height,
  };
}

/**
 * The longest stretch of the right edge nothing holds: what is left between the top and the bottom
 * inset once the floating windows and the toasts on that edge are taken out, each with room around.
 *
 * @param height - The layer's height.
 * @param taken - What holds the edge.
 * @returns The stretch; an empty one when nothing is left.
 */
export function freeStretch(height: number, taken: readonly Band[]): Band {
  const sorted = taken
    .map((band) => ({ top: band.top - CLEAR_PX, bottom: band.bottom + CLEAR_PX }))
    .toSorted((a, b) => a.top - b.top);
  let best: Band = { top: RAIL_INSET_PX, bottom: RAIL_INSET_PX };
  let from = RAIL_INSET_PX;

  for (const band of [...sorted, { top: height - RAIL_INSET_PX, bottom: height }]) {
    const to = Math.min(band.top, height - RAIL_INSET_PX);

    if (to - from > best.bottom - best.top) {
      best = { top: from, bottom: to };
    }

    from = Math.max(from, band.bottom);
  }

  return best;
}

/**
 * Lays the tabs out in a stretch: centred in it, as tall as they may be, squeezed down to the least
 * height when they do not fit.
 *
 * @param count - How many tabs.
 * @param stretch - Where they go.
 * @returns Each tab's top, and their height.
 */
export function tabsLayout(
  count: number,
  stretch: Band,
): { readonly tops: readonly number[]; readonly height: number } {
  if (count === 0) {
    return { tops: [], height: TAB_HEIGHT_PX };
  }

  const room = stretch.bottom - stretch.top - (count - 1) * TAB_GAP_PX;
  const height = Math.max(Math.min(TAB_HEIGHT_PX, Math.floor(room / count)), TAB_MIN_HEIGHT_PX);
  const total = count * height + (count - 1) * TAB_GAP_PX;
  const first = Math.round(stretch.top + Math.max((stretch.bottom - stretch.top - total) / 2, 0));

  return {
    tops: [...Array.from({ length: count }).keys()].map(
      (index) => first + index * (height + TAB_GAP_PX),
    ),
    height,
  };
}

/**
 * Whether two rectangles overlap.
 *
 * @param a - One.
 * @param b - The other.
 * @returns True when they share any area.
 */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * The transform that draws a rectangle laid out at `at` over `over` instead, from its top-left:
 * how a window or a zone is flown from one place to another while it is laid out at the second.
 *
 * @param at - Where it is laid out.
 * @param over - Where it is to be seen.
 * @returns The CSS transform.
 */
export function transformOver(at: Rect, over: Rect): string {
  const dx = over.x - at.x;
  const dy = over.y - at.y;
  const sx = over.width / Math.max(at.width, 1);
  const sy = over.height / Math.max(at.height, 1);

  return `translate(${String(dx)}px, ${String(dy)}px) scale(${String(sx)}, ${String(sy)})`;
}
