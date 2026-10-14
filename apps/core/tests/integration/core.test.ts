/**
 * `core` end to end, against a real broker and a real database.
 *
 * The unit tests cover the registry and the validation in isolation. This covers the thing they
 * cannot: that the pieces are wired to each other. A report published by an adapter has to reach
 * the registry, become an event, become a history row, and come back out of a snapshot - and
 * every one of those hops crosses a boundary that a unit test replaces with a double.
 *
 * Requires the development infrastructure:
 * `pnpm infra:up`, then `pnpm db:migrate`.
 */
import { Writable } from 'node:stream';

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { BusClient, connectBus, ulid, type BusConnection } from '@nebulahome/bus';
import {
  busSubjects,
  CORE_SERVICE,
  CORE_SYSTEM_MONITOR_METHOD,
  DeviceUnavailableError,
  entityStateSchema,
  parseEntityId,
  stateSnapshotReplySchema,
  SUN_ENTITY_IDS,
  SYSTEM_ENTITIES,
  systemMonitorSnapshotSchema,
} from '@nebulahome/contracts';
import { createDatabase, schema, type DatabaseHandle } from '@nebulahome/db';
import { createLogger, type PlatformLogger } from '@nebulahome/logging';

import type { CoreConfig } from '@/config.js';
import { ensureSystemDevice, SYSTEM_DEVICE_NAME } from '@/persistence/system-entities.js';
import { CoreService } from '@/service.js';

import { FakeAdapter } from './support/fake-adapter.js';
import { insertFixture, removeFixture, type Fixture } from './support/fixtures.js';

/** The development infrastructure started by `pnpm infra:up`. */
const NATS_URL = 'nats://localhost:4222';
const DATABASE_URL = 'postgres://nebula:nebula@localhost:5432/nebula';

const bulb = parseEntityId('light.kitchen_ceiling');
const thermometer = parseEntityId('sensor.kitchen_temperature');
const systemCpu = parseEntityId('sensor.system_cpu_usage');

/**
 * A logger that writes nowhere.
 *
 * @returns A logger bound to a discarding stream.
 */
function silentLogger(): PlatformLogger {
  return createLogger(
    { service: 'core-integration', version: '0.0.0', level: 'fatal' },
    new Writable({
      write(chunk, encoding, callback): void {
        callback();
      },
    }),
  );
}

/**
 * Waits until a predicate holds.
 *
 * @param predicate - What has to become true.
 * @param timeoutMs - How long to keep checking.
 * @returns A promise that resolves once it holds.
 * @throws {Error} When it never does.
 */
async function eventually(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error('Condition never became true');
}

/**
 * Polls a query until it returns something.
 *
 * The pipeline is asynchronous end to end - a buffered writer here, a JetStream pull there - so a
 * query run the instant after a publish is a query run too early.
 *
 * @param query - The query to run.
 * @param timeoutMs - How long to keep trying.
 * @returns The rows, once there are any. An empty array when the timeout expires, so the failure
 * is the test's own assertion rather than a thrown helper.
 */
async function untilRows<TRow>(query: () => Promise<TRow[]>, timeoutMs = 10_000): Promise<TRow[]> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const rows = await query();

    if (rows.length > 0) {
      return rows;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return [];
}

describe('core end to end', () => {
  let database: DatabaseHandle;
  let bus: BusConnection;
  let service: CoreService;
  let adapter: FakeAdapter;
  let caller: BusClient;
  let fixture: Fixture;

  const packageId = `pkg-fake-${ulid().toLowerCase().slice(0, 12)}`;

  beforeAll(async () => {
    database = createDatabase({
      connectionString: DATABASE_URL,
      applicationName: 'core-integration',
    });

    fixture = await insertFixture(database.db, packageId, [
      {
        entityId: bulb,
        name: 'Kitchen ceiling',
        capabilities: { on_off: {}, level: { hasTransition: true } },
      },
      { entityId: thermometer, name: 'Kitchen temperature', capabilities: { sensor_numeric: {} } },
    ]);

    bus = await connectBus({
      url: NATS_URL,
      name: 'core-integration',
      logger: silentLogger(),
      signal: AbortSignal.timeout(20_000),
    });

    adapter = new FakeAdapter({
      transport: bus.transport,
      packageId,
      logger: silentLogger(),
      entities: [
        { entityId: bulb, state: { on_off: { isOn: false }, level: { level: 0 } } },
        { entityId: thermometer, state: { sensor_numeric: { value: 20 } } },
      ],
    });

    adapter.start();

    caller = new BusClient({
      transport: bus.transport,
      source: 'core-integration',
      logger: silentLogger(),
      requestTimeoutMs: 5000,
    });

    const config: CoreConfig = {
      NODE_ENV: 'test',
      LOG_LEVEL: 'fatal',
      DATABASE_URL,
      NATS_URL,
      CORE_COMMAND_TIMEOUT_MS: 2000,
      CORE_HISTORY_FLUSH_INTERVAL_MS: 100,
      CORE_HISTORY_BATCH_SIZE: 1,
      CORE_TELEMETRY_BATCH_SIZE: 100,
      CORE_SYSTEM_SAMPLE_INTERVAL_MS: 1000,
      CORE_SYSTEM_PUBLISH_INTERVAL_MS: 1000,
      CORE_NET_DEV_PATH: '/proc/net/dev',
      CORE_AUTOMATION_STARTUP_GRACE_MS: 0,
    };

    service = new CoreService({ config, db: database.db, bus, logger: silentLogger() });

    await service.start();
  });

  afterAll(async () => {
    adapter.stop();
    await service.stop();
    await bus.close();
    await removeFixture(database.db, fixture);
    await database.close();
  });

  it('loads the configured entities and who owns them', () => {
    expect(service.directory.size).toBeGreaterThanOrEqual(2);
    expect(service.directory.get(bulb)?.source).toBe(packageId);
    expect(service.directory.get(bulb)?.capabilities.has('level')).toBe(true);
  });

  it('asks the adapter to resynchronise at startup', async () => {
    // The database holds what `core` last managed to persist; the adapter holds the truth.
    await eventually(() => adapter.resyncCount >= 1);

    expect(adapter.resyncCount).toBeGreaterThanOrEqual(1);
  });

  it('ingests a report into the registry', async () => {
    adapter.report(bulb, { on_off: { isOn: true }, level: { level: 60 } });

    await eventually(() => service.registry.get(bulb)?.state.level?.level === 60);

    const state = service.registry.get(bulb);

    expect(state?.state.on_off?.isOn).toBe(true);
    expect(state?.source).toBe(packageId);
  });

  it('fans the change out as an event', async () => {
    const received: unknown[] = [];

    const subscription = caller.subscribe(
      busSubjects.stateChanged(bulb),
      z.object({ current: entityStateSchema }),
      (payload) => {
        received.push(payload.current.state);
      },
    );

    await eventually(() => true, 100);
    adapter.report(bulb, { level: { level: 25 } });

    await eventually(() => received.length === 1);

    expect(received[0]).toStrictEqual({ on_off: { isOn: true }, level: { level: 25 } });

    subscription.unsubscribe();
  });

  it('writes a history row for the change', async () => {
    const rowId = fixture.rowIds.get(bulb) ?? '';

    adapter.report(bulb, { level: { level: 33 } });

    // The writer flushes on its own timer, so this polls rather than assuming the row is there
    // the instant the event was published.
    const rows = await untilRows(async () =>
      database.db
        .select({ state: schema.history.stateHistory.state })
        .from(schema.history.stateHistory)
        .where(eq(schema.history.stateHistory.entityId, rowId)),
    );

    expect(rows.length).toBeGreaterThan(0);
  });

  it('does not emit anything when a sensor repeats itself', async () => {
    const received: unknown[] = [];

    const subscription = caller.subscribe(
      busSubjects.stateChanged(thermometer),
      z.object({ current: entityStateSchema }),
      (payload) => {
        received.push(payload.current);
      },
    );

    await eventually(() => true, 100);

    adapter.report(thermometer, { sensor_numeric: { value: 21.5 } });
    await eventually(() => received.length === 1);

    adapter.report(thermometer, { sensor_numeric: { value: 21.5 } });
    adapter.report(thermometer, { sensor_numeric: { value: 21.5 } });

    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(received).toHaveLength(1);

    subscription.unsubscribe();
  });

  it('answers a snapshot request', async () => {
    const snapshot = await caller.request(
      busSubjects.stateSnapshot(),
      {},
      stateSnapshotReplySchema,
    );

    expect(snapshot.entities.map((entity) => entity.entityId)).toContain(bulb);
    expect(snapshot.takenAt).toBeInstanceOf(Date);
  });

  it('answers a single-entity read', async () => {
    const state = await caller.request(busSubjects.stateGet(bulb), {}, entityStateSchema);

    expect(state.entityId).toBe(bulb);
    expect(state.lastChanged).toBeInstanceOf(Date);
  });

  it('reports an unknown entity as not found rather than as empty', async () => {
    const unknown = parseEntityId('light.does_not_exist');

    await expect(
      caller.request(busSubjects.stateGet(unknown), {}, entityStateSchema),
    ).rejects.toThrow(/No state for/);
  });

  it('routes a command to the owning adapter and acknowledges it', async () => {
    const before = adapter.received.length;

    const ack = await caller.request(
      busSubjects.command(bulb, 'level'),
      { command: { command: 'set_level', level: 80 } },
      z.object({ entityId: z.string(), capability: z.string() }),
    );

    expect(ack.entityId).toBe(bulb);
    expect(adapter.received.length).toBe(before + 1);
    expect(adapter.received.at(-1)?.command).toStrictEqual({ command: 'set_level', level: 80 });

    // A device that acknowledged a command and never reported the result is a device the
    // interface shows as stuck, so the loop has to close.
    await eventually(() => service.registry.get(bulb)?.state.level?.level === 80);
  });

  it('refuses a command for a capability the entity does not declare', async () => {
    await expect(
      caller.request(
        busSubjects.command(bulb, 'lock'),
        { command: { command: 'lock' } },
        z.object({}),
      ),
    ).rejects.toThrow(/has no lock capability/);
  });

  it('refuses a command a read-only capability cannot accept', async () => {
    await expect(
      caller.request(
        busSubjects.command(thermometer, 'sensor_numeric'),
        { command: { command: 'set' } },
        z.object({}),
      ),
    ).rejects.toThrow(/reports only/);
  });

  it('reports an unreachable adapter as unavailability, not as a transport failure', async () => {
    adapter.stop();

    try {
      await expect(
        caller.request(
          busSubjects.command(bulb, 'on_off'),
          { command: { command: 'turn_on' } },
          z.object({}),
        ),
      ).rejects.toBeInstanceOf(DeviceUnavailableError);
    } finally {
      adapter.start();
    }
  });

  it('stores a telemetry reading in the hypertable', async () => {
    const rowId = fixture.rowIds.get(thermometer) ?? '';

    adapter.publishTelemetry(thermometer, 22.25, new Date());

    const rows = await untilRows(
      async () =>
        database.db
          .select({ value: schema.history.telemetry.value })
          .from(schema.history.telemetry)
          .where(
            and(
              eq(schema.history.telemetry.entityId, rowId),
              eq(schema.history.telemetry.value, 22.25),
            ),
          ),
      20_000,
    );

    expect(rows).toHaveLength(1);
  });

  it('refuses a report from a package that does not own the entity', async () => {
    // Without this, any installed package could report `lock.front_door` as unlocked and the
    // interface would believe it.
    const impostor = new BusClient({
      transport: bus.transport,
      source: 'pkg-impostor',
      logger: silentLogger(),
    });

    const before = service.registry.get(bulb)?.state.level?.level;

    impostor.publish(busSubjects.stateReport(bulb), {
      entityId: bulb,
      state: { level: { level: 1 } },
    });

    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(service.registry.get(bulb)?.state.level?.level).toBe(before);
  });

  it('writes the system device and its entities, once', async () => {
    const devices = await database.db
      .select({ id: schema.registry.devices.id })
      .from(schema.registry.devices)
      .where(eq(schema.registry.devices.source, 'system'));
    const entities = await database.db
      .select({
        entityId: schema.registry.entities.entityId,
        deviceId: schema.registry.entities.deviceId,
      })
      .from(schema.registry.entities)
      .where(eq(schema.registry.entities.source, 'system'));

    const [house] = await database.db
      .select({ latitude: schema.registry.areas.latitude })
      .from(schema.registry.areas)
      .where(eq(schema.registry.areas.kind, 'house'));
    // The sun's two are there exactly when the house has a position.
    const sun = house?.latitude === null || house?.latitude === undefined ? [] : SUN_ENTITY_IDS;

    expect(devices).toHaveLength(1);
    expect(entities.map((entity) => entity.entityId).sort()).toEqual(
      [...SYSTEM_ENTITIES.map((entity) => entity.entityId), ...sun].sort(),
    );
    expect(new Set(entities.map((entity) => entity.deviceId))).toEqual(new Set([devices[0]?.id]));
    expect(service.directory.get(systemCpu)?.source).toBe('system');
  });

  it('keeps the name the owner gave the system device when it starts again', async () => {
    const { devices } = schema.registry;

    await database.db
      .update(devices)
      .set({ name: 'Rack server' })
      .where(eq(devices.source, 'system'));

    try {
      await ensureSystemDevice(
        database.db,
        {
          manufacturer: 'NebulaHome',
          model: 'Test OS · x64',
          swVersion: '0.0.0',
          hwVersion: 'Test processor',
          externalId: 'test-host',
        },
        silentLogger(),
      );

      const rows = await database.db
        .select({ name: devices.name, model: devices.model })
        .from(devices)
        .where(eq(devices.source, 'system'));

      expect(rows).toEqual([{ name: 'Rack server', model: 'Test OS · x64' }]);
    } finally {
      await database.db
        .update(devices)
        .set({ name: SYSTEM_DEVICE_NAME })
        .where(eq(devices.source, 'system'));
    }
  });

  it('answers the system monitor with the host and the samples taken so far', async () => {
    const read = async (): Promise<z.output<typeof systemMonitorSnapshotSchema>> =>
      caller.request(
        busSubjects.service(CORE_SERVICE, CORE_SYSTEM_MONITOR_METHOD),
        {},
        systemMonitorSnapshotSchema,
      );

    let snapshot = await read();

    for (let attempt = 0; snapshot.samples.length === 0 && attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      snapshot = await read();
    }

    expect(snapshot.host.cpuCount).toBeGreaterThan(0);
    expect(snapshot.samples.length).toBeGreaterThan(0);
    expect(snapshot.disk?.categories[0]?.id).toBe('core');
  });

  it('gives the system entities a state out of the samples', async () => {
    await eventually(() => service.registry.get(systemCpu)?.state.sensor_numeric !== undefined);

    const value = service.registry.get(systemCpu)?.state.sensor_numeric?.value ?? -1;

    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(100);
  });
});
