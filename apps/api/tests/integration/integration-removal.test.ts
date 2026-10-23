/**
 * Removing an integration against a real database, with a linked device among its devices.
 *
 * Removing the device the house shows releases every way into it, so a way of the same vendor
 * is gone by the time the removal reaches it. The fake `core` here deletes the rows the way the
 * real one does, which is what lets a second removal of that way show.
 *
 * Needs the development stack: `pnpm infra:up` and
 * `pnpm db:migrate`. Every row is scoped to an id unique to the run and removed afterwards.
 */
import { randomUUID } from 'node:crypto';

import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BusClient } from '@nebulahome/bus';
import { FakeTransport } from '@nebulahome/bus/testing';
import {
  busSubjects,
  catalogueRequestSchema,
  CORE_SERVICE,
  CORE_UNREGISTER_METHOD,
  forgetRequestSchema,
  HUB_CATALOGUE_METHOD,
  HUB_FORGET_METHOD,
  HUB_SERVICE,
  integrationRemoveRequestSchema,
  PACKET_MANAGER_METHODS,
  PACKET_MANAGER_SERVICE,
  unregisterDeviceRequestSchema,
} from '@nebulahome/contracts';
import { createDatabase, schema } from '@nebulahome/db';
import { createLogger } from '@nebulahome/logging';

import type { DevicesContext } from '@/services/devices.js';
import { removeIntegration } from '@/services/integration-install.js';

const DATABASE_URL = 'postgres://nebula:nebula@localhost:5432/nebula';

/** The vendor, unique to the run so two runs never see each other's devices. */
const vendorId = `api-removal-test-${randomUUID().slice(0, 8)}`;

/** The device the house shows. */
const holderId = `${vendorId}-rpc`;

/** The second way into it, of the same vendor. */
const wayId = `${vendorId}-matter`;

/** What the fake hub was asked to forget, in order. */
const forgotten: string[] = [];

let database: ReturnType<typeof createDatabase>;
let context: DevicesContext;

/**
 * Writes one instance and its device.
 *
 * @param id - The instance id.
 * @param linkedTo - The row of the device it is one more way into, if any.
 * @returns The device row's id.
 */
async function insertDevice(id: string, linkedTo: string | null): Promise<string> {
  await database.db.insert(schema.registry.integrations).values({
    id,
    kind: `${vendorId}/plug`,
    kindVersion: '1.0.0',
    transport: 'mqtt',
    transportConfig: {},
    options: {},
    isEnabled: true,
    state: 'running',
  });

  const [device] = await database.db
    .insert(schema.registry.devices)
    .values({ integrationId: id, externalId: id, name: 'Kitchen plug', linkedTo })
    .returning({ id: schema.registry.devices.id });

  if (device === undefined) {
    throw new Error('Could not insert the device');
  }

  return device.id;
}

beforeAll(async () => {
  database = createDatabase({ connectionString: DATABASE_URL, applicationName: 'api-rm-test' });

  const logger = createLogger({ service: 'api', version: '0.0.0', level: 'fatal' });
  const transport = new FakeTransport();
  const peer = (source: string): BusClient =>
    new BusClient({ transport, source, logger, requestTimeoutMs: 500 });
  const hub = peer('hub');
  const core = peer('core');

  hub.serve(busSubjects.service(HUB_SERVICE, HUB_CATALOGUE_METHOD), catalogueRequestSchema, () => ({
    vendors: [],
    failures: [],
  }));
  hub.serve(busSubjects.service(HUB_SERVICE, HUB_FORGET_METHOD), forgetRequestSchema, (request) => {
    forgotten.push(request.integrationId);

    return { wasRunning: true };
  });
  core.serve(
    busSubjects.service(CORE_SERVICE, CORE_UNREGISTER_METHOD),
    unregisterDeviceRequestSchema,
    async (request) => {
      await database.db
        .delete(schema.registry.devices)
        .where(eq(schema.registry.devices.integrationId, request.integrationId));
      await database.db
        .delete(schema.registry.integrations)
        .where(eq(schema.registry.integrations.id, request.integrationId));

      return { deviceId: null, entityIds: [] };
    },
  );
  peer('packet-manager').serve(
    busSubjects.service(PACKET_MANAGER_SERVICE, PACKET_MANAGER_METHODS.integrationRemove),
    integrationRemoveRequestSchema,
    () => ({ isRestartNeeded: false }),
  );

  context = {
    db: database.db,
    bus: peer('api'),
    secretsKey: Buffer.alloc(32, 0x11),
    logger,
    timeoutMs: 1000,
    traceId: 'api-removal-test',
    icons: { has: (): boolean => false },
  };

  // The holder first, so that the way comes after it in the order the vendor's rows are read.
  await insertDevice(wayId, await insertDevice(holderId, null));
});

afterAll(async () => {
  await database.db
    .delete(schema.registry.devices)
    .where(inArray(schema.registry.devices.integrationId, [wayId, holderId]));
  await database.db
    .delete(schema.registry.integrations)
    .where(like(schema.registry.integrations.kind, `${vendorId}/%`));
  await database.close();
});

describe('removing an integration with a linked device', () => {
  it('releases each way once and leaves none of its devices behind', async () => {
    const removed = await removeIntegration(context, vendorId);

    expect(removed).toEqual({ devices: 2, accounts: 0, isRestartNeeded: false });
    expect([...forgotten].sort()).toEqual([wayId, holderId].sort());

    const left = await database.db
      .select({ id: schema.registry.integrations.id })
      .from(schema.registry.integrations)
      .where(like(schema.registry.integrations.kind, `${vendorId}/%`));

    expect(left).toEqual([]);
  });
});
