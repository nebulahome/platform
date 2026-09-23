/**
 * `hub` against a real database and a real broker.
 *
 * What the unit tests cannot reach: the SQL, and the lifecycle decisions that depend on it. The
 * mapping, routing and adoption logic is covered by the tests beside the sources, against real
 * declarative bundles and an in-memory broker; this file exists for the handful of Drizzle
 * statements that only a database can prove.
 *
 * Requires the development stack:
 *
 * ```
 * docker compose -f infra/docker-compose.dev.yml up -d
 * pnpm db:migrate
 * ```
 */
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { eq } from 'drizzle-orm';
import { connectAsync } from 'mqtt';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BusClient, connectBus, ulid, type BusConnection } from '@nebula-home/bus';
import {
  busSubjects,
  CORE_REGISTER_METHOD,
  CORE_SERVICE,
  forgetReplySchema,
  HUB_FORGET_METHOD,
  HUB_PROBE_METHOD,
  HUB_RELOAD_METHOD,
  HUB_SERVICE,
  NotFoundError,
  probeReplySchema,
  registerDeviceRequestSchema,
  reloadReplySchema,
  type RegisterDeviceRequest,
} from '@nebula-home/contracts';
import {
  createDatabase,
  schema,
  sealSecrets,
  secretsKeyFrom,
  type Database,
} from '@nebula-home/db';
import { createLogger, type PlatformLogger } from '@nebula-home/logging';

import { hubEnvSchema } from '@/config.js';
import { loadInstances, recordStatus } from '@/persistence/instances.js';
import { HubService } from '@/service.js';
import { mqttTransport } from '@/transports/mqtt.js';

const DATABASE_URL = 'postgres://nebula:nebula@localhost:5432/nebula';
const NATS_URL = 'nats://localhost:4222';

/** The repository's bundles under development, which the tests run against. */
const REPOSITORY_BUNDLE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../bundles',
);

/**
 * A data directory with nothing installed in it, so that what a developer happens to have in
 * `infra/data` cannot change what these tests load. Never created: a missing one is a fresh
 * installation.
 */
const EMPTY_DATA_DIR = path.join(tmpdir(), 'nebula-hub-test-data-that-is-not-there');

let database: { db: Database; close: () => Promise<void> };
let bus: BusConnection;
let logger: PlatformLogger;

/** Ids seeded by this run, scoped so a parallel run cannot collide with it. */
const suffix = ulid().toLowerCase().slice(0, 10);
const enabled = `int-on-${suffix}`;
const disabled = `int-off-${suffix}`;
const printer = `int-mqtt-${suffix}`;

/** The key `api` would have sealed the printer's access code with. */
const SECRETS_KEY = 'ab'.repeat(32);

/** The serial of the printer the instance was added for, unique to this run. */
const SERIAL = `01P00A${String(Date.now()).slice(-9)}`;

/**
 * Waits until an instance's row says the state, or gives up.
 *
 * @param id - Which instance.
 * @param state - The state to wait for.
 * @param timeoutMs - How long to wait at most.
 * @returns The row's state and last error once it has changed, or as it stands at the timeout.
 */
async function until(
  id: string,
  state: string,
  timeoutMs: number,
): Promise<{ state: string; lastError: string | null }> {
  const deadline = Date.now() + timeoutMs;
  let status = await statusOf(id);

  while (status.state !== state && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));

    status = await statusOf(id);
  }

  return status;
}

/**
 * A logger that keeps its output out of the test report.
 *
 * @returns The logger.
 */
function silent(): PlatformLogger {
  return createLogger(
    { service: 'hub-integration', version: '0.0.0', level: 'fatal' },
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
 * Reads one instance row back.
 *
 * @param id - Which instance.
 * @returns Its state and last error.
 */
async function statusOf(id: string): Promise<{ state: string; lastError: string | null }> {
  const [row] = await database.db
    .select({
      state: schema.registry.integrations.state,
      lastError: schema.registry.integrations.lastError,
    })
    .from(schema.registry.integrations)
    .where(eq(schema.registry.integrations.id, id));

  return row ?? { state: 'missing', lastError: null };
}

beforeAll(async () => {
  logger = silent();
  database = createDatabase({ connectionString: DATABASE_URL, applicationName: 'hub-test' });
  bus = await connectBus({
    url: NATS_URL,
    name: 'hub-integration',
    logger,
    signal: AbortSignal.timeout(20_000),
  });

  await database.db.insert(schema.registry.integrations).values([
    {
      id: enabled,
      kind: 'nothing/installed',
      kindVersion: '1.0.0',
      transport: 'http',
      transportConfig: { host: '192.168.1.40' },
      options: {},
      isEnabled: true,
    },
    {
      id: disabled,
      kind: 'nothing/installed',
      kindVersion: '1.0.0',
      transport: 'http',
      transportConfig: {},
      options: {},
      isEnabled: false,
    },
    {
      // A printer on the development broker, its access code sealed the way `api` stores it.
      id: printer,
      kind: 'bambu-lab/printer',
      kindVersion: '1.0.0',
      transport: 'mqtt',
      transportConfig: sealSecrets(
        {
          url: 'mqtt://localhost:1883',
          username: 'bblp',
          password: '12345678',
          shouldVerifyCertificate: false,
        },
        ['password'],
        secretsKeyFrom(SECRETS_KEY),
      ),
      options: {},
      isEnabled: false,
    },
  ]);
});

afterAll(async () => {
  await database.db
    .delete(schema.registry.devices)
    .where(eq(schema.registry.devices.integrationId, printer));

  for (const id of [enabled, disabled, printer]) {
    await database.db
      .delete(schema.registry.integrations)
      .where(eq(schema.registry.integrations.id, id));
  }

  await bus.close();
  await database.close();
});

describe('reading what an owner configured', () => {
  it('reads an instance back as it was written, jsonb and all', async () => {
    const instances = await loadInstances(database.db);
    const found = instances.find((instance) => instance.id === enabled);

    expect(found).toMatchObject({
      kind: 'nothing/installed',
      transport: 'http',
      transportConfig: { host: '192.168.1.40' },
      isEnabled: true,
    });
  });

  it('reads a disabled instance too, so its status can still be reported', async () => {
    // Filtering these out in SQL would leave whatever they last said standing in the interface
    // forever, which is how a disabled integration comes to look like a running one.
    const instances = await loadInstances(database.db);

    expect(instances.some((instance) => instance.id === disabled)).toBe(true);
  });
});

describe('recording what became of an instance', () => {
  it('writes the reason alongside a failure', async () => {
    await recordStatus(database.db, enabled, 'failed', 'the broker refused the connection');

    expect(await statusOf(enabled)).toEqual({
      state: 'failed',
      lastError: 'the broker refused the connection',
    });
  });

  it('clears the reason when the instance recovers', async () => {
    // A message from an hour ago sitting next to a running instance reads as describing what is
    // happening now, which is the wrong thing to tell somebody debugging at eleven at night.
    await recordStatus(database.db, enabled, 'failed', 'the broker refused the connection');
    await recordStatus(database.db, enabled, 'running');

    expect(await statusOf(enabled)).toEqual({ state: 'running', lastError: null });
  });
});

describe('starting with nothing installed', () => {
  it('records why each instance could not start, and starts anyway', async () => {
    // The behaviour that matters most on a fresh installation: no bundles, no transports, two
    // configured instances. The service comes up and says what is wrong with each of them,
    // rather than refusing to start and saying nothing.
    const config = hubEnvSchema.parse({
      DATABASE_URL,
      NATS_URL,
      HUB_DEV_BUNDLE_DIR: path.join(EMPTY_DATA_DIR, 'no-bundles'),
      NEBULA_DATA_DIR: EMPTY_DATA_DIR,
      NEBULA_SECRETS_KEY: SECRETS_KEY,
    });

    const own = await connectBus({
      url: NATS_URL,
      name: 'hub-under-test',
      logger,
      signal: AbortSignal.timeout(20_000),
    });
    const service = new HubService({ config, db: database.db, bus: own, logger });

    await service.start();
    await service.stop();
    await own.close();

    const failed = await statusOf(enabled);

    expect([failed.state, await statusOf(disabled)]).toEqual([
      'failed',
      { state: 'disabled', lastError: null },
    ]);
    expect(failed.lastError).toMatch(/integration|transport/i);
  });
});

/**
 * A hub with the shipped bundles and the MQTT transport, on a bus connection of its own.
 *
 * Its own connection because stopping a hub drains the connection it was given - the service
 * owns it in production - and the tests after it still need the shared one.
 *
 * @returns The service, started, and how to stop it.
 */
async function startHub(): Promise<{ service: HubService; stop: () => Promise<void> }> {
  const own = await connectBus({
    url: NATS_URL,
    name: 'hub-under-test',
    logger,
    signal: AbortSignal.timeout(20_000),
  });
  const config = hubEnvSchema.parse({
    DATABASE_URL,
    NATS_URL,
    HUB_DEV_BUNDLE_DIR: REPOSITORY_BUNDLE_DIR,
    NEBULA_DATA_DIR: EMPTY_DATA_DIR,
    NEBULA_SECRETS_KEY: SECRETS_KEY,
  });
  const service = new HubService({
    config,
    db: database.db,
    bus: own,
    logger,
    transports: [mqttTransport],
  });

  await service.start();

  return {
    service,
    stop: async (): Promise<void> => {
      await service.stop();
      await own.close();
    },
  };
}

describe('matching an instance to its row on request', () => {
  it('starts, restarts and stops one instance as the registry says, without a restart', async () => {
    // The whole loop the interface relies on: a row is written, `hub` is asked to match it, and
    // the answer is where the instance ended up. The printer is a real session on the
    // development broker, opened with the access code `api` sealed.
    const { service, stop } = await startHub();
    const caller = new BusClient({
      transport: bus.transport,
      source: 'api',
      logger,
      requestTimeoutMs: 15_000,
    });

    try {
      expect(await statusOf(printer)).toEqual({ state: 'disabled', lastError: null });

      await database.db
        .update(schema.registry.integrations)
        .set({ isEnabled: true })
        .where(eq(schema.registry.integrations.id, printer));

      const started = await caller.request(
        busSubjects.service(HUB_SERVICE, HUB_RELOAD_METHOD),
        { integrationId: printer },
        reloadReplySchema,
      );

      // No device row yet: the instance is up and listening for the printer, and says so.
      expect(started).toEqual({ state: 'identifying', lastError: null });
      expect(service.running.has(printer)).toBe(true);

      // Reloading a listening instance restarts it: a changed address takes effect, and the
      // search it replaces is ended before the new one starts.
      const restarted = await service.reloadInstance(printer);

      expect(restarted.state).toBe('identifying');
      expect(service.running.has(printer)).toBe(true);

      await database.db
        .update(schema.registry.integrations)
        .set({ isEnabled: false })
        .where(eq(schema.registry.integrations.id, printer));

      const stopped = await service.reloadInstance(printer);

      expect(stopped).toEqual({ state: 'disabled', lastError: null });
      expect(service.running.has(printer)).toBe(false);

      await expect(service.reloadInstance(`int-gone-${suffix}`)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    } finally {
      await stop();
    }
  }, 30_000);

  it('forgets a listening instance on request, and says so only the first time', async () => {
    // What the API asks just before `core` deletes the rows. Unlike a reload nothing is read
    // back and nothing is restarted: the instance goes quiet, the row records it, and asking
    // again - a retried delete - finds nothing to stop and says so without complaint.
    const { service, stop } = await startHub();
    const caller = new BusClient({
      transport: bus.transport,
      source: 'api',
      logger,
      requestTimeoutMs: 15_000,
    });

    try {
      await database.db
        .update(schema.registry.integrations)
        .set({ isEnabled: true })
        .where(eq(schema.registry.integrations.id, printer));
      await service.reloadInstance(printer);
      expect(service.running.has(printer)).toBe(true);

      const forgotten = await caller.request(
        busSubjects.service(HUB_SERVICE, HUB_FORGET_METHOD),
        { integrationId: printer },
        forgetReplySchema,
      );

      expect(forgotten).toEqual({ wasRunning: true });
      expect(service.running.has(printer)).toBe(false);
      expect(await statusOf(printer)).toEqual({ state: 'stopped', lastError: null });

      expect(await service.forgetInstance(printer)).toEqual({ wasRunning: false });
      expect(await service.forgetInstance(`int-gone-${suffix}`)).toEqual({ wasRunning: false });
    } finally {
      await database.db
        .update(schema.registry.integrations)
        .set({ isEnabled: false })
        .where(eq(schema.registry.integrations.id, printer));
      await stop();
    }
  }, 30_000);

  it('listens for the printer, has core complete its row, and runs once it has answered', async () => {
    // The whole first start of a device: the API wrote the two rows, the instance comes up
    // listening, the printer announces itself on the broker, and `hub` asks `core` for the
    // serial and the entities to be written against the row - never writing them itself. A
    // fake `core` answers here; what it is asked is the point.
    await database.db.insert(schema.registry.devices).values({
      integrationId: printer,
      externalId: null,
      name: 'Studio printer',
      icon: 'printer',
      manufacturer: 'Bambu Lab',
      model: 'X1C',
    });

    const asked: RegisterDeviceRequest[] = [];
    const core = new BusClient({ transport: bus.transport, source: 'core', logger });
    const serving = core.serve(
      busSubjects.service(CORE_SERVICE, CORE_REGISTER_METHOD),
      registerDeviceRequestSchema,
      (request) => {
        // Only this test's instance: a development `hub` running beside the suite completes its
        // own devices on the same bus, and its requests reach this fake `core` too.
        if (request.integrationId === printer) {
          asked.push(request);
        }

        return {
          deviceId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
          entityIds: request.entities.map((entity) => entity.entityId),
        };
      },
    );
    const fakePrinter = await connectAsync('mqtt://localhost:1883', { reconnectPeriod: 0 });
    const { service, stop } = await startHub();

    try {
      await database.db
        .update(schema.registry.integrations)
        .set({ isEnabled: true })
        .where(eq(schema.registry.integrations.id, printer));

      expect((await service.reloadInstance(printer)).state).toBe('identifying');

      // The printer speaks, the way a real one does every second or so.
      const report = JSON.stringify({ print: { nozzle_temper: 25, bed_temper: 30 } });
      const speaking = setInterval(() => {
        void fakePrinter.publishAsync(`device/${SERIAL}/report`, report);
      }, 300);

      try {
        expect(await until(printer, 'running', 15_000)).toEqual({
          state: 'running',
          lastError: null,
        });
      } finally {
        clearInterval(speaking);
      }

      expect(service.running.get(printer)?.book.size).toBe(1);
      expect(asked).toHaveLength(1);
      expect(asked[0]).toMatchObject({ integrationId: printer, externalId: SERIAL });
      expect('name' in (asked[0] ?? {})).toBe(false);
      expect(asked[0]?.entities.map((entity) => entity.entityId)).toContain(
        `sensor.${printer.replaceAll('-', '_')}_nozzle_temperature`,
      );
    } finally {
      serving.unsubscribe();
      await fakePrinter.endAsync();
      await database.db
        .update(schema.registry.integrations)
        .set({ isEnabled: false })
        .where(eq(schema.registry.integrations.id, printer));
      await stop();
      await database.db
        .delete(schema.registry.devices)
        .where(eq(schema.registry.devices.integrationId, printer));
    }
  }, 40_000);

  it('binds the device it identified last time when an instance starts, and watches it', async () => {
    // A printer identified on an earlier run: its row carries the serial and the claim that
    // was kept. Starting the instance must bind it again without listening for it a second
    // time - and prove it by doing what the bundle does for a bound printer, which is to ask
    // it for everything on its request topic.
    await database.db.insert(schema.registry.devices).values({
      integrationId: printer,
      externalId: SERIAL,
      name: 'Studio printer',
      manufacturer: 'Bambu Lab',
      config: {
        claim: {
          deviceKey: `device/${SERIAL}/report`,
          externalId: SERIAL,
          descriptor: {
            topic: `device/${SERIAL}/report`,
            segments: ['device', SERIAL, 'report'],
            message: { print: { nozzle_temper: 25 } },
          },
        },
      },
    });

    const listener = await connectAsync('mqtt://localhost:1883', { reconnectPeriod: 0 });
    const asked = new Promise<string>((resolve) => {
      listener.once('message', (topic) => {
        resolve(topic);
      });
    });

    await listener.subscribeAsync(`device/${SERIAL}/request`);

    const { service, stop } = await startHub();

    try {
      await database.db
        .update(schema.registry.integrations)
        .set({ isEnabled: true })
        .where(eq(schema.registry.integrations.id, printer));

      const started = await service.reloadInstance(printer);

      expect(started.state).toBe('running');
      expect(service.running.get(printer)?.book.size).toBe(1);
      expect(await asked).toBe(`device/${SERIAL}/request`);
    } finally {
      await listener.endAsync();
      await database.db
        .update(schema.registry.integrations)
        .set({ isEnabled: false })
        .where(eq(schema.registry.integrations.id, printer));
      await stop();
    }
  }, 30_000);

  it('tries a sealed configuration against the broker and says it connected', async () => {
    const { stop } = await startHub();
    const caller = new BusClient({
      transport: bus.transport,
      source: 'api',
      logger,
      requestTimeoutMs: 15_000,
    });

    try {
      const [row] = await loadInstances(database.db).then((instances) =>
        instances.filter((instance) => instance.id === printer),
      );

      const reply = await caller.request(
        busSubjects.service(HUB_SERVICE, HUB_PROBE_METHOD),
        { kind: 'bambu-lab/printer', transportConfig: row?.transportConfig ?? {}, timeoutMs: 5000 },
        probeReplySchema,
      );

      expect(reply).toEqual({
        isReachable: true,
        detail: 'Connected to mqtt://localhost:1883 as bblp',
      });
    } finally {
      await stop();
    }
  }, 30_000);
});
