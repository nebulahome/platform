/**
 * The Thread broker's routes against a hub that answers on a bus in memory: who may read the
 * network, set it up, join another and remove the border router, and who may read its key and
 * dataset - each read audited, neither ever written to the audit.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuditLog } from '../services/audit.js';
import { brokerRequests, THREAD_DATASET, THREAD_NETWORK_KEY } from '../testing/brokers-fake.js';
import { bearer, buildTestServer, stopHub } from '../testing/hub-harness.js';

let server: FastifyInstance;

const audited = vi.spyOn(AuditLog.prototype, 'record');

describe('the Thread routes', () => {
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

  it('reads the network with device:read', async () => {
    const status = await server.inject({
      method: 'GET',
      url: '/api/v1/brokers/thread',
      headers: { authorization: await bearer('device:read') },
    });

    expect(status.json()).toMatchObject({
      state: 'running',
      network: { name: 'NebulaHome', role: 'leader' },
      devices: { total: 3, online: 2 },
    });
  });

  it('reveals the key and the dataset to integration:configure only, never auditing either', async () => {
    const reader = await server.inject({
      method: 'GET',
      url: '/api/v1/brokers/thread/network-key',
      headers: { authorization: await bearer('device:write') },
    });
    const key = await server.inject({
      method: 'GET',
      url: '/api/v1/brokers/thread/network-key',
      headers: { authorization: await bearer('integration:configure') },
    });
    const dataset = await server.inject({
      method: 'GET',
      url: '/api/v1/brokers/thread/dataset',
      headers: { authorization: await bearer('integration:configure') },
    });

    expect(reader.statusCode).toBe(403);
    expect(key.json()).toEqual({ networkKey: THREAD_NETWORK_KEY });
    expect(dataset.json()).toEqual({ dataset: THREAD_DATASET });
    expect(audited.mock.calls.map(([entry]) => entry.action)).toEqual([
      'thread.network_key.reveal',
      'thread.dataset.reveal',
    ]);

    const trail = JSON.stringify(audited.mock.calls);

    expect(trail).not.toContain(THREAD_NETWORK_KEY);
    expect(trail).not.toContain(THREAD_DATASET);
  });

  it('sets Thread up by joining a dataset, answering at once and auditing without it', async () => {
    const reader = await server.inject({
      method: 'POST',
      url: '/api/v1/brokers/thread/setup',
      headers: { authorization: await bearer('device:write') },
      payload: {
        border: { mode: 'external', url: 'http://192.168.1.20:8081' },
        network: { action: 'keep' },
      },
    });
    const started = await server.inject({
      method: 'POST',
      url: '/api/v1/brokers/thread/setup',
      headers: { authorization: await bearer('integration:configure') },
      payload: {
        border: { mode: 'external', url: 'http://owner:secret@192.168.1.20:8081' },
        network: { action: 'join', dataset: THREAD_DATASET.toUpperCase() },
      },
    });

    expect(reader.statusCode).toBe(403);
    expect(started.statusCode).toBe(202);
    expect(brokerRequests).toEqual([
      {
        method: 'thread_setup',
        request: {
          border: { mode: 'external', url: 'http://owner:secret@192.168.1.20:8081' },
          network: { action: 'join', dataset: THREAD_DATASET },
          useForMatter: true,
        },
      },
    ]);
    expect(audited).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'thread.setup',
        details: {
          mode: 'external',
          host: '192.168.1.20:8081',
          network: 'join',
          useForMatter: true,
        },
      }),
    );
  });

  it('refuses a dataset that is not hex before asking the hub, and removes the border router', async () => {
    const authorization = await bearer('integration:configure');
    const wrong = await server.inject({
      method: 'POST',
      url: '/api/v1/brokers/thread/join',
      headers: { authorization },
      payload: { dataset: 'not-a-dataset' },
    });
    const removed = await server.inject({
      method: 'DELETE',
      url: '/api/v1/brokers/thread/border-router',
      headers: { authorization },
    });

    expect(wrong.statusCode).toBe(400);
    expect(removed.json()).toEqual({ isRemoved: true });
    expect(brokerRequests.map((each) => each.method)).toEqual(['thread_remove']);
    expect(audited).toHaveBeenCalledWith(expect.objectContaining({ action: 'thread.remove' }));
  });
});
