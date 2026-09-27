/**
 * Reading the past against a real database: an entity's state changes and its numeric readings,
 * raw and rolled up.
 *
 * The hypertables are keyed on the entity's registry row while a request names the entity by its
 * address, and the rolled-up levels are read through raw SQL - the two places a history read
 * breaks without a unit test noticing. Rows are written straight into the tables, the one-minute
 * aggregate is refreshed by hand, and the endpoints are asked for them back.
 *
 * Needs the development stack: `pnpm infra:up` and
 * `pnpm db:migrate`. Every row is scoped to ids unique to the run and removed afterwards.
 */
import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, schema } from '@nebula-home/db';

import { bearer, buildTestServer, stopHub } from '@/testing/hub-harness.js';

const DATABASE_URL = 'postgres://nebula:nebula@localhost:5432/nebula';

/** The instance id, unique to the run so two runs never see each other's rows. */
const instanceId = `api-history-test-${randomUUID().slice(0, 8)}`;

/** The meter the run reads the past of. */
const meterId = `sensor.${instanceId.replaceAll('-', '_')}_power`;

/** Two hours ago, on a whole minute, so the readings fall in known buckets. */
const start = new Date(Math.floor((Date.now() - 2 * 3_600_000) / 60_000) * 60_000);

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

/**
 * Asks a history endpoint about the meter.
 *
 * @param path - `/history/state` or `/history/telemetry`.
 * @param query - The rest of the query.
 * @returns The status and the parsed body.
 */
async function read(
  path: string,
  query: Record<string, string>,
): Promise<{ status: number; body: { items: Record<string, unknown>[] } }> {
  const response = await server.inject({
    method: 'GET',
    url: `/api/v1${path}?${new URLSearchParams({ entityId: meterId, ...query }).toString()}`,
    headers: { authorization: await bearer('entity:read', 'history:read') },
  });

  return { status: response.statusCode, body: response.json() };
}

beforeAll(async () => {
  database = createDatabase({
    connectionString: DATABASE_URL,
    applicationName: 'api-history-test',
  });

  await database.db.insert(schema.registry.integrations).values({
    id: instanceId,
    kind: 'shelly/plug',
    kindVersion: '1.0.0',
    model: 'Plug S',
    transport: 'http',
    transportConfig: {},
    options: {},
    isEnabled: true,
  });

  const [device] = await database.db
    .insert(schema.registry.devices)
    .values({ integrationId: instanceId, externalId: null, name: 'Bench plug', icon: 'plug' })
    .returning({ id: schema.registry.devices.id });

  const [entity] = await database.db
    .insert(schema.registry.entities)
    .values({
      entityId: meterId,
      deviceId: device?.id ?? '',
      integrationId: instanceId,
      source: 'adapter',
      name: 'Power',
    })
    .returning({ id: schema.registry.entities.id });

  const rowId = entity?.id ?? '';

  await database.db.insert(schema.history.telemetry).values([
    { time: at(0), entityId: rowId, value: 100 },
    { time: at(0.5), entityId: rowId, value: 200 },
    { time: at(1), entityId: rowId, value: 50 },
  ]);

  await database.db.insert(schema.history.stateHistory).values({
    time: at(1),
    entityId: rowId,
    state: { sensor_numeric: { value: 50 } },
    previousState: { sensor_numeric: { value: 200 } },
    attributes: {},
    isAvailable: true,
    source: 'adapter',
    contextId: null,
    contextType: null,
  });

  // The policy refreshes every minute and only up to a minute ago; the run does not wait for it.
  await database.db.execute(
    sql`CALL refresh_continuous_aggregate('history.telemetry_1m', ${at(-1).toISOString()}::timestamptz, ${at(5).toISOString()}::timestamptz)`,
  );

  server = await buildTestServer(true, database.db);
});

afterAll(async () => {
  stopHub();
  await server.close();

  await database.db
    .delete(schema.registry.entities)
    .where(eq(schema.registry.entities.entityId, meterId));
  await database.db
    .delete(schema.registry.integrations)
    .where(eq(schema.registry.integrations.id, instanceId));
  await database.close();
});

describe('the past of an entity', () => {
  const window = { from: at(-1).toISOString(), to: at(10).toISOString() };

  it('reads its state changes, named by its address', async () => {
    const { status, body } = await read('/history/state', window);

    expect(status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      entityId: meterId,
      state: { sensor_numeric: { value: 50 } },
    });
  });

  it('reads its raw readings, newest first', async () => {
    const { status, body } = await read('/history/telemetry', { ...window, resolution: 'raw' });

    expect(status).toBe(200);
    expect(body.items.map((item) => item['value'])).toEqual([50, 200, 100]);
  });

  it('reads them rolled up to the minute', async () => {
    const { status, body } = await read('/history/telemetry', { ...window, resolution: '1m' });

    expect(status).toBe(200);
    expect(body.items).toEqual([
      expect.objectContaining({ value: 50, min: 50, max: 50, count: 1 }),
      expect.objectContaining({ value: 150, min: 100, max: 200, count: 2 }),
    ]);
  });
});
