/**
 * The broker routes against a hub that answers on a bus in memory: who may read and drive the
 * house's Matter fabric, a pairing code checked before the hub is asked, and a node with nothing
 * in the house removed from the fabric alone; who may read the MQTT broker and who may change who connects to it, and a client's
 * password answered once. Every broker's card, one the hub cannot read failed on its own.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { HUB_INFRARED_STATUS_METHOD } from '@nebulahome/contracts';

import { brokerRequests, failingStatuses } from '../testing/brokers-fake.js';
import {
  bearer,
  buildTestServer,
  MATTER_LAMP,
  matterRequests,
  MQTT_PLUG,
  mqttRequests,
  stopHub,
} from '../testing/hub-harness.js';

let server: FastifyInstance;

describe('the broker routes', () => {
  beforeAll(async () => {
    server = await buildTestServer(true);
  });

  beforeEach(() => {
    matterRequests.length = 0;
    mqttRequests.length = 0;
    brokerRequests.length = 0;
    failingStatuses.clear();
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
      items: [
        { id: 'matter', state: 'running', devices: { total: 1, online: 1, linked: 0 } },
        { id: 'thread', state: 'running', devices: { total: 3, online: 2, linked: 0 } },
        { id: 'bluetooth', state: 'running', devices: { total: 2, online: 1, linked: 0 } },
        { id: 'mqtt', state: 'running', devices: { total: 1, online: 1, linked: 0 } },
        { id: 'modbus', state: 'running', devices: { total: 1, online: 1, linked: 0 } },
        { id: 'serial', state: 'running', devices: { total: 1, online: 1, linked: 0 } },
        { id: 'infrared', state: 'running', devices: { total: 1, online: 1, linked: 0 } },
      ],
    });
    expect(nodes.json()).toEqual({ items: [MATTER_LAMP] });

    const network = await server.inject({
      method: 'GET',
      url: '/api/v1/brokers/matter/network',
      headers: { authorization },
    });

    expect(network.json()).toMatchObject({
      collectedAt: '2026-10-23T12:00:00.000Z',
      nodes: [{ nodeId: '7', network: 'thread', networkName: 'Casa', channel: 15 }],
      links: [],
    });
  });

  it('lists a broker the hub cannot read as failed, the others standing', async () => {
    failingStatuses.add(HUB_INFRARED_STATUS_METHOD);

    const brokers = await server.inject({
      method: 'GET',
      url: '/api/v1/brokers',
      headers: { authorization: await bearer('device:read') },
    });
    const { items } = brokers.json<{ items: { id: string; state: string }[] }>();

    expect(brokers.statusCode).toBe(200);
    expect(items.map((item) => `${item.id} ${item.state}`)).toEqual([
      'matter running',
      'thread running',
      'bluetooth running',
      'mqtt running',
      'modbus running',
      'serial running',
      'infrared failed',
    ]);
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

  it('reads the MQTT broker, its devices, clients and topics', async () => {
    const authorization = await bearer('device:read');
    /**
     * Reads one of the broker's routes.
     *
     * @param url - What follows `/brokers/mqtt`.
     * @returns The answer's body.
     */
    const read = async (url: string): Promise<unknown> =>
      (
        await server.inject({
          method: 'GET',
          url: `/api/v1/brokers/mqtt${url}`,
          headers: { authorization },
        })
      ).json<unknown>();

    expect(await read('')).toMatchObject({ state: 'running', port: 1883, clientsOnline: 2 });
    expect(await read('/devices')).toEqual({ items: [MQTT_PLUG] });
    expect(await read('/clients')).toMatchObject({ items: [{ username: 'nebula-hub' }] });
    expect(await read('/topics?prefix=stat%2F&limit=5')).toMatchObject({
      items: [{ topic: 'stat/state', isRetained: true }],
      total: 1,
    });
  });

  it('lets only who configures integrations add a client, and answers its password once', async () => {
    const reader = await server.inject({
      method: 'POST',
      url: '/api/v1/brokers/mqtt/clients',
      headers: { authorization: await bearer('device:write') },
      payload: { username: 'plug' },
    });
    const platform = await server.inject({
      method: 'POST',
      url: '/api/v1/brokers/mqtt/clients',
      headers: { authorization: await bearer('integration:configure') },
      payload: { username: 'nebula-hub' },
    });
    const added = await server.inject({
      method: 'POST',
      url: '/api/v1/brokers/mqtt/clients',
      headers: { authorization: await bearer('integration:configure') },
      payload: { username: 'plug', label: 'Desk plug' },
    });
    const removed = await server.inject({
      method: 'DELETE',
      url: '/api/v1/brokers/mqtt/clients/plug',
      headers: { authorization: await bearer('integration:configure') },
    });

    expect(reader.statusCode).toBe(403);
    expect(platform.statusCode).toBe(400);
    expect(added.statusCode).toBe(201);
    expect(added.json()).toEqual({ username: 'plug', password: 'once-only' });
    expect(removed.json()).toEqual({ isRemoved: true });
    expect(mqttRequests).toEqual(['add plug', 'remove plug']);
  });

  it('saves the settings, a mapping, and brings a device back', async () => {
    const settings = await server.inject({
      method: 'PUT',
      url: '/api/v1/brokers/mqtt/settings',
      headers: { authorization: await bearer('integration:configure') },
      payload: { allowAnonymous: false, isDiscoveryEnabled: true, discoveryPrefix: 'devices' },
    });
    const mapped = await server.inject({
      method: 'POST',
      url: '/api/v1/brokers/mqtt/mappings',
      headers: { authorization: await bearer('device:write') },
      payload: { name: 'Garden', component: 'sensor', stateTopic: 'tele/garden/SENSOR' },
    });
    const unmapped = await server.inject({
      method: 'DELETE',
      url: '/api/v1/brokers/mqtt/mappings/garden-1',
      headers: { authorization: await bearer('device:delete') },
    });
    const missing = await server.inject({
      method: 'DELETE',
      url: '/api/v1/brokers/mqtt/mappings/other',
      headers: { authorization: await bearer('device:delete') },
    });
    const restored = await server.inject({
      method: 'POST',
      url: '/api/v1/brokers/mqtt/restore',
      headers: { authorization: await bearer('device:write') },
      payload: { deviceKey: 'C82B96' },
    });

    expect(settings.json()).toMatchObject({ settings: { discoveryPrefix: 'devices' } });
    expect(mapped.json()).toMatchObject({ id: 'garden-1', name: 'Garden' });
    expect(unmapped.statusCode).toBe(204);
    expect(missing.statusCode).toBe(404);
    expect(restored.json()).toEqual({ isRestored: true });
    expect(mqttRequests).toEqual([
      'settings {"allowAnonymous":false,"isDiscoveryEnabled":true,"discoveryPrefix":"devices"}',
      'save Garden',
      'unmap garden-1',
      'unmap other',
      'restore C82B96',
    ]);
  });
});
