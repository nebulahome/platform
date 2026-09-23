/**
 * A tile cache with no disk and no tile server behind it, for the route tests.
 *
 * What it holds is set by the test; what it fetches is a fixed picture, unless the test has
 * taken the server away.
 */
import { UpstreamError } from '@nebula-home/contracts';

import { tilesAround, type Tile } from '../services/map-tile-geometry.js';
import type { MapTileService } from '../services/map-tiles.js';

/** What the stand-in serves as a tile. */
export const FAKE_TILE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The tiles on the stand-in's "disk", by `z/x/y`. */
export const cachedTiles = new Set<string>();

/** Whether the stand-in's tile server answers. Tests flip it. */
export let isMapServerUp = true;

/**
 * Takes the tile server away, or brings it back.
 *
 * @param isUp - Whether it answers.
 */
export function setMapServerUp(isUp: boolean): void {
  isMapServerUp = isUp;
}

/**
 * The key a tile is kept under.
 *
 * @param tile - Which tile.
 * @returns `z/x/y`.
 */
function keyOf(tile: Tile): string {
  return `${String(tile.z)}/${String(tile.x)}/${String(tile.y)}`;
}

/**
 * The stand-in.
 *
 * @returns Something the routes can call as the cache.
 */
export function testMapTiles(): MapTileService {
  return {
    /**
     * Reads a tile from the stand-in's disk.
     *
     * @param tile - Which tile.
     * @returns The picture, or null when the test has not put it there.
     */
    read: (tile): Promise<Buffer | null> =>
      Promise.resolve(cachedTiles.has(keyOf(tile)) ? FAKE_TILE : null),

    /**
     * Fetches a tile from the stand-in's server.
     *
     * @param tile - Which tile.
     * @returns The picture, when the server is up.
     */
    fetchThrough: (tile): Promise<Buffer> => {
      if (!isMapServerUp) {
        return Promise.reject(
          new UpstreamError('The map server could not be reached', { details: { tile } }),
        );
      }

      return Promise.resolve(FAKE_TILE);
    },

    /**
     * Counts the buffer's tiles the test has put on disk.
     *
     * @param latitude - Where the house stands.
     * @param longitude - Where the house stands.
     * @returns The buffer's size, and how much of it is there.
     */
    status: (latitude, longitude): Promise<{ total: number; cached: number }> => {
      const tiles = tilesAround(latitude, longitude);

      return Promise.resolve({
        total: tiles.length,
        cached: tiles.filter((tile) => cachedTiles.has(keyOf(tile))).length,
      });
    },

    /**
     * Puts the whole buffer on the stand-in's disk, or none of it when the server is away.
     *
     * @param latitude - Where the house stands.
     * @param longitude - Where the house stands.
     * @returns What a real prefetch would have said.
     */
    prefetch: (latitude, longitude): Promise<{ total: number; cached: number; failed: number }> => {
      const tiles = tilesAround(latitude, longitude);

      if (!isMapServerUp) {
        return Promise.resolve({ total: tiles.length, cached: 0, failed: tiles.length });
      }

      for (const tile of tiles) {
        cachedTiles.add(keyOf(tile));
      }

      return Promise.resolve({ total: tiles.length, cached: tiles.length, failed: 0 });
    },
  };
}
