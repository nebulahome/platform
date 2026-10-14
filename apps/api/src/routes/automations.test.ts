/**
 * The automation routes against a database that answers nothing: who may read, write, run and
 * test automations. What a run does is `core`'s, and is covered there and by the integration tests.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  bearer,
  blocksTested,
  buildTestServer,
  emptyDatabase,
  stopHub,
  testsCancelled,
} from '../testing/hub-harness.js';

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

describe('testing a block', () => {
  const TEST_ID = '018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e70';
  const action = {
    testId: TEST_ID,
    target: {
      kind: 'action',
      action: {
        type: 'command',
        entityId: 'light.hall',
        capability: 'on_off',
        params: { command: 'turn_on' },
      },
    },
  };
  const condition = {
    testId: TEST_ID,
    target: { kind: 'condition', condition: { type: 'time', from: '22:00' } },
  };

  it('checks a condition for somebody who writes automations', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/automations/test',
      headers: { authorization: await bearer('automation:write') },
      payload: condition,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ kind: 'condition', value: true, steps: [] });
  });

  it('runs an action only for somebody who may also run automations', async () => {
    const refused = await server.inject({
      method: 'POST',
      url: '/api/v1/automations/test',
      headers: { authorization: await bearer('automation:write') },
      payload: action,
    });
    const before = blocksTested.length;
    const allowed = await server.inject({
      method: 'POST',
      url: '/api/v1/automations/test',
      headers: { authorization: await bearer('automation:write', 'automation:trigger') },
      payload: action,
    });

    expect(refused.statusCode).toBe(403);
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toMatchObject({ kind: 'action', result: 'ok' });
    // On behalf of who asked: the commands carry them as their cause.
    expect(blocksTested.slice(before)[0]?.userId).toEqual(expect.any(String));
  });

  it('keeps tests from somebody who only reads automations', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/automations/test',
      headers: { authorization: await bearer('automation:read', 'automation:trigger') },
      payload: condition,
    });

    expect(response.statusCode).toBe(403);
  });

  it('stops a test', async () => {
    const response = await server.inject({
      method: 'POST',
      url: `/api/v1/automations/test/${TEST_ID}/cancel`,
      headers: { authorization: await bearer('automation:write') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ wasRunning: false });
    expect(testsCancelled.at(-1)).toBe(TEST_ID);
  });
});

describe('the house, as the editor reads it', () => {
  it('says UTC and no position for a house nobody placed', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/automations/house',
      headers: { authorization: await bearer('automation:read') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ timeZone: 'UTC', position: null });
  });
});
