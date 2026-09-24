/**
 * Areas against a real database: the tree, the rules that keep it one, and what a room does
 * to the device put in it and to that device's entities.
 *
 * The route tests stand the database in with a proxy that answers nothing, which covers what is
 * refused before a row is touched and nothing of what a write does. Everything here is a write
 * and a read back: the house made and placed, a floor in it, a room on the floor, a device put in
 * the room, its entity found there without being told, the floor removed and the room with it.
 *
 * There is one house, so the run cannot always make its own: on a database where the owner has
 * already made theirs, the run builds under that house, leaves it where it stands, and removes
 * only what it added. What the one-house rule refuses is asserted either way.
 *
 * Needs the development stack: `docker compose -f infra/docker-compose.dev.yml up -d` and
 * `pnpm db:migrate`. Every row is scoped to an id unique to the run and removed afterwards.
 */
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  areaViewSchema,
  deviceViewSchema,
  entityViewSchema,
  type AreaView,
} from '@nebula-home/contracts';
import { createDatabase, schema } from '@nebula-home/db';

import { bearer, buildTestServer, stopHub } from '@/testing/hub-harness.js';
import { cachedTiles } from '@/testing/map-tiles.js';

const DATABASE_URL = 'postgres://nebula:nebula@localhost:5432/nebula';

/** The instance id, unique to the run so two runs never see each other's device. */
const instanceId = `api-areas-test-${randomUUID().slice(0, 8)}`;

/** The entity the device exposes. */
const relayEntityId = `switch.${instanceId.replaceAll('-', '_')}_relay`;

/** The house's name, unique so a stale row from another run cannot match. */
const houseName = `Home ${instanceId.slice(-8)}`;

/**
 * The floor's number: high up, where the owner's own floors are not, so the run can build on a
 * house that already has floors.
 */
const floorLevel = 150 + Math.floor(Math.random() * 50);

let database: ReturnType<typeof createDatabase>;
let server: FastifyInstance;
let house: AreaView;
let floor: AreaView;
let room: AreaView;

/** Whether the run made the house, and so may move it and must remove it. */
let isHouseOurs = false;

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
        'area:read',
        'area:write',
        'device:read',
        'device:write',
        'entity:read',
      ),
    },
    ...(payload === undefined ? {} : { payload }),
  });

  return {
    status: response.statusCode,
    body: response.statusCode === 204 ? undefined : response.json(),
  };
}

/**
 * Reads the areas back.
 *
 * @returns Every area the API lists.
 */
async function listed(): Promise<AreaView[]> {
  const { body } = await call('GET', '/areas');

  return areaViewSchema.array().parse((body as { items: unknown }).items);
}

beforeAll(async () => {
  database = createDatabase({ connectionString: DATABASE_URL, applicationName: 'api-areas-test' });

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
  await database.db.delete(schema.registry.areas).where(eq(schema.registry.areas.name, houseName));
  await database.db
    .delete(schema.registry.areas)
    .where(eq(schema.registry.areas.name, `Ground floor ${instanceId.slice(-8)}`));
  await database.close();
});

describe('the house, a floor and a room', () => {
  it('starts with the house, made here and placed when there was none', async () => {
    const existing = (await listed()).find((each) => each.kind === 'house');

    if (existing !== undefined) {
      house = existing;

      return;
    }

    const { status, body } = await call('POST', '/areas', {
      kind: 'house',
      name: `  ${houseName} `,
      latitude: 45.4642,
      longitude: 9.19,
    });

    expect(status).toBe(201);

    house = areaViewSchema.parse(body);
    isHouseOurs = true;

    expect(house).toMatchObject({
      kind: 'house',
      name: houseName,
      parentId: null,
      latitude: 45.4642,
      longitude: 9.19,
      deviceCount: 0,
      entityCount: 0,
    });
  });

  it('refuses a second house: there is one home, and this is it', async () => {
    const { status, body } = await call('POST', '/areas', { kind: 'house', name: 'Cottage' });

    expect(status).toBe(409);
    expect(JSON.stringify(body)).toContain('house');
  });

  it('puts a floor in the house and a room on the floor', async () => {
    const floorReply = await call('POST', '/areas', {
      kind: 'floor',
      name: `Ground floor ${instanceId.slice(-8)}`,
      parentId: house.id,
      level: floorLevel,
    });

    expect(floorReply.status).toBe(201);
    floor = areaViewSchema.parse(floorReply.body);
    expect([floor.parentId, floor.level]).toEqual([house.id, floorLevel]);

    const roomReply = await call('POST', '/areas', {
      kind: 'room',
      name: 'Kitchen',
      parentId: floor.id,
      icon: 'cooking-pot',
    });

    expect(roomReply.status).toBe(201);
    room = areaViewSchema.parse(roomReply.body);
    expect([room.parentId, room.icon]).toEqual([floor.id, 'cooking-pot']);
  });

  it('refuses a room straight in a house, and a floor on a floor, naming the field', async () => {
    const skipped = await call('POST', '/areas', {
      kind: 'room',
      name: 'Hall',
      parentId: house.id,
    });

    expect(skipped.status).toBe(400);
    expect(JSON.stringify(skipped.body)).toContain('parentId');

    const stacked = await call('POST', '/areas', {
      kind: 'floor',
      name: 'Mezzanine',
      parentId: floor.id,
      level: floorLevel + 1,
    });

    expect(stacked.status).toBe(400);
  });

  it('refuses a second floor with the same number, and a number on a room', async () => {
    const twin = await call('POST', '/areas', {
      kind: 'floor',
      name: 'Twin',
      parentId: house.id,
      level: floorLevel,
    });

    expect(twin.status).toBe(409);
    expect(JSON.stringify(twin.body)).toContain('level');

    const numbered = await call('PATCH', `/areas/${room.id}`, { level: 3 });

    expect(numbered.status).toBe(400);
    expect(JSON.stringify(numbered.body)).toContain('level');

    const kept = await call('PATCH', `/areas/${floor.id}`, { level: floorLevel });

    expect(kept.status).toBe(200);
  });

  it('refuses a position on a room, and moves the house', async () => {
    const placedRoom = await call('PATCH', `/areas/${room.id}`, { latitude: 1, longitude: 1 });

    expect(placedRoom.status).toBe(400);

    // The owner's house stays where they put it; only a house this run made is moved.
    if (!isHouseOurs) {
      return;
    }

    const moved = await call('PATCH', `/areas/${house.id}`, { latitude: 41.9, longitude: 12.5 });

    expect(moved.status).toBe(200);
    expect(areaViewSchema.parse(moved.body)).toMatchObject({ latitude: 41.9, longitude: 12.5 });
  });

  it('has a map around it that is fetched onto disk on request', async () => {
    // The tile server is stood in for; what is real is the house row the endpoints read.
    cachedTiles.clear();

    if (house.latitude === null) {
      // The owner's house is not placed yet, and this run does not place it for them.
      const { status } = await call('GET', `/areas/${house.id}/tiles`);

      expect(status).toBe(400);

      return;
    }

    const before = await call('GET', `/areas/${house.id}/tiles`);

    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({ cached: 0 });

    const fetched = await call('POST', `/areas/${house.id}/tiles`);

    expect(fetched.status).toBe(201);
    expect(fetched.body).toMatchObject({ failed: 0 });

    const after = await call('GET', `/areas/${house.id}/tiles`);

    expect(after.body).toEqual({
      total: (fetched.body as { total: number }).total,
      cached: (fetched.body as { total: number }).total,
    });
  });

  it('has no map around a room', async () => {
    const { status } = await call('GET', `/areas/${room.id}/tiles`);

    expect(status).toBe(400);
  });

  it('takes a device into the room, and its entity with it', async () => {
    const { status, body } = await call('PATCH', `/devices/${instanceId}`, { areaId: room.id });

    expect(status).toBe(200);
    expect(deviceViewSchema.parse(body)).toMatchObject({
      areaId: room.id,
      areaKey: room.key,
      areaName: 'Kitchen',
    });

    const { body: entity } = await call('GET', `/entities/${relayEntityId}`);

    // Nobody told the entity where it is; it is wherever its device is.
    expect(entityViewSchema.parse(entity)).toMatchObject({
      areaKey: room.key,
      areaName: 'Kitchen',
    });
  });

  it('refuses to put a device on a floor: a device goes in a room', async () => {
    const { status, body } = await call('PATCH', `/devices/${instanceId}`, { areaId: floor.id });

    expect(status).toBe(400);
    expect(JSON.stringify(body)).toContain('areaId');
  });

  it('counts the device in the room, and nothing in the floor', async () => {
    const areas = await listed();

    expect(areas.find((each) => each.id === room.id)).toMatchObject({ deviceCount: 1 });
    expect(areas.find((each) => each.id === floor.id)).toMatchObject({ deviceCount: 0 });
  });

  it('removes the room with the floor, and leaves the device in no room', async () => {
    expect((await call('DELETE', `/areas/${floor.id}`)).status).toBe(204);

    const areas = await listed();

    expect(areas.some((each) => each.id === room.id)).toBe(false);

    const { body } = await call('GET', `/devices/${instanceId}`);

    expect(deviceViewSchema.parse(body)).toMatchObject({ areaId: null, areaKey: null });
  });

  it('is removed when this run made it, and is then unknown', async () => {
    if (!isHouseOurs) {
      return;
    }

    expect((await call('DELETE', `/areas/${house.id}`)).status).toBe(204);
    expect((await call('DELETE', `/areas/${house.id}`)).status).toBe(404);
  });
});
