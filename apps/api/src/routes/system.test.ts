/**
 * The system monitor route against a `core` that answers on a bus in memory.
 *
 * Nothing here reads the database: the samples are `core`'s, held in memory, and the route is a
 * translation of one bus request. What is asserted is who may ask and what happens when `core`
 * cannot be reached.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { SystemMonitorSnapshot } from '@nebulahome/contracts';

import { bearer, buildTestServer, stopHub } from '../testing/hub-harness.js';

let server: FastifyInstance;

describe('with core answering', () => {
  beforeAll(async () => {
    server = await buildTestServer(true);
  });

  afterAll(async () => {
    stopHub();
    await server.close();
  });

  it('hands the snapshot to somebody who may read the system', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/system/monitor',
      headers: { authorization: await bearer('system:read') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      host: { cpuCount: 4 },
      samples: [{ at: '2026-09-23T12:00:00.000Z', cpuPercent: 12.5 }],
      disk: { categories: [{ id: 'core', parts: [{ id: 'database' }, { id: 'cache/maps' }] }] },
    });
    expect(response.json<SystemMonitorSnapshot>().network?.interface).toBe('eth0');
  });

  it('keeps it from somebody who may only read the settings', async () => {
    // The settings page and the monitor sit side by side, and still answer to different
    // permissions: what the machine is doing is not a setting.
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/system/monitor',
      headers: { authorization: await bearer('settings:read') },
    });

    expect(response.statusCode).toBe(403);
  });
});

describe('with the bus away', () => {
  beforeAll(async () => {
    server = await buildTestServer(false);
  });

  afterAll(async () => {
    stopHub();
    await server.close();
  });

  it('says core cannot be reached rather than answering with nothing', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/system/monitor',
      headers: { authorization: await bearer('system:read') },
    });

    expect(response.statusCode).toBe(503);
  });
});
