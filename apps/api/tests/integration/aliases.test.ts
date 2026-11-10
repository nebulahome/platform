/**
 * Aliases against a real database: what the API writes, what it leaves to `core`, and what a
 * deletion says stops working.
 *
 * The API writes an alias's setup - its parts, what it reads, its capabilities - and asks `core`
 * to take it in; it never writes the entity's state, which is `core`'s alone. Deleting goes
 * through `core`. The fake `core` in the harness records what it was asked.
 *
 * Needs the development stack: `pnpm infra:up` and
 * `pnpm db:migrate`. Every row is scoped to an id unique to the run and removed afterwards.
 */
import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  aliasActionRunSchema,
  aliasDetailSchema,
  aliasFileSchema,
  aliasViewSchema,
  containerDeviceId,
  type AliasView,
} from '@nebulahome/contracts';
import { createDatabase, schema } from '@nebulahome/db';

import {
  aliasesRemoved,
  aliasesSynced,
  bearerFor,
  buildTestServer,
  stopHub,
} from '@/testing/hub-harness.js';

const DATABASE_URL = 'postgres://nebula:nebula@localhost:5432/nebula';

const slug = `als_${randomUUID().slice(0, 8).replaceAll('-', '_')}`;

/** The sensor the calculated alias reads. */
const sourceEntityId = `sensor.${slug}_power`;

/** The lamp an action of the thermostat commands. */
const lampEntityId = `light.${slug}_lamp`;

/** The user the aliases are recorded as made by. */
const userId = randomUUID();

let database: ReturnType<typeof createDatabase>;
let server: FastifyInstance;
let thermostat: AliasView;
let double: AliasView;

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
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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

  const [lamp] = await database.db
    .insert(schema.registry.entities)
    .values({ entityId: lampEntityId, source: 'derived', name: 'Lamp' })
    .returning({ id: schema.registry.entities.id });

  await database.db
    .insert(schema.registry.entityCapabilities)
    .values({ entityId: lamp?.id ?? '', capability: 'level', params: {} });

  server = await buildTestServer(true, database.db);
});

afterAll(async () => {
  stopHub();
  await server.close();

  await database.db
    .delete(schema.registry.entities)
    .where(inArray(schema.registry.entities.entityId, [thermostat.entityId, double.entityId]));
  await database.db
    .delete(schema.registry.entities)
    .where(inArray(schema.registry.entities.entityId, [sourceEntityId, lampEntityId]));
  await database.db
    .delete(schema.history.aliasActionRuns)
    .where(eq(schema.history.aliasActionRuns.aliasId, thermostat.id));
  await database.db.delete(schema.auth.users).where(eq(schema.auth.users.id, userId));
  await database.close();
});

describe('creating an alias', () => {
  it('starts every required part Stored, asks core to take it in, and writes no state', async () => {
    aliasesSynced.length = 0;

    const { status, body } = await call(AUTHOR, 'POST', '/aliases', {
      name: `Thermostat ${slug}`,
      behavesAs: 'thermostat',
    });

    expect(status).toBe(201);
    thermostat = aliasViewSchema.parse(body);
    expect(Object.keys(thermostat.parts)).toEqual(['target_temperature', 'mode', 'action']);
    expect(Object.values(thermostat.parts).every((part) => part.from === 'stored')).toBe(true);
    expect(thermostat.device.isShared).toBe(true);
    expect(aliasesSynced).toEqual([thermostat.entityId]);

    const states = await database.db
      .select({ id: schema.registry.entityStates.entityId })
      .from(schema.registry.entityStates)
      .innerJoin(
        schema.registry.entities,
        eq(schema.registry.entities.id, schema.registry.entityStates.entityId),
      )
      .where(eq(schema.registry.entities.entityId, thermostat.entityId));

    expect(states).toEqual([]);

    const params = await database.db
      .select({ params: schema.registry.entityCapabilities.params })
      .from(schema.registry.entityCapabilities)
      .innerJoin(
        schema.registry.entities,
        eq(schema.registry.entities.id, schema.registry.entityCapabilities.entityId),
      )
      .where(eq(schema.registry.entities.entityId, thermostat.entityId));

    expect(params[0]?.params).toMatchObject({ minTemperature: 5, maxTemperature: 35 });

    // Drawn as what it behaves as everywhere the house reads its kind.
    const entity = await call(AUTHOR, 'GET', `/entities/${thermostat.entityId}`);

    expect(entity.body).toMatchObject({ entityId: thermostat.entityId, domain: 'climate' });
  });

  it('records what a formula reads, and refuses one over an entity not in the house', async () => {
    const { status, body } = await call(AUTHOR, 'POST', '/aliases', {
      name: `Double ${slug}`,
      behavesAs: 'sensor',
      parts: { value: { from: 'formula', formula: `${sourceEntityId} * 2` } },
    });

    expect(status).toBe(201);
    double = aliasViewSchema.parse(body);
    expect(double.reads).toEqual([sourceEntityId]);

    const missing = await call(AUTHOR, 'POST', '/aliases', {
      name: `Ghost ${slug}`,
      behavesAs: 'sensor',
      parts: { value: { from: 'formula', formula: 'sensor.not_here_at_all * 2' } },
    });

    expect(missing.status).toBe(404);
  });

  it('refuses a part the type does not have, or a source its kind cannot take', async () => {
    const wrongPart = await call(AUTHOR, 'POST', '/aliases', {
      name: `Wrong ${slug}`,
      behavesAs: 'switch',
      parts: { on: { from: 'stored', value: false }, wings: { from: 'stored', value: 2 } },
    });
    const wrongSource = await call(AUTHOR, 'POST', '/aliases', {
      name: `Wrong ${slug}`,
      behavesAs: 'image',
      parts: { picture: { from: 'stored', value: null } },
    });

    expect(wrongPart.status).toBe(400);
    expect(wrongSource.status).toBe(400);
  });

  it('goes on a device named by its id in the devices list', async () => {
    const [device] = await database.db
      .insert(schema.registry.devices)
      .values({ source: 'container', externalId: slug, name: `Box ${slug}` })
      .returning({ id: schema.registry.devices.id });

    try {
      const { status, body } = await call(AUTHOR, 'POST', '/aliases', {
        name: `On box ${slug}`,
        behavesAs: 'switch',
        device: { kind: 'device', deviceId: containerDeviceId(slug) },
      });

      expect(status).toBe(201);
      const made = aliasViewSchema.parse(body);
      expect(made.device).toMatchObject({ id: containerDeviceId(slug), isVirtual: false });

      await database.db
        .delete(schema.registry.entities)
        .where(eq(schema.registry.entities.entityId, made.entityId));
    } finally {
      await database.db
        .delete(schema.registry.devices)
        .where(eq(schema.registry.devices.id, device?.id ?? ''));
    }
  });
});

describe('changing an alias', () => {
  it('refuses code while developer mode is off', async () => {
    const { status } = await call(AUTHOR, 'PATCH', `/aliases/${thermostat.id}`, {
      parts: { ...thermostat.parts, action: { from: 'code', function: 'action' } },
      code: ['def action():', '    return "idle"', ''].join('\n'),
    });

    expect(status).toBe(403);
  });

  it('refuses reads that make an alias read itself', async () => {
    const { status } = await call(AUTHOR, 'PATCH', `/aliases/${double.id}`, {
      parts: { value: { from: 'formula', formula: `${double.entityId} + 1` } },
    });

    expect(status).toBe(400);
  });

  it('asks core to take a change in, and keeps it for the history', async () => {
    aliasesSynced.length = 0;

    const { status } = await call(AUTHOR, 'PATCH', `/aliases/${thermostat.id}`, {
      parts: {
        ...thermostat.parts,
        current_temperature: { from: 'entity', entity: sourceEntityId },
      },
    });

    expect(status).toBe(200);
    expect(aliasesSynced).toEqual([thermostat.entityId]);

    const history = await call(AUTHOR, 'GET', `/aliases/${thermostat.id}/setup-history`);

    expect(history.status).toBe(200);
    expect(JSON.stringify(history.body)).toContain('current_temperature');
  });

  it('shows what it reads and what uses it', async () => {
    const { status, body } = await call(AUTHOR, 'GET', `/aliases/${thermostat.id}`);
    const detail = aliasDetailSchema.parse(body);

    expect(status).toBe(200);
    expect(detail.inputs.map((input) => input.entityId)).toEqual([sourceEntityId]);
    expect(detail.usedBy.automations).toEqual([]);
  });
});

describe('the actions of a part', () => {
  /**
   * An action of the target temperature: the lamp at twice the temperature asked.
   *
   * @param command - The command it answers.
   * @returns The action.
   */
  const action = (command: string) => ({
    id: 'valve',
    when: { kind: 'command', command },
    then: [
      {
        type: 'command',
        entityId: lampEntityId,
        capability: 'level',
        params: { command: 'set_level', level: { formula: 'command.temperature * 2' } },
      },
    ],
  });
  /**
   * The thermostat's parts with that action on its target temperature.
   *
   * @param command - The command it answers.
   * @returns The change to send.
   */
  const withAction = (command: string) => ({
    parts: {
      ...thermostat.parts,
      target_temperature: { ...thermostat.parts['target_temperature'], actions: [action(command)] },
    },
  });

  it('refuses an action on a command the part does not take', async () => {
    const { status } = await call(
      [...AUTHOR, 'entity:control'],
      'PATCH',
      `/aliases/${thermostat.id}`,
      withAction('set_mode'),
    );

    expect(status).toBe(400);
  });

  it('needs entity:control on every entity an action commands', async () => {
    const refused = await call(
      AUTHOR,
      'PATCH',
      `/aliases/${thermostat.id}`,
      withAction('set_target'),
    );
    const saved = await call(
      [...AUTHOR, 'entity:control'],
      'PATCH',
      `/aliases/${thermostat.id}`,
      withAction('set_target'),
    );

    expect(refused.status).toBe(403);
    expect(saved.status).toBe(200);
  });

  it('shows what its actions act on, and their runs with who sent them', async () => {
    await database.db.insert(schema.history.aliasActionRuns).values({
      time: new Date(),
      aliasId: thermostat.id,
      part: 'target_temperature',
      actionId: 'valve',
      when: { kind: 'command', command: { command: 'set_target', temperature: 21 } },
      origin: { type: 'user', id: userId },
      result: 'success',
      finishedAt: new Date(),
      durationMs: 12,
      trace: [],
      error: null,
    });

    const detail = aliasDetailSchema.parse(
      (await call(AUTHOR, 'GET', `/aliases/${thermostat.id}`)).body,
    );

    expect(detail.targets).toEqual([
      {
        kind: 'entity',
        id: lampEntityId,
        name: 'Lamp',
        isPresent: true,
        parts: ['target_temperature'],
      },
    ]);
    expect(detail.lastActionRuns).toMatchObject([
      { part: 'target_temperature', actionId: 'valve', result: 'success' },
    ]);

    const runs = await call(AUTHOR, 'GET', `/aliases/${thermostat.id}/action-runs`);
    const [run] = (runs.body as { items: unknown[] }).items.map((item) =>
      aliasActionRunSchema.parse(item),
    );

    expect(runs.status).toBe(200);
    expect(run?.origin).toEqual({ type: 'user', id: userId, name: 'Alias tester' });
  });
});

describe('files', () => {
  it('exports aliases as one file, and imports it back over them', async () => {
    const exported = await call(AUTHOR, 'GET', `/aliases/export?ids=${thermostat.id}`);
    const file = aliasFileSchema.parse(exported.body);

    expect(file.aliases.map((entry) => entry.key)).toEqual([thermostat.key]);

    // The thermostat's action commands the lamp: bringing it back takes control of the lamp.
    const imported = await call([...AUTHOR, 'entity:control'], 'POST', '/aliases/import', {
      file: {
        ...file,
        aliases: file.aliases.map((entry) => ({ ...entry, name: `Renamed ${slug}` })),
      },
      picks: [thermostat.key],
    });

    expect(imported.status).toBe(201);
    expect(JSON.stringify(imported.body)).toContain(`Renamed ${slug}`);
  });
});

describe('deleting an alias', () => {
  it('goes through core, and says what used it', async () => {
    aliasesRemoved.length = 0;

    const { status, body } = await call(AUTHOR, 'DELETE', `/aliases/${double.id}`);

    expect(status).toBe(200);
    expect(JSON.stringify(body)).toContain('usedBy');
    expect(aliasesRemoved).toEqual([double.entityId]);
  });
});
