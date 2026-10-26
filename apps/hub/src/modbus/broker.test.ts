import { afterEach, describe, expect, it } from 'vitest';

import { modbusTemplateSchema, type ModbusTemplate } from '@nebulahome/contracts';
import { createLogger } from '@nebulahome/logging';
import {
  resolveDiscovery,
  vendorDiscoverySchema,
  type LoadedBundle,
  type LoadedVendor,
} from '@nebulahome/package-runtime';

import { NOTHING_TAKEN } from '../domain/taken.js';
import { memoryModbusStore } from '../persistence/modbus.js';
import { startModbusServer, type FakeModbusServer } from '../testing/modbus-server.js';

import { ModbusBroker, modbusDeviceKeyOf } from './broker.js';
import { ModbusPool } from './client.js';

/** A relay board's template: a coil read and written, a setpoint with limits. */
const RELAY: ModbusTemplate = modbusTemplateSchema.parse({
  name: 'Relay board',
  entities: [
    {
      name: 'Relay 1',
      domain: 'switch',
      capabilities: { on_off: { read: { function: 1, address: 0 }, write: { function: 5 } } },
    },
    {
      name: 'Setpoint',
      domain: 'number',
      capabilities: {
        number: { read: { function: 3, address: 10 }, write: { function: 6, min: 0, max: 50 } },
      },
    },
  ],
});

/**
 * An integration that knows its meters by the word 0x4D31 at holding 0x10, and ships their
 * template.
 *
 * @returns The vendor, as the loader hands it over.
 */
function meterVendor(): LoadedVendor {
  const driver = {
    manifest: { id: 'acme/meter' },
    driverId: 'meter',
    modbusTemplate: RELAY,
  } as unknown as LoadedBundle;

  return {
    manifest: { id: 'acme', name: 'Acme' },
    drivers: [driver],
    discovery: {
      plan: resolveDiscovery(
        'acme',
        vendorDiscoverySchema.parse({
          modbus: {
            read: { code: { function: 3, address: '0x10' } },
            match: [{ path: 'values.code', equals: 0x4d31 }],
          },
        }),
        [{ id: 'meter', name: 'Meter', transport: 'modbus', models: ['M1'] }],
      ),
      sources: [],
    },
  } as unknown as LoadedVendor;
}

let server: FakeModbusServer | undefined;
let pool: ModbusPool | undefined;

afterEach(async () => {
  pool?.closeAll();
  await server?.close();
  server = undefined;
});

/**
 * A broker over a fake server, its store in memory, searching the fake server's port.
 *
 * @param vendors - The vendors loaded.
 * @returns The broker, started.
 */
async function broker(vendors: LoadedVendor[] = []): Promise<ModbusBroker> {
  server = await startModbusServer();
  pool = new ModbusPool({ gapMs: 0 });

  const started = new ModbusBroker({
    store: memoryModbusStore(),
    pool,
    logger: createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' }),
    vendors: () => vendors,
    takenHosts: () => Promise.resolve(new Set()),
    isSearchTimed: false,
    searchPort: server.port,
  });

  await started.start();

  return started;
}

describe('the devices', () => {
  it('hands a device over with its template resolved, and says it was saved', async () => {
    const modbus = await broker();
    const saved: string[][] = [];

    modbus.onSaved((keys) => saved.push([...keys]));

    const template = await modbus.saveTemplate(undefined, RELAY);
    const device = await modbus.saveDevice({
      name: 'Garage relays',
      host: '127.0.0.1',
      port: server!.port,
      unitId: 1,
      framing: 'tcp',
      template: template.id,
      pollSeconds: null,
    });
    const [sighting] = modbus.devices();

    expect(sighting?.deviceKey).toBe(modbusDeviceKeyOf(device.id));
    expect(sighting?.device).toMatchObject({ kind: 'modbus/generic', pollSeconds: 10 });
    expect(sighting?.device.template.entities.map((entity) => entity.id)).toEqual([
      'relay_1',
      'setpoint',
    ]);
    expect(saved).toEqual([[modbusDeviceKeyOf(device.id)]]);
    expect(modbus.deviceViews(NOTHING_TAKEN)[0]).toMatchObject({
      state: 'waiting',
      templateName: 'Relay board',
    });

    modbus.notePoll(sighting!.deviceKey, null);
    expect(modbus.status().devices).toEqual({ total: 1, online: 1 });
  });

  it('refuses a template a device uses, and a device of no template', async () => {
    const modbus = await broker();
    const template = await modbus.saveTemplate(undefined, RELAY);

    await modbus.saveDevice({
      name: 'Garage relays',
      host: '127.0.0.1',
      port: 502,
      unitId: 1,
      framing: 'tcp',
      template: template.id,
      pollSeconds: null,
    });

    await expect(modbus.removeTemplate(template.id)).rejects.toThrow(/used by 1 devices/u);
    await expect(
      modbus.saveDevice({
        name: 'Other',
        host: '127.0.0.1',
        port: 502,
        unitId: 2,
        framing: 'tcp',
        template: 'acme/meter',
        pollSeconds: null,
      }),
    ).rejects.toThrow(/no template acme\/meter/u);
  });

  it('lists an integration’s templates read-only, and reads a device through one', async () => {
    const modbus = await broker([meterVendor()]);

    expect(modbus.templates()).toMatchObject([
      { id: 'acme/meter', vendorName: 'Acme', isReadOnly: true },
    ]);

    await modbus.saveDevice({
      name: 'Meter',
      host: '127.0.0.1',
      port: 502,
      unitId: 1,
      framing: 'tcp',
      template: 'acme/meter',
      pollSeconds: 5,
    });

    expect(modbus.devices()[0]?.device).toMatchObject({ kind: 'acme/meter', pollSeconds: 5 });
  });
});

describe('the network search', () => {
  it('finds a server, names it by an integration’s rules, and asks again when they change', async () => {
    const vendors: LoadedVendor[] = [];
    const modbus = await broker(vendors);

    server!.holding.set(0x10, 0x4d31);
    await modbus.saveSettings({
      isSearchEnabled: true,
      ranges: ['127.0.0.1'],
      intervalMinutes: 120,
    });
    await modbus.searched();

    expect(modbus.found().items).toMatchObject([{ host: '127.0.0.1', claims: [] }]);
    expect(modbus.status().search.lastRun).toMatchObject({ addresses: 1, answered: 1 });

    vendors.push(meterVendor());
    await modbus.reidentify();

    expect(modbus.found().items[0]?.claims).toEqual([
      { vendorId: 'acme', vendorName: 'Acme', kind: 'acme/meter', model: 'M1', unitId: 1 },
    ]);
  });

  it('never offers a server the owner ignores', async () => {
    const modbus = await broker();

    await modbus.saveSettings({
      isSearchEnabled: true,
      ranges: ['127.0.0.1'],
      intervalMinutes: 120,
    });
    await modbus.searched();
    await modbus.ignore('127.0.0.1', server!.port, true);

    expect(modbus.found().items).toEqual([]);
    expect(modbus.found().ignored).toMatchObject([{ host: '127.0.0.1', port: server!.port }]);
  });
});

describe('the editor’s tests', () => {
  it('reads one capability, and says the exception a refused one gets', async () => {
    const modbus = await broker();
    const target = { host: '127.0.0.1', port: server!.port, framing: 'tcp' as const, unitId: 1 };

    server!.coils.set(0, 1);
    server!.refuse = (request) => (request.address === 0x8000 ? 2 : undefined);

    expect(await modbus.testRead(target, { function: 1, address: 0 }, 'high')).toMatchObject({
      request: '01 00 00 00 01',
      response: '01 01 01',
      value: true,
      error: null,
    });
    expect(await modbus.testRead(target, { function: 3, address: '0x8000' }, 'high')).toMatchObject(
      {
        response: '83 02',
        error: expect.stringMatching(/illegal data address/u) as unknown,
      },
    );
  });

  it('sends a command, and refuses one outside min and max before it is sent', async () => {
    const modbus = await broker();
    const target = { host: '127.0.0.1', port: server!.port, framing: 'tcp' as const, unitId: 1 };
    const [relay, setpoint] = RELAY.entities;

    expect(
      await modbus.testWrite(target, relay!, 'on_off', { command: 'turn_on' }, 'high'),
    ).toMatchObject({
      request: '05 00 00 FF 00',
      error: null,
    });
    expect(server!.coils.get(0)).toBe(1);
    expect(
      await modbus.testWrite(
        target,
        setpoint!,
        'number',
        { command: 'set_value', value: 51 },
        'high',
      ),
    ).toMatchObject({ request: '', error: '51 is outside 0 to 50' });
    expect(server!.requests.filter((request) => request.code === 6)).toEqual([]);
  });

  it('reads every entity of a template once', async () => {
    const modbus = await broker();
    const target = { host: '127.0.0.1', port: server!.port, framing: 'tcp' as const, unitId: 1 };

    server!.holding.set(10, 21);

    expect((await modbus.testTemplate(target, RELAY)).values).toEqual([
      { entity: 0, capability: 'on_off', value: false, error: null },
      { entity: 1, capability: 'number', value: 21, error: null },
    ]);
  });
});
