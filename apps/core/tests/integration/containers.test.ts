/**
 * `core` taking in the host's containers from the supervisor.
 *
 * The supervisor hands over the whole list whenever it changes; this is the half that makes the
 * container devices match it - written, brought up to date, removed - and the directory `core`
 * routes by with them, so a container's image entity can be commanded the moment it exists.
 *
 * Requires the development stack:
 *
 * ```
 * pnpm infra:up
 * pnpm db:migrate
 * ```
 */
import { Writable } from 'node:stream';

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BusClient, connectBus, ulid, type BusConnection } from '@nebulahome/bus';
import {
  busSubjects,
  containerDeviceId,
  containerObjectPrefix,
  CORE_SERVICE,
  CORE_SYNC_CONTAINERS_METHOD,
  parseEntityId,
  syncContainersReplySchema,
  type SyncContainersReply,
} from '@nebulahome/contracts';
import { createDatabase, schema, type Database } from '@nebulahome/db';
import { createLogger, type PlatformLogger } from '@nebulahome/logging';

import { EntityDirectory } from '@/domain/entity-directory.js';
import { EntityRegistry } from '@/domain/entity-registry.js';
import type { BatchWriter } from '@/persistence/batch-writer.js';
import { createStateCacheWriter, type EntityStateRow } from '@/persistence/history-writer.js';
import { startContainersService } from '@/services/containers.js';

const DATABASE_URL = 'postgres://nebula:nebula@localhost:5432/nebula';
const NATS_URL = 'nats://localhost:4222';

const suffix = ulid().toLowerCase().slice(0, 8);
const first = `test-web-${suffix}`;
const second = `test-db-${suffix}`;

let database: { db: Database; close: () => Promise<void> };
let bus: BusConnection;
let caller: BusClient;
let directory: EntityDirectory;
let registry: EntityRegistry;
let stateCache: BatchWriter<EntityStateRow>;
let serving: { unsubscribe: () => void };

/**
 * A logger that writes nowhere.
 *
 * @returns A logger bound to a discarding stream.
 */
function silent(): PlatformLogger {
  return createLogger(
    { service: 'core-containers', version: '0.0.0', level: 'fatal' },
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
 * One container as the supervisor hands it over, with two of its entities.
 *
 * @param name - The container's name.
 * @param version - The version it runs.
 * @returns The container.
 */
function container(name: string, version: string): Record<string, unknown> {
  const prefix = containerObjectPrefix(name);

  return {
    name,
    displayName: `Container ${name}`,
    image: `example/${name}:${version}`,
    swVersion: version,
    entities: [
      {
        entityId: `sensor.${prefix}_cpu_usage`,
        name: 'Processor usage',
        unitOfMeasurement: '%',
        stateClass: 'measurement',
        capabilities: { sensor_numeric: {} },
      },
      {
        entityId: `update.${prefix}_image`,
        name: 'Image',
        capabilities: { update: { canInstall: true, hasProgress: true } },
      },
    ],
  };
}

/**
 * Hands `core` the list of containers.
 *
 * @param containers - Every container, whole.
 * @returns What `core` wrote.
 */
async function sync(containers: Record<string, unknown>[]): Promise<SyncContainersReply> {
  return caller.request(
    busSubjects.service(CORE_SERVICE, CORE_SYNC_CONTAINERS_METHOD),
    { containers },
    syncContainersReplySchema,
  );
}

/**
 * The container device rows of this test, by name.
 *
 * @returns The rows.
 */
async function devices(): Promise<
  { externalId: string | null; name: string; model: string | null }[]
> {
  const rows = await database.db
    .select({
      externalId: schema.registry.devices.externalId,
      name: schema.registry.devices.name,
      model: schema.registry.devices.model,
    })
    .from(schema.registry.devices)
    .where(eq(schema.registry.devices.source, 'container'));

  return rows.filter((row) => row.externalId === first || row.externalId === second);
}

beforeAll(async () => {
  const logger = silent();
  database = createDatabase({ connectionString: DATABASE_URL, applicationName: 'core-ctr-test' });
  bus = await connectBus({
    url: NATS_URL,
    name: 'core-containers',
    logger,
    signal: AbortSignal.timeout(20_000),
  });

  directory = new EntityDirectory();
  registry = new EntityRegistry();
  stateCache = createStateCacheWriter({ db: database.db, logger, batchSize: 1000 });
  caller = new BusClient({
    transport: bus.transport,
    source: 'supervisor',
    logger,
    requestTimeoutMs: 5000,
  });

  serving = startContainersService({
    client: new BusClient({ transport: bus.transport, source: 'core', logger }),
    db: database.db,
    directory,
    registry,
    stateCache,
    logger,
  });
});

afterAll(async () => {
  // Handing over an empty list removes every container device, the test's included.
  await sync([]);
  serving.unsubscribe();
  await bus.close();
  await database.close();
});

describe('taking in the containers', () => {
  it('writes a device for each container, with its entities owned by the supervisor', async () => {
    const reply = await sync([container(first, '1.0.0'), container(second, '16.2')]);

    expect(reply.devices.map((device) => device.deviceId).sort()).toEqual(
      [containerDeviceId(first), containerDeviceId(second)].sort(),
    );
    expect(await devices()).toHaveLength(2);
    expect((await devices()).find((device) => device.externalId === first)?.name).toBe(
      `Container ${first}`,
    );

    const image = parseEntityId(`update.${containerObjectPrefix(first)}_image`);

    expect(directory.get(image)?.source).toBe('supervisor');
    expect(directory.get(image)?.capabilities.has('update')).toBe(true);
  });

  it("keeps the owner's name and follows the image the container now runs", async () => {
    await database.db
      .update(schema.registry.devices)
      .set({ name: 'Web server' })
      .where(
        and(
          eq(schema.registry.devices.source, 'container'),
          eq(schema.registry.devices.externalId, first),
        ),
      );

    await sync([container(first, '1.1.0'), container(second, '16.2')]);

    const row = (await devices()).find((device) => device.externalId === first);

    expect(row?.name).toBe('Web server');
    expect(row?.model).toBe(`example/${first}:1.1.0`);
  });

  it('removes the device of a container that is gone, with its entities', async () => {
    const reply = await sync([container(first, '1.1.0')]);

    expect(reply.kept).toEqual([]);
    expect((await devices()).map((device) => device.externalId)).toEqual([first]);
    expect(directory.get(parseEntityId(`sensor.${containerObjectPrefix(second)}_cpu_usage`))).toBe(
      undefined,
    );
  });
});
