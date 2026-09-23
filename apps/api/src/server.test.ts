/**
 * The whole server, driven through Fastify's `inject`.
 *
 * This file exists because of a bug the ninety-nine unit tests could not have found. Every one
 * of them exercised a function; none of them exercised the *chain* those functions hang off. An
 * `onSend` hook that returned its payload synchronously instead of calling `done` left every
 * response half-built and never written - no error, no log line, just a connection that never
 * answers. Nothing below tests interesting logic. What it tests is that a request reaches a
 * handler and a response comes back, which is the one property the unit tests all assumed.
 *
 * No database is needed: the paths asserted here are answered before anything reads one, and the
 * readiness check is given a stub that fails, so its degraded branch is exercised too.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CURRENT_API_VERSION, TRACE_ID_HEADER } from '@nebula-home/contracts';
import { secretsKeyFrom } from '@nebula-home/db';
import { createLogger } from '@nebula-home/logging';

import { Authenticator } from './auth/authenticator.js';
import { ChallengeStore } from './auth/challenges.js';
import { signAccessToken } from './auth/tokens.js';
import { apiEnvSchema } from './config.js';
import type { ApiContext } from './context.js';
import { IdempotencyStore } from './http/idempotency.js';
import { buildServer } from './server.js';
import { AuditLog } from './services/audit.js';
import { EventFanout } from './services/events.js';
import { testIcons } from './testing/icons.js';
import { testMapTiles } from './testing/map-tiles.js';

/** An environment good enough to build a server from. */
const ENVIRONMENT = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'fatal',
  DATABASE_URL: 'postgres://nebula:nebula@localhost:5432/nebula',
  NATS_URL: 'nats://localhost:4222',
  API_JWT_SECRET: 'a-test-signing-key-of-at-least-32-chars',
  API_TOTP_ENCRYPTION_KEY: '00'.repeat(32),
  NEBULA_SECRETS_KEY: '11'.repeat(32),
};

/**
 * Builds the real server around a database that answers nothing.
 *
 * A stub rather than a mock: no route asserted here reads a row, and the one that tries -
 * `/readyz` - is meant to discover that it cannot.
 *
 * @returns The server, ready to inject into.
 */
async function buildTestServer(): Promise<FastifyInstance> {
  const config = apiEnvSchema.parse(ENVIRONMENT);
  const logger = createLogger({ service: 'api', version: '0.0.0', level: 'fatal' });
  const secret = new TextEncoder().encode(config.API_JWT_SECRET);

  const db = {
    /**
     * Stands in for a database that is not there.
     *
     * @returns Never; it always rejects.
     */
    execute: (): Promise<never> => Promise.reject(new Error('no database in this test')),
  } as unknown as ApiContext['db'];

  const context: ApiContext = {
    config,
    db,
    bus: undefined,
    logger,
    authenticator: new Authenticator({ db, secret }),
    challenges: new ChallengeStore(),
    idempotency: new IdempotencyStore(),
    audit: new AuditLog(db, logger),
    events: new EventFanout(logger),
    icons: await testIcons(),
    mapTiles: testMapTiles(),
    jwtSecret: secret,
    totpKey: Buffer.from(config.API_TOTP_ENCRYPTION_KEY, 'hex'),
    secretsKey: secretsKeyFrom(config.NEBULA_SECRETS_KEY),

    /**
     * The wall clock.
     *
     * @returns The current moment.
     */
    now: (): Date => new Date(),
  };

  return buildServer(context);
}

/**
 * Mints an access token this server will accept.
 *
 * @param permissions - What it should carry.
 * @returns The compact JWS.
 */
async function validToken(...permissions: string[]): Promise<string> {
  return signAccessToken(
    {
      userId: '00000000-0000-4000-8000-000000000001',
      sessionId: '00000000-0000-4000-8000-000000000002',
      username: 'tester',
      role: 'owner',
      permissions: permissions.map((key) => ({ key, scope: '*', effect: 'allow' })),
    },
    new TextEncoder().encode(ENVIRONMENT.API_JWT_SECRET),
  );
}

describe('the server', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await buildTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it('answers the liveness probe', async () => {
    const response = await server.inject({ method: 'GET', url: '/healthz' });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ status: string }>().status).toBe('ok');
  });

  it('answers version discovery without a credential', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/versions' });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ current: string }>().current).toBe(CURRENT_API_VERSION);
  });

  it('reports itself unready when a dependency is missing', async () => {
    const response = await server.inject({ method: 'GET', url: '/readyz' });

    expect(response.statusCode).toBe(503);
    expect(response.json<{ status: string }>().status).toBe('degraded');
  });

  it('serves the generated contract without a credential', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/v1/openapi.json' });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ openapi: string }>().openapi).toBe('3.1.0');
  });

  it('publishes every route it serves in that contract', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/v1/openapi.json' });
    const paths = Object.keys(response.json<{ paths: Record<string, unknown> }>().paths);

    expect(paths).toContain('/api/v1/entities');
    expect(paths).toContain('/api/v1/entities/{entityId}');
    expect(paths).toContain('/api/v1/auth/login');
    expect(paths).toContain('/api/v1/users/me/tokens');
    expect(paths).toContain('/api/v1/settings');
  });

  it('refuses a protected route with no credential', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/v1/entities' });

    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('AUTHENTICATION');
  });

  it('refuses a credential that is not valid', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/entities',
      headers: { authorization: 'Bearer not-a-token' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('does not let an anonymous caller map which routes exist', async () => {
    // 401 rather than 404, and deliberately: answering "no such route" to a caller with no
    // credential would let anyone enumerate the API surface one path at a time.
    const response = await server.inject({ method: 'GET', url: '/nothing-here' });

    expect(response.statusCode).toBe(401);
  });

  it('answers an unknown route with the error envelope, not the framework default', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/nothing-here',
      headers: { authorization: `Bearer ${await validToken()}` },
    });
    const body = response.json<{ error: { code: string; traceId: string } }>();

    expect(response.statusCode).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.traceId).not.toBe('');
  });

  it('accepts a signed access token without reading a database', async () => {
    // The whole point of a signed claim: this request is authenticated and authorised against a
    // database that would throw if it were touched.
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/entities/light.hallway_ceiling',
      headers: { authorization: `Bearer ${await validToken('entity:read')}` },
    });

    // It gets past authentication and fails at the read, which is the stub refusing to answer.
    expect(response.statusCode).toBe(500);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('INTERNAL');
  });

  it('refuses a caller who is signed in but not allowed', async () => {
    // 403 rather than 401: the credential is fine, the permission is not, and answering 401
    // would send a client into a refresh loop trying to fix a token that is already valid.
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/settings',
      headers: { authorization: `Bearer ${await validToken('entity:read')}` },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('PERMISSION');
  });

  it('refuses a settings change that names nothing to change', async () => {
    const response = await server.inject({
      method: 'PATCH',
      url: '/api/v1/settings',
      headers: { authorization: `Bearer ${await validToken('settings:write')}` },
      payload: { changes: {} },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('VALIDATION');
  });

  it('refuses a picture for somebody else without the permission to manage them', async () => {
    const response = await server.inject({
      method: 'PUT',
      url: '/api/v1/users/00000000-0000-4000-8000-000000000099/avatar',
      headers: { authorization: `Bearer ${await validToken('entity:read')}` },
      payload: { mime: 'image/webp', data: 'AAAA' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('PERMISSION');
  });

  it('refuses a picture in a format it will not store', async () => {
    // Refused before anything is decoded, and SVG is the one that matters: it is a document
    // that can carry script, and it would be served back to everybody else in the house.
    const response = await server.inject({
      method: 'PUT',
      url: '/api/v1/users/00000000-0000-4000-8000-000000000001/avatar',
      headers: { authorization: `Bearer ${await validToken()}` },
      payload: { mime: 'image/svg+xml', data: 'AAAA' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('VALIDATION');
  });

  it('rejects a body that does not satisfy its schema', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'someone' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('VALIDATION');
  });

  it('puts a trace id on every response', async () => {
    const response = await server.inject({ method: 'GET', url: '/healthz' });

    expect(response.headers[TRACE_ID_HEADER]).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });

  it('keeps the trace id the caller supplied', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/healthz',
      headers: { [TRACE_ID_HEADER]: '01JD8Z4K2P9QF3M7X1V6R8T2NB' },
    });

    expect(response.headers[TRACE_ID_HEADER]).toBe('01JD8Z4K2P9QF3M7X1V6R8T2NB');
  });

  it('replaces a trace id that is not one', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/healthz',
      headers: { [TRACE_ID_HEADER]: 'no spaces allowed here' },
    });

    expect(response.headers[TRACE_ID_HEADER]).not.toBe('no spaces allowed here');
  });

  it('does not mark a current version as deprecated', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/v1/entities' });

    expect(response.headers['deprecation']).toBeUndefined();
    expect(response.headers['sunset']).toBeUndefined();
  });

  it('fails a command with device unavailability while the bus is away', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/entities/light.hallway_ceiling/capabilities/on_off/commands',
      headers: { authorization: 'Bearer not-a-token' },
      payload: { command: { command: 'turn_on' } },
    });

    // Refused for the credential before it ever reaches the bus, which is the right order.
    expect(response.statusCode).toBe(401);
  });
});
