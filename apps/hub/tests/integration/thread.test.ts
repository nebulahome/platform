/**
 * The Thread broker's settings row and Matter's networks row against a real database: what the
 * stores write is what migration 0003 made, the radio's port a foreign key that lets go when the
 * port is forgotten, and the Wi-Fi password sealed in its column.
 *
 * Requires the development stack, migrated:
 *
 * ```
 * pnpm infra:up
 * pnpm db:migrate
 * ```
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, isSealed, schema } from '@nebulahome/db';

import { databaseMatterNetworksStore } from '@/persistence/matter.js';
import { databaseSerialStore } from '@/persistence/serial.js';
import { databaseThreadStore, THREAD_DEFAULTS } from '@/persistence/thread.js';

const DATABASE_URL = 'postgres://nebula:nebula@localhost:5432/nebula';

/** A secrets key. */
const KEY = Buffer.alloc(32, 5);

let database: ReturnType<typeof createDatabase>;

/** Empties the rows the tests write. */
async function clear(): Promise<void> {
  await database.db.delete(schema.registry.threadSettings);
  await database.db.delete(schema.registry.matterNetworks);
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

describe("the store of Matter's networks", () => {
  it('seals the Wi-Fi password in its column, opens it, keeps it, and forgets the network', async () => {
    const store = databaseMatterNetworksStore(database.db, KEY);

    await expect(store.wifi()).resolves.toBeNull();
    await store.saveWifi({ ssid: 'Casa', password: 'secret-pass' });

    const [row] = await database.db.select().from(schema.registry.matterNetworks);

    expect(row?.wifiSsid).toBe('Casa');
    expect(isSealed(row?.wifiPasswordSealed)).toBe(true);
    expect(JSON.stringify(row)).not.toContain('secret-pass');
    await expect(store.wifi()).resolves.toEqual({ ssid: 'Casa', password: 'secret-pass' });

    await store.saveWifi({ ssid: 'Casa' });
    await expect(store.wifi()).resolves.toEqual({ ssid: 'Casa', password: 'secret-pass' });

    await store.saveWifi(null);
    await expect(store.wifi()).resolves.toBeNull();
  });
});
