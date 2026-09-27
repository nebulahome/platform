/**
 * The backup routes against a `backup` service that answers on a bus in memory: who may ask what,
 * what reaches the service, and the installation refusing everything while it is restored.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { NO_MAINTENANCE } from '../services/maintenance.js';
import {
  backupRequests,
  bearer,
  buildTestServer,
  lastMaintenance,
  stopHub,
} from '../testing/hub-harness.js';

let server: FastifyInstance;

describe('with the backup service answering', () => {
  beforeAll(async () => {
    server = await buildTestServer(true);
  });

  afterAll(async () => {
    stopHub();
    await server.close();
  });

  afterEach(() => {
    lastMaintenance?.apply(NO_MAINTENANCE);
  });

  it('starts a backup for somebody who may change the settings, and says who asked', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/backup/runs',
      headers: { authorization: await bearer('settings:write') },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ runId: '11111111-1111-4111-8111-111111111111' });
    expect(backupRequests.at(-1)).toMatchObject({
      method: 'run',
      payload: { requestedBy: { username: expect.any(String) as string } },
    });
  });

  it('keeps it from somebody who may only read the settings', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/backup/runs',
      headers: { authorization: await bearer('settings:read') },
    });

    expect(response.statusCode).toBe(403);
  });

  it('asks the backup service for a folder, since it is what writes there', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/backup/browse',
      headers: { authorization: await bearer('settings:write') },
      payload: { path: '/mnt' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ path: '/mnt', directories: ['usb'] });
  });

  it('keeps the key and the restore from everybody without backup:restore', async () => {
    const authorization = await bearer('settings:read', 'settings:write');
    const key = await server.inject({
      method: 'POST',
      url: '/api/v1/backup/key',
      headers: { authorization },
      payload: { password: 'whatever' },
    });
    const restore = await server.inject({
      method: 'POST',
      url: '/api/v1/backup/restores',
      headers: { authorization },
      payload: {
        locationId: '22222222-2222-4222-8222-222222222222',
        archiveName: 'nebulahome-20260927T030000Z-1a2b3c4d.nhbk',
        password: 'whatever',
      },
    });

    expect(key.statusCode).toBe(403);
    expect(restore.statusCode).toBe(403);
  });

  it('answers 503 to everything while a restore runs, but says how it goes to anybody', async () => {
    lastMaintenance?.apply({
      ...NO_MAINTENANCE,
      state: 'restoring',
      runId: '33333333-3333-4333-8333-333333333333',
      phase: 'switching',
      percent: 80,
    });

    const refused = await server.inject({
      method: 'GET',
      url: '/api/v1/system/monitor',
      headers: { authorization: await bearer('system:read') },
    });
    const state = await server.inject({ method: 'GET', url: '/api/v1/system/maintenance' });

    expect(refused.statusCode).toBe(503);
    expect(refused.json()).toMatchObject({ error: { code: 'MAINTENANCE' } });
    expect(state.statusCode).toBe(200);
    expect(state.json()).toMatchObject({ state: 'restoring', phase: 'switching', percent: 80 });
  });

  it('refuses the tokens issued before a restore, once it has restored', async () => {
    const authorization = await bearer('system:read');

    lastMaintenance?.apply({
      ...NO_MAINTENANCE,
      outcome: 'restored',
      tokensInvalidBefore: new Date(Date.now() + 60_000),
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/system/monitor',
      headers: { authorization },
    });

    expect(response.statusCode).toBe(401);
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

  it('says the backup service cannot be reached', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/backup/runs',
      headers: { authorization: await bearer('settings:write') },
    });

    expect(response.statusCode).toBe(503);
  });
});
