/**
 * Aliases against a real database: what the API writes, what it leaves to `core`, and how a
 * deletion another alias blocks is refused.
 *
 * The API writes an alias's definition and asks `core` to take it in; it never writes the
 * entity's state, which is `core`'s alone. Deleting goes through `core`. The fake `core` in the
 * harness records what it was asked, and can be made to refuse.
 *
 * Needs the development stack: `pnpm infra:up` and
 * `pnpm db:migrate`. Every row is scoped to an id unique to the run and removed afterwards.
 */
import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { aliasViewSchema, ConflictError, type AliasView } from '@nebula-home/contracts';
import { createDatabase, schema } from '@nebula-home/db';

import {
  aliasesRemoved,
  aliasesSynced,
  bearerFor,
  buildTestServer,
  makeCoreRefuse,
  stopHub,
} from '@/testing/hub-harness.js';

const DATABASE_URL = 'postgres://nebula:nebula@localhost:5432/nebula';

const slug = `als_${randomUUID().slice(0, 8).replaceAll('-', '_')}`;

/** The sensor the calculated alias reads. */
const sourceEntityId = `sensor.${slug}_power`;

/** The user the aliases are recorded as made by. */
const userId = randomUUID();

let database: ReturnType<typeof createDatabase>;
let server: FastifyInstance;
let calculated: AliasView;
let helper: AliasView;

/**
 * Calls the API with a given set of permissions, each everywhere.
 *
 * @param permissions - What the caller holds.
 * @param method - The verb.
 * @param url - The path under `/api/v1`.
 * @param payload - The body, if any.
 * @returns The status and the parsed body.
 */
async function call(
  permissions: readonly string[],
  method: 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const response = await server.inject({
    method,
    url: `/api/v1${url}`,
    headers: {
      authorization: await bearerFor(userId, ...permissions.map((key) => ({ key, scope: '*' }))),
    },
    ...(payload === undefined ? {} : { payload }),
  });

  return { status: response.statusCode, body: response.json() };
}

/** Everything an alias author holds. */
const AUTHOR = ['alias:read', 'alias:write', 'entity:read'];

beforeAll(async () => {
  database = createDatabase({ connectionString: DATABASE_URL, applicationName: 'api-alias-test' });

  const [role] = await database.db
    .select({ id: schema.auth.roles.id })
    .from(schema.auth.roles)
    .where(eq(schema.auth.roles.key, 'member'));

  await database.db.insert(schema.auth.users).values({
    id: userId,
    username: `aliases-${slug.slice(4)}`,
    displayName: 'Alias tester',
    passwordHash: 'not-a-hash',
    roleId: role?.id ?? '',
  });

  const [source] = await database.db
    .insert(schema.registry.entities)
    .values({ entityId: sourceEntityId, source: 'derived', name: 'Power' })
    .returning({ id: schema.registry.entities.id });

  await database.db
    .insert(schema.registry.entityCapabilities)
    .values({ entityId: source?.id ?? '', capability: 'sensor_numeric', params: {} });

  server = await buildTestServer(true, database.db);
});

afterAll(async () => {
  stopHub();
  await server.close();

  // Aliases first: they restrict the deletion of what they read.
  await database.db
    .delete(schema.registry.entities)
    .where(
      inArray(schema.registry.entities.entityId, [`alias.${slug}_double`, `alias.${slug}_lamp`]),
    );
  await database.db
    .delete(schema.registry.entities)
    .where(eq(schema.registry.entities.entityId, sourceEntityId));
  await database.db.delete(schema.auth.users).where(eq(schema.auth.users.id, userId));
  await database.close();
});

describe('creating an alias', () => {
  it('writes the definition, asks core to take it in, and writes no state of its own', async () => {
    aliasesSynced.length = 0;

    const { status, body } = await call(AUTHOR, 'POST', '/aliases', {
      kind: 'calculated',
      objectId: `${slug}_double`,
      name: 'Double',
      capability: 'sensor_numeric',
      expression: 'p * 2',
      sources: [{ variableName: 'p', entityId: sourceEntityId }],
    });

    expect(status).toBe(201);
    calculated = aliasViewSchema.parse(body);
    expect(aliasesSynced).toEqual([calculated.entityId]);

    const states = await database.db
      .select({ id: schema.registry.entityStates.entityId })
      .from(schema.registry.entityStates)
      .innerJoin(
        schema.registry.entities,
        eq(schema.registry.entities.id, schema.registry.entityStates.entityId),
      )
      .where(eq(schema.registry.entities.entityId, calculated.entityId));

    expect(states).toEqual([]);
  });

  it('gives a helper the limits its capabilities need when the form sends none', async () => {
    const { status, body } = await call(AUTHOR, 'POST', '/aliases', {
      kind: 'stored',
      objectId: `${slug}_lamp`,
      name: 'Lamp',
      domain: 'light',
      capabilities: [
        { capability: 'on_off', params: {} },
        { capability: 'color_temp', params: {} },
      ],
    });

    expect(status).toBe(201);
    helper = aliasViewSchema.parse(body);

    const params = await database.db
      .select({ params: schema.registry.entityCapabilities.params })
      .from(schema.registry.entityCapabilities)
      .innerJoin(
        schema.registry.entities,
        eq(schema.registry.entities.id, schema.registry.entityCapabilities.entityId),
      )
      .where(eq(schema.registry.entities.entityId, helper.entityId));

    expect(params.map((row) => row.params)).toContainEqual({ minMireds: 153, maxMireds: 500 });
  });
});

describe('changing an alias', () => {
  it('refuses a formula on a stored helper', async () => {
    const { status } = await call(AUTHOR, 'PATCH', `/aliases/${helper.id}`, {
      expression: '1',
    });

    expect(status).toBe(400);
  });

  it('refuses capabilities a helper of its domain cannot carry', async () => {
    const { status } = await call(AUTHOR, 'PATCH', `/aliases/${helper.id}`, {
      capabilities: [{ capability: 'lock', params: {} }],
    });

    expect(status).toBe(400);
  });

  it('asks core to take a change in', async () => {
    aliasesSynced.length = 0;

    const { status } = await call(AUTHOR, 'PATCH', `/aliases/${calculated.id}`, {
      expression: 'p * 3',
    });

    expect(status).toBe(200);
    expect(aliasesSynced).toEqual([calculated.entityId]);
  });
});

describe('deleting an alias', () => {
  it('passes core refusing on as a conflict naming the readers, to somebody who may see them', async () => {
    makeCoreRefuse(
      new ConflictError('Other aliases still read this one', {
        details: { dependents: [{ entityId: 'alias.reader', name: 'Reader' }] },
      }),
    );

    try {
      const visible = await call(AUTHOR, 'DELETE', `/aliases/${calculated.id}`);
      const hidden = await call(['alias:write'], 'DELETE', `/aliases/${calculated.id}`);

      expect(visible.status).toBe(409);
      expect(JSON.stringify(visible.body)).toContain('alias.reader');
      expect(hidden.status).toBe(409);
      expect(JSON.stringify(hidden.body)).not.toContain('alias.reader');
    } finally {
      makeCoreRefuse(null);
    }
  });

  it('goes through core, and answers with what was deleted', async () => {
    aliasesRemoved.length = 0;

    const { status, body } = await call(AUTHOR, 'DELETE', `/aliases/${helper.id}`);

    expect(status).toBe(200);
    expect(aliasViewSchema.parse(body).entityId).toBe(helper.entityId);
    expect(aliasesRemoved).toEqual([helper.entityId]);
  });
});
