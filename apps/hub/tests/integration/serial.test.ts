/**
 * The Serial broker's tables against a real database: what the store writes is what migration
 * 0003 made, a port keeps its id and holder across a restart, and the devices on a port are read
 * from their instances' config.
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

import { serialLineSchema } from '@nebulahome/contracts';
import { createDatabase, schema } from '@nebulahome/db';
import { createLogger } from '@nebulahome/logging';

import {
  databaseSerialStore,
  loadSerialInstances,
  type SerialStore,
} from '@/persistence/serial.js';
import { SerialBroker } from '@/serial/broker.js';
import { createFakeSerialHost } from '@/testing/serial-host.js';

const DATABASE_URL = 'postgres://nebula:nebula@localhost:5432/nebula';

/** The instance the tests add, as a device on a serial port. */
const INSTANCE_ID = 'serial-test-ups';

/** 2400 8N1, as a UPS speaks. */
const LINE = serialLineSchema.parse({ baudRate: 2400 });

/** A UPS cable, as the machine shows it. */
const UPS = {
  devicePath: '/dev/ttyUSB0',
  stablePath: '/dev/serial/by-id/usb-INNO_TECH_USB_to_Serial-if00-port0',
  kind: 'usb' as const,
  usb: {
    vendorId: '0665',
    productId: '5161',
    serialNumber: null,
    manufacturer: 'INNO TECH',
    product: 'USB to Serial',
  },
};

let database: ReturnType<typeof createDatabase>;
let store: SerialStore;

/** Empties the broker's tables and the test's instance, the settings row back to its defaults. */
async function clear(): Promise<void> {
  await database.db.delete(schema.registry.serialPorts);
  await database.db
    .delete(schema.registry.integrations)
    .where(eq(schema.registry.integrations.id, INSTANCE_ID));
  await store.saveSettings({ showBuiltin: false });
}

beforeAll(async () => {
  database = createDatabase({ connectionString: DATABASE_URL, applicationName: 'hub-test' });
  store = databaseSerialStore(database.db);
  await clear();
});

afterAll(async () => {
  await clear();
  await database.close();
});

describe('the Serial store', () => {
  it('keeps the settings on the one row', async () => {
    await store.saveSettings({ showBuiltin: true });

    expect(await store.settings()).toEqual({ showBuiltin: true });
  });

  it('keeps ports by their path, a broker holding one, and forgets them', async () => {
    const usb = await store.savePort({
      stablePath: UPS.stablePath,
      kind: 'usb',
      name: 'INNO TECH USB to Serial',
      usb: UPS.usb,
      network: null,
      holderIntegrationId: null,
      holderBroker: 'thread',
      line: LINE,
      isIgnored: false,
      lastSeenAt: new Date('2026-10-27T20:00:00Z'),
    });
    const network = await store.savePort({
      stablePath: 'tcp://192.168.1.50:6638',
      kind: 'network',
      name: 'Meter bridge',
      usb: null,
      network: { host: '192.168.1.50', port: 6638, protocol: 'rfc2217' },
      holderIntegrationId: null,
      holderBroker: null,
      line: null,
      isIgnored: true,
      lastSeenAt: null,
    });

    expect(
      (await store.ports()).toSorted((left, right) => left.name.localeCompare(right.name)),
    ).toEqual([usb, network]);
    expect(usb).toMatchObject({ holderBroker: 'thread', line: LINE, usb: UPS.usb });

    // One port per path: the database refuses a second.
    await expect(store.savePort({ ...network, id: undefined })).rejects.toThrow();
    expect(await store.removePort(network.id)).toBe(true);
    expect(await store.removePort(network.id)).toBe(false);
  });

  it('reads the devices on a port from their config, and frees a port whose device goes', async () => {
    await database.db.delete(schema.registry.serialPorts);

    const port = await store.savePort({
      stablePath: UPS.stablePath,
      kind: 'usb',
      name: 'INNO TECH USB to Serial',
      usb: UPS.usb,
      network: null,
      holderIntegrationId: null,
      holderBroker: null,
      line: null,
      isIgnored: false,
      lastSeenAt: null,
    });

    await database.db.insert(schema.registry.integrations).values({
      id: INSTANCE_ID,
      kind: 'acme-ups/ups',
      kindVersion: '1.0.0',
      transport: 'acme-ups/line',
      transportConfig: { serial: { portId: port.id, line: LINE } },
    });
    await store.savePort({ ...port, holderIntegrationId: INSTANCE_ID, line: LINE });

    expect(await loadSerialInstances(database.db)).toContainEqual({
      id: INSTANCE_ID,
      kind: 'acme-ups/ups',
      name: 'acme-ups/ups',
      areaId: null,
      state: 'stopped',
      config: { portId: port.id, line: LINE },
    });

    await database.db
      .delete(schema.registry.integrations)
      .where(eq(schema.registry.integrations.id, INSTANCE_ID));

    expect((await store.ports())[0]?.holderIntegrationId).toBeNull();
  });
});

describe('the Serial broker over the store', () => {
  it('keeps a port’s id and holder across a restart', async () => {
    await clear();

    const host = createFakeSerialHost([UPS]);
    const options = {
      store,
      host,
      logger: createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' }),
      vendors: () => [],
      instances: async () => loadSerialInstances(database.db),
      containerPorts: async () => Promise.resolve([]),
      rescanMs: 0,
    };
    const first = new SerialBroker(options);

    await first.start();

    const [seen] = await first.ports();

    expect(seen).toMatchObject({ path: UPS.stablePath, isConnected: true });
    await first.claimForBroker('thread', seen?.id ?? '', LINE);
    await first.stop();

    const second = new SerialBroker(options);

    await second.start();
    expect(await second.ports()).toMatchObject([
      { id: seen?.id, holder: { kind: 'broker', broker: 'thread' }, line: LINE },
    ]);
    await second.stop();
  });
});
