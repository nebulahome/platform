/**
 * The sign-in routes against a database that answers in turn: how many guesses one address gets,
 * and a spent refresh token presented again - by another tab a moment later, or by a copy long
 * after.
 *
 * What the database does with the rows - every guess counted, a token spent once - is the
 * integration test's business.
 */
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildTestServer, databaseAnswering, stopHub } from '../testing/hub-harness.js';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const SESSION_ID = '00000000-0000-4000-8000-000000000002';

/** The account, as the sign-in path reads it. */
const USER = {
  id: USER_ID,
  username: 'ada',
  email: null,
  displayName: 'Ada',
  passwordHash: 'not-a-hash',
  roleId: '00000000-0000-4000-8000-000000000003',
  roleKey: 'guest',
  locale: null,
  timezone: 'Europe/Rome',
  isActive: true,
  mustChangePassword: false,
  failedLoginCount: 0,
  lockedUntil: null,
  lastLoginAt: null,
  createdAt: new Date('2026-11-01T00:00:00Z'),
};

/**
 * A refresh token spent some time ago.
 *
 * @param spentMsAgo - How long ago.
 * @returns The row, as the refresh route reads it.
 */
function spentToken(spentMsAgo: number): Record<string, unknown> {
  const now = Date.now();

  return {
    id: '00000000-0000-4000-8000-000000000004',
    sessionId: SESSION_ID,
    userId: USER_ID,
    issuedAt: new Date(now - 3_600_000),
    expiresAt: new Date(now + 3_600_000),
    usedAt: new Date(now - spentMsAgo),
    revokedAt: null,
    sessionRevokedAt: null,
    sessionExpiresAt: new Date(now + 3_600_000),
  };
}

let server: FastifyInstance | undefined;

afterEach(async () => {
  stopHub();
  await server?.close();
  server = undefined;
});

describe('signing in', () => {
  it('gives one address API_LOGIN_RATE_LIMIT_MAX guesses a minute, then refuses', async () => {
    server = await buildTestServer(true, databaseAnswering());

    const statuses: number[] = [];

    for (let attempt = 0; attempt < 11; attempt += 1) {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: 'nobody', password: 'a-wrong-password' },
      });

      statuses.push(response.statusCode);
    }

    expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe('a spent refresh token presented again', () => {
  it('a moment later gets a pair of its own in the same session', async () => {
    server = await buildTestServer(
      true,
      databaseAnswering([spentToken(5000)], [USER], [{ id: 'next-token' }]),
    );

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: 'a-token-another-tab-spent' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ user: { id: USER_ID } });
  });

  it('long after is taken for a copy, and refused', async () => {
    server = await buildTestServer(true, databaseAnswering([spentToken(60_000)]));

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: 'a-copied-token' },
    });

    expect(response.statusCode).toBe(401);
  });
});
