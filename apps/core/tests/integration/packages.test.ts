/**
 * `core` taking in a package's devices.
 *
 * A package hands over every device it has, whole, whenever the set changes; this is the half that
 * makes its devices match - written, brought up to date, removed - owned by the package, so its
 * entities route to `svc.<package>.command`; and that reads its entity types from its row, so a
 * `custom` entity is checked against them.
 *
 * Requires the development stack, and no development `core` running against it: two answering
 * the same service share its requests.
 *
 * ```
 * pnpm infra:up
 * pnpm db:migrate
 * ```
 */
import { Writable } from 'node:stream';

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BusClient, connectBus, ulid, type BusConnection } from '@nebula-home/bus';
import {
  busSubjects,
  CORE_SERVICE,
  CORE_SYNC_PACKAGE_METHOD,
  packageDeviceId,
  packageObjectPrefix,
  parseEntityId,
  syncPackageReplySchema,
  type SyncPackageReply,
} from '@nebula-home/contracts';
import { createDatabase, schema, type Database } from '@nebula-home/db';
import { createLogger, type PlatformLogger } from '@nebula-home/logging';

import { EntityDirectory } from '@/domain/entity-directory.js';
import { EntityRegistry } from '@/domain/entity-registry.js';
import { PackageTypes } from '@/domain/package-types.js';
import type { BatchWriter } from '@/persistence/batch-writer.js';
import { createStateCacheWriter, type EntityStateRow } from '@/persistence/history-writer.js';
import { startPackagesService } from '@/services/packages.js';

const DATABASE_URL = 'postgres://nebula:nebula@localhost:5432/nebula';
const NATS_URL = 'nats://localhost:4222';

const suffix = ulid().toLowerCase().slice(0, 8);
const packageId = `test-rec-${suffix}`;
const prefix = packageObjectPrefix(packageId);

let database: { db: Database; close: () => Promise<void> };
let bus: BusConnection;
let caller: BusClient;
let directory: EntityDirectory;
let registry: EntityRegistry;
let packageTypes: PackageTypes;
let stateCache: BatchWriter<EntityStateRow>;
let serving: { unsubscribe: () => void };

/**
 * A logger that writes nowhere.
 *
 * @returns A logger bound to a discarding stream.
 */
function silent(): PlatformLogger {
  return createLogger(
    { service: 'core-packages', version: '0.0.0', level: 'fatal' },
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
 * One camera of the recorder, with its entities.
 *
 * @param externalId - The camera's id at the package.
 * @param model - Its model.
 * @returns The device.
 */
function camera(externalId: string, model: string): Record<string, unknown> {
  return {
    externalId,
    name: `Camera ${externalId}`,
    model,
    entities: [
      {
        entityId: `custom.${prefix}${externalId}_last_recording`,
        name: 'Last recording',
        capabilities: { custom: { packageId, type: 'recording' } },
      },
      {
        entityId: `binary_sensor.${prefix}${externalId}_person`,
        name: 'Person',
        capabilities: { sensor_binary: {} },
      },
    ],
  };
}

/**
 * Hands `core` the package's devices.
 *
 * @param devices - Every device, whole.
 * @returns What `core` did.
 */
async function sync(devices: Record<string, unknown>[]): Promise<SyncPackageReply> {
  return caller.request(
    busSubjects.service(CORE_SERVICE, CORE_SYNC_PACKAGE_METHOD),
    { packageId, devices },
    syncPackageReplySchema,
  );
}

/**
 * The package's device rows.
 *
 * @returns The rows.
 */
async function devices(): Promise<
  { externalId: string | null; name: string; model: string | null }[]
> {
  return database.db
    .select({
      externalId: schema.registry.devices.externalId,
      name: schema.registry.devices.name,
      model: schema.registry.devices.model,
    })
    .from(schema.registry.devices)
    .where(eq(schema.registry.devices.packageId, packageId));
}

beforeAll(async () => {
  const logger = silent();

  database = createDatabase({ connectionString: DATABASE_URL, applicationName: 'core-pkg-test' });
  bus = await connectBus({
    url: NATS_URL,
    name: 'core-packages',
    logger,
    signal: AbortSignal.timeout(20_000),
  });

  // What the packet-manager writes on install: the row the devices and the types hang from.
  await database.db.insert(schema.system.packages).values({
    id: packageId,
    version: '1.0.0',
    runtime: 'node',
    state: 'running',
    source: 'local',
    manifest: {
      id: packageId,
      entityTypes: [
        {
          id: 'recording',
          name: 'Recording',
          icon: 'video',
          state: [{ key: 'size', type: 'number', label: 'Size' }],
        },
      ],
    },
  });

  directory = new EntityDirectory();
  registry = new EntityRegistry();
  packageTypes = new PackageTypes();
  stateCache = createStateCacheWriter({ db: database.db, logger, batchSize: 1000 });
  caller = new BusClient({
    transport: bus.transport,
    source: packageId,
    logger,
    requestTimeoutMs: 5000,
  });
  serving = startPackagesService({
    client: new BusClient({ transport: bus.transport, source: 'core', logger }),
    db: database.db,
    directory,
    registry,
    stateCache,
    packageTypes,
    logger,
  });
});

afterAll(async () => {
  // An empty list removes every device the package had.
  await sync([]);
  await database.db.delete(schema.system.packages).where(eq(schema.system.packages.id, packageId));
  serving.unsubscribe();
  await bus.close();
  await database.close();
});

describe("taking in a package's devices", () => {
  it('writes each device, owned by the package, and reads its entity types', async () => {
    const reply = await sync([camera('door', 'Reolink'), camera('garden', 'Tapo')]);

    expect(reply.refused).toEqual([]);
    expect(reply.devices.map((device) => device.deviceId).sort()).toEqual(
      [packageDeviceId(packageId, 'door'), packageDeviceId(packageId, 'garden')].sort(),
    );
    expect(await devices()).toHaveLength(2);

    const recording = parseEntityId(`custom.${prefix}door_last_recording`);

    expect(directory.get(recording)?.source).toBe(packageId);
    expect(packageTypes.get(packageId, 'recording')?.name).toBe('Recording');
  });

  it("keeps the owner's name, follows the model, and refuses an entity not named after it", async () => {
    await database.db
      .update(schema.registry.devices)
      .set({ name: 'Front door' })
      .where(
        and(
          eq(schema.registry.devices.packageId, packageId),
          eq(schema.registry.devices.externalId, 'door'),
        ),
      );

    const reply = await sync([
      {
        ...camera('door', 'Reolink Duo'),
        entities: [
          ...(camera('door', 'Reolink Duo')['entities'] as unknown[]),
          { entityId: 'switch.somebody_elses', name: 'Stolen', capabilities: { on_off: {} } },
        ],
      },
      camera('garden', 'Tapo'),
    ]);
    const door = (await devices()).find((device) => device.externalId === 'door');

    expect(door).toMatchObject({ name: 'Front door', model: 'Reolink Duo' });
    expect(reply.refused).toEqual([expect.objectContaining({ entityId: 'switch.somebody_elses' })]);
  });

  it('removes a device that is gone, with its entities', async () => {
    const reply = await sync([camera('door', 'Reolink Duo')]);

    expect(reply.kept).toEqual([]);
    expect((await devices()).map((device) => device.externalId)).toEqual(['door']);
    expect(directory.get(parseEntityId(`binary_sensor.${prefix}garden_person`))).toBeUndefined();
  });
});
