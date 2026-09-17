/**
 * The vendor routes against a hub that answers on a bus in memory.
 *
 * The catalogue comes from the hub; what the owner has done about each vendor comes from the
 * database, which here is either a stub that rejects everything or one with nothing in it.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bearer, buildTestServer, emptyDatabase, stopHub } from '../testing/hub-harness.js';

let server: FastifyInstance;

describe('with the hub answering', () => {
  beforeAll(async () => {
    server = await buildTestServer(true);
  });

  afterAll(async () => {
    stopHub();
    await server.close();
  });

  it('keeps the catalogue from somebody without the permission', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/integrations/vendors',
      headers: { authorization: await bearer('entity:read') },
    });

    expect(response.statusCode).toBe(403);
  });
});

describe('with the hub answering and nothing saved', () => {
  beforeAll(async () => {
    server = await buildTestServer(true, emptyDatabase());
  });

  afterAll(async () => {
    stopHub();
    await server.close();
  });

  it('lists the vendors the hub has loaded, saying which still need setting up', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/integrations/vendors',
      headers: { authorization: await bearer('integration:read') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [
        {
          id: 'bambu-lab',
          needsSetup: false,
          isConfigured: false,
          drivers: [{ id: 'bambu-lab/printer', models: ['X1C', 'P1S'] }],
        },
        { id: 'acme', needsSetup: true, isConfigured: false },
      ],
    });
  });

  it('reads one vendor by its id, and says when there is no such vendor', async () => {
    const found = await server.inject({
      method: 'GET',
      url: '/api/v1/integrations/vendors/acme',
      headers: { authorization: await bearer('integration:read') },
    });
    const missing = await server.inject({
      method: 'GET',
      url: '/api/v1/integrations/vendors/nobody',
      headers: { authorization: await bearer('integration:read') },
    });

    expect(found.statusCode).toBe(200);
    expect(found.json()).toMatchObject({ id: 'acme', name: 'ACME', internetRequired: true });
    expect(missing.statusCode).toBe(404);
  });

  it("refuses a vendor's settings that are not what the vendor asks", async () => {
    const response = await server.inject({
      method: 'PATCH',
      url: '/api/v1/integrations/vendors/acme/config',
      headers: { authorization: await bearer('integration:configure') },
      payload: { transportConfig: { region: 'eu' } },
    });

    expect(response.statusCode).toBe(400);

    const body = response.json<{ error: { details: { issues: { path: string }[] } } }>();

    expect(body.error.details.issues.map((issue) => issue.path).sort()).toEqual([
      'transportConfig',
      'transportConfig.apiKey',
    ]);
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

  it('cannot list vendors, and says which dependency is missing', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/integrations/vendors',
      headers: { authorization: await bearer('integration:read') },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { code: 'DEVICE_UNAVAILABLE' } });
  });
});
