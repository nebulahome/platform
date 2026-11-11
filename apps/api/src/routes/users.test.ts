/**
 * The people routes against a database that answers in turn: nobody hands out a role granting
 * more than they hold, a second factor already on is not quietly replaced, and a personal access
 * token does not change how its own account signs in.
 */
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { bearer, buildTestServer, databaseAnswering, stopHub } from '../testing/hub-harness.js';

/** Somebody else's account. */
const OTHER_USER = '00000000-0000-4000-8000-0000000000aa';

let server: FastifyInstance | undefined;

afterEach(async () => {
  stopHub();
  await server?.close();
  server = undefined;
});

/**
 * Asks to give somebody a role.
 *
 * @param grants - What the role grants.
 * @param held - What the caller holds.
 * @returns The status.
 */
async function giveRole(grants: readonly string[], held: readonly string[]): Promise<number> {
  server = await buildTestServer(
    true,
    databaseAnswering(
      [{ id: '00000000-0000-4000-8000-0000000000bb' }],
      grants.map((key) => ({ key, scope: '*' })),
    ),
  );

  const response = await server.inject({
    method: 'PATCH',
    url: `/api/v1/users/${OTHER_USER}`,
    headers: { authorization: await bearer(...held) },
    payload: { role: 'owner' },
  });

  return response.statusCode;
}

describe('giving somebody a role', () => {
  it('is refused when the role grants what the caller does not hold', async () => {
    expect(await giveRole(['user:manage', 'role:manage'], ['user:manage'])).toBe(403);
  });

  it('goes on when the caller holds everything the role grants', async () => {
    // 404: past the check, to the update, which finds nobody in this database.
    expect(await giveRole(['user:manage', 'entity:read'], ['user:manage', 'entity:read'])).toBe(
      404,
    );
  });
});

describe('starting two-factor enrolment', () => {
  it('is refused while a confirmed second factor is on, which it would turn off', async () => {
    server = await buildTestServer(true, databaseAnswering([]));

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/users/me/two-factor',
      headers: { authorization: await bearer() },
    });

    expect(response.statusCode).toBe(409);
  });

  it('hands back a secret when there is none, or one never confirmed', async () => {
    server = await buildTestServer(
      true,
      databaseAnswering([{ userId: '00000000-0000-4000-8000-000000000001' }]),
    );

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/users/me/two-factor',
      headers: { authorization: await bearer() },
    });

    expect(response.statusCode).toBe(200);
  });
});

describe('a personal access token', () => {
  it('does not mint another token', async () => {
    server = await buildTestServer(
      true,
      databaseAnswering(
        [
          {
            id: '00000000-0000-4000-8000-0000000000cc',
            userId: '00000000-0000-4000-8000-000000000001',
            name: 'Script',
            expiresAt: null,
            revokedAt: null,
          },
        ],
        [{ id: '00000000-0000-4000-8000-000000000001', username: 'ada', isActive: true }],
      ),
    );

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/users/me/tokens',
      headers: { authorization: 'Bearer nbh_a-scripts-token' },
      payload: { name: 'Another', permissions: [{ key: 'entity:read', scope: '*' }] },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: { message: 'This needs a signed-in session, not an access token' },
    });
  });
});
