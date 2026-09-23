/**
 * The area routes against a database that answers nothing.
 *
 * What is checked before a row is touched: who may ask, what a body must carry, and what a
 * body must not. What a write does to the tree is the integration test's business.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bearer, buildTestServer, emptyDatabase, stopHub } from '../testing/hub-harness.js';

let server: FastifyInstance;

const AREA_ID = '018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e6f';

beforeAll(async () => {
  server = await buildTestServer(true, emptyDatabase());
});

afterAll(async () => {
  stopHub();
  await server.close();
});

describe('reading areas', () => {
  it('needs area:read', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/areas',
      headers: { authorization: await bearer('entity:read') },
    });

    expect(response.statusCode).toBe(403);
  });

  it('lists none when there are none', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/areas',
      headers: { authorization: await bearer('area:read') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [] });
  });
});

describe('creating an area', () => {
  it('keeps it from somebody who may only read areas', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/areas',
      headers: { authorization: await bearer('area:read') },
      payload: { kind: 'house', name: 'Home' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('refuses a floor without a house, naming the field', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/areas',
      headers: { authorization: await bearer('area:write') },
      payload: { kind: 'floor', name: 'Ground floor' },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.stringify(response.json())).toContain('parentId');
  });

  it('refuses a floor whose house does not exist, naming the field', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/areas',
      headers: { authorization: await bearer('area:write') },
      payload: { kind: 'floor', name: 'Ground floor', parentId: AREA_ID },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.stringify(response.json())).toContain('parentId');
  });

  it('refuses a house off the globe, naming the field', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/areas',
      headers: { authorization: await bearer('area:write') },
      payload: { kind: 'house', name: 'Home', latitude: 91, longitude: 0 },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.stringify(response.json())).toContain('latitude');
  });

  it('refuses an icon the catalogue does not have, naming the field', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/areas',
      headers: { authorization: await bearer('area:write') },
      payload: { kind: 'house', name: 'Home', icon: 'no-such-glyph' },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.stringify(response.json())).toContain('no-such-glyph');
  });
});

describe('changing and removing an area', () => {
  it('refuses a change that changes nothing', async () => {
    const response = await server.inject({
      method: 'PATCH',
      url: `/api/v1/areas/${AREA_ID}`,
      headers: { authorization: await bearer('area:write') },
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it('refuses a kind: the kind is fixed at creation', async () => {
    const response = await server.inject({
      method: 'PATCH',
      url: `/api/v1/areas/${AREA_ID}`,
      headers: { authorization: await bearer('area:write') },
      payload: { kind: 'floor' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('says when there is no such area to change', async () => {
    const response = await server.inject({
      method: 'PATCH',
      url: `/api/v1/areas/${AREA_ID}`,
      headers: { authorization: await bearer('area:write') },
      payload: { name: 'Studio' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('says when there is no such area to remove', async () => {
    const response = await server.inject({
      method: 'DELETE',
      url: `/api/v1/areas/${AREA_ID}`,
      headers: { authorization: await bearer('area:write') },
    });

    expect(response.statusCode).toBe(404);
  });

  it('refuses an id that is not a uuid', async () => {
    const response = await server.inject({
      method: 'DELETE',
      url: '/api/v1/areas/kitchen',
      headers: { authorization: await bearer('area:write') },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('the map around a house', () => {
  it('is read with area:read and fetched with area:write', async () => {
    const reading = await server.inject({
      method: 'GET',
      url: `/api/v1/areas/${AREA_ID}/tiles`,
      headers: { authorization: await bearer('entity:read') },
    });
    const fetching = await server.inject({
      method: 'POST',
      url: `/api/v1/areas/${AREA_ID}/tiles`,
      headers: { authorization: await bearer('area:read') },
    });

    expect(reading.statusCode).toBe(403);
    expect(fetching.statusCode).toBe(403);
  });

  it('says when there is no such house to read the map of, or to fetch it for', async () => {
    const reading = await server.inject({
      method: 'GET',
      url: `/api/v1/areas/${AREA_ID}/tiles`,
      headers: { authorization: await bearer('area:read') },
    });
    const fetching = await server.inject({
      method: 'POST',
      url: `/api/v1/areas/${AREA_ID}/tiles`,
      headers: { authorization: await bearer('area:write') },
    });

    expect(reading.statusCode).toBe(404);
    expect(fetching.statusCode).toBe(404);
  });
});
