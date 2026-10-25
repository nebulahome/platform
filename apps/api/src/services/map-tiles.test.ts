/**
 * The tile cache: files on disk, filled on request and read back when the internet is away.
 *
 * The network is stood in for - a `fetch` that answers from a table - and the disk is a
 * directory made for the run and removed after it.
 */
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UpstreamError } from '@nebulahome/contracts';
import { createLogger } from '@nebulahome/logging';

import { tilesAround } from './map-tile-geometry.js';
import { createMapTileService, type MapTileService } from './map-tiles.js';

/** Somewhere in Milan. */
const LATITUDE = 45.4642;
const LONGITUDE = 9.19;

/** What a tile server answers with: a few bytes that say they are a picture. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let directory: string;
let service: MapTileService;
let fetched: string[];
let upstream: (url: string) => Response | Promise<Response>;

/**
 * A tile server that serves every tile, unless told otherwise.
 *
 * @returns A picture.
 */
function serving(): Response {
  return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'nebula-tiles-'));
  fetched = [];
  upstream = serving;
  service = createMapTileService({
    directory,
    template: 'https://tiles.example/{z}/{x}/{y}.png',
    userAgent: 'NebulaHome/0.0.0 (test)',
    fetch: vi.fn((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const headers = init?.headers as Record<string, string> | undefined;

      fetched.push(`${url} ${String(headers?.['user-agent'])}`);

      return Promise.resolve(upstream(url));
    }),
    logger: createLogger({ service: 'api', version: '0.0.0', level: 'fatal' }),
  });
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

// Each prefetch writes the whole buffer - hundreds of files - to a real folder: seconds on a busy
// disk, so past the default 5 s while the monorepo tests in parallel.
describe('the cache', { timeout: 20_000 }, () => {
  it('has nothing until the buffer is fetched, and reports as much', async () => {
    expect(await service.read({ z: 10, x: 538, y: 372 })).toBeNull();
    expect(await service.status(LATITUDE, LONGITUDE)).toEqual({
      total: tilesAround(LATITUDE, LONGITUDE).length,
      cached: 0,
    });
  });

  it('fetches every tile of the buffer from the template, as itself, and keeps each on disk', async () => {
    const expected = tilesAround(LATITUDE, LONGITUDE);

    const result = await service.prefetch(LATITUDE, LONGITUDE);

    expect(result).toEqual({ total: expected.length, cached: expected.length, failed: 0 });
    expect(fetched).toHaveLength(expected.length);
    expect(fetched[0]).toMatch(
      /^https:\/\/tiles\.example\/10\/\d+\/\d+\.png NebulaHome\/0\.0\.0 \(test\)$/u,
    );

    const first = expected[0];

    expect(first).toBeDefined();

    const file = join(directory, String(first?.z), String(first?.x), `${String(first?.y)}.png`);

    expect((await stat(file)).size).toBe(PNG.length);
    expect(await service.status(LATITUDE, LONGITUDE)).toEqual({
      total: expected.length,
      cached: expected.length,
    });
  });

  it('reads a fetched tile back, so the map draws when the internet is away', async () => {
    await service.prefetch(LATITUDE, LONGITUDE);

    const tile = tilesAround(LATITUDE, LONGITUDE)[0];

    expect(tile).toBeDefined();
    expect(
      Buffer.from(PNG).equals(
        (await service.read(tile ?? { z: 0, x: 0, y: 0 })) ?? Buffer.alloc(0),
      ),
    ).toBe(true);
  });

  it('does not fetch again what is already on disk', async () => {
    await service.prefetch(LATITUDE, LONGITUDE);
    const once = fetched.length;

    await service.prefetch(LATITUDE, LONGITUDE);

    expect(fetched).toHaveLength(once);
  });

  it('counts a tile the server would not give, and carries on with the rest', async () => {
    upstream = (url) => (url.includes('/10/') ? new Response('gone', { status: 404 }) : serving());

    const result = await service.prefetch(LATITUDE, LONGITUDE);
    const zoomTen = tilesAround(LATITUDE, LONGITUDE).filter((tile) => tile.z === 10).length;

    expect(result.failed).toBe(zoomTen);
    expect(result.cached).toBe(result.total - zoomTen);
  });

  it('keeps nothing that is not a picture', async () => {
    upstream = () =>
      new Response('<html>blocked</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });

    const result = await service.prefetch(LATITUDE, LONGITUDE);

    expect(result.cached).toBe(0);
    expect(await readdir(directory)).toEqual([]);
  });
});

describe('passing a tile through', () => {
  it('hands the picture over without keeping it', async () => {
    const bytes = await service.fetchThrough({ z: 3, x: 4, y: 2 });

    expect(Buffer.from(PNG).equals(bytes)).toBe(true);
    expect(await service.read({ z: 3, x: 4, y: 2 })).toBeNull();
  });

  it('says the server is away rather than inventing a tile', async () => {
    upstream = () => {
      throw new TypeError('fetch failed');
    };

    await expect(service.fetchThrough({ z: 3, x: 4, y: 2 })).rejects.toBeInstanceOf(UpstreamError);
  });

  it('says the server refused, with its status, rather than passing the refusal on as a picture', async () => {
    upstream = () => new Response('slow down', { status: 429 });

    await expect(service.fetchThrough({ z: 3, x: 4, y: 2 })).rejects.toThrow(/429/u);
  });
});
