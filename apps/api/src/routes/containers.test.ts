/**
 * The container routes against a supervisor that answers on a bus in memory.
 *
 * What is asserted is who may look and who may act, that the supervisor's refusals reach the
 * caller as they were made, and that the list says Docker cannot be seen - rather than failing -
 * when the supervisor is away.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ContainersView } from '@nebula-home/contracts';

import {
  bearer,
  buildTestServer,
  controlled,
  emptyDatabase,
  removed,
  stopHub,
} from '../testing/hub-harness.js';

let server: FastifyInstance;

describe('with the supervisor answering', () => {
  beforeAll(async () => {
    server = await buildTestServer(true, emptyDatabase());
  });

  afterAll(async () => {
    stopHub();
    await server.close();
  });

  it('lists the containers, the platform’s own among them, to somebody who may read them', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/containers',
      headers: { authorization: await bearer('container:read') },
    });

    expect(response.statusCode).toBe(200);

    const view = response.json<ContainersView>();

    expect(view.docker.isAvailable).toBe(true);
    expect(view.items.map((item) => [item.name, item.isSelf, item.refusal])).toEqual([
      ['nebulahome', true, 'self'],
      ['nebulahome-zigbee2mqtt', false, 'managed'],
      ['adguard', false, null],
    ]);
  });

  it('keeps the list from somebody who may only read the system monitor', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/containers',
      headers: { authorization: await bearer('system:read') },
    });

    expect(response.statusCode).toBe(403);
  });

  it('stops a plain container for somebody who may control them', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/containers/adguard/stop',
      headers: { authorization: await bearer('container:control') },
    });

    expect(response.statusCode).toBe(200);
    expect(controlled).toEqual(['adguard:stop']);
  });

  it('refuses to stop one an integration runs, saying why, as the supervisor did', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/containers/nebulahome-zigbee2mqtt/stop',
      headers: { authorization: await bearer('container:control') },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { details: { reason: 'managed' } } });
  });

  it('removes a plain container, its own volumes with it, for somebody who may install them', async () => {
    const response = await server.inject({
      method: 'DELETE',
      url: '/api/v1/containers/adguard?volumes=true',
      headers: { authorization: await bearer('container:install') },
    });

    expect(response.statusCode).toBe(204);
    expect(removed).toEqual(['adguard:true']);
  });

  it("refuses to remove the platform's own container, saying why", async () => {
    const response = await server.inject({
      method: 'DELETE',
      url: '/api/v1/containers/nebulahome',
      headers: { authorization: await bearer('container:install') },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { details: { reason: 'self' } } });
  });

  it('keeps removing from somebody who may only start and stop', async () => {
    const response = await server.inject({
      method: 'DELETE',
      url: '/api/v1/containers/adguard',
      headers: { authorization: await bearer('container:control') },
    });

    expect(response.statusCode).toBe(403);
  });

  it('refuses to act for somebody who may only look', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/containers/adguard/restart',
      headers: { authorization: await bearer('container:read') },
    });

    expect(response.statusCode).toBe(403);
  });
});

describe('with the bus away', () => {
  beforeAll(async () => {
    server = await buildTestServer(false, emptyDatabase());
  });

  afterAll(async () => {
    stopHub();
    await server.close();
  });

  it('says Docker cannot be seen, and why, rather than failing the page', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/containers',
      headers: { authorization: await bearer('container:read') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<ContainersView>().docker).toMatchObject({
      isAvailable: false,
      reason: 'The supervisor is not running, so Docker cannot be asked',
    });
  });
});
