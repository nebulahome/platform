/**
 * The map around the house, kept on disk for the days the internet is away.
 *
 * The browser never talks to a tile server. It asks this service for a tile, and the service
 * answers from disk when the tile is there and from the tile server when it is not - passing
 * the picture through without keeping it. What is kept is the buffer around the house, and only
 * when asked: once the house has been placed, a prefetch walks every tile of the buffer, fetches
 * the ones missing and writes each beside the others. That is the whole cache, and it is files
 * rather than rows because a tile is a picture nobody queries, and a directory of pictures is
 * what a person can look at, back up and delete without a tool.
 *
 * The tile server is somebody else's, and the service behaves as a guest: it says who it is in
 * every request, takes nothing beyond the buffer the geometry bounds, and fetches a few tiles at
 * a time rather than all at once. A tile that fails is counted and passed over, so that one
 * missing picture does not stop the other two hundred from arriving.
 *
 * Files are written whole: to a temporary name first and renamed into place, so that a read
 * never sees half a picture and a crash leaves at worst a stray temporary file.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  UpstreamError,
  type TileCacheStatus,
  type TilePrefetchResult,
} from '@nebula-home/contracts';
import type { PlatformLogger } from '@nebula-home/logging';

import { tilesAround, type Tile } from './map-tile-geometry.js';

/** How long one tile may take to arrive. */
const TILE_TIMEOUT_MS = 10_000;

/** How many tiles are fetched at once during a prefetch. */
const PREFETCH_CONCURRENCY = 4;

/** The largest tile accepted: a real one is a few tens of kilobytes. */
const TILE_MAXIMUM_BYTES = 1_048_576;

/** What the service needs. */
export type MapTileServiceOptions = {
  /** Where the tiles are kept, as `<directory>/<z>/<x>/<y>.png`. */
  readonly directory: string;

  /** The tile server's address, with `{z}`, `{x}` and `{y}` where the tile goes. */
  readonly template: string;

  /** Who the service says it is to the tile server. */
  readonly userAgent: string;

  /** How it reaches the tile server. */
  readonly fetch: typeof globalThis.fetch;
  readonly logger: PlatformLogger;
};

/** What the routes ask of the cache. */
export type MapTileService = {
  /**
   * Reads a tile from disk.
   *
   * @param tile - Which tile.
   * @returns The picture, or null when it is not on disk.
   */
  readonly read: (tile: Tile) => Promise<Buffer | null>;

  /**
   * Fetches a tile from the tile server, without keeping it.
   *
   * @param tile - Which tile.
   * @returns The picture.
   * @throws {UpstreamError} When the server cannot be reached, refuses, or answers with
   * something that is not a picture.
   */
  readonly fetchThrough: (tile: Tile) => Promise<Buffer>;

  /**
   * Says how much of the buffer around a place is on disk.
   *
   * @param latitude - Where the house stands.
   * @param longitude - Where the house stands.
   * @returns The tiles the buffer is made of, and how many are here.
   */
  readonly status: (latitude: number, longitude: number) => Promise<TileCacheStatus>;

  /**
   * Fetches what the buffer around a place is missing.
   *
   * @param latitude - Where the house stands.
   * @param longitude - Where the house stands.
   * @returns How many tiles the buffer has, how many are on disk now, how many could not be had.
   */
  readonly prefetch: (latitude: number, longitude: number) => Promise<TilePrefetchResult>;
};

/**
 * Whether a file is there.
 *
 * @param path - The file.
 * @returns True when it is.
 */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);

    return true;
  } catch {
    return false;
  }
}

/**
 * Runs a job over every item, a few at a time.
 *
 * @param items - What to work through.
 * @param concurrency - How many at once.
 * @param job - What to do with each.
 */
async function forEachConcurrently<T>(
  items: readonly T[],
  concurrency: number,
  job: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;

  /** Takes items until there are none left. */
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next];

      next += 1;

      if (item !== undefined) {
        // One after another on purpose: this worker is one lane of a few, and the loop is
        // what keeps the lane from taking every tile at once.
        // eslint-disable-next-line no-await-in-loop -- see above
        await job(item);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

/**
 * The cache over a directory.
 *
 * @param options - See {@link MapTileServiceOptions}.
 * @returns The service.
 */
export function createMapTileService(options: MapTileServiceOptions): MapTileService {
  const { directory, template, userAgent, logger } = options;

  /**
   * Where a tile lives on disk.
   *
   * @param tile - Which tile.
   * @returns The file.
   */
  const pathOf = (tile: Tile): string =>
    join(directory, String(tile.z), String(tile.x), `${String(tile.y)}.png`);

  /**
   * Where a tile lives on the tile server.
   *
   * @param tile - Which tile.
   * @returns The address.
   */
  const urlOf = (tile: Tile): string =>
    template
      .replace('{z}', String(tile.z))
      .replace('{x}', String(tile.x))
      .replace('{y}', String(tile.y));

  /**
   * Fetches a tile from the tile server, without keeping it.
   *
   * @param tile - Which tile.
   * @returns The picture.
   * @throws {UpstreamError} When the server cannot be reached, refuses, or answers with
   * something that is not a picture.
   */
  const fetchThrough = async (tile: Tile): Promise<Buffer> => {
    const url = urlOf(tile);
    let response: Response;

    try {
      response = await options.fetch(url, {
        headers: { 'user-agent': userAgent, accept: 'image/png,image/*' },
        signal: AbortSignal.timeout(TILE_TIMEOUT_MS),
      });
    } catch (error: unknown) {
      throw new UpstreamError('The map server could not be reached', {
        cause: error,
        details: { tile },
      });
    }

    if (!response.ok) {
      throw new UpstreamError(`The map server answered ${String(response.status)}`, {
        details: { tile, status: response.status },
      });
    }

    if (!(response.headers.get('content-type') ?? '').startsWith('image/')) {
      throw new UpstreamError('The map server answered with something that is not a picture', {
        details: { tile, contentType: response.headers.get('content-type') },
      });
    }

    const bytes = Buffer.from(await response.arrayBuffer());

    if (bytes.length > TILE_MAXIMUM_BYTES) {
      throw new UpstreamError('The map server answered with more than a tile', {
        details: { tile, bytes: bytes.length },
      });
    }

    return bytes;
  };

  /**
   * Writes a tile whole: to a temporary name, then into place.
   *
   * @param tile - Which tile.
   * @param bytes - The picture.
   */
  const keep = async (tile: Tile, bytes: Buffer): Promise<void> => {
    const path = pathOf(tile);
    const temporary = `${path}.${randomBytes(4).toString('hex')}.tmp`;

    await mkdir(join(directory, String(tile.z), String(tile.x)), { recursive: true });
    await writeFile(temporary, bytes);

    try {
      await rename(temporary, path);
    } catch (error: unknown) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  };

  return {
    /**
     * Reads a tile from disk.
     *
     * @param tile - Which tile.
     * @returns The picture, or null when it is not on disk.
     */
    read: async (tile): Promise<Buffer | null> => {
      try {
        return await readFile(pathOf(tile));
      } catch {
        return null;
      }
    },

    fetchThrough,

    /**
     * Says how much of the buffer around a place is on disk.
     *
     * @param latitude - Where the house stands.
     * @param longitude - Where the house stands.
     * @returns The tiles the buffer is made of, and how many are here.
     */
    status: async (latitude, longitude): Promise<TileCacheStatus> => {
      const tiles = tilesAround(latitude, longitude);
      const present = await Promise.all(tiles.map((tile) => exists(pathOf(tile))));

      return { total: tiles.length, cached: present.filter(Boolean).length };
    },

    /**
     * Fetches what the buffer around a place is missing.
     *
     * @param latitude - Where the house stands.
     * @param longitude - Where the house stands.
     * @returns How many tiles the buffer has, how many are on disk now, how many could not be had.
     */
    prefetch: async (latitude, longitude): Promise<TilePrefetchResult> => {
      const tiles = tilesAround(latitude, longitude);
      let cached = 0;
      let failed = 0;

      await forEachConcurrently(tiles, PREFETCH_CONCURRENCY, async (tile) => {
        if (await exists(pathOf(tile))) {
          cached += 1;

          return;
        }

        try {
          await keep(tile, await fetchThrough(tile));
          cached += 1;
        } catch (error: unknown) {
          failed += 1;
          logger.warn(
            { err: error, tile },
            'A tile of the map around the house could not be fetched',
          );
        }
      });

      logger.info({ total: tiles.length, cached, failed }, 'The map around the house was fetched');

      return { total: tiles.length, cached, failed };
    },
  };
}
