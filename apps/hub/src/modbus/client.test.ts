import { afterEach, describe, expect, it } from 'vitest';

import { startModbusServer, type FakeModbusServer } from '../testing/modbus-server.js';

import { hexOf, ModbusPool, type ModbusAddress } from './client.js';

let server: FakeModbusServer | undefined;
let pool: ModbusPool | undefined;

/**
 * A server and a pool that asks it without pausing.
 *
 * @param framing - How frames travel.
 * @returns The server's address.
 */
async function start(framing: 'tcp' | 'rtu' = 'tcp'): Promise<ModbusAddress> {
  server = await startModbusServer(framing);
  pool = new ModbusPool({ gapMs: 0 });

  return { host: '127.0.0.1', port: server.port, framing };
}

afterEach(async () => {
  pool?.closeAll();
  await server?.close();
  server = undefined;
  pool = undefined;
});

describe.each(['tcp', 'rtu'] as const)('the client over %s', (framing) => {
  it('reads every table and writes every way', async () => {
    const address = await start(framing);
    const fake = server!;
    const modbus = pool!;

    fake.coils.set(2, 1);
    fake.discrete.set(9, 1);
    fake.holding.set(10, 0x1234);
    fake.input.set(0, 7);

    expect(
      (await modbus.read(address, { unitId: 1, function: 1, address: 0, count: 3 })).values,
    ).toEqual([0, 0, 1]);
    expect(
      (await modbus.read(address, { unitId: 1, function: 2, address: 9, count: 1 })).values,
    ).toEqual([1]);
    expect(
      (await modbus.read(address, { unitId: 1, function: 3, address: 10, count: 2 })).values,
    ).toEqual([0x1234, 0]);
    expect(
      (await modbus.read(address, { unitId: 1, function: 4, address: 0, count: 1 })).values,
    ).toEqual([7]);

    await modbus.write(address, { unitId: 1, function: 5, address: 4, values: [0xff00] });
    await modbus.write(address, { unitId: 1, function: 6, address: 20, values: [99] });
    await modbus.write(address, { unitId: 1, function: 15, address: 8, values: [1, 0, 1] });
    await modbus.write(address, { unitId: 1, function: 16, address: 30, values: [1, 2] });

    expect([fake.coils.get(4), fake.coils.get(8), fake.coils.get(9), fake.coils.get(10)]).toEqual([
      1, 1, 0, 1,
    ]);
    expect([fake.holding.get(20), fake.holding.get(30), fake.holding.get(31)]).toEqual([99, 1, 2]);
  });

  it('names the exception a refused request is answered with', async () => {
    const address = await start(framing);

    server!.refuse = (request) => (request.address === 0x8000 ? 2 : undefined);

    await expect(
      pool!.read(address, { unitId: 1, function: 3, address: 0x8000, count: 1 }),
    ).rejects.toMatchObject({ name: 'ModbusException', code: 2 });
  });
});

describe('the client', () => {
  it('keeps one request on the wire and one connection per server', async () => {
    const address = await start();

    const reads = await Promise.all(
      [0, 1, 2, 3].map((register) =>
        pool!.read(address, { unitId: 1, function: 3, address: register, count: 1 }),
      ),
    );

    expect(reads).toHaveLength(4);
    expect(server!.connections).toBe(1);
  });

  it('gives up on a silent unit and opens the socket again for the next request', async () => {
    const address = await start();

    server!.toLose = 1;

    await expect(
      pool!.read(address, { unitId: 1, function: 3, address: 0, count: 1, timeoutMs: 100 }),
    ).rejects.toMatchObject({ name: 'ModbusSilence' });
    await expect(
      pool!.read(address, { unitId: 1, function: 3, address: 0, count: 1 }),
    ).resolves.toBeDefined();
  });

  it('takes an answer with transaction 0 and another unit echoed', async () => {
    const address = await start();

    server!.echo = { transaction: 0, unit: 9 };

    await expect(
      pool!.read(address, { unitId: 1, function: 3, address: 0, count: 1 }),
    ).resolves.toMatchObject({
      values: [0],
    });
  });

  it('says what was sent and got back, as the editor shows it', async () => {
    const address = await start();
    const exchange = await pool!.write(address, {
      unitId: 1,
      function: 5,
      address: 0,
      values: [0xff00],
    });

    expect(hexOf(exchange.request)).toBe('05 00 00 FF 00');
    expect(hexOf(exchange.response)).toBe('05 00 00 FF 00');
  });

  it('holds a server while something does, and counts the traffic', async () => {
    const address = await start();
    const client = pool!.acquire(address);

    expect(pool!.isHeld(address)).toBe(true);
    await pool!.read(address, { unitId: 1, function: 3, address: 0, count: 1 });
    expect(pool!.traffic()).toMatchObject({ gateways: 1, requestsPerMinute: 1 });
    pool!.release(client);
    expect(pool!.isHeld(address)).toBe(false);
    expect(pool!.traffic().gateways).toBe(0);
  });

  it('says no connection when nothing listens', async () => {
    const address = await start();

    await server!.close();

    await expect(
      pool!.read(address, { unitId: 1, function: 3, address: 0, count: 1, timeoutMs: 500 }),
    ).rejects.toMatchObject({ name: 'ModbusNoConnection' });
  });
});
