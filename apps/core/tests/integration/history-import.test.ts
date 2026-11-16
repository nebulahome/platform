/**
 * `core` taking in a device's past readings: written into the telemetry table, summarised by the
 * job of 0012/0013 and the aggregates' own policies, and never into anything another entity has.
 *
 * Requires the development stack:
 *
 * ```
 * pnpm infra:up
 * pnpm db:migrate
 * ```
 */
import { Writable } from 'node:stream';

import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BusClient, connectBus, ulid, type BusConnection } from '@nebulahome/bus';
import {
  busSubjects,
  CORE_HISTORY_IMPORT_METHOD,
  CORE_REGISTER_METHOD,
  CORE_SERVICE,
  historyImportReplySchema,
  parseEntityId,
  registerDeviceReplySchema,
} from '@nebulahome/contracts';
import { createDatabase, schema, type Database } from '@nebulahome/db';
import { createLogger, type PlatformLogger } from '@nebulahome/logging';

import { EntityDirectory } from '@/domain/entity-directory.js';
import { EntityRegistry } from '@/domain/entity-registry.js';
import { createStateCacheWriter } from '@/persistence/history-writer.js';
import { startHistoryImportService } from '@/services/history-import.js';
import { startRegistrationService } from '@/services/registration.js';

const DATABASE_URL = 'postgres://nebula:nebula@localhost:5432/nebula';
const NATS_URL = 'nats://localhost:4222';
const HOUR_MS = 3_600_000;

const suffix = ulid().toLowerCase().slice(0, 10);
const instanceId = `imp-${suffix}`;
const imported = parseEntityId(`sensor.imp_${suffix}_price`);
const live = parseEntityId(`sensor.imp_${suffix}_power`);
const single = parseEntityId(`sensor.imp_${suffix}_rate`);
const relay = parseEntityId(`switch.imp_${suffix}_relay`);
const all = [imported, live, single, relay];

let database: { db: Database; close: () => Promise<void> };
let bus: BusConnection;
let caller: BusClient;
let serving: { unsubscribe: () => void }[];
let rowIds: Map<string, string>;
let firstReply: { createdEntityIds: string[] };

/**
 * A logger that writes nowhere.
 *
 * @returns A logger bound to a discarding stream.
 */
function silent(): PlatformLogger {
  return createLogger(
    { service: 'core-history-import', version: '0.0.0', level: 'fatal' },
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
 * Asks `core` to register the device, as `hub` does once it identified it.
 *
 * @returns What `core` wrote.
 */
async function register(): Promise<{ createdEntityIds: string[] }> {
  return caller.request(
    busSubjects.service(CORE_SERVICE, CORE_REGISTER_METHOD),
    {
      integrationId: instanceId,
      externalId: `imp-${suffix}`,
      config: { claim: { deviceKey: 'lab', externalId: `imp-${suffix}`, descriptor: {} } },
      entities: [
        { entityId: imported, name: 'Price', capabilities: { sensor_numeric: {} } },
        { entityId: live, name: 'Power', capabilities: { sensor_numeric: {} } },
        { entityId: single, name: 'Rate', capabilities: { sensor_numeric: {} } },
        { entityId: relay, name: 'Relay', capabilities: { on_off: {} } },
      ],
    },
    registerDeviceReplySchema,
  );
}

/**
 * Hands `core` past readings, as `hub` does.
 *
 * @param entityId - The entity.
 * @param readings - When and what.
 * @param integrationId - Who asks; the owner unless said.
 * @returns What `core` wrote and left out.
 */
async function importReadings(
  entityId: string,
  readings: { observedAt: string; value: number }[],
  integrationId = instanceId,
): Promise<{ written: number; skipped: number }> {
  return caller.request(
    busSubjects.service(CORE_SERVICE, CORE_HISTORY_IMPORT_METHOD),
    { integrationId, entityId, readings },
    historyImportReplySchema,
  );
}

/**
 * Runs a TimescaleDB job now. The scheduler may be running it, or a policy over the same
 * stretch, at the same moment: a run that meets one is tried again.
 *
 * @param where - Which job, by what `timescaledb_information.jobs` says of it.
 */
async function runJob(where: ReturnType<typeof sql>): Promise<void> {
  const rows = await database.db.execute<{ job_id: number }>(
    sql`SELECT job_id FROM timescaledb_information.jobs WHERE ${where}`,
  );
  const jobId = rows[0]?.job_id;

  if (jobId === undefined) {
    throw new Error('A job is missing: run pnpm db:migrate');
  }

  for (let attempt = 1; ; attempt += 1) {
    try {
      await database.db.execute(sql`CALL run_job(${jobId}::integer)`);

      return;
    } catch (error: unknown) {
      const isConcurrent = (error as { cause?: { code?: string } }).cause?.code === '55P03';

      if (!isConcurrent || attempt === 40) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

/**
 * Brings the summaries up to date as the scheduler would within the hour: the job of imported
 * stretches, then each aggregate's own policy.
 */
async function summarise(): Promise<void> {
  await runJob(sql`proc_name = 'refresh_imported_telemetry'`);

  for (const view of ['telemetry_1m', 'telemetry_1h', 'telemetry_1d']) {
    await runJob(
      sql`proc_name = 'policy_refresh_continuous_aggregate' AND hypertable_name = ${view}`,
    );
  }
}

/**
 * One entity's hourly buckets, oldest first.
 *
 * @param entityId - The entity.
 * @returns Each bucket's start and mean.
 */
async function hourly(entityId: string): Promise<{ bucket: string; avg: number }[]> {
  const rows = await database.db.execute<{ bucket: string; avg_value: number }>(
    sql`SELECT bucket::text, avg_value FROM history.telemetry_1h
        WHERE entity_id = ${rowIds.get(entityId) ?? ''}::uuid ORDER BY bucket`,
  );

  return rows.map((row) => ({ bucket: row.bucket, avg: row.avg_value }));
}

beforeAll(async () => {
  const logger = silent();
  database = createDatabase({
    connectionString: DATABASE_URL,
    applicationName: 'core-import-test',
  });
  bus = await connectBus({
    url: NATS_URL,
    name: 'core-history-import',
    logger,
    signal: AbortSignal.timeout(20_000),
  });

  await database.db.insert(schema.registry.integrations).values({
    id: instanceId,
    kind: 'pun-prices',
    kindVersion: '1.0.0',
    transport: 'pun/gme',
    transportConfig: {},
    options: {},
    isEnabled: true,
  });
  await database.db.insert(schema.registry.devices).values({
    integrationId: instanceId,
    externalId: null,
    name: 'Import lab',
    icon: 'euro',
  });

  const directory = new EntityDirectory();
  const core = new BusClient({ transport: bus.transport, source: 'core', logger });

  serving = [
    ...startRegistrationService({
      client: core,
      db: database.db,
      directory,
      registry: new EntityRegistry(),
      stateCache: createStateCacheWriter({ db: database.db, logger, batchSize: 1000 }),
      logger,
    }),
    startHistoryImportService({ client: core, db: database.db, directory, logger }),
  ];
  caller = new BusClient({
    transport: bus.transport,
    source: 'hub',
    logger,
    requestTimeoutMs: 5000,
  });

  firstReply = await register();

  const rows = await database.db
    .select({ id: schema.registry.entities.id, entityId: schema.registry.entities.entityId })
    .from(schema.registry.entities)
    .where(inArray(schema.registry.entities.entityId, all));

  rowIds = new Map(rows.map((row) => [row.entityId, row.id]));
});

afterAll(async () => {
  for (const subscription of serving) {
    subscription.unsubscribe();
  }

  const ids = [...rowIds.values()];

  await database.db
    .delete(schema.history.telemetry)
    .where(inArray(schema.history.telemetry.entityId, ids));
  // Summarise the stretch again, now empty of the test's readings, so its buckets go too.
  await database.db.insert(schema.history.telemetryRefreshes).values({
    fromTime: new Date(Date.now() - 4 * 24 * HOUR_MS),
    toTime: new Date(),
  });
  await summarise();
  await database.db
    .delete(schema.registry.entities)
    .where(inArray(schema.registry.entities.entityId, all));
  await database.db
    .delete(schema.registry.devices)
    .where(eq(schema.registry.devices.integrationId, instanceId));
  await database.db
    .delete(schema.registry.integrations)
    .where(eq(schema.registry.integrations.id, instanceId));

  await bus.close();
  await database.close();
});

describe('registering a device', () => {
  it('names the entities written for the first time, and none when it is heard again', async () => {
    expect([...firstReply.createdEntityIds].sort()).toEqual([...all].sort());
    expect((await register()).createdEntityIds).toEqual([]);
  });
});

describe("a device's past readings", () => {
  it('are written and summarised, leaving every other entity as it was', async () => {
    const now = Date.now();
    const hourStart = Math.floor(now / HOUR_MS) * HOUR_MS;
    const at = (hoursAgo: number): Date => new Date(hourStart - hoursAgo * HOUR_MS);

    // What another sensor read live over the same days, already summarised. Up to two hours
    // ago, so every bucket is one the hourly policy has closed.
    await database.db.insert(schema.history.telemetry).values(
      Array.from({ length: 71 }, (unused, index) => ({
        time: at(72 - index),
        entityId: rowIds.get(live) ?? '',
        value: 100 + index,
      })),
    );
    await database.db.insert(schema.history.telemetryRefreshes).values({
      fromTime: at(72),
      toTime: at(2),
    });
    await summarise();

    const before = await hourly(live);

    expect(before).toHaveLength(71);

    const reply = await importReadings(imported, [
      ...Array.from({ length: 47 }, (unused, index) => ({
        observedAt: at(48 - index).toISOString(),
        value: 0.2 + index / 1000,
      })),
      // After the entity was registered: among the live readings, left out.
      { observedAt: new Date(now + HOUR_MS).toISOString(), value: 9 },
      // Older than the 7 days kept, left out.
      { observedAt: new Date(now - 40 * 24 * HOUR_MS).toISOString(), value: 9 },
    ]);

    expect(reply).toEqual({ written: 47, skipped: 2 });

    await summarise();

    const summarised = await hourly(imported);

    expect(summarised).toHaveLength(47);
    expect(summarised[0]?.avg).toBeCloseTo(0.2, 9);
    expect(await hourly(live)).toEqual(before);
    expect(await database.db.select().from(schema.history.telemetryRefreshes)).toEqual([]);
  });

  it('summarises a stretch of one reading', async () => {
    const twoDaysAgo = Math.floor(Date.now() / HOUR_MS) * HOUR_MS - 48 * HOUR_MS;

    expect(
      await importReadings(single, [{ observedAt: new Date(twoDaysAgo).toISOString(), value: 7 }]),
    ).toEqual({ written: 1, skipped: 0 });

    await runJob(sql`proc_name = 'refresh_imported_telemetry'`);

    expect((await hourly(single)).map((bucket) => bucket.avg)).toEqual([7]);
  });

  it("refuses another instance's entity, and leaves out one with no numeric reading", async () => {
    const reading = [{ observedAt: new Date(Date.now() - HOUR_MS).toISOString(), value: 1 }];

    await expect(importReadings(imported, reading, `other-${suffix}`)).rejects.toThrow(
      `is not an entity of other-${suffix}`,
    );
    await expect(importReadings(relay, reading)).resolves.toEqual({ written: 0, skipped: 1 });
  });
});
