/**
 * The role routes against a database that answers nothing.
 *
 * What is checked before a row is touched: who may ask, and what a body must carry. What a
 * write does to the rows is the integration test's business.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bearer, buildTestServer, emptyDatabase, stopHub } from '../testing/hub-harness.js';

let server: FastifyInstance;

const ROLE_ID = '018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e6f';

beforeAll(async () => {
  server = await buildTestServer(true, emptyDatabase());
});

afterAll(async () => {
  stopHub();
  await server.close();
});

describe('reading roles', () => {
  it('needs user:read', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/roles',
      headers: { authorization: await bearer('entity:read') },
    });

    expect(response.statusCode).toBe(403);
  });

  it('lists none when there are none', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/roles',
      headers: { authorization: await bearer('user:read') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [] });
  });
});

describe('changing roles', () => {
  it('keeps creating from somebody who may only read people', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/roles',
      headers: { authorization: await bearer('user:read') },
      payload: { name: 'Kids' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('keeps changing and deleting from somebody without role:manage', async () => {
    const authorization = await bearer('user:manage');
    const patch = await server.inject({
      method: 'PATCH',
      url: `/api/v1/roles/${ROLE_ID}`,
      headers: { authorization },
      payload: { name: 'Kids' },
    });
    const remove = await server.inject({
      method: 'DELETE',
      url: `/api/v1/roles/${ROLE_ID}`,
      headers: { authorization },
    });

    expect(patch.statusCode).toBe(403);
    expect(remove.statusCode).toBe(403);
  });

  it('refuses a blank name, naming the field', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/roles',
      headers: { authorization: await bearer('role:manage') },
      payload: { name: '   ' },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.stringify(response.json())).toContain('name');
  });

  it('refuses a change that changes nothing', async () => {
    const response = await server.inject({
      method: 'PATCH',
      url: `/api/v1/roles/${ROLE_ID}`,
      headers: { authorization: await bearer('role:manage') },
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it('refuses a permission that is not a key', async () => {
    const response = await server.inject({
      method: 'PATCH',
      url: `/api/v1/roles/${ROLE_ID}`,
      headers: { authorization: await bearer('role:manage') },
      payload: { permissions: ['everything'] },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.stringify(response.json())).toContain('permissions');
  });
});
