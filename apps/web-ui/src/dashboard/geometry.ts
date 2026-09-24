/**
 * From cells to pixels and back.
 *
 * The page is four columns on a hundred-pixel row with sixteen between, the unit the mockup was
 * drawn on: a tile is one row, a card two, and a tile under a card ends on the same line as the
 * card beside it without anyone measuring. Columns take whatever width the window gives them.
 *
 * A container's first row is its heading. Its own cards sit on a grid inset by the container's
 * padding, starting where its second row would; so a container two rows tall has exactly one row
 * of room, and one grows a row at a time, like everything else on the page.
 */
import type { GridItem, GridPoint } from '@/dashboard/grid-engine';

/** The height of one row, in pixels. */
export const ROW_PX = 100;

/** The space between two cells, across and down, in pixels. */
export const GAP_PX = 16;

/** How far a container's cards sit inside its edges, in pixels. */
export const CONTAINER_PADDING_PX = 12;

/** How tall a container's heading is: its first row, less the padding under its cards. */
export const CONTAINER_HEADING_PX = ROW_PX + GAP_PX - CONTAINER_PADDING_PX;

/** Narrower than this and the page is drawn on two columns rather than four. */
export const NARROW_WIDTH_PX = 720;

/** A card's box on its grid, in pixels. */
export type Box = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

/**
 * How wide one column is.
 *
 * @param width - How wide the grid is.
 * @param columns - How many columns it has.
 * @returns The column's width, never below zero.
 */
export function columnWidth(width: number, columns: number): number {
  return Math.max(0, (width - GAP_PX * (columns - 1)) / columns);
}

/**
 * How tall a number of rows is, gaps between them included.
 *
 * @param rows - How many rows.
 * @returns The height in pixels.
 */
export function rowsHeight(rows: number): number {
  return rows <= 0 ? 0 : rows * ROW_PX + (rows - 1) * GAP_PX;
}

/**
 * Where a card is drawn.
 *
 * @param item - Where it sits, in cells.
 * @param column - How wide one column is.
 * @returns Its box, in pixels from the grid's top-left corner.
 */
export function boxOf(item: Omit<GridItem, 'id'>, column: number): Box {
  return {
    left: item.x * (column + GAP_PX),
    top: item.y * (ROW_PX + GAP_PX),
    width: item.w * column + (item.w - 1) * GAP_PX,
    height: rowsHeight(item.h),
  };
}

/**
 * The cell nearest to a point, measured from the grid's top-left corner.
 *
 * @param left - Pixels across.
 * @param top - Pixels down.
 * @param column - How wide one column is.
 * @returns The cell; never left of or above the first one.
 */
export function cellAt(left: number, top: number, column: number): GridPoint {
  return {
    x: Math.max(0, Math.round(left / (column + GAP_PX))),
    y: Math.max(0, Math.round(top / (ROW_PX + GAP_PX))),
  };
}

/**
 * How many cells a stretch of pixels covers, to the nearest cell.
 *
 * @param width - Pixels across.
 * @param height - Pixels down.
 * @param column - How wide one column is.
 * @returns The span, at least one cell each way.
 */
export function spanOf(width: number, height: number, column: number): { w: number; h: number } {
  return {
    w: Math.max(1, Math.round((width + GAP_PX) / (column + GAP_PX))),
    h: Math.max(1, Math.round((height + GAP_PX) / (ROW_PX + GAP_PX))),
  };
}

/** A card on the page as the drop target sees it: where it sits, and whether it is a container. */
export type PageCard = GridItem & { readonly isContainer: boolean };

/** Where a carried card would be put. */
export type DropPlace = GridPoint & { readonly parentId: string | null };

/**
 * Where a carried card lands with the pointer at a point.
 *
 * Worked out against the page as it was when the card was lifted, not as the preview has
 * rearranged it: a card carried towards a container pushes that container down in the preview,
 * and a container found where it now is would slide away from the pointer as it is approached.
 * Over a container's cards - the area under its heading - the card goes into the container,
 * unless it is a container itself; anywhere else, onto the page.
 *
 * @param page - The page's cards when the drag began.
 * @param carried - The card being carried: its id, and whether it is a container.
 * @param carried.id - Its id.
 * @param carried.isContainer - Whether it is a container.
 * @param pointer - The pointer, in pixels from the page grid's top-left corner.
 * @param offset - Where on the card it was picked up, from the card's top-left corner.
 * @param pageWidth - How wide the page grid is.
 * @param columns - How many columns the page grid has.
 * @returns The grid and the cell its top-left corner lands on.
 */
export function dropPlace(
  page: readonly PageCard[],
  carried: { readonly id: string; readonly isContainer: boolean },
  pointer: GridPoint,
  offset: GridPoint,
  pageWidth: number,
  columns: number,
): DropPlace {
  const column = columnWidth(pageWidth, columns);

  if (!carried.isContainer) {
    for (const card of page) {
      if (!card.isContainer || card.id === carried.id) {
        continue;
      }

      const box = boxOf(card, column);
      const left = box.left + CONTAINER_PADDING_PX;
      const top = box.top + CONTAINER_HEADING_PX;
      const width = box.width - 2 * CONTAINER_PADDING_PX;
      const bottom = box.top + box.height - CONTAINER_PADDING_PX;

      if (
        pointer.x >= left &&
        pointer.x <= left + width &&
        pointer.y >= top &&
        pointer.y <= bottom
      ) {
        return {
          parentId: card.id,
          ...cellAt(
            pointer.x - offset.x - left,
            pointer.y - offset.y - top,
            columnWidth(width, card.w),
          ),
        };
      }
    }
  }

  return { parentId: null, ...cellAt(pointer.x - offset.x, pointer.y - offset.y, column) };
}
