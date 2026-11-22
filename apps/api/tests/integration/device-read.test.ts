/**
 * Reading one device against a real database: the same view as finding it in the whole list.
 *
 * `readDevice` used to read every device - every entity id, tag, report and the hub's catalogue -
 * to keep one. It now reads the one, and what its view needs; this holds it to what the list
 * says, for every kind of device: an integration's, one reached two ways (by either way's id),
 * the parts of one piece of hardware, a package's, a virtual one, a container, and the system
 * device and whatever else the development database already has.
 *
 * Needs the development stack: `pnpm infra:up` and `pnpm db:migrate`. Every row this file writes
 * is scoped to an id unique to the run and removed afterwards.
 */
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { isDeepStrictEqual } from 'node:util';

import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { NotFoundError, type DeviceView } from '@nebulahome/contracts';
import { createDatabase, schema, secretsKeyFrom } from '@nebulahome/db';
import { createLogger } from '@nebulahome/logging';

import { listDevices, readDevice, type DevicesContext } from '@/services/devices.js';

const DATABASE_URL = 'postgres://nebula:nebula@localhost:5432/nebula';

/** What every id and key this run writes starts with. */
const run = `read-${randomUUID().slice(0, 8)}`;

/** The same, where only letters, digits and underscores may go. */
const slug = run.replaceAll('-', '_');

let database: ReturnType<typeof createDatabase>;
let context: DevicesContext;

/**
 * An integration's two halves and one entity that reported.
 *
 * @param fields - The instance, and what its identity row says.
 * @param fields.id - The instance id.
 * @param fields.kind - Its driver.
 * @param fields.transport - Its transport.
 * @param fields.externalId - The hardware's id.
 * @param fields.parentExternalId - The hardware it is part of.
 * @returns The identity row's id.
 */
async function addIntegration(fields: {
  id: string;
  kind: string;
  transport: string;
  externalId?: string;
  parentExternalId?: string;
}): Promise<string> {
  const { integrations, devices, entities, entityStates } = schema.registry;

  await database.db.insert(integrations).values({
    id: fields.id,
    kind: fields.kind,
    kindVersion: '1.0.0',
    transport: fields.transport,
    transportConfig: { host: '192.0.2.10' },
    state: 'running',
  });

  const [device] = await database.db
    .insert(devices)
    .values({
      integrationId: fields.id,
      name: `Device ${fields.id}`,
      externalId: fields.externalId ?? null,
      parentExternalId: fields.parentExternalId ?? null,
    })
    .returning({ id: devices.id });
  const [entity] = await database.db
    .insert(entities)
    .values({
      entityId: `sensor.${fields.id.replaceAll('-', '_')}`,
      deviceId: device?.id ?? '',
      integrationId: fields.id,
      source: 'adapter',
      name: 'Reading',
    })
    .returning({ id: entities.id });

  await database.db.insert(entityStates).values({
    entityId: entity?.id ?? '',
    state: { sensor_numeric: { value: 1 } },
    isAvailable: true,
    lastChanged: new Date('2026-11-01T10:00:00.250Z'),
    lastUpdated: new Date('2026-11-01T10:00:00.250Z'),
    source: fields.id,
  });

  return device?.id ?? '';
}

/**
 * A device the platform or a package keeps, with one entity.
 *
 * @param values - Its row.
 * @returns Its row's id.
 */
async function addPlatformDevice(
  values: typeof schema.registry.devices.$inferInsert,
): Promise<string> {
  const { devices, entities } = schema.registry;
  const [device] = await database.db.insert(devices).values(values).returning({ id: devices.id });

  await database.db.insert(entities).values({
    entityId: `sensor.${slug}_${values.source ?? 'x'}`,
    deviceId: device?.id ?? '',
    source: 'system',
    name: 'Reading',
  });

  return device?.id ?? '';
}

beforeAll(async () => {
  database = createDatabase({ connectionString: DATABASE_URL, applicationName: 'api-read-test' });
  context = {
    db: database.db,
    bus: undefined,
    secretsKey: secretsKeyFrom('11'.repeat(32)),
    logger: createLogger(
      { service: 'api-read', version: '0.0.0', level: 'fatal' },
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
    ),
    timeoutMs: 1000,
    traceId: 'api-read-test',
    icons: { has: (): boolean => true },
  };

  const { devices, deviceTags, tags } = schema.registry;
  const [tag] = await database.db
    .insert(tags)
    .values([
      { key: `${slug}_b`, name: 'B', color: 'blue' },
      { key: `${slug}_a`, name: 'A', color: 'red' },
    ])
    .returning({ id: tags.id });

  // Reached on its own, and tagged.
  const plain = await addIntegration({
    id: `${run}-plain`,
    kind: 'bambu-lab/printer',
    transport: 'mqtt',
  });

  // One device reached two ways, read through the second first.
  const first = await addIntegration({ id: `${run}-http`, kind: 'shelly/plug', transport: 'http' });
  const second = await addIntegration({
    id: `${run}-matter`,
    kind: 'matter/plug',
    transport: 'matter',
  });

  await database.db
    .update(devices)
    .set({ preferredTransport: `${run}-matter` })
    .where(eq(devices.id, first));
  await database.db.update(devices).set({ linkedTo: first }).where(eq(devices.id, second));

  // An inverter and the part of it that names it.
  await addIntegration({
    id: `${run}-inv`,
    kind: 'solax/inverter',
    transport: 'modbus',
    externalId: `${run}-sn`,
  });
  await addIntegration({
    id: `${run}-eps`,
    kind: 'solax/eps',
    transport: 'modbus',
    externalId: `${run}-sn:eps`,
    parentExternalId: `${run}-sn`,
  });

  // A package's device, a virtual one and a container, one of them tagged.
  await database.db.insert(schema.system.packages).values({
    id: `${run}-pkg`,
    version: '1.0.0',
    runtime: 'node',
    state: 'running',
    source: 'local',
    manifest: { id: `${run}-pkg`, name: 'Test package' },
  });

  const virtual = await addPlatformDevice({
    source: 'virtual',
    externalId: `${run}-v`,
    name: 'Virtual',
  });

  await addPlatformDevice({
    source: 'container',
    externalId: `${run}-container`,
    name: 'Container',
  });
  await database.db.insert(devices).values({
    source: 'adapter',
    packageId: `${run}-pkg`,
    externalId: 'thing',
    name: 'Package thing',
  });
  await database.db.insert(deviceTags).values([
    { deviceId: plain, tagId: tag?.id ?? '' },
    { deviceId: virtual, tagId: tag?.id ?? '' },
  ]);
});

afterAll(async () => {
  const { devices, entities, integrations, tags } = schema.registry;

  await database.db.delete(entities).where(like(entities.entityId, `sensor.${slug}%`));
  await database.db.delete(devices).where(like(devices.externalId, `${run}%`));
  await database.db.delete(devices).where(eq(devices.packageId, `${run}-pkg`));
  await database.db.delete(integrations).where(like(integrations.id, `${run}-%`));
  await database.db
    .delete(schema.system.packages)
    .where(eq(schema.system.packages.id, `${run}-pkg`));
  await database.db.delete(tags).where(inArray(tags.key, [`${slug}_a`, `${slug}_b`]));
  await database.close();
});

/**
 * What `readDevice` used to answer: the first device in the list that has an id, or a way into it
 * under that id.
 *
 * @param all - The list.
 * @param id - The id.
 * @returns The device, or undefined when none has it.
 */
function listedAs(all: readonly DeviceView[], id: string): DeviceView | undefined {
  return all.find(
    (one) => one.id === id || (one.linked?.ways.some((way) => way.deviceId === id) ?? false),
  );
}

/**
 * Reads one device, and what the list says of it, until nothing changed it while it was read:
 * the other files of this suite run beside this one, and write devices the house shares - the
 * system device, the aliases' - and devices of their own, which they rename and remove.
 *
 * @param id - The device.
 * @returns Both reads; undefined for one that found nothing under the id.
 */
async function readBoth(
  id: string,
): Promise<{ read: DeviceView | undefined; listed: DeviceView | undefined }> {
  for (let attempt = 1; ; attempt += 1) {
    const before = listedAs(await listDevices(context), id);
    const read = await readDevice(context, id).catch((error: unknown) => {
      if (error instanceof NotFoundError) {
        return undefined;
      }

      throw error;
    });
    const after = listedAs(await listDevices(context), id);

    if (isDeepStrictEqual(before, after) || attempt === 3) {
      return { read, listed: before };
    }
  }
}

describe('reading one device', () => {
  it('reads what the list says of it, for every device and every way into one', async () => {
    const all = await listDevices(context);
    const ids = all.flatMap((device) => [
      device.id,
      ...(device.linked?.ways.map((way) => way.deviceId) ?? []),
    ]);

    // Every kind this file wrote is among them.
    expect(all.map((device) => device.origin)).toEqual(
      expect.arrayContaining(['integration', 'package', 'virtual', 'container']),
    );
    expect(ids).toEqual(expect.arrayContaining([`${run}-plain`, `${run}-http`, `${run}-matter`]));

    for (const id of ids) {
      const { read, listed } = await readBoth(id);

      // A linked device is read with the readings it suggests linking, which the list leaves out.
      expect(read === undefined ? read : { ...read, suggestedLinks: [] }, id).toEqual(
        listed === undefined ? listed : { ...listed, suggestedLinks: [] },
      );

      if (listed?.linked === null) {
        expect(read, id).toEqual(listed);
      }
    }
  });

  it('reads the parts of one piece of hardware, and the two ways into one device', async () => {
    expect(await readDevice(context, `${run}-inv`)).toMatchObject({
      parentId: null,
      childIds: [`${run}-eps`],
    });
    expect(await readDevice(context, `${run}-eps`)).toMatchObject({ parentId: `${run}-inv` });
    expect(await readDevice(context, `${run}-matter`)).toMatchObject({
      id: `${run}-http`,
      entityIds: [`sensor.${slug}_http`, `sensor.${slug}_matter`],
      linked: { preferred: `${run}-matter` },
    });
  });

  it('says a device that is not there is not there', async () => {
    await expect(readDevice(context, `${run}-nothing`)).rejects.toBeInstanceOf(NotFoundError);
  });
});
