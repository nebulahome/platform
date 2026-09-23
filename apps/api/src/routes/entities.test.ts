/**
 * The entity change route against a database that answers nothing.
 *
 * What is checked before a row is touched: the body, and that an entity nobody can find is a
 * not-found rather than a write of nothing. What a change does to a row, and how a scope on the
 * entity is honoured, is the integration test's business.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bearer, buildTestServer, emptyDatabase, stopHub } from '../testing/hub-harness.js';

let server: FastifyInstance;

beforeAll(async () => {
  server = await buildTestServer(true, emptyDatabase());
});

afterAll(async () => {
  stopHub();
  await server.close();
});

describe('changing an entity', () => {
  it('refuses a change that changes nothing', async () => {
    const response = await server.inject({
      method: 'PATCH',
      url: '/api/v1/entities/switch.bench_relay',
      headers: { authorization: await bearer('entity:read', 'entity:write') },
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it('refuses an icon that is not an icon id, naming the field', async () => {
    const response = await server.inject({
      method: 'PATCH',
      url: '/api/v1/entities/switch.bench_relay',
      headers: { authorization: await bearer('entity:read', 'entity:write') },
      payload: { icon: 'Not An Id' },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.stringify(response.json())).toContain('icon');
  });

  it('says when there is no such entity', async () => {
    const response = await server.inject({
      method: 'PATCH',
      url: '/api/v1/entities/switch.bench_relay',
      headers: { authorization: await bearer('entity:read', 'entity:write') },
      payload: { name: 'Bench relay' },
    });

    expect(response.statusCode).toBe(404);
  });
});
