/**
 * The Serial broker's routes against a hub that answers on a bus in memory: who may read the
 * ports, add one on the network, forget one, change the settings and open the console, and what
 * the audit trail is told.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuditLog } from '../services/audit.js';
import { brokerRequests, SERIAL_PORT } from '../testing/brokers-fake.js';
import { bearer, buildTestServer, stopHub } from '../testing/hub-harness.js';

let server: FastifyInstance;

const audited = vi.spyOn(AuditLog.prototype, 'record');

describe('the Serial routes', () => {
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

  it('reads the broker and its ports with device:read', async () => {
    const authorization = await bearer('device:read');
    const status = await server.inject({
      method: 'GET',
      url: '/api/v1/brokers/serial',
      headers: { authorization },
    });
    const ports = await server.inject({
      method: 'GET',
      url: '/api/v1/brokers/serial/ports',
      headers: { authorization },
    });

    expect(status.json()).toMatchObject({ state: 'running', devices: { total: 1, online: 1 } });
    expect(ports.json()).toMatchObject({
      items: [{ id: SERIAL_PORT.id, devicePath: '/dev/ttyUSB0' }],
    });
  });

  it('changes the settings with integration:configure only, checking them first', async () => {
    const refused = await server.inject({
      method: 'PUT',
      url: '/api/v1/brokers/serial/settings',
      headers: { authorization: await bearer('device:write') },
      payload: { showBuiltin: true },
    });
    const wrong = await server.inject({
      method: 'PUT',
      url: '/api/v1/brokers/serial/settings',
      headers: { authorization: await bearer('integration:configure') },
      payload: { showBuiltin: 'yes' },
    });
    const saved = await server.inject({
      method: 'PUT',
      url: '/api/v1/brokers/serial/settings',
      headers: { authorization: await bearer('integration:configure') },
      payload: { showBuiltin: true },
    });

    expect(refused.statusCode).toBe(403);
    expect(wrong.statusCode).toBe(400);
    expect(saved.json()).toMatchObject({ settings: { showBuiltin: true } });
    expect(audited).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'serial.settings', details: { showBuiltin: true } }),
    );
  });

  it('adds a port on the network with device:write, refusing a host that is none', async () => {
    const wrong = await server.inject({
      method: 'POST',
      url: '/api/v1/brokers/serial/ports',
      headers: { authorization: await bearer('device:write') },
      payload: { name: 'Boiler', host: 'not a host', port: 2000 },
    });
    const added = await server.inject({
      method: 'POST',
      url: '/api/v1/brokers/serial/ports',
      headers: { authorization: await bearer('device:write') },
      payload: { name: 'Boiler', host: '192.168.1.80', port: 2000, protocol: 'rfc2217' },
    });

    expect(wrong.statusCode).toBe(400);
    expect(added.statusCode).toBe(201);
    expect(added.json()).toMatchObject({ kind: 'network', path: 'tcp://192.168.1.80:2000' });
    expect(brokerRequests.map((each) => each.method)).toEqual(['serial_network_port_save']);
  });

  it('forgets a port with device:delete, auditing it, and says when there is none', async () => {
    const refused = await server.inject({
      method: 'DELETE',
      url: `/api/v1/brokers/serial/ports/${SERIAL_PORT.id}`,
      headers: { authorization: await bearer('device:write') },
    });
    const forgotten = await server.inject({
      method: 'DELETE',
      url: `/api/v1/brokers/serial/ports/${SERIAL_PORT.id}`,
      headers: { authorization: await bearer('device:delete') },
    });
    const missing = await server.inject({
      method: 'DELETE',
      url: '/api/v1/brokers/serial/ports/00000000-0000-4000-8000-0000000000aa',
      headers: { authorization: await bearer('device:delete') },
    });

    expect(refused.statusCode).toBe(403);
    expect(forgotten.statusCode).toBe(204);
    expect(missing.statusCode).toBe(404);
    expect(audited).toHaveBeenCalledTimes(1);
    expect(audited).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'serial.port.forget', resourceId: SERIAL_PORT.id }),
    );
  });

  it('opens, reads and writes the console with integration:configure only', async () => {
    const authorization = await bearer('integration:configure');
    const refused = await server.inject({
      method: 'POST',
      url: '/api/v1/brokers/serial/console',
      headers: { authorization: await bearer('device:write') },
      payload: { portId: SERIAL_PORT.id, line: { baudRate: 115_200 } },
    });
    const opened = await server.inject({
      method: 'POST',
      url: '/api/v1/brokers/serial/console',
      headers: { authorization },
      payload: { portId: SERIAL_PORT.id, line: { baudRate: 115_200 } },
    });
    const read = await server.inject({
      method: 'GET',
      url: '/api/v1/brokers/serial/console/console-1?after=0',
      headers: { authorization },
    });
    const written = await server.inject({
      method: 'POST',
      url: '/api/v1/brokers/serial/console/console-1/write',
      headers: { authorization },
      payload: { data: '41540D', lineEnding: 'crlf' },
    });

    expect(refused.statusCode).toBe(403);
    expect(opened.json()).toMatchObject({ consoleId: 'console-1', line: { baudRate: 115_200 } });
    expect(read.json()).toMatchObject({ cursor: 1, isOpen: true });
    expect(written.json()).toEqual({ bytes: 5 });
    expect(brokerRequests.slice(1).map((each) => each.request)).toEqual([
      { consoleId: 'console-1', after: 0 },
      { consoleId: 'console-1', data: '41540d', lineEnding: 'crlf' },
    ]);
    expect(audited).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'serial.console.open', resourceId: SERIAL_PORT.id }),
    );
  });
});
