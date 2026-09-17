/**
 * `core` registering what `hub` adopted.
 *
 * The other half of adoption. `hub` finds a device and asks; this is the half that writes the
 * rows and updates the directory `core` routes commands against, in the same step - which is the
 * whole reason `hub` asks instead of writing them itself.
 *
 * Requires the development stack:
 *
 * ```
 * docker compose -f infra/docker-compose.dev.yml up -d
 * pnpm db:migrate
 * ```
 */
import { Writable } from 'node:stream';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BusClient, connectBus, ulid, type BusConnection } from '@nebula-home/bus';
import {
  busSubjects,
  CORE_REGISTER_METHOD,
  CORE_SERVICE,
  deviceEventSchema,
  parseEntityId,
  registerDeviceReplySchema,
  type DeviceEventPayload,
} from '@nebula-home/contracts';
import { createDatabase, schema, type Database } from '@nebula-home/db';
import { createLogger, type PlatformLogger } from '@nebula-home/logging';

import { EntityDirectory } from '@/domain/entity-directory.js';
import { startRegistrationService } from '@/services/registration.js';

const DATABASE_URL = 'postgres://nebula:nebula@localhost:5432/nebula';
const NATS_URL = 'nats://localhost:4222';

const suffix = ulid().toLowerCase().slice(0, 10);
const instanceId = `reg-${suffix}`;
const relay = parseEntityId(`switch.reg_${suffix}`);

let database: { db: Database; close: () => Promise<void> };
let bus: BusConnection;
let caller: BusClient;
let directory: EntityDirectory;
let serving: { unsubscribe: () => void };

/**
 * A logger that writes nowhere.
 *
 * @returns A logger bound to a discarding stream.
 */
function silent(): PlatformLogger {
  return createLogger(
    { service: 'core-registration', version: '0.0.0', level: 'fatal' },
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
 * One registration request, as `hub` would send it once it has heard from the device.
 *
 * @param fields - What to add or change: the model the hardware reports, a serial.
 * @returns The request.
 */
function request(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    integrationId: instanceId,
    externalId: 'relay-one',
    manufacturer: 'Generic',
    config: { claim: { deviceKey: '192.168.1.40', externalId: 'relay-one', descriptor: {} } },
    entities: [
      {
        entityId: relay,
        name: 'Relay',
        capabilities: { on_off: {}, level: { hasTransition: true } },
      },
    ],
    ...fields,
  };
}

/**
 * Asks `core` to complete a device.
 *
 * @param fields - What to add or change in the request.
 * @returns What `core` wrote.
 */
async function register(
  fields: Record<string, unknown> = {},
): Promise<{ deviceId: string; entityIds: string[] }> {
  return caller.request(
    busSubjects.service(CORE_SERVICE, CORE_REGISTER_METHOD),
    request(fields),
    registerDeviceReplySchema,
  );
}

beforeAll(async () => {
  const logger = silent();
  database = createDatabase({ connectionString: DATABASE_URL, applicationName: 'core-reg-test' });
  bus = await connectBus({
    url: NATS_URL,
    name: 'core-registration',
    logger,
    signal: AbortSignal.timeout(20_000),
  });

  await database.db.insert(schema.registry.integrations).values({
    id: instanceId,
    kind: 'generic-rest-relay',
    kindVersion: '1.0.0',
    transport: 'http',
    transportConfig: {},
    options: {},
    isEnabled: true,
  });

  // The identity half, as `api` writes it when the owner adds the device: named, with the model
  // the owner picked, and nothing heard from the hardware yet.
  await database.db.insert(schema.registry.devices).values({
    integrationId: instanceId,
    externalId: null,
    name: 'Lab relay',
    icon: 'relay',
    manufacturer: 'Generic',
    model: 'R1',
  });

  directory = new EntityDirectory();
  caller = new BusClient({
    transport: bus.transport,
    source: 'hub',
    logger,
    requestTimeoutMs: 5000,
  });

  serving = startRegistrationService({
    client: new BusClient({ transport: bus.transport, source: 'core', logger }),
    db: database.db,
    directory,
    logger,
  });
});

afterAll(async () => {
  serving.unsubscribe();

  await database.db
    .delete(schema.registry.entities)
    .where(eq(schema.registry.entities.entityId, relay));
  await database.db
    .delete(schema.registry.devices)
    .where(eq(schema.registry.devices.integrationId, instanceId));
  await database.db
    .delete(schema.registry.integrations)
    .where(eq(schema.registry.integrations.id, instanceId));

  await bus.close();
  await database.close();
});

describe('completing a device the API created', () => {
  it('writes the serial and the entities against the row, and answers with what it wrote', async () => {
    const reply = await register();

    expect(reply.entityIds).toEqual([relay]);
    expect(reply.deviceId).toMatch(/^[0-9a-f-]{36}$/);

    const [row] = await database.db
      .select({
        externalId: schema.registry.devices.externalId,
        name: schema.registry.devices.name,
        icon: schema.registry.devices.icon,
      })
      .from(schema.registry.devices)
      .where(eq(schema.registry.devices.integrationId, instanceId));

    expect(row).toEqual({ externalId: 'relay-one', name: 'Lab relay', icon: 'relay' });
  });

  it('keeps the model the owner picked when the hardware does not report one', async () => {
    // Bambu printers say nothing about their model over the broker. `X1C` is what the owner
    // picked, and it must not become null because the descriptor had no better idea.
    const [row] = await database.db
      .select({ model: schema.registry.devices.model })
      .from(schema.registry.devices)
      .where(eq(schema.registry.devices.integrationId, instanceId));

    expect(row?.model).toBe('R1');
  });

  it('takes the model the hardware reports, when it does', async () => {
    await register({ model: 'R1-PRO' });

    const [row] = await database.db
      .select({ model: schema.registry.devices.model })
      .from(schema.registry.devices)
      .where(eq(schema.registry.devices.integrationId, instanceId));

    expect(row?.model).toBe('R1-PRO');
  });

  it('makes the entity routable straight away, without a restart', () => {
    // The reason `hub` asks instead of writing the rows itself. `core` loads its directory once
    // at startup, so a row written behind its back would be invisible until the next one - and a
    // command for a device adopted a minute ago would come back as "not registered".
    const record = directory.get(relay);

    expect([record?.source, record?.isEnabled]).toEqual([instanceId, true]);
  });

  it('records what the entity can do, with the device limits it reported', () => {
    expect(directory.get(relay)?.capabilities.get('level')).toEqual({ hasTransition: true });
  });

  it('owns the device by its integration, not by a package', async () => {
    const [row] = await database.db
      .select({
        packageId: schema.registry.devices.packageId,
        integrationId: schema.registry.devices.integrationId,
      })
      .from(schema.registry.devices)
      .where(eq(schema.registry.devices.integrationId, instanceId));

    expect(row).toEqual({ packageId: null, integrationId: instanceId });
  });

  it('keeps what the owner sent to find the device again, as it was sent', async () => {
    // The hub's claim. Opaque here: what matters is that it comes back byte for byte, because
    // the hub binds the device again from it on its next start.
    const [row] = await database.db
      .select({ config: schema.registry.devices.config })
      .from(schema.registry.devices)
      .where(eq(schema.registry.devices.integrationId, instanceId));

    expect(row?.config).toEqual({
      claim: { deviceKey: '192.168.1.40', externalId: 'relay-one', descriptor: {} },
    });
  });

  it('updates rather than duplicating when the same device is completed again', async () => {
    // Identifying again has to be safe: a restart that could not bind from the row hears the
    // device a second time, and a second row would be a second copy of the same relay.
    const again = await register({ swVersion: '2.0' });

    const rows = await database.db
      .select({
        id: schema.registry.devices.id,
        name: schema.registry.devices.name,
        swVersion: schema.registry.devices.swVersion,
      })
      .from(schema.registry.devices)
      .where(eq(schema.registry.devices.integrationId, instanceId));

    expect(rows).toEqual([{ id: again.deviceId, name: 'Lab relay', swVersion: '2.0' }]);
  });

  it('refuses to complete a device the API never created', async () => {
    // Nothing `hub` can do makes the row appear, so the refusal is a not-found it can stop on,
    // rather than an insert that would make `hub` a second writer of the registry.
    await expect(register({ integrationId: `${instanceId}-nobody` })).rejects.toThrow(
      /no device/iu,
    );
  });

  it('tells everyone else a device arrived', async () => {
    // What `api` forwards to a browser so a list updates without being asked again.
    const seen: DeviceEventPayload[] = [];
    const watching = caller.subscribe(
      busSubjects.deviceEvent('added'),
      deviceEventSchema,
      (payload): void => {
        seen.push(payload);
      },
    );

    await register();

    for (let attempt = 0; attempt < 50 && seen.length === 0; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    watching.unsubscribe();

    // Named by the public id and the owner's name: what a browser lists the device under.
    expect(seen[0]).toMatchObject({
      deviceId: instanceId,
      source: instanceId,
      name: 'Lab relay',
      entityIds: [relay],
    });
  });
});
