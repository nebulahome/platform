/**
 * The Thread broker's settings row against a real database: what the store writes is what
 * migration 0003 made, the radio's port a foreign key that lets go when the port is forgotten.
 *
 * Requires the development stack, migrated:
 *
 * ```
 * pnpm infra:up
 * pnpm db:migrate
 * ```
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, schema } from '@nebulahome/db';

import { databaseSerialStore } from '@/persistence/serial.js';
import { databaseThreadStore, THREAD_DEFAULTS } from '@/persistence/thread.js';

const DATABASE_URL = 'postgres://nebula:nebula@localhost:5432/nebula';

let database: ReturnType<typeof createDatabase>;

/** Empties the rows the tests write. */
async function clear(): Promise<void> {
  await database.db.delete(schema.registry.threadSettings);
  await database.db.delete(schema.registry.serialPorts);
}

beforeAll(async () => {
  database = createDatabase({ connectionString: DATABASE_URL, applicationName: 'hub-test' });
  await clear();
});

afterAll(async () => {
  await clear();
  await database.close();
});

describe('the Thread store', () => {
  it('reads not set up before anything is saved', async () => {
    await expect(databaseThreadStore(database.db).settings()).resolves.toEqual(THREAD_DEFAULTS);
  });

  it('keeps the mode, the radio and the hand-off to Matter on the one row', async () => {
    const store = databaseThreadStore(database.db);
    const port = await databaseSerialStore(database.db).savePort({
      stablePath: '/dev/serial/by-id/usb-Nabu_Casa_SkyConnect_v1.0-if00-port0',
      kind: 'usb',
      name: 'Nabu Casa SkyConnect v1.0',
      usb: null,
      network: null,
      holderIntegrationId: null,
      holderBroker: 'thread',
      line: null,
      isIgnored: false,
      lastSeenAt: null,
    });

    await store.saveSettings({
      mode: 'local',
      externalUrl: null,
      radioPortId: port.id,
      useForMatter: false,
    });
    await expect(store.settings()).resolves.toEqual({
      mode: 'local',
      externalUrl: null,
      radioPortId: port.id,
      useForMatter: false,
    });

    // The port forgotten, the row keeps its mode and lets go of the port.
    await databaseSerialStore(database.db).removePort(port.id);
    await expect(store.settings()).resolves.toMatchObject({ mode: 'local', radioPortId: null });

    await store.saveSettings({
      mode: 'external',
      externalUrl: 'http://192.168.1.20:8081',
      radioPortId: null,
      useForMatter: true,
    });
    await expect(store.settings()).resolves.toMatchObject({
      mode: 'external',
      externalUrl: 'http://192.168.1.20:8081',
    });
  });
});
