/**
 * The Infrared broker's routes against a hub that answers on a bus in memory: who may read the
 * remotes, make one, remove one never added, save, press and remove a button and learn a code,
 * an icon checked against the catalogue before the hub is asked, and what the audit trail is told.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuditLog } from '../services/audit.js';
import { brokerRequests, INFRARED_BUTTON, INFRARED_REMOTE } from '../testing/brokers-fake.js';
import { bearer, buildTestServer, stopHub } from '../testing/hub-harness.js';

let server: FastifyInstance;

const audited = vi.spyOn(AuditLog.prototype, 'record');

describe('the Infrared routes', () => {
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

  it('reads the broker and its remotes with device:read', async () => {
    const authorization = await bearer('device:read');
    const status = await server.inject({
      method: 'GET',
      url: '/api/v1/brokers/infrared',
      headers: { authorization },
    });
    const remotes = await server.inject({
      method: 'GET',
      url: '/api/v1/brokers/infrared/remotes',
      headers: { authorization },
    });

    expect(status.json()).toMatchObject({ state: 'running', devices: { total: 1, online: 1 } });
    expect(remotes.json()).toMatchObject({ items: [{ id: INFRARED_REMOTE.id }] });
  });

  it('makes a remote with device:write, its room left alone when its device is not there yet', async () => {
    const body = {
      name: 'Bedroom fan',
      kind: 'fan',
      blasterId: 'broadlink-rm4',
      areaId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
    };
    const reader = await server.inject({
      method: 'POST',
      url: '/api/v1/brokers/infrared/remotes',
      headers: { authorization: await bearer('device:read') },
      payload: body,
    });
    const nameless = await server.inject({
      method: 'POST',
      url: '/api/v1/brokers/infrared/remotes',
      headers: { authorization: await bearer('device:write') },
      payload: { ...body, name: ' ' },
    });
    // The fake hub answers with no device: the database, which would reject, is never asked.
    const saved = await server.inject({
      method: 'POST',
      url: '/api/v1/brokers/infrared/remotes',
      headers: { authorization: await bearer('device:write') },
      payload: body,
    });

    expect(reader.statusCode).toBe(403);
    expect(nameless.statusCode).toBe(400);
    expect(saved.statusCode).toBe(201);
    expect(saved.json()).toMatchObject({ name: 'Bedroom fan', deviceId: null, areaId: null });
    expect(brokerRequests.map((each) => each.method)).toEqual(['infrared_remote_save']);
    expect(audited).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'infrared.remote.save' }),
    );
  });

  it('removes a remote never added from the broker alone, auditing it', async () => {
    const removed = await server.inject({
      method: 'DELETE',
      url: `/api/v1/brokers/infrared/remotes/${INFRARED_REMOTE.id}`,
      headers: { authorization: await bearer('device:delete') },
    });
    const missing = await server.inject({
      method: 'DELETE',
      url: '/api/v1/brokers/infrared/remotes/00000000-0000-4000-8000-0000000000aa',
      headers: { authorization: await bearer('device:delete') },
    });

    expect(removed.statusCode).toBe(204);
    expect(missing.statusCode).toBe(404);
    expect(brokerRequests.map((each) => each.method)).toEqual([
      'infrared_remotes',
      'infrared_remote_remove',
      'infrared_remotes',
    ]);
    expect(audited).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'infrared.remote.remove',
        details: { name: INFRARED_REMOTE.name, entityIds: [] },
      }),
    );
  });

  it('refuses a button whose icon the catalogue does not have before asking the hub', async () => {
    const refused = await server.inject({
      method: 'POST',
      url: '/api/v1/brokers/infrared/buttons',
      headers: { authorization: await bearer('device:write') },
      payload: {
        remoteId: INFRARED_REMOTE.id,
        name: 'Mute',
        icon: 'no-such-icon',
        code: INFRARED_BUTTON.code,
      },
    });
    const saved = await server.inject({
      method: 'POST',
      url: '/api/v1/brokers/infrared/buttons',
      headers: { authorization: await bearer('device:write') },
      payload: { remoteId: INFRARED_REMOTE.id, name: 'Mute', code: INFRARED_BUTTON.code },
    });

    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({ error: { details: { issues: [{ path: 'icon' }] } } });
    expect(saved.json()).toMatchObject({ name: 'Mute', cell: 1 });
    expect(brokerRequests.map((each) => each.method)).toEqual(['infrared_button_save']);
  });

  it('presses a button, learns a code and removes a button', async () => {
    const pressed = await server.inject({
      method: 'POST',
      url: `/api/v1/brokers/infrared/buttons/${INFRARED_BUTTON.id}/press`,
      headers: { authorization: await bearer('device:write') },
    });
    const learning = await server.inject({
      method: 'POST',
      url: '/api/v1/brokers/infrared/learn',
      headers: { authorization: await bearer('device:write') },
      payload: { blasterId: 'broadlink-rm4' },
    });
    const removed = await server.inject({
      method: 'DELETE',
      url: `/api/v1/brokers/infrared/buttons/${INFRARED_BUTTON.id}`,
      headers: { authorization: await bearer('device:delete') },
    });

    expect(pressed.json()).toEqual({ pressedAt: '2026-10-28T08:00:00.000Z' });
    expect(learning.statusCode).toBe(202);
    expect(learning.json()).toMatchObject({ phase: 'listening', signal: 'ir' });
    expect(removed.statusCode).toBe(204);
    expect(audited).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'infrared.button.remove', resourceId: INFRARED_BUTTON.id }),
    );
  });
});
