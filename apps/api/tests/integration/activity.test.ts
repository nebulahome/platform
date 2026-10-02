/**
 * A device's activity against a real database: read from the state history, nothing of its own.
 *
 * One device with a relay and a power meter. The relay is switched on, carries an attribute that
 * changes nothing a person would call a change, drops off the network and comes back; the meter
 * reads a new value. The activity shows the relay's three changes, newest first, pages through
 * them without losing one, and shows nothing of the meter - its readings are the history chart's.
 *
 * Needs the development stack: `pnpm infra:up` and
 * `pnpm db:migrate`. Every row is scoped to ids unique to the run and removed afterwards.
 */
import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, schema } from '@nebulahome/db';

import { bearer, buildTestServer, stopHub } from '@/testing/hub-harness.js';

const DATABASE_URL = 'postgres://nebula:nebula@localhost:5432/nebula';

/** The instance id, unique to the run so two runs never see each other's rows. */
const instanceId = `api-activity-test-${randomUUID().slice(0, 8)}`;

/** The relay and the meter, by address. */
const relayId = `switch.${instanceId.replaceAll('-', '_')}_relay`;
const meterId = `sensor.${instanceId.replaceAll('-', '_')}_power`;

/** An hour ago, on a whole minute. */
const start = new Date(Math.floor((Date.now() - 3_600_000) / 60_000) * 60_000);

/**
 * A moment some minutes after the start.
 *
 * @param minutes - How long after.
 * @returns The moment.
 */
function at(minutes: number): Date {
  return new Date(start.getTime() + minutes * 60_000);
}

let database: ReturnType<typeof createDatabase>;
let server: FastifyInstance;

/** The entities' rows, whose history is removed with them. */
const rowIds: string[] = [];

/**
 * Reads one page of the device's activity.
 *
 * @param query - The page size and cursor.
 * @param grants - What the caller holds.
 * @returns The status and the parsed body.
 */
async function read(
  query: Record<string, string> = {},
  grants: readonly string[] = ['device:read', 'entity:read', 'history:read'],
): Promise<{
  status: number;
  body: { items: Record<string, unknown>[]; nextCursor?: string };
}> {
  const response = await server.inject({
    method: 'GET',
    url: `/api/v1/devices/${instanceId}/activity?${new URLSearchParams(query).toString()}`,
    headers: { authorization: await bearer(...grants) },
  });

  return { status: response.statusCode, body: response.json() };
}

beforeAll(async () => {
  database = createDatabase({
    connectionString: DATABASE_URL,
    applicationName: 'api-activity-test',
  });

  await database.db.insert(schema.registry.integrations).values({
    id: instanceId,
    kind: 'shelly/switch-pm',
    kindVersion: '1.0.0',
    model: '1PM Gen3',
    transport: 'shelly/rpc',
    transportConfig: {},
    options: {},
    isEnabled: true,
  });

  const [device] = await database.db
    .insert(schema.registry.devices)
    .values({ integrationId: instanceId, externalId: null, name: 'Bench relay', icon: 'relay' })
    .returning({ id: schema.registry.devices.id });

  const rows = await database.db
    .insert(schema.registry.entities)
    .values([
      {
        entityId: relayId,
        deviceId: device?.id ?? '',
        integrationId: instanceId,
        source: 'adapter',
        name: 'Relay',
      },
      {
        entityId: meterId,
        deviceId: device?.id ?? '',
        integrationId: instanceId,
        source: 'adapter',
        name: 'Power',
      },
    ])
    .returning({ id: schema.registry.entities.id, entityId: schema.registry.entities.entityId });

  const relay = rows.find((row) => row.entityId === relayId)?.id ?? '';
  const meter = rows.find((row) => row.entityId === meterId)?.id ?? '';

  rowIds.push(relay, meter);

  await database.db.insert(schema.registry.entityCapabilities).values([
    { entityId: relay, capability: 'on_off', params: {} },
    { entityId: meter, capability: 'sensor_numeric', params: {} },
  ]);

  const off = { on_off: { isOn: false } };
  const on = { on_off: { isOn: true } };
  const change = {
    attributes: {},
    source: instanceId,
    contextId: null,
    contextType: null,
  };

  await database.db.insert(schema.history.stateHistory).values([
    { ...change, time: at(1), entityId: relay, state: on, previousState: off, isAvailable: true },
    // An attribute moved and nothing else: not a change anybody would look for.
    {
      ...change,
      time: at(2),
      entityId: relay,
      state: on,
      previousState: on,
      attributes: { rssi: -60 },
      isAvailable: true,
    },
    {
      ...change,
      time: at(3),
      entityId: meter,
      state: { sensor_numeric: { value: 12 } },
      previousState: { sensor_numeric: { value: 0 } },
      isAvailable: true,
    },
    { ...change, time: at(4), entityId: relay, state: on, previousState: on, isAvailable: false },
    { ...change, time: at(5), entityId: relay, state: on, previousState: on, isAvailable: true },
  ]);

  server = await buildTestServer(true, database.db);
});

afterAll(async () => {
  stopHub();
  await server.close();

  await database.db
    .delete(schema.history.stateHistory)
    .where(inArray(schema.history.stateHistory.entityId, rowIds));
  await database.db
    .delete(schema.registry.entities)
    .where(eq(schema.registry.entities.integrationId, instanceId));
  await database.db
    .delete(schema.registry.integrations)
    .where(eq(schema.registry.integrations.id, instanceId));
  await database.close();
});

describe('the activity of a device', () => {
  it('lists what changed on its switches, newest first, and none of its readings', async () => {
    const { status, body } = await read();

    expect(status).toBe(200);
    expect(body.items).toEqual([
      expect.objectContaining({
        entityId: relayId,
        kind: 'availability',
        isAvailable: true,
        wasAvailable: false,
      }),
      expect.objectContaining({
        entityId: relayId,
        kind: 'availability',
        isAvailable: false,
        wasAvailable: true,
      }),
      expect.objectContaining({
        entityId: relayId,
        kind: 'state',
        from: { on_off: { isOn: false } },
        to: { on_off: { isOn: true } },
        isAvailable: true,
      }),
    ]);
  });

  it('pages through it without losing or repeating a change', async () => {
    const first = await read({ limit: '2' });
    const second = await read({ limit: '2', cursor: first.body.nextCursor ?? '' });

    expect(first.body.items).toHaveLength(2);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.items[0]).toMatchObject({ kind: 'state' });
    expect(second.body.nextCursor).toBeUndefined();
  });

  it('shows nothing to somebody who may not read the past', async () => {
    const { status, body } = await read({}, ['device:read', 'entity:read']);

    expect(status).toBe(200);
    expect(body.items).toEqual([]);
  });

  it('says there is no such device when there is none', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/devices/api-activity-nobody/activity',
      headers: { authorization: await bearer('device:read', 'entity:read', 'history:read') },
    });

    expect(response.statusCode).toBe(404);
  });
});
