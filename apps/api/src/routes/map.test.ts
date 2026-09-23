/**
 * The tile route: what the browser's map asks for, one picture at a time.
 *
 * The cache and the tile server are stood in for. What is checked is who may ask, what a tile
 * address must look like, and that a picture on disk comes from disk while one that is not
 * comes through the server - or does not, when the server is away.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { bearer, buildTestServer, emptyDatabase, stopHub } from '../testing/hub-harness.js';
import { cachedTiles, FAKE_TILE, setMapServerUp } from '../testing/map-tiles.js';

let server: FastifyInstance;

beforeAll(async () => {
  server = await buildTestServer(true, emptyDatabase());
});

afterAll(async () => {
  stopHub();
  await server.close();
});

beforeEach(() => {
  cachedTiles.clear();
  setMapServerUp(true);
});

describe('a tile', () => {
  it('needs area:read', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/map/tiles/3/4/2',
      headers: { authorization: await bearer('entity:read') },
    });

    expect(response.statusCode).toBe(403);
  });

  it('comes from disk when it is there, as a picture the browser may keep for a while', async () => {
    cachedTiles.add('3/4/2');

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/map/tiles/3/4/2',
      headers: { authorization: await bearer('area:read') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['cache-control']).toContain('max-age');
    expect(response.rawPayload.equals(FAKE_TILE)).toBe(true);
  });

  it('comes through the tile server when it is not on disk, and is not kept', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/map/tiles/3/4/2',
      headers: { authorization: await bearer('area:read') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.rawPayload.equals(FAKE_TILE)).toBe(true);
    expect(cachedTiles.has('3/4/2')).toBe(false);
  });

  it('says the server is away, in the usual envelope, rather than a broken picture', async () => {
    setMapServerUp(false);

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/map/tiles/3/4/2',
      headers: { authorization: await bearer('area:read') },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { code: 'UPSTREAM' } });
  });

  it('refuses an address off the map, or not an address at all', async () => {
    for (const url of [
      '/api/v1/map/tiles/3/8/0',
      '/api/v1/map/tiles/3/0/-1',
      '/api/v1/map/tiles/20/0/0',
      '/api/v1/map/tiles/3/four/2',
      '/api/v1/map/tiles/3/4.5/2',
    ]) {
      const response = await server.inject({
        method: 'GET',
        url,
        headers: { authorization: await bearer('area:read') },
      });

      expect(response.statusCode, url).toBe(400);
    }
  });
});

describe('the tile budget', () => {
  it('is its own, larger than the one every other route shares, and still a ceiling', async () => {
    // Last in the file: it spends the budget. The shared one is 300 a minute; a map being
    // panned goes past that, and a script walking the tile server must not get further.
    cachedTiles.add('3/4/2');

    const authorization = await bearer('area:read');
    let firstRefusal: number | undefined;

    for (let count = 1; count <= 1300 && firstRefusal === undefined; count += 1) {
      // One after another on purpose: the budget counts requests as they arrive.
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/map/tiles/3/4/2',
        headers: { authorization },
      });

      if (response.statusCode === 429) {
        firstRefusal = count;
      }
    }

    expect(firstRefusal).toBeGreaterThan(1000);
    expect(firstRefusal).toBeLessThanOrEqual(1201);
  });
});
