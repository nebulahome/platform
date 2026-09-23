/**
 * The scene routes against a database that answers nothing.
 *
 * What is checked before a row is touched: who may ask, and what a body must carry. What a write
 * does to the members is covered by the mapper unit tests and by integration elsewhere.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bearer, buildTestServer, emptyDatabase, stopHub } from '../testing/hub-harness.js';

let server: FastifyInstance;

const SCENE_ID = '018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e6f';

beforeAll(async () => {
  server = await buildTestServer(true, emptyDatabase());
});

afterAll(async () => {
  stopHub();
  await server.close();
});

describe('reading scenes', () => {
  it('lists none when there are none', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/scenes',
      headers: { authorization: await bearer('scene:read') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [] });
  });
});

describe('creating a scene', () => {
  it('keeps it from somebody who may only read scenes', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/scenes',
      headers: { authorization: await bearer('scene:read') },
      payload: { key: 'evening', name: 'Evening' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('refuses a bad key', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/scenes',
      headers: { authorization: await bearer('scene:write') },
      payload: { key: 'Evening Lights', name: 'Evening' },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('applying a scene', () => {
  it('keeps it from somebody who may only write scenes', async () => {
    const response = await server.inject({
      method: 'POST',
      url: `/api/v1/scenes/${SCENE_ID}/apply`,
      headers: { authorization: await bearer('scene:write') },
    });

    expect(response.statusCode).toBe(403);
  });
});

describe('changing and removing a scene', () => {
  it('keeps a change from somebody who may only read scenes', async () => {
    const response = await server.inject({
      method: 'PATCH',
      url: `/api/v1/scenes/${SCENE_ID}`,
      headers: { authorization: await bearer('scene:read') },
      payload: { name: 'Dusk' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('keeps a delete from somebody who may only read scenes', async () => {
    const response = await server.inject({
      method: 'DELETE',
      url: `/api/v1/scenes/${SCENE_ID}`,
      headers: { authorization: await bearer('scene:read') },
    });

    expect(response.statusCode).toBe(403);
  });
});
