/**
 * The tag routes against a database that answers nothing.
 *
 * What is checked before a row is touched: who may ask, and what a body must carry. What a
 * write does to the rows is the integration test's business.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bearer, buildTestServer, emptyDatabase, stopHub } from '../testing/hub-harness.js';

let server: FastifyInstance;

const TAG_ID = '018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e6f';

beforeAll(async () => {
  server = await buildTestServer(true, emptyDatabase());
});

afterAll(async () => {
  stopHub();
  await server.close();
});

describe('reading tags', () => {
  it('needs tag:read', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/tags',
      headers: { authorization: await bearer('entity:read') },
    });

    expect(response.statusCode).toBe(403);
  });

  it('lists none when there are none', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/tags',
      headers: { authorization: await bearer('tag:read') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [] });
  });
});

describe('creating a tag', () => {
  it('keeps it from somebody who may only read tags', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/tags',
      headers: { authorization: await bearer('tag:read') },
      payload: { name: 'Exterior', color: 'green' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('refuses a blank name, naming the field', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/tags',
      headers: { authorization: await bearer('tag:write') },
      payload: { name: '   ', color: 'green' },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.stringify(response.json())).toContain('name');
  });

  it('refuses a colour outside the palette, naming the field', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/tags',
      headers: { authorization: await bearer('tag:write') },
      payload: { name: 'Exterior', color: '#00ff00' },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.stringify(response.json())).toContain('color');
  });

  it('refuses an icon the catalogue does not have, naming the field', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/tags',
      headers: { authorization: await bearer('tag:write') },
      payload: { name: 'Exterior', color: 'green', icon: 'no-such-glyph' },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.stringify(response.json())).toContain('no-such-glyph');
  });
});

describe('changing and removing a tag', () => {
  it('refuses a change that changes nothing', async () => {
    const response = await server.inject({
      method: 'PATCH',
      url: `/api/v1/tags/${TAG_ID}`,
      headers: { authorization: await bearer('tag:write') },
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it('refuses a key: the key is fixed at creation', async () => {
    const response = await server.inject({
      method: 'PATCH',
      url: `/api/v1/tags/${TAG_ID}`,
      headers: { authorization: await bearer('tag:write') },
      payload: { key: 'outside' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('says when there is no such tag to change', async () => {
    const response = await server.inject({
      method: 'PATCH',
      url: `/api/v1/tags/${TAG_ID}`,
      headers: { authorization: await bearer('tag:write') },
      payload: { name: 'Outside' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('says when there is no such tag to remove', async () => {
    const response = await server.inject({
      method: 'DELETE',
      url: `/api/v1/tags/${TAG_ID}`,
      headers: { authorization: await bearer('tag:write') },
    });

    expect(response.statusCode).toBe(404);
  });

  it('refuses an id that is not a uuid', async () => {
    const response = await server.inject({
      method: 'DELETE',
      url: '/api/v1/tags/exterior',
      headers: { authorization: await bearer('tag:write') },
    });

    expect(response.statusCode).toBe(400);
  });
});
