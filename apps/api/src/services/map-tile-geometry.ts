/**
 * Where a place falls on a slippy map, and which tiles make up the map around the house.
 *
 * The map is the Web Mercator one every tile server draws: at zoom `z` the world is a square of
 * `2^z` tiles a side, `x` counting east from the antimeridian and `y` south from the top edge
 * at 85.05°. The arithmetic is the standard one and nothing here is clever; what is worth
 * keeping in one place is the shape of the buffer, because the tile servers say how much may
 * be taken for offline use and the buffer has to stay inside that.
 *
 * The buffer runs from zoom ten, where a tile is a town, to seventeen, where it is a street.
 * Zoom eighteen and beyond is where the servers ask that nothing be taken in bulk, and a house
 * needs no closer. Close in, the buffer is a kilometre each way; far out, where a kilometre is
 * a corner of one tile, it is the three-by-three block around the house's tile instead, so that
 * the map has somewhere to be when it is zoomed out. Each zoom is capped at a few tiles a side,
 * more the closer in: near the poles a kilometre is many tiles, and the caps are what keep the
 * street zoom under the two hundred and fifty the servers name and the whole buffer around
 * three hundred at worst, two hundred where people live.
 */

/** One tile, by its zoom and its column and row at that zoom. */
export type Tile = {
  readonly z: number;
  readonly x: number;
  readonly y: number;
};

/** The zoom the buffer starts at: a tile is a town. */
export const TILE_ZOOM_MINIMUM = 10;

/** The zoom the buffer stops at: a tile is a street. Beyond it the servers ask for restraint. */
export const TILE_ZOOM_MAXIMUM = 17;

/** The deepest zoom the tile route serves at all. */
export const TILE_ZOOM_SERVED_MAXIMUM = 19;

/** How far from the house the buffer reaches, close in. */
const BUFFER_RADIUS_METRES = 1000;

/** The zoom from which the buffer is measured in metres rather than in tiles. */
const METRIC_FROM_ZOOM = 14;

/** How many tiles a side the buffer may be, by zoom; the block of three below the metric zooms. */
const TILES_PER_SIDE_MAXIMUM: Readonly<Record<number, number>> = { 14: 5, 15: 7, 16: 9, 17: 11 };

/** The latitude past which the projection has nothing to draw. */
const LATITUDE_LIMIT = 85.0511;

/** Metres in a degree of latitude, near enough everywhere. */
const METRES_PER_DEGREE = 111_320;

/**
 * Keeps a latitude on the map.
 *
 * @param latitude - In degrees.
 * @returns The latitude, no nearer a pole than the projection allows.
 */
function clampLatitude(latitude: number): number {
  return Math.min(LATITUDE_LIMIT, Math.max(-LATITUDE_LIMIT, latitude));
}

/**
 * The tile a place falls on.
 *
 * @param latitude - In degrees.
 * @param longitude - In degrees.
 * @param z - The zoom.
 * @returns The tile.
 */
export function tileFor(latitude: number, longitude: number, z: number): Tile {
  const side = 2 ** z;
  const radians = (clampLatitude(latitude) * Math.PI) / 180;
  const x = Math.floor(((longitude + 180) / 360) * side);
  const y = Math.floor(
    ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * side,
  );

  return {
    z,
    x: Math.min(side - 1, Math.max(0, x)),
    y: Math.min(side - 1, Math.max(0, y)),
  };
}

/**
 * Whether a tile exists at its zoom, within what the route serves.
 *
 * @param tile - The tile asked for.
 * @returns True when it is on the map.
 */
export function isTileInRange(tile: Tile): boolean {
  if (!Number.isInteger(tile.z) || tile.z < 0 || tile.z > TILE_ZOOM_SERVED_MAXIMUM) {
    return false;
  }

  const side = 2 ** tile.z;

  return (
    Number.isInteger(tile.x) &&
    Number.isInteger(tile.y) &&
    tile.x >= 0 &&
    tile.x < side &&
    tile.y >= 0 &&
    tile.y < side
  );
}

/**
 * A run of tile indices centred on one, no wider than the cap and no further than the edges.
 *
 * @param from - The first index wanted.
 * @param to - The last index wanted.
 * @param centre - The index the house is on, kept whatever the cap trims.
 * @param side - How many tiles the map is at this zoom.
 * @param cap - How many tiles the run may be.
 * @returns The indices, in order.
 */
function span(from: number, to: number, centre: number, side: number, cap: number): number[] {
  const half = Math.floor(cap / 2);
  const first = Math.max(0, Math.max(from, centre - half));
  const last = Math.min(side - 1, Math.min(to, centre + half));

  return Array.from({ length: last - first + 1 }, (nothing, index) => first + index);
}

/**
 * The tiles that make up the map around the house.
 *
 * @param latitude - Where the house stands, in degrees.
 * @param longitude - Where the house stands, in degrees.
 * @returns Every tile of the buffer, zoomed-out first, each once.
 */
export function tilesAround(latitude: number, longitude: number): Tile[] {
  const tiles: Tile[] = [];
  const north = clampLatitude(latitude + BUFFER_RADIUS_METRES / METRES_PER_DEGREE);
  const south = clampLatitude(latitude - BUFFER_RADIUS_METRES / METRES_PER_DEGREE);
  const metresPerDegreeOfLongitude =
    METRES_PER_DEGREE * Math.cos((clampLatitude(latitude) * Math.PI) / 180);
  const west = Math.max(-180, longitude - BUFFER_RADIUS_METRES / metresPerDegreeOfLongitude);
  const east = Math.min(180, longitude + BUFFER_RADIUS_METRES / metresPerDegreeOfLongitude);

  for (let z = TILE_ZOOM_MINIMUM; z <= TILE_ZOOM_MAXIMUM; z += 1) {
    const side = 2 ** z;
    const centre = tileFor(latitude, longitude, z);
    const isMetric = z >= METRIC_FROM_ZOOM;
    const cap = TILES_PER_SIDE_MAXIMUM[z] ?? 3;
    const columns = isMetric
      ? span(tileFor(latitude, west, z).x, tileFor(latitude, east, z).x, centre.x, side, cap)
      : span(centre.x - 1, centre.x + 1, centre.x, side, cap);
    const rows = isMetric
      ? span(tileFor(north, longitude, z).y, tileFor(south, longitude, z).y, centre.y, side, cap)
      : span(centre.y - 1, centre.y + 1, centre.y, side, cap);

    for (const y of rows) {
      for (const x of columns) {
        tiles.push({ z, x, y });
      }
    }
  }

  return tiles;
}
