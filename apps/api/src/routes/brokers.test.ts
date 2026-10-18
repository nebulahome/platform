/**
 * The broker routes against a hub that answers on a bus in memory: who may read and drive the
 * house's Matter fabric, a pairing code checked before the hub is asked, and a node with nothing
 * in the house removed from the fabric alone.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  bearer,
  buildTestServer,
  MATTER_LAMP,
  matterRequests,
  stopHub,
} from '../testing/hub-harness.js';

let server: FastifyInstance;

describe('the broker routes', () => {
  beforeAll(async () => {
    server = await buildTestServer(true);
  });

  beforeEach(() => {
    matterRequests.length = 0;
  });

  afterAll(async () => {
    stopHub();
    await server.close();
  });

  it('lists the brokers, and reads the fabric and its nodes', async () => {
    const authorization = await bearer('device:read');
    const brokers = await server.inject({
      method: 'GET',
      url: '/api/v1/brokers',
      headers: { authorization },
    });
    const nodes = await server.inject({
      method: 'GET',
      url: '/api/v1/brokers/matter/nodes',
      headers: { authorization },
    });

    expect(brokers.json()).toEqual({
      items: [{ id: 'matter', state: 'running', devices: { total: 1, online: 1 } }],
    });
    expect(nodes.json()).toEqual({ items: [MATTER_LAMP] });
  });

  it('starts commissioning with the code as written, and answers at once', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/brokers/matter/commission',
      headers: { authorization: await bearer('device:write') },
      payload: { code: '3497-011-2332' },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ id: 'job-1', state: 'running' });
    expect(matterRequests).toEqual(['commission 34970112332']);
  });

  it('refuses what is no pairing code before asking the hub, and whoever may not add devices', async () => {
    const wrong = await server.inject({
      method: 'POST',
      url: '/api/v1/brokers/matter/commission',
      headers: { authorization: await bearer('device:write') },
      payload: { code: '1234' },
    });
    const reader = await server.inject({
      method: 'POST',
      url: '/api/v1/brokers/matter/commission',
      headers: { authorization: await bearer('device:read') },
      payload: { code: '34970112332' },
    });

    expect(wrong.statusCode).toBe(400);
    expect(reader.statusCode).toBe(403);
    expect(matterRequests).toEqual([]);
  });

  it('takes a node with nothing in the house off the fabric, and brings a device back', async () => {
    const removed = await server.inject({
      method: 'DELETE',
      url: '/api/v1/brokers/matter/nodes/7',
      headers: { authorization: await bearer('device:delete') },
    });
    const restored = await server.inject({
      method: 'POST',
      url: '/api/v1/brokers/matter/nodes/7/restore',
      headers: { authorization: await bearer('device:write') },
      payload: { endpoint: null },
    });
    const unknown = await server.inject({
      method: 'DELETE',
      url: '/api/v1/brokers/matter/nodes/8',
      headers: { authorization: await bearer('device:delete') },
    });

    expect(removed.statusCode).toBe(204);
    expect(restored.json()).toEqual({ isRestored: true });
    expect(unknown.statusCode).toBe(404);
    expect(matterRequests).toEqual(['remove 7', 'restore 7:null']);
  });
});
