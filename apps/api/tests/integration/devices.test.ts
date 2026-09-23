/**
 * The device paths against a real database.
 *
 * The route tests stand the database in with a proxy that answers nothing, which is right for
 * what they check and blind to two things only a row can show. What the driver hands back for
 * `lastUpdatedAt`: an aggregate over `entity_states` is not a column, and comes back as
 * Postgres' own text unless the query says otherwise. And what a save changes: the form sends
 * the whole connection half back with a rename, and only a difference from the row may cost the
 * hub a restart.
 *
 * Needs the development stack: `docker compose -f infra/docker-compose.dev.yml up -d` and
 * `pnpm db:migrate`. Every row is scoped to an id unique to the run and removed afterwards.
 */
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';

import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ConflictError, deviceViewSchema } from '@nebula-home/contracts';
import { createDatabase, schema, sealSecret, secretsKeyFrom, type Database } from '@nebula-home/db';
import { createLogger, type PlatformLogger } from '@nebula-home/logging';

import { listDevices, type DevicesContext } from '@/services/devices.js';
import {
  bearer,
  buildTestServer,
  forgotten,
  makeCoreRefuse,
  reloaded,
  stopHub,
  unregistered,
} from '@/testing/hub-harness.js';

const DATABASE_URL = 'postgres://nebula:nebula@localhost:5432/nebula';

/** The key the test server seals with; the row is sealed with the same one. */
const SECRETS_KEY = secretsKeyFrom('11'.repeat(32));

/** The instance id, unique to the run so two runs never see each other's device. */
const instanceId = `api-devices-test-${randomUUID().slice(0, 8)}`;

/** The entity that reports. */
const powerEntityId = `sensor.${instanceId.replaceAll('-', '_')}_power`;

/** When the entity last reported, to the millisecond, so the read can be compared exactly. */
const lastUpdated = new Date('2026-09-17T15:06:40.500Z');

let database: ReturnType<typeof createDatabase>;
let context: DevicesContext;
let server: FastifyInstance;

/**
 * A logger that writes nowhere.
 *
 * @returns A logger bound to a discarding stream.
 */
function silent(): PlatformLogger {
  return createLogger(
    { service: 'api-devices', version: '0.0.0', level: 'fatal' },
    new Writable({
      /**
       * Discards a chunk.
       *
       * @param chunk - Ignored.
       * @param encoding - Ignored.
       * @param done - Called to accept the write.
       */
      write(chunk, encoding, done): void {
        done();
      },
    }),
  );
}

/**
 * Writes the two halves of a device the fake hub's catalogue knows, and one entity that has
 * reported.
 *
 * @param db - A connected database handle.
 */
async function insertDevice(db: Database): Promise<void> {
  await db.insert(schema.registry.integrations).values({
    id: instanceId,
    kind: 'bambu-lab/printer',
    kindVersion: '1.0.0',
    model: 'X1C',
    transport: 'mqtt',
    transportConfig: {
      url: 'mqtts://192.168.1.60:8883',
      username: 'bblp',
      shouldVerifyCertificate: false,
      password: sealSecret('12345678', SECRETS_KEY),
    },
    options: {},
    isEnabled: true,
    state: 'running',
  });

  const [device] = await db
    .insert(schema.registry.devices)
    .values({
      integrationId: instanceId,
      externalId: '01P00A000000001',
      name: 'Workshop printer',
      icon: 'printer',
      manufacturer: 'Bambu Lab',
      model: 'X1C',
    })
    .returning({ id: schema.registry.devices.id });

  if (device === undefined) {
    throw new Error('Could not insert the device');
  }

  const [entity] = await db
    .insert(schema.registry.entities)
    .values({
      entityId: powerEntityId,
      deviceId: device.id,
      integrationId: instanceId,
      source: 'adapter',
      name: 'Power',
    })
    .returning({ id: schema.registry.entities.id });

  if (entity === undefined) {
    throw new Error('Could not insert the entity');
  }

  await db.insert(schema.registry.entityStates).values({
    entityId: entity.id,
    state: { sensor_numeric: { value: 12.5 } },
    isAvailable: true,
    lastChanged: lastUpdated,
    lastUpdated,
    source: instanceId,
  });
}

/**
 * Changes the device through the real route.
 *
 * @param payload - The body.
 * @returns The status and the device as it now stands.
 */
async function patch(payload: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const response = await server.inject({
    method: 'PATCH',
    url: `/api/v1/devices/${instanceId}`,
    headers: { authorization: await bearer('device:write') },
    payload,
  });

  return { status: response.statusCode, body: response.json() };
}

beforeAll(async () => {
  database = createDatabase({ connectionString: DATABASE_URL, applicationName: 'api-dev-test' });
  await insertDevice(database.db);

  // No bus: the hub is away, so the driver's name falls back to its id, which is not what is
  // under test here. The catalogue knows the one icon the device carries.
  context = {
    db: database.db,
    bus: undefined,
    secretsKey: SECRETS_KEY,
    logger: silent(),
    timeoutMs: 1000,
    traceId: 'api-devices-test',
    icons: { has: (id: string): boolean => id === 'printer' },
  };

  server = await buildTestServer(true, database.db);
});

afterAll(async () => {
  stopHub();
  await server.close();

  await database.db
    .delete(schema.registry.entities)
    .where(eq(schema.registry.entities.entityId, powerEntityId));
  await database.db
    .delete(schema.registry.devices)
    .where(eq(schema.registry.devices.integrationId, instanceId));
  await database.db
    .delete(schema.registry.integrations)
    .where(eq(schema.registry.integrations.id, instanceId));
  await database.close();
});

describe('listing devices from the database', () => {
  it('reads the last report as a date the contract accepts, beside both halves', async () => {
    const device = (await listDevices(context)).find((one) => one.id === instanceId);

    expect(device).toBeDefined();
    expect(device?.lastUpdatedAt).toBeInstanceOf(Date);
    expect(device?.lastUpdatedAt?.toISOString()).toBe(lastUpdated.toISOString());
    expect(device?.model).toBe('X1C');
    expect(device?.entityIds).toEqual([powerEntityId]);
    expect(deviceViewSchema.safeParse(device).success).toBe(true);
  });
});

describe('changing a device through the route', () => {
  it('renames without a restart when the connection half comes back unchanged', async () => {
    reloaded.length = 0;

    // What the form sends: everything it holds, the secret left blank to keep the saved one.
    const { status, body } = await patch({
      name: 'Studio printer',
      icon: 'printer',
      isEnabled: true,
      model: 'X1C',
      transportConfig: { url: 'mqtts://192.168.1.60:8883' },
      options: {},
    });

    expect(status).toBe(200);
    expect(body).toMatchObject({ name: 'Studio printer', state: 'running' });
    expect(reloaded).toEqual([]);
  });

  it('asks the hub to start the instance again when the address differs', async () => {
    reloaded.length = 0;

    const { status } = await patch({
      name: 'Studio printer',
      isEnabled: true,
      transportConfig: { url: 'mqtts://192.168.1.61:8883' },
      options: {},
    });

    expect(status).toBe(200);
    expect(reloaded).toEqual([instanceId]);
  });

  it('asks again when the device is switched off, and for nothing else', async () => {
    reloaded.length = 0;

    const { status, body } = await patch({ isEnabled: false });

    expect(status).toBe(200);
    expect(reloaded).toEqual([instanceId]);
    expect(body).toMatchObject({ isEnabled: false });
  });
});

describe('removing a device through the route', () => {
  /**
   * Removes the device as somebody who may.
   *
   * @returns The status and the body, if any.
   */
  async function remove(): Promise<{ status: number; body: unknown }> {
    const response = await server.inject({
      method: 'DELETE',
      url: `/api/v1/devices/${instanceId}`,
      headers: { authorization: await bearer('device:delete') },
    });

    return {
      status: response.statusCode,
      body: response.statusCode === 204 ? undefined : response.json(),
    };
  }

  it('cannot remove anything while the bus is away, and says which dependency is missing', async () => {
    // Nothing can be stopped and nothing released without the bus, so nothing is touched: a
    // delete that removed the rows and left the instance running would be worse than one that
    // waits.
    const offline = await buildTestServer(false, database.db);

    try {
      const response = await offline.inject({
        method: 'DELETE',
        url: `/api/v1/devices/${instanceId}`,
        headers: { authorization: await bearer('device:delete') },
      });

      expect(response.statusCode).toBe(503);
      expect(JSON.stringify(response.json())).toContain('bus');
    } finally {
      await offline.close();
    }
  });

  it('refuses before the hub is asked while an alias reads one of its entities', async () => {
    // Refused by `core` alone, the device would already be stopped by the time the refusal
    // came back: the hub is asked first. The API asks the same question before either.
    const aliasEntityId = `alias.${instanceId.replaceAll('-', '_')}_watts`;
    const [source] = await database.db
      .select({ id: schema.registry.entities.id })
      .from(schema.registry.entities)
      .where(eq(schema.registry.entities.entityId, powerEntityId));
    const [aliasEntity] = await database.db
      .insert(schema.registry.entities)
      .values({ entityId: aliasEntityId, source: 'derived', name: 'Watts' })
      .returning({ id: schema.registry.entities.id });
    const [alias] = await database.db
      .insert(schema.registry.aliases)
      .values({ entityId: aliasEntity?.id ?? '', capability: 'sensor_numeric', expression: 'w' })
      .returning({ id: schema.registry.aliases.id });

    await database.db
      .insert(schema.registry.aliasSources)
      .values({ aliasId: alias?.id ?? '', variableName: 'w', entityId: source?.id ?? '' });

    forgotten.length = 0;
    unregistered.length = 0;

    try {
      const { status, body } = await remove();

      expect(status).toBe(409);
      expect(JSON.stringify(body)).toContain(powerEntityId);
      expect([forgotten, unregistered]).toEqual([[], []]);
    } finally {
      await database.db
        .delete(schema.registry.entities)
        .where(eq(schema.registry.entities.entityId, aliasEntityId));
    }
  });

  it('keeps the rows when core refuses, and says why', async () => {
    // An alias made between the API's check and `core`'s: `core` refuses, the API passes the
    // refusal on as a conflict, and nothing has changed but the hub having stopped the
    // instance - which the row records, and a retry after the alias is edited undoes.
    forgotten.length = 0;
    unregistered.length = 0;
    makeCoreRefuse(new ConflictError('Derived entities still read this device'));

    try {
      const { status, body } = await remove();

      expect(status).toBe(409);
      expect(JSON.stringify(body)).toContain('Derived entities');
      expect(forgotten).toEqual([instanceId]);
      expect(unregistered).toEqual([]);

      const rows = await database.db
        .select({ id: schema.registry.integrations.id })
        .from(schema.registry.integrations)
        .where(eq(schema.registry.integrations.id, instanceId));

      expect(rows).toHaveLength(1);
    } finally {
      makeCoreRefuse(null);
    }
  });

  it('stops the instance on the hub before core releases the rows, and records who asked', async () => {
    forgotten.length = 0;
    unregistered.length = 0;

    const { status } = await remove();

    expect(status).toBe(204);
    expect([forgotten, unregistered]).toEqual([[instanceId], [instanceId]]);

    const entries = await database.db
      .select({ details: schema.system.auditLog.details })
      .from(schema.system.auditLog)
      .where(
        and(
          eq(schema.system.auditLog.resourceId, instanceId),
          eq(schema.system.auditLog.action, 'device.delete'),
        ),
      );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.details).toMatchObject({ kind: 'bambu-lab/printer' });
  });
});
