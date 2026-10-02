/**
 * Scenes against a real database: what a save refuses, and what applying one may command.
 *
 * Applying a scene sends the same commands a person would send one entity at a time, so it
 * answers to the same permission: holding `scene:apply` is not a way past what each entity
 * allows. Here one member sits on a device tagged for the caller and one does not, and the
 * fake `core` in the harness records what actually reached it.
 *
 * Needs the development stack: `pnpm infra:up` and
 * `pnpm db:migrate`. Every row is scoped to an id unique to the run and removed afterwards.
 */
import { randomUUID } from 'node:crypto';

import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sceneApplyResultSchema, sceneViewSchema } from '@nebulahome/contracts';
import { createDatabase, schema, type Database } from '@nebulahome/db';

import { bearerFor, buildTestServer, commanded, stopHub } from '@/testing/hub-harness.js';

const DATABASE_URL = 'postgres://nebula:nebula@localhost:5432/nebula';

const suffix = randomUUID().slice(0, 8);
const slug = `scn_${suffix.replaceAll('-', '_')}`;

/** The two instances: one on a device tagged for the caller, one not. */
const porchInstance = `api-scenes-porch-${suffix}`;
const doorInstance = `api-scenes-door-${suffix}`;

const porchEntityId = `switch.${slug}_porch`;
const doorEntityId = `lock.${slug}_door`;
const tagKey = `exterior_${slug}`;

/** The user the scene is recorded as made by. */
const userId = randomUUID();

let database: ReturnType<typeof createDatabase>;
let server: FastifyInstance;
let sceneId: string;

/**
 * Writes an instance, its device and its one entity with one capability.
 *
 * @param db - A connected database handle.
 * @param instanceId - The instance.
 * @param entityId - The entity.
 * @param capability - What it declares.
 * @returns The device's row id.
 */
async function insertDevice(
  db: Database,
  instanceId: string,
  entityId: string,
  capability: string,
): Promise<string> {
  await db.insert(schema.registry.integrations).values({
    id: instanceId,
    kind: 'bambu-lab/printer',
    kindVersion: '1.0.0',
    transport: 'mqtt',
    transportConfig: {},
    options: {},
    isEnabled: true,
  });

  const [device] = await db
    .insert(schema.registry.devices)
    .values({ integrationId: instanceId, externalId: null, name: instanceId })
    .returning({ id: schema.registry.devices.id });

  if (device === undefined) {
    throw new Error('Could not insert the device');
  }

  const [entity] = await db
    .insert(schema.registry.entities)
    .values({
      entityId,
      deviceId: device.id,
      integrationId: instanceId,
      source: 'adapter',
      name: entityId,
    })
    .returning({ id: schema.registry.entities.id });

  await db
    .insert(schema.registry.entityCapabilities)
    .values({ entityId: entity?.id ?? '', capability, params: {} });

  return device.id;
}

/**
 * Calls the API with a given set of grants.
 *
 * @param grants - What the caller holds, each with its scope.
 * @param method - The verb.
 * @param url - The path under `/api/v1`.
 * @param payload - The body, if any.
 * @returns The status and the parsed body.
 */
async function call(
  grants: readonly { key: string; scope: string }[],
  method: 'GET' | 'POST',
  url: string,
  payload?: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const response = await server.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: await bearerFor(userId, ...grants) },
    ...(payload === undefined ? {} : { payload }),
  });

  return { status: response.statusCode, body: response.json() };
}

beforeAll(async () => {
  database = createDatabase({ connectionString: DATABASE_URL, applicationName: 'api-scenes-test' });

  const [role] = await database.db
    .select({ id: schema.auth.roles.id })
    .from(schema.auth.roles)
    .where(eq(schema.auth.roles.key, 'member'));

  await database.db.insert(schema.auth.users).values({
    id: userId,
    username: `scenes-${suffix}`,
    displayName: 'Scene tester',
    passwordHash: 'not-a-hash',
    roleId: role?.id ?? '',
  });

  const porchDevice = await insertDevice(database.db, porchInstance, porchEntityId, 'on_off');

  await insertDevice(database.db, doorInstance, doorEntityId, 'lock');

  const [tag] = await database.db
    .insert(schema.registry.tags)
    .values({ key: tagKey, name: `Exterior ${suffix}`, color: 'green' })
    .returning({ id: schema.registry.tags.id });

  await database.db
    .insert(schema.registry.deviceTags)
    .values({ deviceId: porchDevice, tagId: tag?.id ?? '' });

  server = await buildTestServer(true, database.db);
});

afterAll(async () => {
  stopHub();
  await server.close();

  await database.db
    .delete(schema.registry.scenes)
    .where(sql`${schema.registry.scenes.key} like ${`${slug}%`}`);
  await database.db
    .delete(schema.registry.entities)
    .where(inArray(schema.registry.entities.entityId, [porchEntityId, doorEntityId]));
  await database.db
    .delete(schema.registry.integrations)
    .where(inArray(schema.registry.integrations.id, [porchInstance, doorInstance]));
  await database.db.delete(schema.registry.tags).where(eq(schema.registry.tags.key, tagKey));
  await database.db.delete(schema.auth.users).where(eq(schema.auth.users.id, userId));
  await database.close();
});

describe('saving a scene', () => {
  it('refuses an entity listed twice, naming it, rather than failing on the join table', async () => {
    const { status, body } = await call([{ key: 'scene:write', scope: '*' }], 'POST', '/scenes', {
      key: `${slug}_twice`,
      name: 'Twice',
      members: [
        { entityId: porchEntityId, targetState: { on_off: { isOn: true } } },
        { entityId: porchEntityId, targetState: { on_off: { isOn: false } } },
      ],
    });

    expect(status).toBe(400);
    expect(JSON.stringify(body)).toContain(porchEntityId);
  });

  it('keeps a scene whose members are a switch and a lock', async () => {
    const { status, body } = await call([{ key: 'scene:write', scope: '*' }], 'POST', '/scenes', {
      key: `${slug}_evening`,
      name: 'Evening',
      members: [
        { entityId: porchEntityId, targetState: { on_off: { isOn: true } } },
        { entityId: doorEntityId, targetState: { lock: { lockState: 'locked' } } },
      ],
    });

    expect(status).toBe(201);
    sceneId = sceneViewSchema.parse(body).id;
  });
});

describe('applying a scene', () => {
  it('commands only the members the caller may control, and says which it did not', async () => {
    commanded.length = 0;

    const { status, body } = await call(
      [
        { key: 'scene:apply', scope: '*' },
        { key: 'entity:control', scope: `tag.${tagKey}` },
      ],
      'POST',
      `/scenes/${sceneId}/apply`,
    );

    expect(status).toBe(200);

    const result = sceneApplyResultSchema.parse(body);

    // The porch switch falls under the tag through its device; the door does not.
    expect(result.applied).toBe(1);
    expect(result.members).toEqual(
      expect.arrayContaining([
        { entityId: porchEntityId, ok: true, error: null },
        { entityId: doorEntityId, ok: false, error: 'You may not control this entity' },
      ]),
    );
    expect(commanded).toEqual([
      { entityId: porchEntityId, capability: 'on_off', command: 'turn_on' },
    ]);
  });

  it('records a lock it sends in the audit log, as a lock sent by hand is', async () => {
    commanded.length = 0;

    const { status, body } = await call(
      [
        { key: 'scene:apply', scope: '*' },
        { key: 'entity:control', scope: '*' },
      ],
      'POST',
      `/scenes/${sceneId}/apply`,
    );

    expect(status).toBe(200);
    expect(sceneApplyResultSchema.parse(body).applied).toBe(2);

    const entries = await database.db
      .select({ details: schema.system.auditLog.details })
      .from(schema.system.auditLog)
      .where(
        and(
          eq(schema.system.auditLog.action, 'entity.command'),
          eq(schema.system.auditLog.resourceId, doorEntityId),
        ),
      );

    expect(entries.map((entry) => entry.details)).toEqual([
      { capability: 'lock', command: 'lock', sceneId },
    ]);
  });
});
