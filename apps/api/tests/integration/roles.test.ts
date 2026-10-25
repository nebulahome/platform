/**
 * Custom roles against a real database: made from another role, renamed, their permissions
 * switched, and deleted with their people moved.
 *
 * The route tests stand the database in with a proxy that answers nothing; everything here is a
 * write and a read back. Built-in roles are tried too, and must refuse.
 *
 * Needs the development stack: `pnpm infra:up` and `pnpm db:migrate`. Every row is scoped to an
 * id unique to the run and removed afterwards.
 */
import { randomUUID } from 'node:crypto';

import { eq, like } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { roleViewSchema, type RoleView } from '@nebulahome/contracts';
import { createDatabase, schema } from '@nebulahome/db';

import { bearer, buildTestServer, stopHub } from '@/testing/hub-harness.js';

const DATABASE_URL = 'postgres://nebula:nebula@localhost:5432/nebula';

/** Unique to the run, so two runs never see each other's rows. */
const slug = randomUUID().slice(0, 8);

/** The name the run's role is made with; its key starts with `kids_<slug>`. */
const roleName = `Kids ${slug}`;

/** The person who holds the role until it goes. */
const userId = randomUUID();

/** Everything an owner holds, for the calls that should succeed. */
const OWNER = [
  'user:read',
  'role:manage',
  'entity:read',
  'entity:control',
  'scene:read',
  'scene:apply',
  'history:read',
  'device:read',
  'area:read',
  'tag:read',
  'automation:read',
  'automation:trigger',
  'alias:read',
  'package:read',
  'integration:read',
];

let database: ReturnType<typeof createDatabase>;
let server: FastifyInstance;
let role: RoleView;

/**
 * Calls the API.
 *
 * @param method - The verb.
 * @param url - The path under `/api/v1`.
 * @param payload - The body, if any.
 * @param permissions - What the caller holds.
 * @returns The status and the parsed body, or nothing for a `204`.
 */
async function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: Record<string, unknown>,
  permissions: readonly string[] = OWNER,
): Promise<{ status: number; body: unknown }> {
  const response = await server.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: await bearer(...permissions) },
    ...(payload === undefined ? {} : { payload }),
  });

  return {
    status: response.statusCode,
    body: response.statusCode === 204 ? undefined : response.json(),
  };
}

/**
 * Reads every role.
 *
 * @returns The roles.
 */
async function roles(): Promise<RoleView[]> {
  const { body } = await call('GET', '/roles');

  return (body as { items: unknown[] }).items.map((item) => roleViewSchema.parse(item));
}

beforeAll(async () => {
  database = createDatabase({ connectionString: DATABASE_URL, applicationName: 'api-roles-test' });
  server = await buildTestServer(true, database.db);
});

afterAll(async () => {
  stopHub();
  await server.close();

  await database.db.delete(schema.auth.users).where(eq(schema.auth.users.id, userId));
  await database.db.delete(schema.auth.roles).where(like(schema.auth.roles.key, `kids_${slug}%`));
  await database.close();
});

describe('a custom role, from creation to deletion', () => {
  it('lists the built-in roles with their icons', async () => {
    const owner = (await roles()).find((each) => each.key === 'owner');

    expect(owner).toMatchObject({ isBuiltin: true, icon: 'shield' });
  });

  it('is made from member, with member’s permissions and the icon asked for', async () => {
    const member = (await roles()).find((each) => each.key === 'member');
    const { status, body } = await call('POST', '/roles', {
      name: ` ${roleName} `,
      description: 'Lights in their rooms.',
      icon: 'smile',
      from: 'member',
    });

    expect(status).toBe(201);

    role = roleViewSchema.parse(body);

    expect(role).toMatchObject({
      key: `kids_${slug}`,
      name: roleName,
      icon: 'smile',
      isBuiltin: false,
      userCount: 0,
    });
    expect(role.permissions.map((grant) => grant.key).sort()).toEqual(
      (member?.permissions ?? []).map((grant) => grant.key).sort(),
    );
  });

  it('gets a numbered key when the name is taken', async () => {
    const { body } = await call('POST', '/roles', { name: roleName });

    expect(roleViewSchema.parse(body).key).toBe(`kids_${slug}_2`);
  });

  it('switches its permissions and renames it', async () => {
    const { status, body } = await call('PATCH', `/roles/${role.id}`, {
      name: `${roleName} 2`,
      permissions: ['entity:read', 'scene:apply'],
    });

    expect(status).toBe(200);
    expect(roleViewSchema.parse(body)).toMatchObject({ name: `${roleName} 2` });
    expect(
      roleViewSchema
        .parse(body)
        .permissions.map((grant) => grant.key)
        .sort(),
    ).toEqual(['entity:read', 'scene:apply']);
  });

  it('refuses a permission the caller does not hold', async () => {
    const { status } = await call('PATCH', `/roles/${role.id}`, {
      permissions: ['entity:read', 'backup:restore'],
    });

    expect(status).toBe(403);
  });

  it('refuses to delete it while it has people and nowhere to send them', async () => {
    const [kids] = await database.db
      .select({ id: schema.auth.roles.id })
      .from(schema.auth.roles)
      .where(eq(schema.auth.roles.id, role.id));

    await database.db.insert(schema.auth.users).values({
      id: userId,
      username: `roles-${slug}`,
      displayName: 'Role tester',
      passwordHash: 'not-a-hash',
      roleId: kids?.id ?? '',
    });

    const { status } = await call('DELETE', `/roles/${role.id}`);

    expect(status).toBe(400);
  });

  it('is deleted with its people moved to the role named', async () => {
    const { status } = await call('DELETE', `/roles/${role.id}?moveTo=member`);

    expect(status).toBe(204);
    expect((await roles()).some((each) => each.id === role.id)).toBe(false);

    const [moved] = await database.db
      .select({ key: schema.auth.roles.key })
      .from(schema.auth.users)
      .innerJoin(schema.auth.roles, eq(schema.auth.roles.id, schema.auth.users.roleId))
      .where(eq(schema.auth.users.id, userId));

    expect(moved?.key).toBe('member');
  });
});

describe('a built-in role', () => {
  it('can be neither changed nor deleted', async () => {
    const member = (await roles()).find((each) => each.key === 'member');
    const patch = await call('PATCH', `/roles/${member?.id ?? ''}`, { name: 'Family' });
    const remove = await call('DELETE', `/roles/${member?.id ?? ''}?moveTo=guest`);

    expect(patch.status).toBe(409);
    expect(remove.status).toBe(409);
  });
});
