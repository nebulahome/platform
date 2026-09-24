import { describe, expect, it } from 'vitest';

import {
  collides,
  compact,
  firstFit,
  insertItem,
  moveItem,
  reflow,
  removeItem,
  resizeItem,
  settle,
  type GridItem,
} from '@/dashboard/grid-engine';

/**
 * A card on the grid.
 *
 * @param id - Its identifier.
 * @param x - Its column.
 * @param y - Its row.
 * @param w - How many columns it spans.
 * @param h - How many rows it spans.
 * @returns The item.
 */
function item(id: string, x: number, y: number, w = 1, h = 2): GridItem {
  return { id, x, y, w, h };
}

/**
 * Where each item ended up, keyed by id, so an assertion reads as a picture of the grid.
 *
 * @param items - The grid.
 * @returns `id → "x,y wxh"`.
 */
function where(items: readonly GridItem[]): Record<string, string> {
  return Object.fromEntries(
    items.map((one) => [
      one.id,
      `${String(one.x)},${String(one.y)} ${String(one.w)}x${String(one.h)}`,
    ]),
  );
}

describe('collides', () => {
  it('sees two items sharing a cell', () => {
    expect(collides(item('a', 0, 0), item('b', 0, 1))).toBe(true);
  });

  it('lets items touch edge to edge', () => {
    expect(collides(item('a', 0, 0), item('b', 1, 0))).toBe(false);
    expect(collides(item('a', 0, 0), item('b', 0, 2))).toBe(false);
  });

  it('never collides an item with itself', () => {
    expect(collides(item('a', 0, 0), item('a', 0, 0))).toBe(false);
  });
});

describe('compact', () => {
  it('floats everything up until it meets something', () => {
    const packed = compact([item('a', 0, 3), item('b', 1, 5), item('c', 0, 7)]);

    expect(where(packed)).toEqual({ a: '0,0 1x2', b: '1,0 1x2', c: '0,2 1x2' });
  });

  it('keeps the order the items came in', () => {
    const packed = compact([item('late', 0, 9), item('early', 0, 0)]);

    expect(packed.map((one) => one.id)).toEqual(['late', 'early']);
  });

  it('keeps a wide item from rising through a narrow one', () => {
    const packed = compact([item('tall', 1, 0, 1, 3), item('wide', 0, 6, 2, 1)]);

    expect(where(packed)).toEqual({ tall: '1,0 1x3', wide: '0,3 2x1' });
  });
});

describe('moveItem', () => {
  it('swaps two cards of one size, moving down a column', () => {
    const moved = moveItem([item('a', 0, 0), item('b', 0, 2)], 'a', { x: 0, y: 2 }, 4);

    expect(where(moved)).toEqual({ a: '0,2 1x2', b: '0,0 1x2' });
  });

  it('swaps two cards of one size, moving across a row', () => {
    const moved = moveItem([item('a', 0, 0), item('b', 1, 0)], 'a', { x: 1, y: 0 }, 4);

    expect(where(moved)).toEqual({ a: '1,0 1x2', b: '0,0 1x2' });
  });

  it('pushes what is in the way down when nothing can swap', () => {
    const grid = [item('wide', 0, 0, 2, 2), item('a', 2, 0), item('b', 3, 0)];
    const moved = moveItem(grid, 'a', { x: 0, y: 0 }, 4);

    // The wide card cannot go where the tile was, so it goes under it.
    expect(where(moved)).toEqual({ a: '0,0 1x2', wide: '0,2 2x2', b: '3,0 1x2' });
  });

  it('keeps an item inside the columns it has', () => {
    const moved = moveItem([item('wide', 0, 0, 2, 2)], 'wide', { x: 3, y: 0 }, 4);

    expect(where(moved)).toEqual({ wide: '2,0 2x2' });
  });

  it('cannot leave an item hanging below a gap', () => {
    const moved = moveItem([item('a', 0, 0)], 'a', { x: 0, y: 6 }, 4);

    expect(where(moved)).toEqual({ a: '0,0 1x2' });
  });

  it('answers the same from the same start, wherever the drag passed through', () => {
    const start = [item('a', 0, 0), item('b', 1, 0), item('c', 2, 0)];
    const direct = moveItem(start, 'a', { x: 2, y: 0 }, 4);

    // A preview is always worked out from where the drag began, never from the last preview.
    moveItem(start, 'a', { x: 1, y: 0 }, 4);

    expect(moveItem(start, 'a', { x: 2, y: 0 }, 4)).toEqual(direct);
  });

  it('leaves the grid alone for an id it does not hold', () => {
    const grid = [item('a', 0, 0)];

    expect(moveItem(grid, 'ghost', { x: 1, y: 0 }, 4)).toEqual(grid);
  });
});

describe('resizeItem', () => {
  it('pushes the card below further down as it grows', () => {
    const grown = resizeItem([item('a', 0, 0), item('b', 0, 2)], 'a', { w: 1, h: 3 }, 4);

    expect(where(grown)).toEqual({ a: '0,0 1x3', b: '0,3 1x2' });
  });

  it('pushes the card beside it down as it widens', () => {
    const grown = resizeItem([item('a', 0, 0), item('b', 1, 0)], 'a', { w: 2, h: 2 }, 4);

    expect(where(grown)).toEqual({ a: '0,0 2x2', b: '1,2 1x2' });
  });

  it('moves left rather than running past the last column', () => {
    const grown = resizeItem([item('a', 3, 0)], 'a', { w: 2, h: 2 }, 4);

    expect(where(grown)).toEqual({ a: '2,0 2x2' });
  });

  it('lets what was below rise as it shrinks', () => {
    const shrunk = resizeItem([item('a', 0, 0, 1, 3), item('b', 0, 3)], 'a', { w: 1, h: 1 }, 4);

    expect(where(shrunk)).toEqual({ a: '0,0 1x1', b: '0,1 1x2' });
  });
});

describe('firstFit', () => {
  it('finds the first free cells, reading row by row', () => {
    const grid = [item('a', 0, 0), item('b', 1, 0), item('c', 2, 0)];

    expect(firstFit(grid, 1, 2, 4)).toEqual({ x: 3, y: 0 });
    expect(firstFit(grid, 2, 1, 4)).toEqual({ x: 0, y: 2 });
  });

  it('starts no earlier than where it is told', () => {
    expect(firstFit([], 1, 1, 4, { x: 2, y: 1 })).toEqual({ x: 2, y: 1 });
  });
});

describe('insertItem', () => {
  it('puts a new card in the first place it fits', () => {
    const added = insertItem([item('a', 0, 0, 2, 2)], item('b', 0, 9), 4);

    expect(where(added)).toEqual({ a: '0,0 2x2', b: '2,0 1x2' });
  });
});

describe('removeItem', () => {
  it('closes the gap it leaves', () => {
    const left = removeItem([item('a', 0, 0), item('b', 0, 2)], 'a');

    expect(where(left)).toEqual({ b: '0,0 1x2' });
  });
});

describe('settle', () => {
  it('pushes overlapping items apart and packs them, the first ones keeping their place', () => {
    const settled = settle([item('big', 0, 0, 4, 3), item('a', 0, 1), item('b', 2, 0)]);

    expect(where(settled)).toEqual({ big: '0,0 4x3', a: '0,3 1x2', b: '2,3 1x2' });
  });
});

describe('reflow', () => {
  it('lays a four-column page out in two columns, in reading order', () => {
    const page = [item('a', 0, 0), item('b', 1, 0), item('c', 2, 0, 2, 2), item('d', 0, 2, 1, 1)];
    const narrow = reflow(page, 2, (one, columns) => ({ w: Math.min(one.w, columns), h: one.h }));

    expect(where(narrow)).toEqual({ a: '0,0 1x2', b: '1,0 1x2', c: '0,2 2x2', d: '0,4 1x1' });
  });

  it('narrows what is too wide the way it is told to', () => {
    const narrow = reflow([item('wide', 0, 0, 4, 1)], 2, () => ({ w: 2, h: 2 }));

    expect(where(narrow)).toEqual({ wide: '0,0 2x2' });
  });
});
