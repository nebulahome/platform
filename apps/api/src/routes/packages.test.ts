/**
 * The package routes against a packet-manager that answers on a bus in memory.
 *
 * What is asserted is who may do what, that the packet-manager's refusals reach the caller as it
 * made them, that settings are sealed before they leave `api`, that a package's method is called
 * with the permission its access asks, and that a package's interface is served from its folder -
 * only from the folder its entry is in, only for the release installed.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { isSealed } from '@nebulahome/db';

import { bearer, buildTestServer, emptyDatabase, stopHub } from '../testing/hub-harness.js';
import { packetManagerRequests } from '../testing/packet-manager-fake.js';

let server: FastifyInstance;

beforeAll(async () => {
  server = await buildTestServer(true, emptyDatabase());
});

afterAll(async () => {
  stopHub();
  await server.close();
});

describe('the installed packages', () => {
  it('lists them with how much of the house each accounts for', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/packages',
      headers: { authorization: await bearer('package:read') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ items: unknown[] }>().items).toEqual([
      expect.objectContaining({ id: 'mqtt', deviceCount: 0, entityCount: 0, isSystem: true }),
    ]);
  });

  it("reads one without its files' place or its secrets, and says so for one that isn't there", async () => {
    const authorization = await bearer('package:read');
    const found = await server.inject({
      method: 'GET',
      url: '/api/v1/packages/mqtt',
      headers: { authorization },
    });
    const missing = await server.inject({
      method: 'GET',
      url: '/api/v1/packages/nvr',
      headers: { authorization },
    });

    expect(found.statusCode).toBe(200);
    expect(found.json()).not.toHaveProperty('root');
    expect(found.json()).toMatchObject({
      config: { port: 1883, password: { $sealed: true } },
      setup: { transport: {} },
    });
    expect(missing.statusCode).toBe(404);
  });
});

describe('changing what is installed', () => {
  it('refuses somebody who may only read packages', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/packages/nvr/install',
      headers: { authorization: await bearer('package:read') },
      payload: {},
    });

    expect(response.statusCode).toBe(403);
  });

  it("passes on the packet-manager's refusals as it made them", async () => {
    const authorization = await bearer('package:install');
    const install = await server.inject({
      method: 'POST',
      url: '/api/v1/packages/watcher/install',
      headers: { authorization },
      payload: {},
    });
    const remove = await server.inject({
      method: 'DELETE',
      url: '/api/v1/packages/mqtt',
      headers: { authorization },
    });

    expect(install.statusCode).toBe(409);
    expect(JSON.stringify(install.json())).toContain('object-detection');
    expect(remove.statusCode).toBe(409);
    expect(JSON.stringify(remove.json())).toContain('system');
  });

  it('installs one, the release asked for passed on', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/packages/nvr/install',
      headers: { authorization: await bearer('package:install') },
      payload: { version: '1.4.0' },
    });

    expect(response.statusCode).toBe(200);
    expect(packetManagerRequests.at(-1)).toEqual({
      method: 'install',
      payload: { packageId: 'nvr', version: '1.4.0' },
    });
  });
});

describe("a package's settings", () => {
  it('are checked against its setup, merged over what is saved, and sealed before they leave', async () => {
    const authorization = await bearer('package:configure');
    const bad = await server.inject({
      method: 'PUT',
      url: '/api/v1/packages/mqtt/config',
      headers: { authorization },
      payload: { transportConfig: { port: 'many' } },
    });
    const good = await server.inject({
      method: 'PUT',
      url: '/api/v1/packages/mqtt/config',
      headers: { authorization },
      payload: { transportConfig: { password: 'hunter2' } },
    });
    const sent = packetManagerRequests.at(-1)?.payload as { values: Record<string, unknown> };

    expect(bad.statusCode).toBe(400);
    expect(good.statusCode).toBe(200);
    expect(sent.values['port']).toBe(1883);
    expect(isSealed(sent.values['password'])).toBe(true);
  });
});

describe("a package's methods", () => {
  it('are called with the permission their access asks', async () => {
    const reader = await bearer('package:read');
    const clients = await server.inject({
      method: 'POST',
      url: '/api/v1/packages/mqtt/rpc/clients',
      headers: { authorization: reader },
      payload: {},
    });
    const kick = await server.inject({
      method: 'POST',
      url: '/api/v1/packages/mqtt/rpc/kick',
      headers: { authorization: reader },
      payload: { input: { client: 'x' } },
    });
    const nope = await server.inject({
      method: 'POST',
      url: '/api/v1/packages/mqtt/rpc/nope',
      headers: { authorization: reader },
      payload: {},
    });

    expect(clients.statusCode).toBe(200);
    expect(clients.json()).toEqual({ output: ['tasmota-kitchen'] });
    expect(kick.statusCode).toBe(403);
    expect(nope.statusCode).toBe(404);
  });
});

describe("a package's interface", () => {
  it('is served to anyone, for good, from the folder of its entry and the release installed', async () => {
    const module = await server.inject({
      method: 'GET',
      url: '/api/v1/packages/mqtt/ui/1.0.0/index.js',
    });
    const asset = await server.inject({
      method: 'GET',
      url: '/api/v1/packages/mqtt/ui/1.0.0/assets/broker.svg',
    });
    const old = await server.inject({
      method: 'GET',
      url: '/api/v1/packages/mqtt/ui/0.9.0/index.js',
    });
    const outside = await server.inject({
      method: 'GET',
      url: '/api/v1/packages/mqtt/ui/1.0.0/..%2Fsecret.txt',
    });
    const logo = await server.inject({ method: 'GET', url: '/api/v1/packages/mqtt/logo' });

    expect(module.statusCode).toBe(200);
    expect(module.headers['content-type']).toContain('text/javascript');
    expect(module.headers['cache-control']).toContain('immutable');
    expect(asset.headers['content-type']).toBe('image/svg+xml');
    expect(old.statusCode).toBe(404);
    expect(outside.statusCode).toBe(404);
    expect(logo.statusCode).toBe(200);
  });
});
