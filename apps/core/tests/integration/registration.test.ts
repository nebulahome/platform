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
 * One registration request, as `hub` would send it.
 *
 * @param name - What to call the device.
 * @returns The request.
 */
function request(name: string): Record<string, unknown> {
  return {
    integrationId: instanceId,
    externalId: 'relay-one',
    name,
    manufacturer: 'Generic',
    model: 'R1',
    config: { claim: { deviceKey: '192.168.1.40', externalId: 'relay-one', descriptor: {} } },
    entities: [
      {
        entityId: relay,
        name,
        capabilities: { on_off: {}, level: { hasTransition: true } },
      },
    ],
  };
}

/**
 * Asks `core` to register a device.
 *
 * @param name - What to call it.
 * @returns What `core` wrote.
 */
async function register(name: string): Promise<{ deviceId: string; entityIds: string[] }> {
  return caller.request(
    busSubjects.service(CORE_SERVICE, CORE_REGISTER_METHOD),
    request(name),
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

describe('registering an adopted device', () => {
  it('writes the device and its entities, and answers with what it wrote', async () => {
    const reply = await register('Lab relay');

    expect(reply.entityIds).toEqual([relay]);
    expect(reply.deviceId).toMatch(/^[0-9a-f-]{36}$/);
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

  it('updates rather than duplicating when the same device is registered again', async () => {
    // Re-adoption has to be safe: a rescan after a firmware update sends the same device with a
    // new name, and a second row would be a second copy of the same relay in the interface.
    const again = await register('Lab relay renamed');

    const rows = await database.db
      .select({ id: schema.registry.devices.id, name: schema.registry.devices.name })
      .from(schema.registry.devices)
      .where(eq(schema.registry.devices.integrationId, instanceId));

    expect(rows).toEqual([{ id: again.deviceId, name: 'Lab relay renamed' }]);
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

    await register('Lab relay');

    for (let attempt = 0; attempt < 50 && seen.length === 0; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    watching.unsubscribe();

    expect(seen[0]).toMatchObject({ source: instanceId, entityIds: [relay] });
  });
});
