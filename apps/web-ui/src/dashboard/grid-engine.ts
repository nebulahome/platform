/**
 * The dashboard grid: where cards sit, and where they go when one of them moves.
 *
 * A card covers whole cells - a column and a row, spanning a number of each. The grid is kept
 * packed towards the top: nothing floats with empty rows under it, so a layout never grows holes
 * nobody put there. When a card lands on others they make room for it - by trading places with it
 * when they fit where it was, by stepping above it when there is room, and otherwise by moving
 * down - and then everything packs again.
 *
 * Every function here is pure and answers a new list. A drag works out each preview from where the
 * drag began, never from the last preview, so passing over a card and coming back leaves it where
 * it was.
 */

/** A card as the grid sees it: where it sits and how much it covers, in cells. */
export type GridItem = {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};

/** A cell on the grid. */
export type GridPoint = { readonly x: number; readonly y: number };

/** How much of the grid a card covers. */
export type GridSize = { readonly w: number; readonly h: number };

/**
 * Whether two items cover a cell in common. An item never collides with itself.
 *
 * @param a - One item.
 * @param b - The other.
 * @returns True when they overlap.
 */
export function collides(a: GridItem, b: GridItem): boolean {
  return a.id !== b.id && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Orders items the way a page is read: by row, then by column.
 *
 * @param a - One item.
 * @param b - The other.
 * @returns Negative when `a` comes first.
 */
function readingOrder(a: GridPoint, b: GridPoint): number {
  return a.y - b.y || a.x - b.x;
}

/**
 * The row under the lowest of the items an item overlaps.
 *
 * @param item - The item.
 * @param others - What it may overlap.
 * @returns The first row clear of all of them, or null when it overlaps none.
 */
function clearRow(item: GridItem, others: readonly GridItem[]): number | null {
  const hits = others.filter((other) => collides(item, other));

  return hits.length === 0 ? null : Math.max(...hits.map((hit) => hit.y + hit.h));
}

/**
 * Puts items back in the order they were given, which is the order the document keeps them in.
 *
 * @param original - The items as given.
 * @param placed - The same items, moved.
 * @returns The moved items, in the original order.
 */
function inOriginalOrder<T extends GridItem>(
  original: readonly GridItem[],
  placed: readonly T[],
): T[] {
  const byId = new Map(placed.map((one) => [one.id, one]));

  return original.flatMap((one) => {
    const found = byId.get(one.id);

    return found === undefined ? [] : [found];
  });
}

/**
 * Packs items towards the top: each rises until it would overlap another or reach the first row.
 *
 * Items are taken in reading order, so one never rises past another that was above it.
 *
 * @param items - The grid.
 * @returns The packed grid, in the order given.
 */
export function compact<T extends GridItem>(items: readonly T[]): T[] {
  const packed: T[] = [];

  for (const item of [...items].sort(readingOrder)) {
    let y = item.y;

    while (y > 0 && clearRow({ ...item, y: y - 1 }, packed) === null) {
      y -= 1;
    }

    let placed: T = { ...item, y };
    let below = clearRow(placed, packed);

    while (below !== null) {
      placed = { ...placed, y: below };
      below = clearRow(placed, packed);
    }

    packed.push(placed);
  }

  return inOriginalOrder(items, packed);
}

/**
 * Pushes overlapping items apart, then packs them.
 *
 * Items are taken in the order given and each one earlier keeps its place: a later one that
 * overlaps it moves down until it is clear. So the item that should win - the one being dragged -
 * goes first.
 *
 * @param items - The grid, the items that keep their place first.
 * @returns The settled grid, in the order given.
 */
export function settle<T extends GridItem>(items: readonly T[]): T[] {
  const fixed: T[] = [];

  for (const item of items) {
    let placed = item;
    let below = clearRow(placed, fixed);

    while (below !== null) {
      placed = { ...placed, y: below };
      below = clearRow(placed, fixed);
    }

    fixed.push(placed);
  }

  return inOriginalOrder(items, compact(fixed));
}

/**
 * Keeps a column inside the grid for an item of a given width.
 *
 * @param x - The column asked for.
 * @param w - The item's width.
 * @param columns - How many columns the grid has.
 * @returns The nearest column at which the item fits.
 */
function clampColumn(x: number, w: number, columns: number): number {
  return Math.max(0, Math.min(x, columns - Math.min(w, columns)));
}

/**
 * Moves one item to a cell, making room for it.
 *
 * Each item it lands on tries, in turn, to take the place the moved item left, then to step above
 * it, and otherwise is pushed below it; whatever that displaces is pushed down too, and the grid
 * packs.
 *
 * @param items - The grid as it was when the drag began.
 * @param id - The item being moved.
 * @param target - The cell its top-left corner is dropped on.
 * @param columns - How many columns the grid has.
 * @returns The grid with the item moved, in the order given.
 */
export function moveItem<T extends GridItem>(
  items: readonly T[],
  id: string,
  target: GridPoint,
  columns: number,
): T[] {
  const origin = items.find((one) => one.id === id);

  if (origin === undefined) {
    return [...items];
  }

  const moved: T = {
    ...origin,
    x: clampColumn(target.x, origin.w, columns),
    y: Math.max(0, target.y),
  };
  const rest = items.filter((one) => one.id !== id);
  const struck = rest.filter((one) => collides(one, moved)).sort(readingOrder);
  const clear = rest.filter((one) => !collides(one, moved));
  const resolved: T[] = [];
  const pushed: T[] = [];

  for (const hit of struck) {
    const blocking = [moved, ...clear, ...resolved];
    const swapped: T = { ...hit, x: clampColumn(origin.x, hit.w, columns), y: origin.y };
    const above: T = { ...hit, y: moved.y - hit.h };

    if (clearRow(swapped, blocking) === null) {
      resolved.push(swapped);
    } else if (above.y >= 0 && clearRow(above, blocking) === null) {
      resolved.push(above);
    } else {
      pushed.push(hit);
    }
  }

  const others = [...clear, ...pushed].sort(readingOrder);

  return inOriginalOrder(items, settle([moved, ...resolved, ...others]));
}

/**
 * Changes one item's size, pushing down whatever it grows over.
 *
 * An item widened past the last column moves left rather than running off the grid.
 *
 * @param items - The grid.
 * @param id - The item.
 * @param size - Its new size.
 * @param columns - How many columns the grid has.
 * @returns The grid with the item resized, in the order given.
 */
export function resizeItem<T extends GridItem>(
  items: readonly T[],
  id: string,
  size: GridSize,
  columns: number,
): T[] {
  const origin = items.find((one) => one.id === id);

  if (origin === undefined) {
    return [...items];
  }

  const w = Math.min(size.w, columns);
  const resized: T = { ...origin, w, h: size.h, x: clampColumn(origin.x, w, columns) };
  const others = items.filter((one) => one.id !== id).sort(readingOrder);

  return inOriginalOrder(items, settle([resized, ...others]));
}

/**
 * The first cells, reading row by row, where an item of a given size fits.
 *
 * @param items - What is already on the grid.
 * @param w - The item's width.
 * @param h - The item's height.
 * @param columns - How many columns the grid has.
 * @param from - The earliest cell to consider, in reading order.
 * @returns The top-left cell of the first place it fits.
 */
export function firstFit(
  items: readonly GridItem[],
  w: number,
  h: number,
  columns: number,
  from: GridPoint = { x: 0, y: 0 },
): GridPoint {
  const width = Math.min(w, columns);
  const bottom = Math.max(from.y, ...items.map((one) => one.y + one.h));

  for (let y = from.y; y <= bottom; y += 1) {
    for (let x = y === from.y ? from.x : 0; x + width <= columns; x += 1) {
      if (clearRow({ id: '', x, y, w: width, h }, items) === null) {
        return { x, y };
      }
    }
  }

  return { x: 0, y: bottom };
}

/**
 * Adds an item in the first place it fits.
 *
 * @param items - The grid.
 * @param item - The new item. Where it says it sits is ignored; only its size counts.
 * @param columns - How many columns the grid has.
 * @returns The grid with the item added last.
 */
export function insertItem<T extends GridItem>(items: readonly T[], item: T, columns: number): T[] {
  const w = Math.min(item.w, columns);
  const at = firstFit(items, w, item.h, columns);

  return compact([...items, { ...item, w, x: at.x, y: at.y }]);
}

/**
 * Takes an item off the grid and closes the gap it leaves.
 *
 * @param items - The grid.
 * @param id - The item.
 * @returns The grid without it.
 */
export function removeItem<T extends GridItem>(items: readonly T[], id: string): T[] {
  return compact(items.filter((one) => one.id !== id));
}

/**
 * Lays a grid out again on fewer columns, in reading order.
 *
 * Each item keeps its place in the order a page is read, sized down by `clampSize` when it no
 * longer fits. Used for a narrow window and for a container that is made narrower.
 *
 * @param items - The grid.
 * @param columns - How many columns the new grid has.
 * @param clampSize - The size an item takes on the new grid.
 * @returns The grid laid out again, in the order given.
 */
export function reflow<T extends GridItem>(
  items: readonly T[],
  columns: number,
  clampSize: (item: T, columns: number) => GridSize,
): T[] {
  const placed: T[] = [];
  let cursor: GridPoint = { x: 0, y: 0 };

  for (const item of [...items].sort(readingOrder)) {
    const size = clampSize(item, columns);
    const w = Math.min(size.w, columns);
    const at = firstFit(placed, w, size.h, columns, cursor);

    placed.push({ ...item, w, h: size.h, x: at.x, y: at.y });
    cursor = at;
  }

  return inOriginalOrder(items, compact(placed));
}
