/**
 * Tags against a real database: the rows, the two joins, and what the views say.
 *
 * The route tests stand the database in with a proxy that answers nothing, which covers what is
 * refused before a row is touched and nothing of what a write does. Everything here is a write
 * and a read back: a tag made, put on a device and on an entity, counted, searched by, renamed,
 * and taken off everything when it goes.
 *
 * Needs the development stack: `pnpm infra:up` and
 * `pnpm db:migrate`. Every row is scoped to an id unique to the run and removed afterwards.
 */
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { entityViewSchema, tagViewSchema, type TagView } from '@nebulahome/contracts';
import { createDatabase, schema } from '@nebulahome/db';

import { createIconStore } from '@/services/icons.js';
import { bearer, buildTestServer, stopHub } from '@/testing/hub-harness.js';

const DATABASE_URL = 'postgres://nebula:nebula@localhost:5432/nebula';

/** The instance id, unique to the run so two runs never see each other's device. */
const instanceId = `api-tags-test-${randomUUID().slice(0, 8)}`;

/** The entity the device exposes. */
const relayEntityId = `switch.${instanceId.replaceAll('-', '_')}_relay`;

/** The name the run's tag is made with, unique so a stale row from another run cannot match. */
const tagName = `Exterior ${instanceId.slice(-8)}`;

let database: ReturnType<typeof createDatabase>;
let server: FastifyInstance;
let tag: TagView;

/**
 * Calls the API as an administrator.
 *
 * @param method - The verb.
 * @param url - The path under `/api/v1`.
 * @param payload - The body, if any.
 * @returns The status and the parsed body, or nothing for a `204`.
 */
async function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const response = await server.inject({
    method,
    url: `/api/v1${url}`,
    headers: {
      authorization: await bearer(
        'tag:read',
        'tag:write',
        'device:read',
        'device:write',
        'entity:read',
        'entity:write',
      ),
    },
    ...(payload === undefined ? {} : { payload }),
  });

  return {
    status: response.statusCode,
    body: response.statusCode === 204 ? undefined : response.json(),
  };
}

beforeAll(async () => {
  database = createDatabase({ connectionString: DATABASE_URL, applicationName: 'api-tags-test' });

  await database.db.insert(schema.registry.integrations).values({
    id: instanceId,
    kind: 'bambu-lab/printer',
    kindVersion: '1.0.0',
    model: 'X1C',
    transport: 'mqtt',
    transportConfig: {},
    options: {},
    isEnabled: true,
  });

  const [device] = await database.db
    .insert(schema.registry.devices)
    .values({ integrationId: instanceId, externalId: null, name: 'Porch relay', icon: 'relay' })
    .returning({ id: schema.registry.devices.id });

  await database.db.insert(schema.registry.entities).values({
    entityId: relayEntityId,
    deviceId: device?.id ?? '',
    integrationId: instanceId,
    source: 'adapter',
    name: 'Relay',
  });

  server = await buildTestServer(true, database.db);
});

afterAll(async () => {
  stopHub();
  await server.close();

  await database.db
    .delete(schema.registry.entities)
    .where(eq(schema.registry.entities.entityId, relayEntityId));
  await database.db
    .delete(schema.registry.integrations)
    .where(eq(schema.registry.integrations.id, instanceId));
  await database.db.delete(schema.registry.tags).where(eq(schema.registry.tags.name, tagName));
  await database.close();
});

describe('a tag, from creation to removal', () => {
  it('is created with a key derived from its name and the icon asked for, on nothing yet', async () => {
    const { status, body } = await call('POST', '/tags', {
      name: `  ${tagName} `,
      color: 'green',
      icon: 'sun',
    });

    expect(status).toBe(201);

    tag = tagViewSchema.parse(body);

    expect(tag).toMatchObject({
      name: tagName,
      color: 'green',
      icon: 'sun',
      key: `exterior_${instanceId.slice(-8)}`,
      deviceCount: 0,
      entityCount: 0,
    });
  });

  it('counts as a use of its icon, so the icon cannot be taken away under it', async () => {
    const uses = await createIconStore(database.db).countUses('sun');

    expect(uses.tags).toBeGreaterThanOrEqual(1);
  });

  it('gets a numbered key when a second tag slugs the same', async () => {
    const { status, body } = await call('POST', '/tags', {
      name: tagName.toUpperCase(),
      color: 'pink',
    });

    expect(status).toBe(201);

    const twin = tagViewSchema.parse(body);

    expect(twin.key).toBe(`${tag.key}_2`);
    expect((await call('DELETE', `/tags/${twin.id}`)).status).toBe(204);
  });

  it('goes on a device through the device change, and the view lists it', async () => {
    const { status, body } = await call('PATCH', `/devices/${instanceId}`, { tagIds: [tag.id] });

    expect(status).toBe(200);
    expect(body).toMatchObject({ id: instanceId, tagIds: [tag.id] });
  });

  it('refuses a tag id no tag has, naming the field, and leaves the device as it was', async () => {
    const { status, body } = await call('PATCH', `/devices/${instanceId}`, {
      tagIds: [tag.id, randomUUID()],
    });

    expect(status).toBe(400);
    expect(JSON.stringify(body)).toContain('tagIds');

    const { body: device } = await call('GET', `/devices/${instanceId}`);

    expect(device).toMatchObject({ tagIds: [tag.id] });
  });

  it('goes on an entity with a new name and icon, through the entity change', async () => {
    const { status, body } = await call('PATCH', `/entities/${relayEntityId}`, {
      name: 'Porch light',
      icon: 'light',
      tagIds: [tag.id],
    });

    expect(status).toBe(200);

    const view = entityViewSchema.parse(body);

    expect([view.name, view.icon, view.tagIds]).toEqual(['Porch light', 'light', [tag.id]]);
  });

  it('is counted on both, and found by key when entities are listed', async () => {
    const { body: tags } = await call('GET', '/tags');
    const listed = tagViewSchema.array().parse((tags as { items: unknown }).items);

    expect(listed.find((each) => each.id === tag.id)).toMatchObject({
      deviceCount: 1,
      entityCount: 1,
    });

    const { body: entities } = await call('GET', `/entities?tag=${tag.key}`);
    const found = entityViewSchema.array().parse((entities as { items: unknown }).items);

    expect(found.map((each) => each.entityId)).toEqual([relayEntityId]);
  });

  it('keeps its key when renamed and recoloured, and loses its icon on null', async () => {
    const { status, body } = await call('PATCH', `/tags/${tag.id}`, {
      name: `Outside ${instanceId.slice(-8)}`,
      color: 'teal',
      icon: null,
    });

    expect(status).toBe(200);
    expect(body).toMatchObject({
      key: tag.key,
      name: `Outside ${instanceId.slice(-8)}`,
      color: 'teal',
      icon: null,
    });

    // Put the name back, so the teardown finds the row by it.
    await call('PATCH', `/tags/${tag.id}`, { name: tagName });
  });

  it('comes off the device when the set is replaced, and off everything when it is removed', async () => {
    expect((await call('PATCH', `/devices/${instanceId}`, { tagIds: [] })).body).toMatchObject({
      tagIds: [],
    });

    expect((await call('DELETE', `/tags/${tag.id}`)).status).toBe(204);
    expect((await call('DELETE', `/tags/${tag.id}`)).status).toBe(404);

    const { body } = await call('GET', `/entities/${relayEntityId}`);

    expect(entityViewSchema.parse(body).tagIds).toEqual([]);
  });
});
