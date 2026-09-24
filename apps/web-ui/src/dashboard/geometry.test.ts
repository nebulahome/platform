import { describe, expect, it } from 'vitest';

import { boxOf, cellAt, columnWidth, dropPlace, rowsHeight, spanOf } from '@/dashboard/geometry';

describe('the grid in pixels', () => {
  // Four columns across 1000 pixels: 3 gaps of 16, so each column is 238.
  const column = columnWidth(1000, 4);

  it('shares the width between the columns, after the gaps', () => {
    expect(column).toBe(238);
  });

  it('draws a tile a row tall and a card two rows and a gap tall', () => {
    expect(rowsHeight(1)).toBe(100);
    expect(rowsHeight(2)).toBe(216);
    expect(rowsHeight(3)).toBe(332);
  });

  it('places a card by its cells', () => {
    expect(boxOf({ x: 1, y: 2, w: 2, h: 2 }, column)).toEqual({
      left: 254,
      top: 232,
      width: 492,
      height: 216,
    });
  });

  it('finds the nearest cell to a point, and no cell before the first', () => {
    expect(cellAt(254, 232, column)).toEqual({ x: 1, y: 2 });
    expect(cellAt(390, 280, column)).toEqual({ x: 2, y: 2 });
    expect(cellAt(-90, -40, column)).toEqual({ x: 0, y: 0 });
  });

  it('measures a dragged corner in whole cells', () => {
    expect(spanOf(492, 216, column)).toEqual({ w: 2, h: 2 });
    expect(spanOf(300, 120, column)).toEqual({ w: 1, h: 1 });
    expect(spanOf(10, 10, column)).toEqual({ w: 1, h: 1 });
  });
});

describe('dropPlace', () => {
  // A 1000-pixel page: columns of 238. A container across the page at row 2, three rows tall.
  const page = [
    { id: 'light', x: 0, y: 0, w: 1, h: 2, isContainer: false },
    { id: 'group', x: 0, y: 2, w: 4, h: 3, isContainer: true },
  ];
  const carried = { id: 'light', isContainer: false };
  const corner = { x: 0, y: 0 };

  it('puts a card on the page where the pointer is', () => {
    expect(dropPlace(page, carried, { x: 260, y: 10 }, corner, 1000, 4)).toEqual({
      parentId: null,
      x: 1,
      y: 0,
    });
  });

  it('puts a card into a container when the pointer is over its cards', () => {
    // The container's cards start 104 pixels under its top (232) and 12 in from its left.
    expect(dropPlace(page, carried, { x: 12 + 250, y: 232 + 104 + 5 }, corner, 1000, 4)).toEqual({
      parentId: 'group',
      x: 1,
      y: 0,
    });
  });

  it('leaves a card on the page over the container heading', () => {
    expect(dropPlace(page, carried, { x: 300, y: 250 }, corner, 1000, 4).parentId).toBeNull();
  });

  it('never puts a container into a container', () => {
    const box = { id: 'other', isContainer: true };

    expect(dropPlace(page, box, { x: 262, y: 341 }, corner, 1000, 4).parentId).toBeNull();
  });
});
