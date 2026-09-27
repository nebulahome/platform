/**
 * Dashboards against a real database: made by whoever manages them, shown to whoever they are
 * assigned to, and to nobody else.
 *
 * Three accounts. A manager makes a dashboard, lays it out and assigns it to one person; that
 * person finds it on their own list and can read it but not change it; the third is told there is
 * no such dashboard, exactly as if it had never existed. Re-assigning moves it from one list to the
 * other, removing an account takes its assignments with it, and the dashboard stays.
 *
 * Needs the development stack: `pnpm infra:up` and
 * `pnpm db:migrate`. Every row is scoped to ids unique to the run and removed afterwards.
 */
import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  dashboardAssigneeSchema,
  dashboardViewSchema,
  type DashboardView,
} from '@nebula-home/contracts';
import { createDatabase, schema } from '@nebula-home/db';

import { bearerFor, buildTestServer, stopHub } from '@/testing/hub-harness.js';

const DATABASE_URL = 'postgres://nebula:nebula@localhost:5432/nebula';

const suffix = randomUUID().slice(0, 8);

/** The one who manages dashboards, the one a dashboard is for, and someone else in the house. */
const managerId = randomUUID();
const viewerId = randomUUID();
const otherId = randomUUID();

let database: ReturnType<typeof createDatabase>;
let server: FastifyInstance;
let dashboard: DashboardView;

/** Every dashboard the run made, removed afterwards whatever the tests got to. */
const made = new Set<string>();

/**
 * Calls the API as one of the accounts.
 *
 * @param userId - Who is asking. The manager carries `dashboard:manage`; the others nothing.
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
  const grants = userId === managerId ? [{ key: 'dashboard:manage', scope: '*' }] : [];
  const response = await server.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: await bearerFor(userId, ...grants) },
    ...(payload === undefined ? {} : { payload }),
  });

  return { status: response.statusCode, body: response.json() };
}

/**
 * The ids of the dashboards one account is shown.
 *
 * @param userId - Whose list.
 * @returns The ids.
 */
async function listedFor(userId: string): Promise<string[]> {
  const { body } = await call(userId, 'GET', '/dashboards');

  return dashboardViewSchema
    .array()
    .parse((body as { items: unknown }).items)
    .map((each) => each.id);
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

  await database.db.insert(schema.auth.users).values(
    [
      [managerId, 'manager', 'Dashboard manager'],
      [viewerId, 'viewer', 'The one it is for'],
      [otherId, 'other', 'Someone else'],
    ].map(([id, name, displayName]) => ({
      id: id ?? '',
      username: `dash-${name ?? ''}-${suffix}`,
      displayName: displayName ?? '',
      passwordHash: 'not-a-hash',
      roleId: role?.id ?? '',
    })),
  );

  server = await buildTestServer(true, database.db);
});

afterAll(async () => {
  stopHub();
  await server.close();

  if (made.size > 0) {
    await database.db
      .delete(schema.registry.dashboards)
      .where(inArray(schema.registry.dashboards.id, [...made]));
  }

  await database.db
    .delete(schema.auth.users)
    .where(inArray(schema.auth.users.id, [managerId, viewerId, otherId]));
  await database.close();
});

describe('making a dashboard', () => {
  it('is refused to someone who does not manage dashboards', async () => {
    const { status } = await call(viewerId, 'POST', '/dashboards', { name: 'Mine' });

    expect(status).toBe(403);
  });

  it('makes one with nothing on it, shown to the one it is for', async () => {
    const { status, body } = await call(managerId, 'POST', '/dashboards', {
      name: 'Home',
      icon: 'house',
      userIds: [viewerId],
    });

    expect(status).toBe(201);
    dashboard = dashboardViewSchema.parse(body);
    made.add(dashboard.id);
    expect(dashboard).toMatchObject({
      name: 'Home',
      icon: 'house',
      layout: { cards: [] },
      userIds: [viewerId],
    });
  });

  it('refuses an assignment to someone with no account', async () => {
    const { status, body } = await call(managerId, 'PATCH', `/dashboards/${dashboard.id}`, {
      userIds: [randomUUID()],
    });

    expect(status).toBe(400);
    expect(JSON.stringify(body)).toContain('userIds');
  });

  it('lists the people it can be assigned to, and every dashboard', async () => {
    const people = await call(managerId, 'GET', '/dashboards/assignees');
    const ids = dashboardAssigneeSchema
      .array()
      .parse((people.body as { items: unknown }).items)
      .map((person) => person.id);

    expect(ids).toEqual(expect.arrayContaining([managerId, viewerId, otherId]));

    const every = await call(managerId, 'GET', '/dashboards/manage');

    expect(JSON.stringify(every.body)).toContain(dashboard.id);
  });

  it('saves a layout whole, and the one it is for sees it', async () => {
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

    const saved = await call(managerId, 'PATCH', `/dashboards/${dashboard.id}`, { layout });

    expect(saved.status).toBe(200);

    const { status, body } = await call(viewerId, 'GET', '/dashboards');

    expect(status).toBe(200);
    expect(body).toMatchObject({ items: [{ id: dashboard.id, layout }] });
  });
});

describe('who sees it', () => {
  it('is read by the one it is for, who cannot change it', async () => {
    const read = await call(viewerId, 'GET', `/dashboards/${dashboard.id}`);
    const change = await call(viewerId, 'PATCH', `/dashboards/${dashboard.id}`, { name: 'Mine' });

    expect([read.status, change.status]).toEqual([200, 403]);
  });

  it('is not there at all for somebody else', async () => {
    expect(await listedFor(otherId)).not.toContain(dashboard.id);
    expect((await call(otherId, 'GET', `/dashboards/${dashboard.id}`)).status).toBe(404);
  });

  it('moves from one list to the other when it is assigned again', async () => {
    const { status } = await call(managerId, 'PATCH', `/dashboards/${dashboard.id}`, {
      userIds: [otherId, managerId],
    });

    expect(status).toBe(200);
    expect(await listedFor(viewerId)).not.toContain(dashboard.id);
    expect(await listedFor(otherId)).toContain(dashboard.id);
    expect(await listedFor(managerId)).toContain(dashboard.id);
  });
});

describe('as a file', () => {
  it('exports in the standard, and imports into a new dashboard assigned to nobody', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/api/v1/dashboards/${dashboard.id}/export`,
      headers: {
        authorization: await bearerFor(managerId, { key: 'dashboard:manage', scope: '*' }),
      },
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
      managerId,
      'POST',
      '/dashboards/import',
      file as Record<string, unknown>,
    );
    const copy = dashboardViewSchema.parse(imported.body);

    made.add(copy.id);
    expect(imported.status).toBe(201);
    expect(copy.id).not.toBe(dashboard.id);
    expect(copy.userIds).toEqual([]);
    expect(copy.layout).toEqual((file as { layout: unknown }).layout);

    await call(managerId, 'DELETE', `/dashboards/${copy.id}`);
  });
});

describe('removing', () => {
  it('takes an account out of the assignment with the account, and keeps the dashboard', async () => {
    await database.db.delete(schema.auth.users).where(eq(schema.auth.users.id, otherId));

    const { body } = await call(managerId, 'GET', `/dashboards/${dashboard.id}`);

    expect(dashboardViewSchema.parse(body).userIds).toEqual([managerId]);
  });

  it('deletes one and answers with what it was', async () => {
    const { status, body } = await call(managerId, 'DELETE', `/dashboards/${dashboard.id}`);

    expect(status).toBe(200);
    expect(body).toMatchObject({ id: dashboard.id, name: 'Home' });
    expect(await listedFor(managerId)).not.toContain(dashboard.id);
  });
});
