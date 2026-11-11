/**
 * Signing in and staying in against a real database: what only the database can show - guesses
 * sent at once all counted, a lock that ran out starting the count again, and a refresh token
 * spent exactly once however many present it together.
 *
 * Needs the development stack: `pnpm infra:up` and `pnpm db:migrate`. The run's one account and
 * everything it signed into is removed afterwards.
 */
import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FAILED_LOGIN_LIMIT } from '@nebulahome/contracts';
import { createDatabase, schema } from '@nebulahome/db';

import { hashPassword } from '@/auth/password.js';
import { hashOpaqueToken } from '@/auth/tokens.js';
import { buildTestServer, stopHub } from '@/testing/hub-harness.js';

const DATABASE_URL = 'postgres://nebula:nebula@localhost:5432/nebula';

/** The run's account. */
const userId = randomUUID();
const username = `auth-${randomUUID().slice(0, 8)}`;
const PASSWORD = 'the-right-password';

let database: ReturnType<typeof createDatabase>;
let server: FastifyInstance;

/** A different address for every call, so the sign-in rate limit counts none of them together. */
let address = 0;

/**
 * Posts to an auth route from an address of its own.
 *
 * @param url - The path under `/api/v1/auth`.
 * @param payload - The body.
 * @returns The status and the parsed body.
 */
async function post(
  url: string,
  payload: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  address += 1;

  const response = await server.inject({
    method: 'POST',
    url: `/api/v1/auth${url}`,
    headers: {
      'x-forwarded-for': `10.0.${String(Math.floor(address / 250))}.${String(address % 250)}`,
    },
    payload,
  });

  return { status: response.statusCode, body: response.json() };
}

/**
 * Reads the run's account as the lock sees it.
 *
 * @returns The failures counted and the lock.
 */
async function lockState(): Promise<{ failedLoginCount: number; lockedUntil: Date | null }> {
  const [row] = await database.db
    .select({
      failedLoginCount: schema.auth.users.failedLoginCount,
      lockedUntil: schema.auth.users.lockedUntil,
    })
    .from(schema.auth.users)
    .where(eq(schema.auth.users.id, userId));

  return row ?? { failedLoginCount: -1, lockedUntil: null };
}

/**
 * Signs the run's account in.
 *
 * @returns The refresh token.
 */
async function signIn(): Promise<string> {
  const { status, body } = await post('/login', { username, password: PASSWORD });

  expect(status).toBe(200);

  return (body['tokens'] as { refreshToken: string }).refreshToken;
}

beforeAll(async () => {
  database = createDatabase({ connectionString: DATABASE_URL, applicationName: 'api-auth-test' });
  server = await buildTestServer(true, database.db);

  const [guest] = await database.db
    .select({ id: schema.auth.roles.id })
    .from(schema.auth.roles)
    .where(eq(schema.auth.roles.key, 'guest'));

  await database.db.insert(schema.auth.users).values({
    id: userId,
    username,
    displayName: 'Auth tester',
    passwordHash: await hashPassword(PASSWORD),
    roleId: guest?.id ?? '',
  });
});

afterAll(async () => {
  stopHub();
  await server.close();

  const sessions = await database.db
    .select({ id: schema.auth.sessions.id })
    .from(schema.auth.sessions)
    .where(eq(schema.auth.sessions.userId, userId));
  const ids = sessions.map((row) => row.id);

  if (ids.length > 0) {
    await database.db
      .delete(schema.auth.refreshTokens)
      .where(inArray(schema.auth.refreshTokens.sessionId, ids));
    await database.db.delete(schema.auth.sessions).where(inArray(schema.auth.sessions.id, ids));
  }

  await database.db.delete(schema.auth.users).where(eq(schema.auth.users.id, userId));
  await database.close();
});

describe('wrong passwords', () => {
  it('lock the account when sent all at once, every one of them counted', async () => {
    const answers = await Promise.all(
      Array.from({ length: FAILED_LOGIN_LIMIT }, async () =>
        post('/login', { username, password: 'a-wrong-password' }),
      ),
    );

    expect(answers.every((answer) => answer.status === 401)).toBe(true);

    const state = await lockState();

    expect(state.failedLoginCount).toBe(FAILED_LOGIN_LIMIT);
    expect(state.lockedUntil?.getTime() ?? 0).toBeGreaterThan(Date.now());
  });

  it('count from one again once the lock has run out', async () => {
    await database.db
      .update(schema.auth.users)
      .set({ lockedUntil: new Date(Date.now() - 1000) })
      .where(eq(schema.auth.users.id, userId));

    await post('/login', { username, password: 'a-wrong-password' });

    expect(await lockState()).toEqual({ failedLoginCount: 1, lockedUntil: null });
  });
});

describe('a refresh token', () => {
  it('is spent once when two present it together, and both are answered', async () => {
    const token = await signIn();
    const answers = await Promise.all([
      post('/refresh', { refreshToken: token }),
      post('/refresh', { refreshToken: token }),
    ]);

    expect(answers.map((answer) => answer.status)).toEqual([200, 200]);

    const sessions = await database.db
      .select({ id: schema.auth.sessions.id, revokedAt: schema.auth.sessions.revokedAt })
      .from(schema.auth.sessions)
      .where(eq(schema.auth.sessions.userId, userId));
    const live = sessions.filter((row) => row.revokedAt === null);
    const tokens = await database.db
      .select({
        usedAt: schema.auth.refreshTokens.usedAt,
        replacedBy: schema.auth.refreshTokens.replacedBy,
      })
      .from(schema.auth.refreshTokens)
      .where(eq(schema.auth.refreshTokens.sessionId, live[0]?.id ?? ''));

    expect(live).toHaveLength(1);
    // The one presented, its one replacement, and the pair the second caller was given.
    expect(tokens).toHaveLength(3);
    expect(tokens.filter((row) => row.replacedBy !== null)).toHaveLength(1);
  });

  it('presented long after it was spent ends the session', async () => {
    const token = await signIn();

    expect((await post('/refresh', { refreshToken: token })).status).toBe(200);

    await database.db
      .update(schema.auth.refreshTokens)
      .set({ usedAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.auth.refreshTokens.tokenHash, hashOpaqueToken(token)));

    expect((await post('/refresh', { refreshToken: token })).status).toBe(401);
  });
});
