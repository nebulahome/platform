import { describe, expect, it } from 'vitest';

import {
  clampRect,
  freeStretch,
  MIN_SIZE,
  overlaps,
  spotAt,
  spotRect,
  tabsLayout,
} from '@/app-windows/geometry';

/** A page box beside the shut sidebar on a 1440 x 900 screen. */
const BOUNDS = { width: 1360, height: 900 };

describe('spotRect', () => {
  it('lays Large 16 px off every edge', () => {
    expect(spotRect('large', BOUNDS, false)).toEqual({ x: 16, y: 16, width: 1328, height: 868 });
  });

  it('keeps 44 px off the right edge while the rail has something on it', () => {
    const large = spotRect('large', BOUNDS, true);

    expect(large.x + large.width).toBe(1360 - 32 - 12);
  });

  it('splits the halves and the quarters with a 16 px gap and no lost pixel', () => {
    const left = spotRect('left', BOUNDS, false);
    const right = spotRect('right', BOUNDS, false);
    const bottomRight = spotRect('bottom-right', BOUNDS, false);

    expect(right.x - (left.x + left.width)).toBe(16);
    expect(right.x + right.width).toBe(1344);
    expect(bottomRight.y + bottomRight.height).toBe(884);
    expect(spotRect('top-left', BOUNDS, false).height + 16 + bottomRight.height).toBe(868);
  });
});

describe('spotAt', () => {
  it('finds Large at the top edge, the halves at the sides and nothing at the bottom', () => {
    expect(spotAt({ x: 600, y: 4 }, BOUNDS)).toBe('large');
    expect(spotAt({ x: -30, y: 450 }, BOUNDS)).toBe('left');
    expect(spotAt({ x: 1350, y: 450 }, BOUNDS)).toBe('right');
    expect(spotAt({ x: 600, y: 896 }, BOUNDS)).toBeNull();
    expect(spotAt({ x: 600, y: 450 }, BOUNDS)).toBeNull();
  });

  it('finds the quarters near the corners, from either edge', () => {
    expect(spotAt({ x: 10, y: 40 }, BOUNDS)).toBe('top-left');
    expect(spotAt({ x: 40, y: 10 }, BOUNDS)).toBe('top-left');
    expect(spotAt({ x: 1355, y: 880 }, BOUNDS)).toBe('bottom-right');
    expect(spotAt({ x: 1320, y: 896 }, BOUNDS)).toBe('bottom-right');
    expect(spotAt({ x: 1355, y: 20 }, BOUNDS)).toBe('top-right');
  });
});

describe('clampRect', () => {
  it('keeps a free window inside and no smaller than the least size', () => {
    expect(clampRect({ x: 1200, y: -40, width: 100, height: 100 }, BOUNDS, false)).toEqual({
      x: 1360 - MIN_SIZE.width,
      y: 0,
      width: MIN_SIZE.width,
      height: MIN_SIZE.height,
    });
  });

  it('keeps it off a busy rail and shrinks it into a small layer', () => {
    const rect = clampRect({ x: 900, y: 0, width: 600, height: 2000 }, BOUNDS, true);

    expect(rect.x + rect.width).toBeLessThanOrEqual(1360 - 44);
    expect(rect.height).toBe(900);
  });
});

describe('freeStretch', () => {
  it('is the whole edge, inset, with nothing on it', () => {
    expect(freeStretch(900, [])).toEqual({ top: 24, bottom: 876 });
  });

  it('keeps 12 px clear of a player in the bottom-right corner', () => {
    expect(freeStretch(900, [{ top: 706, bottom: 876 }])).toEqual({ top: 24, bottom: 694 });
  });

  it('takes the longer side when players hold both ends, and the gap between toasts and a player', () => {
    expect(
      freeStretch(900, [
        { top: 24, bottom: 194 },
        { top: 706, bottom: 876 },
      ]),
    ).toEqual({ top: 206, bottom: 694 });
    expect(
      freeStretch(900, [
        { top: 24, bottom: 400 },
        { top: 640, bottom: 900 },
      ]),
    ).toEqual({ top: 412, bottom: 628 });
  });
});

describe('tabsLayout', () => {
  it('centres the tabs in the stretch', () => {
    expect(tabsLayout(2, { top: 24, bottom: 876 })).toEqual({ tops: [394, 454], height: 52 });
  });

  it('squeezes them to 40 px, and no less, when they do not fit', () => {
    expect(tabsLayout(5, { top: 0, bottom: 250 }).height).toBe(43);
    expect(tabsLayout(5, { top: 0, bottom: 100 }).height).toBe(40);
  });
});

describe('overlaps', () => {
  it('says whether two rectangles share area, edges not counting', () => {
    const a = { x: 0, y: 0, width: 100, height: 100 };

    expect(overlaps(a, { x: 99, y: 99, width: 10, height: 10 })).toBe(true);
    expect(overlaps(a, { x: 100, y: 0, width: 10, height: 10 })).toBe(false);
  });
});
