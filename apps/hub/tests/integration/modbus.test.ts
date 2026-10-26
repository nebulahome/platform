/**
 * The Modbus broker's tables against a real database: what the store writes is what migration
 * 0002 made, and what it reads back is what the broker hands discovery.
 *
 * Requires the development stack, migrated:
 *
 * ```
 * pnpm infra:up
 * pnpm db:migrate
 * ```
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { modbusTemplateSchema } from '@nebulahome/contracts';
import { createDatabase, schema } from '@nebulahome/db';
import { createLogger } from '@nebulahome/logging';

import { ModbusBroker } from '@/modbus/broker.js';
import { ModbusPool } from '@/modbus/client.js';
import { databaseModbusStore, type ModbusStore } from '@/persistence/modbus.js';
import { startModbusServer, type FakeModbusServer } from '@/testing/modbus-server.js';

const DATABASE_URL = 'postgres://nebula:nebula@localhost:5432/nebula';

/** A relay board: one coil, read and written. */
const RELAY = modbusTemplateSchema.parse({
  name: 'Relay board',
  entities: [
    {
      name: 'Relay 1',
      domain: 'switch',
      capabilities: { on_off: { read: { function: 1, address: 0 }, write: { function: 5 } } },
    },
  ],
});

let database: ReturnType<typeof createDatabase>;
let store: ModbusStore;
let server: FakeModbusServer;

/** Empties the broker's tables, the settings row back to its defaults. */
async function clear(): Promise<void> {
  await database.db.delete(schema.registry.modbusDevices);
  await database.db.delete(schema.registry.modbusTemplates);
  await database.db.delete(schema.registry.modbusIgnored);
  await store.saveSettings({ isSearchEnabled: false, ranges: [], intervalMinutes: 120 });
}

beforeAll(async () => {
  database = createDatabase({ connectionString: DATABASE_URL, applicationName: 'hub-test' });
  store = databaseModbusStore(database.db);
  server = await startModbusServer();
  await clear();
});

afterAll(async () => {
  await clear();
  await server.close();
  await database.close();
});

describe('the Modbus store', () => {
  it('keeps the settings and the last search on the one row', async () => {
    await store.saveSettings({
      isSearchEnabled: true,
      ranges: ['10.0.0.0/24'],
      intervalMinutes: 30,
    });
    await store.recordSearch({
      at: new Date('2026-10-26T14:02:00Z'),
      durationMs: 6000,
      addresses: 254,
      answered: 2,
    });

    expect(await store.settings()).toEqual({
      settings: { isSearchEnabled: true, ranges: ['10.0.0.0/24'], intervalMinutes: 30 },
      lastRun: {
        at: new Date('2026-10-26T14:02:00Z'),
        durationMs: 6000,
        addresses: 254,
        answered: 2,
      },
    });
  });

  it('keeps templates and devices, one device per address and unit', async () => {
    const template = await store.saveTemplate(undefined, RELAY);
    const device = {
      name: 'Garage relays',
      host: '192.168.1.60',
      port: 502,
      unitId: 1,
      framing: 'tcp' as const,
      template: template.id,
      pollSeconds: null,
    };
    const saved = await store.saveDevice(device);

    expect(await store.devices()).toEqual([saved]);
    await expect(store.saveDevice({ ...device, name: 'Again' })).rejects.toMatchObject({
      name: 'ConflictError',
    });
    expect(await store.saveDevice({ ...device, unitId: 2, template: 'acme/meter' })).toMatchObject({
      template: 'acme/meter',
    });
    // A template a device names stays: the database refuses it too, not only the broker.
    await expect(store.removeTemplate(template.id)).rejects.toThrow();
  });

  it('keeps the servers ignored', async () => {
    await store.setIgnored('192.168.1.30', 502, true);
    await store.setIgnored('192.168.1.30', 502, true);

    expect((await store.ignored()).map(({ host, port }) => [host, port])).toEqual([
      ['192.168.1.30', 502],
    ]);

    await store.setIgnored('192.168.1.30', 502, false);
    expect(await store.ignored()).toEqual([]);
  });
});

describe('the Modbus broker over the store', () => {
  it('reads back what it saved after a restart, and reads the device through it', async () => {
    await clear();

    const options = {
      store,
      pool: new ModbusPool({ gapMs: 0 }),
      logger: createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' }),
      vendors: () => [],
      takenHosts: () => Promise.resolve(new Set<string>()),
      isSearchTimed: false,
    };
    const first = new ModbusBroker(options);

    await first.start();

    const template = await first.saveTemplate(undefined, RELAY);

    await first.saveDevice({
      name: 'Garage relays',
      host: '127.0.0.1',
      port: server.port,
      unitId: 1,
      framing: 'tcp',
      template: template.id,
      pollSeconds: 5,
    });
    first.stop();

    const second = new ModbusBroker(options);

    await second.start();
    server.coils.set(0, 1);

    const [sighting] = second.devices();

    expect(sighting?.device).toMatchObject({
      name: 'Garage relays',
      pollSeconds: 5,
      kind: 'modbus/generic',
    });
    expect(
      (
        await second.testTemplate(
          { host: '127.0.0.1', port: server.port, unitId: 1, framing: 'tcp' },
          RELAY,
        )
      ).values,
    ).toEqual([{ entity: 0, capability: 'on_off', value: true, error: null }]);

    second.stop();
    options.pool.closeAll();
  });
});
