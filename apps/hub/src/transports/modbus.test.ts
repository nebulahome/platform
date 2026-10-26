import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLogger } from '@nebulahome/logging';
import type { TransportConnection, TransportInbound } from '@nebulahome/package-runtime';

import type { ModbusBroker } from '../modbus/broker.js';
import { ModbusPool } from '../modbus/client.js';
import { startModbusServer, type FakeModbusServer } from '../testing/modbus-server.js';

import { createModbusTransport } from './modbus.js';

let server: FakeModbusServer | undefined;
let connection: TransportConnection | undefined;

afterEach(async () => {
  await connection?.close();
  await server?.close();
  connection = undefined;
});

/**
 * Opens the transport over a fake server, with a broker that only notes polls.
 *
 * @returns What it delivered and noted, and the poll of the one device.
 */
async function open() {
  server = await startModbusServer();

  const delivered: TransportInbound[] = [];
  const noted: (string | null)[] = [];
  const broker = {
    notePoll: (...[, error]: [string, string | null]) => noted.push(error),
    devices: () => [],
  } as unknown as ModbusBroker;
  const transport = createModbusTransport(broker, new ModbusPool({ gapMs: 0 }));

  connection = await transport.connect(
    {},
    {
      logger: createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' }),
      deliver: (message) => delivered.push(message),
      report: () => undefined,
    },
  );

  const poll = {
    op: 'poll',
    args: {
      deviceKey: 'modbus-1',
      host: '127.0.0.1',
      port: server.port,
      unitId: 1,
      framing: 'tcp',
      everyMs: 60_000,
      blocks: [
        { function: 1, start: 0, count: 2 },
        { function: 3, start: 10, count: 1 },
      ],
    },
  };

  return { delivered, noted, poll };
}

describe('the modbus transport', () => {
  it('polls a device for its blocks and delivers the registers', async () => {
    const { delivered, noted, poll } = await open();

    server!.coils.set(1, 1);
    server!.holding.set(10, 42);
    await connection!.apply([poll]);
    await vi.waitFor(() => {
      expect(delivered).toHaveLength(1);
    });

    expect(delivered[0]).toEqual({
      connectionKey: 'modbus',
      deviceKey: 'modbus-1',
      payload: { registers: { '1:0': 0, '1:1': 1, '3:10': 42 } },
    });
    expect(noted).toEqual([null]);
  });

  it('leaves a refused block out, and says a silent device did not answer', async () => {
    const { delivered, poll } = await open();

    server!.refuse = (request) => (request.code === 3 ? 2 : undefined);
    await connection!.apply([poll]);
    await vi.waitFor(() => {
      expect(delivered).toHaveLength(1);
    });
    expect(delivered[0]?.payload).toEqual({ registers: { '1:0': 0, '1:1': 0 } });

    await server!.close();
    await connection!.apply([]);
    await connection!.apply([{ ...poll, args: { ...poll.args, everyMs: 59_000 } }]);
    await vi.waitFor(
      () => {
        expect(delivered).toHaveLength(2);
      },
      { timeout: 8000 },
    );
    expect(delivered[1]?.payload).toMatchObject({ error: expect.any(String) as unknown });
  });

  it('writes a command, then reads the device again', async () => {
    const { delivered, poll } = await open();

    await connection!.apply([poll]);
    await vi.waitFor(() => {
      expect(delivered).toHaveLength(1);
    });
    await connection!.send(
      {
        deviceKey: 'modbus-1',
        op: 'write',
        args: {
          host: '127.0.0.1',
          port: server!.port,
          unitId: 1,
          framing: 'tcp',
          function: 5,
          address: 1,
          values: [0xff00],
        },
      },
      new AbortController().signal,
    );
    await vi.waitFor(() => {
      expect(delivered).toHaveLength(2);
    });

    expect(delivered[1]?.payload).toMatchObject({ registers: { '1:1': 1 } });
  });
});
