/**
 * A container's page through the platform, against a page served by this test: who gets in, what
 * the container receives, and a WebSocket joined both ways.
 */
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Socket } from 'node:net';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';

import {
  bearer,
  buildTestServer,
  emptyDatabase,
  ingressTargets,
  stopHub,
} from '../testing/hub-harness.js';

/** What the page was last asked. */
type Asked = {
  readonly method: string;
  readonly url: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
};

const PAGE = '/api/ingress/nebulahome-zigbee2mqtt';

/** The policy that lets the platform's own page, and only it, frame an answer. */
const FRAMED_BY_PLATFORM = "frame-ancestors 'self'";

/** What the page sends besides its body, by path: its own policy for any path not listed. */
const PAGE_HEADERS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  '/bare': {},
  '/unframeable': {
    'x-frame-options': 'DENY',
    'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
  },
  '/two-policies': { 'content-security-policy': "img-src 'self', FRAME-ANCESTORS 'none'" },
};

let server: FastifyInstance;
let page: Server;
let asked: Asked | undefined;

/**
 * The cookie a browser holds after `POST /ingress/session`, with one of the page's own beside it.
 *
 * @param permissions - What the token carries.
 * @returns The `Cookie` header.
 */
async function cookieWith(...permissions: string[]): Promise<string> {
  const token = (await bearer(...permissions)).replace('Bearer ', '');

  return `theme=dark; nebula_ingress=${token}`;
}

beforeAll(async () => {
  page = createServer((request, response) => {
    let body = '';

    request.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on('end', () => {
      asked = {
        method: request.method ?? '',
        url: request.url ?? '',
        headers: request.headers,
        body,
      };
      response.writeHead(200, {
        'content-type': 'text/html',
        ...(PAGE_HEADERS[request.url ?? ''] ?? { 'content-security-policy': "script-src 'self'" }),
      });
      response.end('<p>Zigbee2MQTT</p>');
    });
  });

  // Says back what it is told.
  new WebSocketServer({ server: page }).on('connection', (socket) => {
    socket.on('message', (data, isBinary) => {
      socket.send(data, { binary: isBinary });
    });
  });

  await new Promise<void>((resolve) => {
    page.listen(0, '127.0.0.1', resolve);
  });

  ingressTargets.set('nebulahome-zigbee2mqtt', {
    url: `http://127.0.0.1:${String((page.address() as AddressInfo).port)}`,
    ownerKind: 'vendor',
  });
  server = await buildTestServer(true, emptyDatabase());
  await server.ready();
});

afterAll(async () => {
  stopHub();
  ingressTargets.clear();
  await server.close();
  page.closeAllConnections();
  await new Promise<void>((resolve) => {
    page.close(() => {
      resolve();
    });
  });
});

describe('the cookie a page is opened with', () => {
  it('holds the caller’s token, for the pages’ paths only and out of reach of script', async () => {
    const authorization = await bearer('integration:read');
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/ingress/session',
      headers: { authorization },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['set-cookie']).toBe(
      `nebula_ingress=${authorization.replace('Bearer ', '')}; Path=/api/ingress/; HttpOnly; SameSite=Strict; Max-Age=900`,
    );
    // An answer of the API's, outside the pages' paths: the front door's policy stays on it.
    expect(response.headers['content-security-policy']).toBeUndefined();
  });
});

describe('a container’s page', () => {
  it('is closed without the cookie, and to one who may not configure the integration', async () => {
    const without = await server.inject({ method: 'GET', url: `${PAGE}/` });
    const member = await server.inject({
      method: 'GET',
      url: `${PAGE}/`,
      headers: { cookie: await cookieWith('integration:read') },
    });

    expect(without.statusCode).toBe(401);
    expect(member.statusCode).toBe(403);
    expect(asked).toBeUndefined();
    // Shown in the platform's window, a refusal is framed like the page.
    expect(without.headers['content-security-policy']).toBe(FRAMED_BY_PLATFORM);
    expect(member.headers['content-security-policy']).toBe(FRAMED_BY_PLATFORM);
  });

  it('is not found for a container without one', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/ingress/nebulahome-tasmota/',
      headers: { cookie: await cookieWith('integration:read', 'integration:configure') },
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-security-policy']).toBe(FRAMED_BY_PLATFORM);
  });

  it('reaches the container under its own path, without the platform’s credentials', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `${PAGE}/assets/index.js?v=2`,
      headers: { cookie: await cookieWith('integration:read', 'integration:configure') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('<p>Zigbee2MQTT</p>');
    expect(response.headers['content-security-policy']).toBe(
      `script-src 'self', ${FRAMED_BY_PLATFORM}`,
    );
    expect(asked).toMatchObject({
      method: 'GET',
      url: '/assets/index.js?v=2',
      headers: { cookie: 'theme=dark', 'x-forwarded-prefix': PAGE, 'x-ingress-path': PAGE },
    });
    expect(asked?.headers).not.toHaveProperty('authorization');
  });

  it('passes on a body of any kind as it came', async () => {
    const response = await server.inject({
      method: 'POST',
      url: `${PAGE}/api/upload`,
      headers: {
        cookie: await cookieWith('integration:read', 'integration:configure'),
        'content-type': 'application/octet-stream',
      },
      payload: 'firmware',
    });

    expect(response.statusCode).toBe(200);
    expect(asked).toMatchObject({ method: 'POST', url: '/api/upload', body: 'firmware' });
  });

  it('sends its address without the slash to the one with it, where its links resolve', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `${PAGE}?tab=map`,
      headers: { cookie: await cookieWith('integration:read', 'integration:configure') },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(`${PAGE}/?tab=map`);
    expect(response.headers['content-security-policy']).toBe(FRAMED_BY_PLATFORM);
  });

  it('may be framed by the platform’s own page even when the container refuses every frame', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `${PAGE}/unframeable`,
      headers: { cookie: await cookieWith('integration:read', 'integration:configure') },
    });

    expect(response.statusCode).toBe(200);
    // The container's DENY is gone; what is left is the platform's own, which lets its page in.
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['content-security-policy']).toBe(
      `default-src 'self', ${FRAMED_BY_PLATFORM}`,
    );
    expect(response.headers['content-security-policy']).not.toContain("'none'");
  });

  it('drops a policy of the container’s that only refused frames, keeping the others', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `${PAGE}/two-policies`,
      headers: { cookie: await cookieWith('integration:read', 'integration:configure') },
    });

    expect(response.headers['content-security-policy']).toBe(
      `img-src 'self', ${FRAMED_BY_PLATFORM}`,
    );
  });

  it('may be framed by the platform’s own page only, when the container sends no policy', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `${PAGE}/bare`,
      headers: { cookie: await cookieWith('integration:read', 'integration:configure') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-security-policy']).toBe(FRAMED_BY_PLATFORM);
  });

  it('joins its WebSocket to the container’s, both ways', async () => {
    const socket = await server.injectWS(`${PAGE}/api`, {
      socket: new Socket(),
      headers: { cookie: await cookieWith('integration:read', 'integration:configure') },
    });
    const answer = new Promise<string>((resolve) => {
      socket.once('message', (data: Buffer) => {
        resolve(data.toString());
      });
    });

    socket.send('{"topic":"bridge/request/permit_join"}');

    await expect(answer).resolves.toBe('{"topic":"bridge/request/permit_join"}');
    socket.terminate();
  });

  it('says the page does not answer when the container is away', async () => {
    ingressTargets.set('nebulahome-gone', { url: 'http://127.0.0.1:9', ownerKind: 'vendor' });

    const response = await server.inject({
      method: 'GET',
      url: '/api/ingress/nebulahome-gone/',
      headers: { cookie: await cookieWith('integration:read', 'integration:configure') },
    });

    expect(response.statusCode).toBe(503);
    expect(response.headers['content-security-policy']).toBe(FRAMED_BY_PLATFORM);
  });
});
