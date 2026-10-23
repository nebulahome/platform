/**
 * Webhooks against a database that answers nothing and a fake `core`: the public address checks
 * the id, hands `core` the call without its body or its credentials, and answers what `core`
 * said; the lists are for whoever may read automations.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { isLocalAddress } from '../services/webhooks.js';
import {
  bearer,
  buildTestServer,
  emptyDatabase,
  stopHub,
  webhookCalls,
} from '../testing/hub-harness.js';

let server: FastifyInstance;

const HOOK = '7f3a9c2e5b1d4e88a0b1c2d3e4f50617';

beforeAll(async () => {
  server = await buildTestServer(true, emptyDatabase());
});

afterAll(async () => {
  stopHub();
  await server.close();
});

describe('a webhook address', () => {
  it('answers 404 to a path that is no webhook id, without asking core', async () => {
    const before = webhookCalls.length;
    const response = await server.inject({ method: 'POST', url: '/api/hooks/7f3a9c2e' });

    expect(response.statusCode).toBe(404);
    expect(webhookCalls).toHaveLength(before);
  });

  it('takes any body without a credential, and passes on neither body nor secrets', async () => {
    const response = await server.inject({
      method: 'POST',
      url: `/api/hooks/${HOOK}?token=abc`,
      headers: {
        authorization: 'Bearer not-a-session',
        cookie: 'session=1',
        'content-type': 'application/xml',
        'user-agent': 'curl/8.5.0',
      },
      payload: '<ring/>',
    });
    const call = webhookCalls.at(-1);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      outcome: 'started',
      runId: '0190f5a1-0000-7000-8000-000000000002',
    });
    expect(call).toMatchObject({
      hookId: HOOK,
      method: 'POST',
      path: `/api/hooks/${HOOK}`,
      isLocal: true,
      userAgent: 'curl/8.5.0',
    });
    expect(call?.headers).toMatchObject({ authorization: '[hidden]', cookie: '[hidden]' });
    expect(JSON.stringify(call)).not.toContain('ring');
  });
});

describe('the webhook lists', () => {
  it('are for somebody who may read automations', async () => {
    for (const url of ['/api/v1/webhooks', '/api/v1/webhooks/calls?since=7d&methods=GET,POST']) {
      const refused = await server.inject({
        method: 'GET',
        url,
        headers: { authorization: await bearer('scene:read') },
      });
      const allowed = await server.inject({
        method: 'GET',
        url,
        headers: { authorization: await bearer('automation:read') },
      });

      expect(refused.statusCode).toBe(403);
      expect(allowed.statusCode).toBe(200);
      expect(allowed.json()).toMatchObject({ items: [] });
    }
  });
});

describe('isLocalAddress', () => {
  it('knows the house network, IPv4 and IPv6, from the internet', () => {
    expect(
      ['192.168.178.34', '10.0.0.7', '172.31.1.1', '127.0.0.1', '::ffff:192.168.1.5', '::1'].map(
        isLocalAddress,
      ),
    ).toEqual([true, true, true, true, true, true]);
    expect(['fd12:3456::1', 'fe80::1'].map(isLocalAddress)).toEqual([true, true]);
    expect(
      ['93.41.12.208', '172.32.0.1', '2001:db8::1', '::ffff:8.8.8.8', 'nonsense', ''].map(
        isLocalAddress,
      ),
    ).toEqual([false, false, false, false, false, false]);
  });
});
