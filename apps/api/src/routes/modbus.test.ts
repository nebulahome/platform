/**
 * The Modbus broker's routes against a hub that answers on a bus in memory: who may read it, add
 * a device, test a write and change the search, and a device never added removed from the broker
 * alone.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  bearer,
  buildTestServer,
  MODBUS_RELAY,
  modbusRequests,
  stopHub,
} from '../testing/hub-harness.js';

let server: FastifyInstance;

describe('the Modbus routes', () => {
  beforeAll(async () => {
    server = await buildTestServer(true);
  });

  beforeEach(() => {
    modbusRequests.length = 0;
  });

  afterAll(async () => {
    stopHub();
    await server.close();
  });

  it('reads the broker and its devices with device:read', async () => {
    const authorization = await bearer('device:read');
    const status = await server.inject({
      method: 'GET',
      url: '/api/v1/brokers/modbus',
      headers: { authorization },
    });
    const devices = await server.inject({
      method: 'GET',
      url: '/api/v1/brokers/modbus/devices',
      headers: { authorization },
    });

    expect(status.json()).toMatchObject({ state: 'running', devices: { total: 1, online: 1 } });
    expect(devices.json()).toEqual({
      items: [JSON.parse(JSON.stringify(MODBUS_RELAY)) as unknown],
    });
  });

  it('adds a device with device:write, and refuses device:read', async () => {
    const body = {
      name: 'Pool pump',
      host: '192.168.1.61',
      port: 502,
      unitId: 7,
      framing: 'rtu',
      template: MODBUS_RELAY.template,
    };
    const refused = await server.inject({
      method: 'POST',
      url: '/api/v1/brokers/modbus/devices',
      headers: { authorization: await bearer('device:read') },
      payload: body,
    });
    const added = await server.inject({
      method: 'POST',
      url: '/api/v1/brokers/modbus/devices',
      headers: { authorization: await bearer('device:write') },
      payload: body,
    });

    expect(refused.statusCode).toBe(403);
    expect(added.statusCode).toBe(201);
    expect(added.json()).toMatchObject({ name: 'Pool pump', unitId: 7, framing: 'rtu' });
    expect(modbusRequests).toEqual(['save Pool pump']);
  });

  it('refuses a template whose entity names an icon the catalogue does not have', async () => {
    const saved = await server.inject({
      method: 'POST',
      url: '/api/v1/brokers/modbus/templates',
      headers: { authorization: await bearer('device:write') },
      payload: {
        document: {
          name: 'Relay board',
          entities: [
            {
              name: 'Relay 1',
              icon: 'no-such-icon',
              domain: 'switch',
              capabilities: { on_off: { read: { function: 1, address: 0 } } },
            },
          ],
        },
      },
    });

    expect(saved.statusCode).toBe(400);
    expect(saved.json()).toMatchObject({
      error: {
        details: { issues: [{ path: 'document.entities.0.icon' }] },
      },
    });
    expect(modbusRequests).toEqual([]);
  });

  it('removes a device never added from the broker alone', async () => {
    const response = await server.inject({
      method: 'DELETE',
      url: `/api/v1/brokers/modbus/devices/${MODBUS_RELAY.id}`,
      headers: { authorization: await bearer('device:delete') },
    });

    expect(response.statusCode).toBe(204);
    expect(modbusRequests).toEqual([`remove ${MODBUS_RELAY.id}`]);
  });

  it('sends a test write with device:write', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/brokers/modbus/test/write',
      headers: { authorization: await bearer('device:write') },
      payload: {
        target: { host: '192.168.1.60' },
        entity: {
          name: 'Relay 1',
          domain: 'switch',
          capabilities: { on_off: { read: { function: 1, address: 0 }, write: { function: 5 } } },
        },
        capability: 'on_off',
        command: { command: 'turn_on' },
      },
    });

    expect(response.json()).toMatchObject({ request: '05 00 00 FF 00', error: null });
    expect(modbusRequests).toEqual(['test_write']);
  });

  it('changes the search with integration:configure, checking the ranges first', async () => {
    const wrong = await server.inject({
      method: 'PUT',
      url: '/api/v1/brokers/modbus/settings',
      headers: { authorization: await bearer('integration:configure') },
      payload: { isSearchEnabled: true, ranges: ['garage'], intervalMinutes: 120 },
    });
    const refused = await server.inject({
      method: 'PUT',
      url: '/api/v1/brokers/modbus/settings',
      headers: { authorization: await bearer('device:write') },
      payload: { isSearchEnabled: true, ranges: ['192.168.1.0/24'], intervalMinutes: 120 },
    });
    const saved = await server.inject({
      method: 'PUT',
      url: '/api/v1/brokers/modbus/settings',
      headers: { authorization: await bearer('integration:configure') },
      payload: { isSearchEnabled: true, ranges: ['192.168.1.0/24'], intervalMinutes: 60 },
    });

    expect(wrong.statusCode).toBe(400);
    expect(refused.statusCode).toBe(403);
    expect(saved.json()).toMatchObject({
      settings: { isSearchEnabled: true, intervalMinutes: 60 },
    });
    expect(modbusRequests).toHaveLength(1);
  });
});
