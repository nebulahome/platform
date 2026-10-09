/**
 * The automation routes against a database that answers nothing: who may read, write and run
 * automations. What a run does is `core`'s, and is covered there and by the integration tests.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bearer, buildTestServer, emptyDatabase, stopHub } from '../testing/hub-harness.js';

let server: FastifyInstance;

const AUTOMATION_ID = '018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e6f';

beforeAll(async () => {
  server = await buildTestServer(true, emptyDatabase());
});

afterAll(async () => {
  stopHub();
  await server.close();
});

describe('reading automations', () => {
  it('lists none when there are none', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/automations',
      headers: { authorization: await bearer('automation:read') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [] });
  });

  it('keeps one automation and its runs from somebody who may not read automations', async () => {
    for (const url of [
      `/api/v1/automations/${AUTOMATION_ID}`,
      `/api/v1/automations/${AUTOMATION_ID}/runs`,
    ]) {
      const response = await server.inject({
        method: 'GET',
        url,
        headers: { authorization: await bearer('scene:read') },
      });

      expect(response.statusCode).toBe(403);
    }
  });

  it('says an automation that is not there is not there', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/api/v1/automations/${AUTOMATION_ID}`,
      headers: { authorization: await bearer('automation:read') },
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('running an automation', () => {
  it('keeps Run from somebody who may only write automations', async () => {
    const response = await server.inject({
      method: 'POST',
      url: `/api/v1/automations/${AUTOMATION_ID}/trigger`,
      headers: { authorization: await bearer('automation:write') },
    });

    expect(response.statusCode).toBe(403);
  });

  it('says an automation that is not there cannot run', async () => {
    const response = await server.inject({
      method: 'POST',
      url: `/api/v1/automations/${AUTOMATION_ID}/trigger`,
      headers: { authorization: await bearer('automation:trigger') },
    });

    expect(response.statusCode).toBe(404);
  });
});
