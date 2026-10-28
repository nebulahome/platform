/**
 * The Bluetooth broker's routes against a hub that answers on a bus in memory: who may read it
 * and hold the Nearby lease, add a device heard, make a device a proxy and remove one, and what
 * the audit trail is told.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuditLog } from '../services/audit.js';
import { BLUETOOTH_SENSOR, brokerRequests } from '../testing/brokers-fake.js';
import { bearer, buildTestServer, stopHub } from '../testing/hub-harness.js';

let server: FastifyInstance;

const audited = vi.spyOn(AuditLog.prototype, 'record');

describe('the Bluetooth routes', () => {
  beforeAll(async () => {
    server = await buildTestServer(true);
  });

  beforeEach(() => {
    brokerRequests.length = 0;
    audited.mockClear();
  });

  afterAll(async () => {
    stopHub();
    await server.close();
  });

  it('reads the broker and its devices, and holds the Nearby lease, with device:read', async () => {
    const authorization = await bearer('device:read');
    const status = await server.inject({
      method: 'GET',
      url: '/api/v1/brokers/bluetooth',
      headers: { authorization },
    });
    const devices = await server.inject({
      method: 'GET',
      url: '/api/v1/brokers/bluetooth/devices',
      headers: { authorization },
    });
    const lease = await server.inject({
      method: 'PUT',
      url: '/api/v1/brokers/bluetooth/nearby/lease',
      headers: { authorization },
      payload: { leaseId: '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e', isHeld: true },
    });

    expect(status.json()).toMatchObject({ state: 'running', devices: { total: 2, online: 1 } });
    expect(devices.json()).toMatchObject({ items: [{ address: BLUETOOTH_SENSOR.address }] });
    expect(lease.json()).toMatchObject({ isForwardingAll: true });
  });

  it('adds a device heard with device:write, refusing what is no address', async () => {
    const reader = await server.inject({
      method: 'POST',
      url: '/api/v1/brokers/bluetooth/devices',
      headers: { authorization: await bearer('device:read') },
      payload: { address: 'a4:c1:38:00:11:22' },
    });
    const wrong = await server.inject({
      method: 'POST',
      url: '/api/v1/brokers/bluetooth/devices',
      headers: { authorization: await bearer('device:write') },
      payload: { address: 'kitchen' },
    });
    const added = await server.inject({
      method: 'POST',
      url: '/api/v1/brokers/bluetooth/devices',
      headers: { authorization: await bearer('device:write') },
      payload: { address: 'a4:c1:38:00:11:22' },
    });

    expect(reader.statusCode).toBe(403);
    expect(wrong.statusCode).toBe(400);
    expect(added.json()).toEqual({ deviceId: 'bluetooth-a4c138001122' });
    expect(brokerRequests).toEqual([
      { method: 'bluetooth_add', request: { address: 'A4:C1:38:00:11:22' } },
    ]);
    expect(audited).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'bluetooth.device.add' }),
    );
  });

  it('makes a device a proxy with integration:configure only, answering the job at once', async () => {
    const writer = await server.inject({
      method: 'POST',
      url: '/api/v1/brokers/bluetooth/proxies',
      headers: { authorization: await bearer('device:write') },
      payload: { deviceId: 'shelly-plug-1', mode: 'passive' },
    });
    const started = await server.inject({
      method: 'POST',
      url: '/api/v1/brokers/bluetooth/proxies',
      headers: { authorization: await bearer('integration:configure') },
      payload: { deviceId: 'shelly-plug-1', mode: 'active' },
    });
    const job = await server.inject({
      method: 'GET',
      url: '/api/v1/brokers/bluetooth/proxies/jobs/proxy-1',
      headers: { authorization: await bearer('device:read') },
    });

    expect(writer.statusCode).toBe(403);
    expect(started.statusCode).toBe(202);
    expect(started.json()).toMatchObject({ id: 'proxy-1', mode: 'active', state: 'running' });
    expect(job.json()).toMatchObject({ id: 'proxy-1' });
    expect(audited).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'bluetooth.proxy.install',
        resourceId: 'shelly-plug-1',
        details: { jobId: 'proxy-1', mode: 'active' },
      }),
    );
  });

  it('changes a proxy’s mode and removes it, auditing both', async () => {
    const authorization = await bearer('integration:configure');
    const mode = await server.inject({
      method: 'PUT',
      url: '/api/v1/brokers/bluetooth/proxies/shelly-plug-1/mode',
      headers: { authorization },
      payload: { mode: 'active' },
    });
    const removed = await server.inject({
      method: 'DELETE',
      url: '/api/v1/brokers/bluetooth/proxies/shelly-plug-1',
      headers: { authorization },
    });
    const none = await server.inject({
      method: 'DELETE',
      url: '/api/v1/brokers/bluetooth/proxies/kitchen-lamp',
      headers: { authorization },
    });

    expect(mode.json()).toMatchObject({ id: 'shelly-plug-1', scanMode: 'active' });
    expect(removed.statusCode).toBe(204);
    expect(none.statusCode).toBe(404);
    expect(audited.mock.calls.map(([entry]) => entry.action)).toEqual([
      'bluetooth.proxy.mode',
      'bluetooth.proxy.remove',
    ]);
  });

  it('refuses to remove a device that is not one of Bluetooth’s, or without device:delete', async () => {
    const writer = await server.inject({
      method: 'DELETE',
      url: `/api/v1/brokers/bluetooth/devices/${BLUETOOTH_SENSOR.deviceId}`,
      headers: { authorization: await bearer('device:write') },
    });
    const other = await server.inject({
      method: 'DELETE',
      url: '/api/v1/brokers/bluetooth/devices/bambu-lab-x1c',
      headers: { authorization: await bearer('device:delete') },
    });

    expect(writer.statusCode).toBe(403);
    expect(other.statusCode).toBe(404);
    expect(audited).not.toHaveBeenCalled();
  });
});
