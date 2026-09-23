/**
 * The device routes against a hub that answers on a bus in memory.
 *
 * The database is a stub that rejects everything, which is exactly right for what is asserted:
 * a configuration is checked against the bundle before a row is touched, an icon against the
 * catalogue, a probe never touches a row at all. What the hub is given and what comes back
 * from it is the whole of the interest here.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  bearer,
  buildTestServer,
  emptyDatabase,
  forgotten,
  probed,
  stopHub,
  unregistered,
} from '../testing/hub-harness.js';

let server: FastifyInstance;

/** A device as the form sends it, for tests that vary one field. */
const NEW_PRINTER = {
  id: 'bambu-lab-x1c',
  kind: 'bambu-lab/printer',
  model: 'X1C',
  name: 'X1C',
  transportConfig: { url: 'mqtt://localhost:1883', password: '12345678' },
};

describe('with the hub answering', () => {
  beforeAll(async () => {
    server = await buildTestServer(true);
  });

  afterAll(async () => {
    stopHub();
    await server.close();
  });

  it('keeps adding a device from somebody who may only read', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/devices',
      headers: { authorization: await bearer('device:read') },
      payload: NEW_PRINTER,
    });

    expect(response.statusCode).toBe(403);
  });

  it('needs a name for the device', async () => {
    const { name, ...withoutName } = NEW_PRINTER;
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/devices',
      headers: { authorization: await bearer('device:write') },
      payload: withoutName,
    });

    expect(name).toBe('X1C');
    expect(response.statusCode).toBe(400);
  });

  it('refuses a model the driver does not offer before touching the database', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/devices',
      headers: { authorization: await bearer('device:write') },
      payload: { ...NEW_PRINTER, model: 'A1' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: 'VALIDATION',
        details: { issues: [{ path: 'model' }], choices: ['X1C', 'P1S'] },
      },
    });
  });

  it('refuses an icon the catalogue does not have, naming the field', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/devices',
      headers: { authorization: await bearer('device:write') },
      payload: { ...NEW_PRINTER, icon: 'no-such-icon' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'VALIDATION', details: { issues: [{ path: 'icon' }] } },
    });
  });

  it('checks a new device against the bundle before touching the database', async () => {
    // The database in this test rejects every query. A 400 rather than a 500 is the proof that
    // the check came first.
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/devices',
      headers: { authorization: await bearer('device:write') },
      payload: {
        ...NEW_PRINTER,
        transportConfig: { url: 'mqtt://localhost:1883', password: 'short', username: 'me' },
      },
    });

    expect(response.statusCode).toBe(400);

    const body = response.json<{ error: { details: { issues: { path: string }[] } } }>();

    expect(body.error.details.issues.map((issue) => issue.path).sort()).toEqual([
      'transportConfig',
      'transportConfig.password',
    ]);
  });

  it('tries a configuration with the constants added and reports the verdict', async () => {
    probed.length = 0;

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/devices/probe',
      headers: { authorization: await bearer('device:write') },
      payload: {
        kind: 'bambu-lab/printer',
        transportConfig: { url: 'mqtt://localhost:1883', password: '12345678' },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      isReachable: true,
      detail: 'Connected to mqtt://localhost:1883',
    });
    expect(probed[0]?.transportConfig).toEqual({
      url: 'mqtt://localhost:1883',
      password: '12345678',
      username: 'bblp',
      shouldVerifyCertificate: false,
    });
  });

  it('reports a configuration that does not work as a verdict, not an error', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/devices/probe',
      headers: { authorization: await bearer('device:write') },
      payload: {
        kind: 'bambu-lab/printer',
        transportConfig: { url: 'mqtt://nowhere:1', password: '12345678' },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ isReachable: false });
  });

  it('refuses a configuration that is not what the bundle asks, naming the field', async () => {
    probed.length = 0;

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/devices/probe',
      headers: { authorization: await bearer('device:write') },
      payload: { kind: 'bambu-lab/printer', transportConfig: { url: 'mqtt://localhost:1883' } },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: 'VALIDATION',
        details: { issues: [{ path: 'transportConfig.password' }] },
      },
    });
    expect(probed).toEqual([]);
  });

  it('says when the kind is not one the hub has', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/devices/probe',
      headers: { authorization: await bearer('device:write') },
      payload: { kind: 'nothing/installed', transportConfig: {} },
    });

    expect(response.statusCode).toBe(404);
  });

  it('refuses an empty change', async () => {
    const response = await server.inject({
      method: 'PATCH',
      url: '/api/v1/devices/bambu-lab-x1c',
      headers: { authorization: await bearer('device:write') },
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it('takes tags only by id, naming the field otherwise', async () => {
    const response = await server.inject({
      method: 'PATCH',
      url: '/api/v1/devices/bambu-lab-x1c',
      headers: { authorization: await bearer('device:write') },
      payload: { tagIds: ['exterior'] },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.stringify(response.json())).toContain('tagIds');
  });

  it('takes a room only by id, naming the field otherwise', async () => {
    const response = await server.inject({
      method: 'PATCH',
      url: '/api/v1/devices/bambu-lab-x1c',
      headers: { authorization: await bearer('device:write') },
      payload: { areaId: 'kitchen' },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.stringify(response.json())).toContain('areaId');
  });

  it('keeps the id the platform names its own machine by', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/devices',
      headers: { authorization: await bearer('device:write') },
      payload: { ...NEW_PRINTER, id: 'system' },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.stringify(response.json())).toContain('Reserved for the platform');
  });

  it('refuses to change a connection the system device does not have, naming the fields', async () => {
    const response = await server.inject({
      method: 'PATCH',
      url: '/api/v1/devices/system',
      headers: { authorization: await bearer('device:write') },
      payload: { name: 'Rack', isEnabled: false, transportConfig: {} },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { details: { fields: ['isEnabled', 'transportConfig'] } },
    });
  });

  it('refuses to remove the system device, without asking the hub or core', async () => {
    const before = [forgotten.length, unregistered.length];
    const response = await server.inject({
      method: 'DELETE',
      url: '/api/v1/devices/system',
      headers: { authorization: await bearer('device:delete') },
    });

    expect(response.statusCode).toBe(409);
    expect([forgotten.length, unregistered.length]).toEqual(before);
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

  it('lists no devices when none has been added', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/devices',
      headers: { authorization: await bearer('device:read') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [] });
  });

  it('refuses a room that is not an area, naming the field', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/devices',
      headers: { authorization: await bearer('device:write') },
      payload: { ...NEW_PRINTER, areaId: '018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e6f' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'VALIDATION', details: { issues: [{ path: 'areaId' }] } },
    });
  });

  it('keeps removing a device from somebody who may only change one', async () => {
    const response = await server.inject({
      method: 'DELETE',
      url: '/api/v1/devices/bambu-lab-x1c',
      headers: { authorization: await bearer('device:write') },
    });

    expect(response.statusCode).toBe(403);
  });

  it('says when there is no such device to remove, without asking the hub or core', async () => {
    forgotten.length = 0;
    unregistered.length = 0;

    const response = await server.inject({
      method: 'DELETE',
      url: '/api/v1/devices/bambu-lab-x1c',
      headers: { authorization: await bearer('device:delete') },
    });

    expect(response.statusCode).toBe(404);
    expect([forgotten, unregistered]).toEqual([[], []]);
  });

  it('says when there is no such device', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/devices/bambu-lab-x1c',
      headers: { authorization: await bearer('device:read') },
    });

    expect(response.statusCode).toBe(404);
  });

  it('refuses to add a device of a vendor nobody has set up, and says so', async () => {
    // The address may be right; the key is missing. The reply sends the owner to the vendor
    // page rather than back to the device form.
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/devices',
      headers: { authorization: await bearer('device:write') },
      payload: {
        id: 'acme-printer',
        kind: 'acme/printer',
        model: 'Printer',
        name: 'Printer',
        transportConfig: { url: 'mqtt://localhost:1883', password: '12345678' },
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: { code: 'CONFLICT', details: { vendorId: 'acme', reason: 'needs-setup' } },
    });
  });

  it('says a device that is not there cannot be changed', async () => {
    const response = await server.inject({
      method: 'PATCH',
      url: '/api/v1/devices/bambu-lab-x1c',
      headers: { authorization: await bearer('device:write') },
      payload: { name: 'Studio printer' },
    });

    expect(response.statusCode).toBe(404);
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

  it('still lists devices, without the drivers names', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/devices',
      headers: { authorization: await bearer('device:read') },
    });

    expect(response.statusCode).toBe(200);
  });

  it('cannot try a configuration, and says which dependency is missing', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/devices/probe',
      headers: { authorization: await bearer('device:write') },
      payload: { kind: 'bambu-lab/printer', transportConfig: {} },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { code: 'DEVICE_UNAVAILABLE' } });
  });
});
