import { describe, expect, it } from 'vitest';

import {
  isTileInRange,
  TILE_ZOOM_MAXIMUM,
  TILE_ZOOM_MINIMUM,
  tileFor,
  tilesAround,
} from './map-tile-geometry.js';

describe('tileFor', () => {
  it('puts the equator and the meridian in the middle of the world', () => {
    expect(tileFor(0, 0, 0)).toEqual({ z: 0, x: 0, y: 0 });
    expect(tileFor(0, 0, 1)).toEqual({ z: 1, x: 1, y: 1 });
  });

  it('puts the top-left corner of the map at the first tile, and the bottom-right at the last', () => {
    expect(tileFor(85.0511, -180, 2)).toEqual({ z: 2, x: 0, y: 0 });
    expect(tileFor(-85.0511, 179.999, 2)).toEqual({ z: 2, x: 3, y: 3 });
  });

  it('lands on the tile every slippy map gives a place', () => {
    // Rome, as the standard formula has it at zoom ten.
    expect(tileFor(41.9028, 12.4964, 10)).toEqual({ z: 10, x: 547, y: 380 });
  });

  it('keeps a latitude past the poles on the map rather than off it', () => {
    expect(tileFor(89, 0, 3).y).toBe(0);
    expect(tileFor(-89, 0, 3).y).toBe(7);
  });
});

describe('tilesAround', () => {
  it('covers every zoom from the town to the street, and no closer', () => {
    const zooms = new Set(tilesAround(45.4642, 9.19).map((tile) => tile.z));

    expect([...zooms].sort((a, b) => a - b)).toEqual(
      Array.from({ length: TILE_ZOOM_MAXIMUM - TILE_ZOOM_MINIMUM + 1 }, (nothing, i) => i + 10),
    );
    expect(TILE_ZOOM_MAXIMUM).toBe(17);
  });

  it('always holds the tile the house is on, at every zoom', () => {
    const tiles = tilesAround(45.4642, 9.19);

    for (let z = TILE_ZOOM_MINIMUM; z <= TILE_ZOOM_MAXIMUM; z += 1) {
      const centre = tileFor(45.4642, 9.19, z);

      expect(tiles.some((tile) => tile.z === z && tile.x === centre.x && tile.y === centre.y)).toBe(
        true,
      );
    }
  });

  it('stays within what the tile servers allow for offline use, even far north', () => {
    // Tiles narrow towards the poles, so a kilometre is more of them; the cap holds anyway. The
    // servers' rule is about the street-level zooms: no more than two hundred and fifty tiles
    // at seventeen and beyond, and the buffer never goes beyond seventeen.
    for (const latitude of [0, 45.4642, 69.65, 78.2]) {
      const tiles = tilesAround(latitude, 18.95);
      const byZoom = new Map<number, number>();

      for (const tile of tiles) {
        byZoom.set(tile.z, (byZoom.get(tile.z) ?? 0) + 1);
      }

      for (const count of byZoom.values()) {
        expect(count).toBeLessThanOrEqual(121);
      }
      expect(byZoom.get(17) ?? 0).toBeLessThanOrEqual(250);
      expect(tiles.length).toBeLessThanOrEqual(320);
    }
  });

  it('lists each tile once', () => {
    const tiles = tilesAround(45.4642, 9.19);
    const keys = new Set(
      tiles.map((tile) => `${String(tile.z)}/${String(tile.x)}/${String(tile.y)}`),
    );

    expect(keys.size).toBe(tiles.length);
  });
});

describe('isTileInRange', () => {
  it('accepts a tile inside the world at its zoom and refuses one outside it', () => {
    expect(isTileInRange({ z: 3, x: 7, y: 7 })).toBe(true);
    expect(isTileInRange({ z: 3, x: 8, y: 0 })).toBe(false);
    expect(isTileInRange({ z: 3, x: 0, y: -1 })).toBe(false);
    expect(isTileInRange({ z: 20, x: 0, y: 0 })).toBe(false);
  });
});
