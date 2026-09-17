/**
 * The icon routes against the catalogue a test server serves.
 *
 * The catalogue is the real built-in set over a store in memory, so what is asserted is what
 * a browser would get: a search, a list by id, and the settings page's writes.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bearer, buildTestServer, stopHub } from '../testing/hub-harness.js';

let server: FastifyInstance;

/** A drawing an owner might upload. */
const SVG =
  '<svg viewBox="0 0 24 24" stroke="currentColor"><rect x="4" y="4" width="16" height="16"/></svg>';

describe('the icon catalogue', () => {
  beforeAll(async () => {
    server = await buildTestServer(true);
  });

  afterAll(async () => {
    stopHub();
    await server.close();
  });

  it('finds icons by what was typed, the closest first', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/icons?q=lightbulb&limit=3',
      headers: { authorization: await bearer('device:read') },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json<{ items: { id: string; node: unknown[] }[] }>();

    expect(body.items[0]?.id).toBe('lightbulb');
    expect(body.items.length).toBeLessThanOrEqual(3);
    expect(body.items[0]?.node.length).toBeGreaterThan(0);
  });

  it('lists the ids a page asks for, in its order, skipping what it does not have', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/icons?ids=printer,no-such-icon,lightbulb',
      headers: { authorization: await bearer('device:read') },
    });

    expect(response.json<{ items: { id: string }[] }>().items.map((icon) => icon.id)).toEqual([
      'printer',
      'lightbulb',
    ]);
  });

  it('keeps the catalogue from somebody with no permission on devices', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/icons',
      headers: { authorization: await bearer('entity:read') },
    });

    expect(response.statusCode).toBe(403);
  });

  it('keeps the writes from somebody who may not change the server', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/icons',
      headers: { authorization: await bearer('device:write') },
      payload: { id: 'boiler', name: 'Boiler', svg: SVG, frame: { x: 0, y: 0, size: 24 } },
    });

    expect(response.statusCode).toBe(403);
  });

  it('adds a custom icon, redraws a built-in one, and puts it back', async () => {
    const created = await server.inject({
      method: 'POST',
      url: '/api/v1/icons',
      headers: { authorization: await bearer('settings:write') },
      payload: { id: 'boiler', name: 'Boiler', svg: SVG, frame: { x: 0, y: 0, size: 24 } },
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ id: 'boiler', origin: 'custom' });

    const redrawn = await server.inject({
      method: 'PATCH',
      url: '/api/v1/icons/lightbulb',
      headers: { authorization: await bearer('settings:write') },
      payload: { svg: SVG, frame: { x: 0, y: 0, size: 24 } },
    });

    expect(redrawn.statusCode).toBe(200);
    expect(redrawn.json()).toMatchObject({ id: 'lightbulb', isOverridden: true });

    const renamed = await server.inject({
      method: 'PATCH',
      url: '/api/v1/icons/lightbulb',
      headers: { authorization: await bearer('settings:write') },
      payload: { name: 'Bulb' },
    });

    expect(renamed.statusCode).toBe(400);

    const restored = await server.inject({
      method: 'DELETE',
      url: '/api/v1/icons/lightbulb',
      headers: { authorization: await bearer('settings:write') },
    });

    expect(restored.statusCode).toBe(204);

    const again = await server.inject({
      method: 'GET',
      url: '/api/v1/icons?ids=lightbulb',
      headers: { authorization: await bearer('device:read') },
    });

    expect(again.json()).toMatchObject({ items: [{ id: 'lightbulb', isOverridden: false }] });
  });

  it('refuses a drawing it cannot read, naming the file field', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/icons',
      headers: { authorization: await bearer('settings:write') },
      payload: {
        id: 'bad',
        name: 'Bad',
        svg: '<svg viewBox="0 0 24 24"><image href="x.png"/></svg>',
        frame: { x: 0, y: 0, size: 24 },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'VALIDATION', details: { issues: [{ path: 'svg' }] } },
    });
  });
});
