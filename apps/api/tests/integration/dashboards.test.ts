/**
 * Dashboards against a real database: each person keeps their own, and nobody else's.
 *
 * Two accounts. One makes a dashboard and saves a layout on it; the other asks for it by id and is
 * told there is no such dashboard, exactly as if it had never existed - and cannot change or
 * remove it either. Removing the owner's account takes its dashboards with it.
 *
 * Needs the development stack: `docker compose -f infra/docker-compose.dev.yml up -d` and
 * `pnpm db:migrate`. Every row is scoped to ids unique to the run and removed afterwards.
 */
import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  DASHBOARDS_PER_USER_MAXIMUM,
  dashboardViewSchema,
  type DashboardView,
} from '@nebula-home/contracts';
import { createDatabase, schema } from '@nebula-home/db';

import { bearerFor, buildTestServer, stopHub } from '@/testing/hub-harness.js';

const DATABASE_URL = 'postgres://nebula:nebula@localhost:5432/nebula';

const suffix = randomUUID().slice(0, 8);

/** The one who makes the dashboard, and someone else in the same house. */
const ownerId = randomUUID();
const otherId = randomUUID();

let database: ReturnType<typeof createDatabase>;
let server: FastifyInstance;
let dashboard: DashboardView;

/**
 * Calls the API as one of the two accounts, holding no permission at all.
 *
 * @param userId - Who is asking.
 * @param method - The verb.
 * @param url - The path under `/api/v1`.
 * @param payload - The body, if any.
 * @returns The status and the parsed body.
 */
async function call(
  userId: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const response = await server.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: await bearerFor(userId) },
    ...(payload === undefined ? {} : { payload }),
  });

  return { status: response.statusCode, body: response.json() };
}

beforeAll(async () => {
  database = createDatabase({
    connectionString: DATABASE_URL,
    applicationName: 'api-dashboards-test',
  });

  const [role] = await database.db
    .select({ id: schema.auth.roles.id })
    .from(schema.auth.roles)
    .where(eq(schema.auth.roles.key, 'guest'));

  await database.db.insert(schema.auth.users).values([
    {
      id: ownerId,
      username: `dash-owner-${suffix}`,
      displayName: 'Dashboard owner',
      passwordHash: 'not-a-hash',
      roleId: role?.id ?? '',
    },
    {
      id: otherId,
      username: `dash-other-${suffix}`,
      displayName: 'Someone else',
      passwordHash: 'not-a-hash',
      roleId: role?.id ?? '',
    },
  ]);

  server = await buildTestServer(true, database.db);
});

afterAll(async () => {
  stopHub();
  await server.close();

  await database.db
    .delete(schema.auth.users)
    .where(inArray(schema.auth.users.id, [ownerId, otherId]));
  await database.close();
});

describe('keeping a dashboard', () => {
  it('makes one with nothing on it', async () => {
    const { status, body } = await call(ownerId, 'POST', '/dashboards', {
      name: 'Home',
      icon: 'house',
    });

    expect(status).toBe(201);
    dashboard = dashboardViewSchema.parse(body);
    expect(dashboard).toMatchObject({ name: 'Home', icon: 'house', layout: { cards: [] } });
  });

  it('saves a layout whole and serves it back', async () => {
    const layout = {
      cards: [
        {
          id: 'lightaaaa',
          type: 'entity',
          x: 0,
          y: 0,
          w: 1,
          h: 2,
          entityId: 'light.kitchen_ceiling',
          title: null,
          icon: null,
          range: null,
        },
        {
          id: 'container01',
          type: 'container',
          x: 1,
          y: 0,
          w: 3,
          h: 2,
          title: 'Ground floor',
          icon: null,
          cards: [
            {
              id: 'clock0001',
              type: 'clock',
              x: 0,
              y: 0,
              w: 2,
              h: 1,
              showSeconds: false,
              showDate: true,
            },
          ],
        },
      ],
    };

    const saved = await call(ownerId, 'PATCH', `/dashboards/${dashboard.id}`, { layout });

    expect(saved.status).toBe(200);

    const { status, body } = await call(ownerId, 'GET', '/dashboards');

    expect(status).toBe(200);
    expect(body).toMatchObject({ items: [{ id: dashboard.id, layout }] });
  });
});

describe('somebody else', () => {
  it('does not see it listed', async () => {
    const { body } = await call(otherId, 'GET', '/dashboards');

    expect(body).toEqual({ items: [] });
  });

  it('is told it does not exist, and cannot change or remove it', async () => {
    const read = await call(otherId, 'GET', `/dashboards/${dashboard.id}`);
    const change = await call(otherId, 'PATCH', `/dashboards/${dashboard.id}`, { name: 'Mine' });
    const remove = await call(otherId, 'DELETE', `/dashboards/${dashboard.id}`);

    expect([read.status, change.status, remove.status]).toEqual([404, 404, 404]);

    const { body } = await call(ownerId, 'GET', `/dashboards/${dashboard.id}`);

    expect(body).toMatchObject({ name: 'Home' });
  });
});

describe('as a file', () => {
  it('exports in the standard, and imports as someone else into a new dashboard', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/api/v1/dashboards/${dashboard.id}/export`,
      headers: { authorization: await bearerFor(ownerId) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="home.dashboard.json"',
    );

    const file: unknown = response.json();

    expect(file).toMatchObject({ format: 'nebula-home/dashboard', version: 1, name: 'Home' });
    expect(Object.keys(file as object).sort()).toEqual([
      'format',
      'icon',
      'layout',
      'name',
      'version',
    ]);

    const imported = await call(
      otherId,
      'POST',
      '/dashboards/import',
      file as Record<string, unknown>,
    );
    const copy = dashboardViewSchema.parse(imported.body);

    expect(imported.status).toBe(201);
    expect(copy.id).not.toBe(dashboard.id);
    expect(copy.layout).toEqual(
      dashboardViewSchema.parse((await call(ownerId, 'GET', `/dashboards/${dashboard.id}`)).body)
        .layout,
    );

    await call(otherId, 'DELETE', `/dashboards/${copy.id}`);
  });
});

describe('the limit', () => {
  it('stops at the most one account may keep', async () => {
    const made = await Promise.all(
      Array.from({ length: DASHBOARDS_PER_USER_MAXIMUM - 1 }, () =>
        call(ownerId, 'POST', '/dashboards', { name: 'Spare' }),
      ),
    );

    expect(made.every((response) => response.status === 201)).toBe(true);

    const { status } = await call(ownerId, 'POST', '/dashboards', { name: 'One too many' });

    expect(status).toBe(409);
  });
});

describe('removing', () => {
  it('deletes one and answers with what it was', async () => {
    const { status, body } = await call(ownerId, 'DELETE', `/dashboards/${dashboard.id}`);

    expect(status).toBe(200);
    expect(body).toMatchObject({ id: dashboard.id, name: 'Home' });
  });

  it('takes the rest with the account', async () => {
    await database.db.delete(schema.auth.users).where(eq(schema.auth.users.id, ownerId));

    const left = await database.db
      .select({ id: schema.registry.dashboards.id })
      .from(schema.registry.dashboards)
      .where(eq(schema.registry.dashboards.userId, ownerId));

    expect(left).toEqual([]);
  });
});
