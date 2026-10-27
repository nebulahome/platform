/**
 * The Bluetooth broker's tables against a real database: what the store writes is what migration
 * 0003 made, a proxy goes with its instance, and the house's Bluetooth devices are read from their
 * instances.
 *
 * Requires the development stack, migrated:
 *
 * ```
 * pnpm infra:up
 * pnpm db:migrate
 * ```
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bluetoothSettingsSchema } from '@nebulahome/contracts';
import { createDatabase, schema } from '@nebulahome/db';

import {
  databaseBluetoothStore,
  loadBluetoothInstances,
  type BluetoothStore,
} from '@/persistence/bluetooth.js';

const DATABASE_URL = 'postgres://nebula:nebula@localhost:5432/nebula';

/** The instance the tests add, as a device that is a proxy. */
const INSTANCE_ID = 'bluetooth-test-plug';

/** A BTHome thermometer's address. */
const ADDRESS = 'A4:C1:38:0B:5E:ED';

let database: ReturnType<typeof createDatabase>;
let store: BluetoothStore;

/** Empties the broker's tables and the test's instance, the settings row back to its defaults. */
async function clear(): Promise<void> {
  await database.db.delete(schema.registry.bluetoothIgnored);
  await database.db
    .delete(schema.registry.integrations)
    .where(eq(schema.registry.integrations.id, INSTANCE_ID));
  await store.saveSettings(bluetoothSettingsSchema.parse({}));
}

beforeAll(async () => {
  database = createDatabase({ connectionString: DATABASE_URL, applicationName: 'hub-test' });
  store = databaseBluetoothStore(database.db);
  await clear();
});

afterAll(async () => {
  await clear();
  await database.close();
});

describe('the Bluetooth store', () => {
  it('keeps the settings on the one row', async () => {
    const settings = bluetoothSettingsSchema.parse({
      localEnabled: false,
      adapterId: 'hci1',
      localScanMode: 'passive',
      proxyScanMode: 'active',
      forgetAfterDays: 3,
      showPrivate: true,
    });

    await store.saveSettings(settings);
    expect(await store.settings()).toEqual(settings);
  });

  it('ignores an address once, with its name, and stops', async () => {
    await store.setIgnored(ADDRESS, 'ATC_0B5EED', true);
    await store.setIgnored(ADDRESS, 'Renamed', true);
    expect(await store.ignored()).toMatchObject([{ address: ADDRESS, name: 'ATC_0B5EED' }]);

    await store.setIgnored(ADDRESS, null, false);
    expect(await store.ignored()).toEqual([]);
  });

  it('keeps a proxy by its instance, and lets it go with the instance', async () => {
    await database.db.insert(schema.registry.integrations).values({
      id: INSTANCE_ID,
      kind: 'shelly/plug',
      kindVersion: '1.0.0',
      transport: 'shelly/rpc',
      transportConfig: { host: '192.168.1.20' },
    });

    const installedAt = new Date('2026-10-27T20:00:00Z');

    expect(
      await store.saveProxy({
        integrationId: INSTANCE_ID,
        scanMode: 'passive',
        scriptVersion: '1.0.0',
        installedAt,
      }),
    ).toEqual({
      integrationId: INSTANCE_ID,
      scanMode: 'passive',
      scriptVersion: '1.0.0',
      installedAt,
    });

    await store.saveProxy({
      integrationId: INSTANCE_ID,
      scanMode: 'active',
      scriptVersion: '1.1.0',
      installedAt,
    });
    expect(await store.proxies()).toEqual([
      { integrationId: INSTANCE_ID, scanMode: 'active', scriptVersion: '1.1.0', installedAt },
    ]);
    expect(await loadBluetoothInstances(database.db)).toContainEqual(
      expect.objectContaining({
        id: INSTANCE_ID,
        kind: 'shelly/plug',
        transport: 'shelly/rpc',
        externalId: null,
        name: 'shelly/plug',
        state: 'stopped',
      }),
    );

    await database.db
      .delete(schema.registry.integrations)
      .where(eq(schema.registry.integrations.id, INSTANCE_ID));
    expect(await store.proxies()).toEqual([]);
    expect(await store.removeProxy(INSTANCE_ID)).toBe(false);
  });
});
