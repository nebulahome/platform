/**
 * The discovery routes against a hub that answers on a bus in memory.
 *
 * The database is a stub, so what is asserted is what happens before a row is touched: who may
 * list and adopt, a device the hub no longer proposes, a model the device could not be, a field
 * the driver asks that nobody filled, and a vendor that still needs setting up.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  bearer,
  buildTestServer,
  DISCOVERED_ACME,
  DISCOVERED_PRINTER,
  emptyDatabase,
  scanned,
  stopHub,
} from '../testing/hub-harness.js';

let server: FastifyInstance;

describe('with the hub answering', () => {
  beforeAll(async () => {
    server = await buildTestServer(true);
  });

  afterAll(async () => {
    stopHub();
    await server.close();
  });

  it('lists what the hub proposes', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/discovery',
      headers: { authorization: await bearer('device:read') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [
        { id: DISCOVERED_PRINTER.id, kind: 'bambu-lab/printer', model: 'X1C' },
        { id: DISCOVERED_ACME.id, kind: 'acme/printer' },
      ],
    });
  });

  it('asks the hub to look now, for one vendor or every one', async () => {
    scanned.length = 0;

    const one = await server.inject({
      method: 'POST',
      url: '/api/v1/discovery/scan',
      headers: { authorization: await bearer('device:write') },
      payload: { vendorId: 'acme' },
    });
    const every = await server.inject({
      method: 'POST',
      url: '/api/v1/discovery/scan',
      headers: { authorization: await bearer('device:write') },
      payload: {},
    });

    expect(one.statusCode).toBe(202);
    expect(one.json()).toEqual({ vendors: ['acme'] });
    expect(every.json()).toEqual({ vendors: ['acme', 'bambu-lab'] });
    expect(scanned).toEqual(['acme', undefined]);
  });

  it('keeps looking from somebody who may only read devices', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/discovery/scan',
      headers: { authorization: await bearer('device:read') },
      payload: {},
    });

    expect(response.statusCode).toBe(403);
  });

  it('keeps the list from somebody who may not see devices', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/discovery',
      headers: { authorization: await bearer('entity:read') },
    });

    expect(response.statusCode).toBe(403);
  });

  it('keeps adopting from somebody who may only read', async () => {
    const response = await server.inject({
      method: 'POST',
      url: `/api/v1/discovery/${DISCOVERED_PRINTER.id}/adopt`,
      headers: { authorization: await bearer('device:read') },
      payload: { id: 'workshop', name: 'Workshop' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('refuses a device the hub no longer proposes', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/discovery/aaaaaaaaaaaaaaaa/adopt',
      headers: { authorization: await bearer('device:write') },
      payload: { id: 'workshop', name: 'Workshop' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('refuses a model the device could not be, before touching the database', async () => {
    const response = await server.inject({
      method: 'POST',
      url: `/api/v1/discovery/${DISCOVERED_PRINTER.id}/adopt`,
      headers: { authorization: await bearer('device:write') },
      payload: { id: 'workshop', name: 'Workshop', model: 'P1S' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { details: { choices: ['X1C'] } } });
  });

  it('asks for what the driver needs and discovery could not fill', async () => {
    // The printer's access code is not something it announces.
    const response = await server.inject({
      method: 'POST',
      url: `/api/v1/discovery/${DISCOVERED_PRINTER.id}/adopt`,
      headers: { authorization: await bearer('device:write') },
      payload: { id: 'workshop', name: 'Workshop' },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.stringify(response.json())).toContain('transportConfig.password');
  });

  it('passes on which model a configuration being tried reaches', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/devices/probe',
      headers: { authorization: await bearer('device:write') },
      payload: {
        kind: 'bambu-lab/printer',
        transportConfig: { url: 'mqtt://detected:1883', password: '12345678' },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      isReachable: true,
      detected: { kind: 'bambu-lab/printer', model: 'P1S', modelChoices: ['P1S'] },
    });
  });
});

describe('with a vendor nobody has set up', () => {
  beforeAll(async () => {
    server = await buildTestServer(true, emptyDatabase());
  });

  afterAll(async () => {
    stopHub();
    await server.close();
  });

  it('refuses to adopt a device of it until it is set up', async () => {
    const response = await server.inject({
      method: 'POST',
      url: `/api/v1/discovery/${DISCOVERED_ACME.id}/adopt`,
      headers: { authorization: await bearer('device:write') },
      payload: {
        id: 'acme-workshop',
        name: 'Workshop',
        transportConfig: { password: '12345678' },
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { details: { reason: 'needs-setup' } } });
  });
});

describe('with no hub on the bus', () => {
  beforeAll(async () => {
    server = await buildTestServer(false);
  });

  afterAll(async () => {
    stopHub();
    await server.close();
  });

  it('lists nothing rather than failing the page', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/discovery',
      headers: { authorization: await bearer('device:read') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [] });
  });
});
