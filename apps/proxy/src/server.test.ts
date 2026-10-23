/**
 * The front door: the page's files with the cache headers their names allow, the page for the
 * single-page app's own routes, and `/api` passed to `api` as it came.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildProxyServer } from './server.js';

/** A script large enough to be worth compressing. */
const SCRIPT = `console.log(${JSON.stringify('x'.repeat(4096))});`;

describe('buildProxyServer', () => {
  let webRoot = '';
  let upstream: FastifyInstance;
  let proxy: FastifyInstance;

  beforeAll(async () => {
    webRoot = mkdtempSync(path.join(tmpdir(), 'nebula-proxy-'));
    mkdirSync(path.join(webRoot, 'assets'));
    writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html><title>Nebula Home</title>');
    writeFileSync(path.join(webRoot, 'assets', 'index-abc123.js'), SCRIPT);

    upstream = Fastify();
    upstream.get('/api/v1/meta', (request) => ({
      path: request.url,
      forwardedFor: request.headers['x-forwarded-for'],
      payload: 'y'.repeat(4096),
    }));
    await upstream.listen({ host: '127.0.0.1', port: 0 });

    const address = upstream.server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;

    proxy = await buildProxyServer({ webRoot, upstream: `http://127.0.0.1:${String(port)}` });
  });

  afterAll(async () => {
    await proxy.close();
    await upstream.close();
    rmSync(webRoot, { recursive: true, force: true });
  });

  it('serves the page, never from a cache, under a policy that keeps it to its own origin', async () => {
    const response = await proxy.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Nebula Home');
    expect(response.headers['cache-control']).toBe('no-cache');
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['strict-transport-security']).toBeUndefined();
  });

  it('keeps a hashed asset for a year, compressed', async () => {
    const response = await proxy.inject({
      method: 'GET',
      url: '/assets/index-abc123.js',
      headers: { 'accept-encoding': 'gzip' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toContain('immutable');
    expect(response.headers['content-encoding']).toBe('gzip');
  });

  it('answers one of the page’s own routes with the page', async () => {
    const response = await proxy.inject({ method: 'GET', url: '/settings/backup' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Nebula Home');
    expect(response.headers['cache-control']).toBe('no-cache');
  });

  it('passes the API to api as it came, uncompressed', async () => {
    const response = await proxy.inject({
      method: 'GET',
      url: '/api/v1/meta?x=1',
      headers: { 'accept-encoding': 'gzip' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-encoding']).toBeUndefined();
    expect(response.json<{ path: string }>().path).toBe('/api/v1/meta?x=1');
  });

  it('tells api the address on the socket, never the one a caller wrote', async () => {
    const response = await proxy.inject({
      method: 'GET',
      url: '/api/v1/meta',
      headers: { 'x-forwarded-for': '192.168.1.10' },
      remoteAddress: '203.0.113.7',
    });

    expect(response.json<{ forwardedFor: string }>().forwardedFor).toBe('203.0.113.7');
  });

  it('does not answer an unknown API path with the page', async () => {
    const response = await proxy.inject({ method: 'POST', url: '/nowhere' });

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('Nebula Home');
  });

  it('says it is alive', async () => {
    const response = await proxy.inject({ method: 'GET', url: '/healthz' });

    expect(response.json()).toEqual({ status: 'ok' });
  });
});
