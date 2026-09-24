/**
 * The dashboard routes against a database that answers nothing.
 *
 * What is decided before a row is touched: that a signed-in person needs no permission to read
 * the dashboards assigned to them, that everything else asks for `dashboard:manage`, that a layout
 * breaking the grid is refused, and that an id nothing is behind is answered as missing. What a
 * write stores is covered by the integration tests.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bearer, buildTestServer, emptyDatabase, stopHub } from '../testing/hub-harness.js';

let server: FastifyInstance;

const DASHBOARD_ID = '018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e6f';

/**
 * A light card, for layouts that vary where it sits.
 *
 * @param id - Its identifier.
 * @param x - Its column.
 * @param y - Its row.
 * @returns The card.
 */
function light(id: string, x: number, y: number): Record<string, unknown> {
  return {
    id,
    type: 'entity',
    x,
    y,
    w: 1,
    h: 2,
    entityId: 'light.kitchen_ceiling',
    title: null,
    icon: null,
    range: null,
  };
}

beforeAll(async () => {
  server = await buildTestServer(true, emptyDatabase());
});

afterAll(async () => {
  stopHub();
  await server.close();
});

describe('reading dashboards', () => {
  it('asks for a sign-in first', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/v1/dashboards' });

    expect(response.statusCode).toBe(401);
  });

  it('lists the ones assigned to you with no permission at all', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/dashboards',
      headers: { authorization: await bearer() },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [] });
  });

  it('answers a dashboard with nothing behind it as missing', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/api/v1/dashboards/${DASHBOARD_ID}`,
      headers: { authorization: await bearer() },
    });

    expect(response.statusCode).toBe(404);
  });

  it('refuses an id that is not one', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/dashboards/home',
      headers: { authorization: await bearer() },
    });

    expect(response.statusCode).toBe(400);
  });

  it('keeps the list of every dashboard, and of the people, to whoever manages them', async () => {
    const [every, people] = await Promise.all(
      ['/api/v1/dashboards/manage', '/api/v1/dashboards/assignees'].map(async (url) =>
        server.inject({ method: 'GET', url, headers: { authorization: await bearer() } }),
      ),
    );
    const managed = await server.inject({
      method: 'GET',
      url: '/api/v1/dashboards/manage',
      headers: { authorization: await bearer('dashboard:manage') },
    });

    expect([every?.statusCode, people?.statusCode]).toEqual([403, 403]);
    expect(managed.statusCode).toBe(200);
    expect(managed.json()).toEqual({ items: [] });
  });
});

describe('writing dashboards', () => {
  it('asks for dashboard:manage to make, change or remove one', async () => {
    const authorization = await bearer();
    const responses = await Promise.all([
      server.inject({
        method: 'POST',
        url: '/api/v1/dashboards',
        headers: { authorization },
        payload: { name: 'Home' },
      }),
      server.inject({
        method: 'PATCH',
        url: `/api/v1/dashboards/${DASHBOARD_ID}`,
        headers: { authorization },
        payload: { name: 'Upstairs' },
      }),
      server.inject({
        method: 'DELETE',
        url: `/api/v1/dashboards/${DASHBOARD_ID}`,
        headers: { authorization },
      }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([403, 403, 403]);
  });

  it('refuses a blank name', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/dashboards',
      headers: { authorization: await bearer('dashboard:manage') },
      payload: { name: '  ' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('refuses an assignment that is not a list of ids', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/dashboards',
      headers: { authorization: await bearer('dashboard:manage') },
      payload: { name: 'Home', userIds: ['somebody'] },
    });

    expect(response.statusCode).toBe(400);
  });

  it('refuses a layout with two cards on the same cell', async () => {
    const response = await server.inject({
      method: 'PATCH',
      url: `/api/v1/dashboards/${DASHBOARD_ID}`,
      headers: { authorization: await bearer('dashboard:manage') },
      payload: { layout: { cards: [light('lightaaaa', 0, 0), light('lightbbbb', 0, 1)] } },
    });

    expect(response.statusCode).toBe(400);
  });

  it('refuses a change that changes nothing', async () => {
    const response = await server.inject({
      method: 'PATCH',
      url: `/api/v1/dashboards/${DASHBOARD_ID}`,
      headers: { authorization: await bearer('dashboard:manage') },
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it('answers a change to a dashboard that is not there as missing', async () => {
    const response = await server.inject({
      method: 'PATCH',
      url: `/api/v1/dashboards/${DASHBOARD_ID}`,
      headers: { authorization: await bearer('dashboard:manage') },
      payload: { name: 'Upstairs' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('answers a delete of a dashboard that is not there as missing', async () => {
    const response = await server.inject({
      method: 'DELETE',
      url: `/api/v1/dashboards/${DASHBOARD_ID}`,
      headers: { authorization: await bearer('dashboard:manage') },
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('dashboards as files', () => {
  it('answers the export of a dashboard that is not there as missing', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/api/v1/dashboards/${DASHBOARD_ID}/export`,
      headers: { authorization: await bearer('dashboard:manage') },
    });

    expect(response.statusCode).toBe(404);
  });

  it('refuses a file that is not a dashboard', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/dashboards/import',
      headers: { authorization: await bearer('dashboard:manage') },
      payload: {
        format: 'nebula-home/scene',
        version: 1,
        name: 'Home',
        icon: null,
        layout: { cards: [] },
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('refuses a file from a newer platform, saying so', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/dashboards/import',
      headers: { authorization: await bearer('dashboard:manage') },
      payload: {
        format: 'nebula-home/dashboard',
        version: 9,
        name: 'Home',
        icon: null,
        layout: { cards: [] },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('Made by a newer NebulaHome (format 9)');
  });
});
