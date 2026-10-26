/**
 * A Modbus server for tests: the four tables of one unit, answering over MBAP or RTU frames, with
 * the quirks real gateways have - a transaction id of 0, another unit echoed, silence, a request
 * lost, a table refused.
 */
import { createServer, type Server, type Socket } from 'node:net';

import { crc16 } from '../modbus/client.js';

/** One request as the server read it. */
export type ModbusServerRequest = {
  readonly unit: number;
  readonly code: number;
  readonly address: number;

  /** The count of a read or a multiple write; the value of a single write. */
  readonly quantity: number;
};

/** What a test server holds and how it behaves; tests change these as they go. */
export type FakeModbusServer = {
  port: number;
  readonly framing: 'tcp' | 'rtu';

  /** The unit that answers; requests to another go unanswered. */
  unit: number;
  coils: Map<number, number>;
  discrete: Map<number, number>;
  holding: Map<number, number>;
  input: Map<number, number>;

  /** Every request, in order. */
  readonly requests: ModbusServerRequest[];
  connections: number;
  isSilent: boolean;

  /** How many requests to drop without an answer. */
  toLose: number;

  /** What a TCP answer carries instead of the request's own transaction id or unit. */
  echo: { transaction?: number; unit?: number };

  /** The exception to answer a request with, if any. */
  refuse: (request: ModbusServerRequest) => number | undefined;

  close: () => Promise<void>;
};

/**
 * The PDU answering one request.
 *
 * @param server - The server.
 * @param pdu - The request's PDU.
 * @param request - The request, read.
 * @returns The answer's PDU.
 */
function answerOf(server: FakeModbusServer, pdu: Buffer, request: ModbusServerRequest): Buffer {
  const refusal = server.refuse(request);
  const { code, address, quantity } = request;

  if (refusal !== undefined) {
    return Buffer.from([code | 0x80, refusal]);
  }

  switch (code) {
    case 1:
    case 2: {
      const image = code === 1 ? server.coils : server.discrete;
      const bytes = Buffer.alloc(Math.ceil(quantity / 8));

      for (let index = 0; index < quantity; index += 1) {
        if ((image.get(address + index) ?? 0) !== 0) {
          bytes[Math.floor(index / 8)] = (bytes[Math.floor(index / 8)] ?? 0) | (1 << (index % 8));
        }
      }

      return Buffer.concat([Buffer.from([code, bytes.length]), bytes]);
    }
    case 3:
    case 4: {
      const image = code === 3 ? server.holding : server.input;
      const answer = Buffer.alloc(2 + quantity * 2);

      answer.writeUInt8(code, 0);
      answer.writeUInt8(quantity * 2, 1);

      for (let index = 0; index < quantity; index += 1) {
        answer.writeUInt16BE(image.get(address + index) ?? 0, 2 + index * 2);
      }

      return answer;
    }
    case 5:
      server.coils.set(address, quantity === 0xff00 ? 1 : 0);

      return Buffer.from(pdu.subarray(0, 5));
    case 6:
      server.holding.set(address, quantity);

      return Buffer.from(pdu.subarray(0, 5));
    case 15:
      for (let index = 0; index < quantity; index += 1) {
        server.coils.set(
          address + index,
          (pdu.readUInt8(6 + Math.floor(index / 8)) >> (index % 8)) & 1,
        );
      }

      return Buffer.from(pdu.subarray(0, 5));
    case 16:
      for (let index = 0; index < quantity; index += 1) {
        server.holding.set(address + index, pdu.readUInt16BE(6 + index * 2));
      }

      return Buffer.from(pdu.subarray(0, 5));
    default:
      return Buffer.from([code | 0x80, 1]);
  }
}

/**
 * How long a request PDU is, from what it has so far.
 *
 * @param bytes - The PDU's bytes received so far.
 * @returns Its length, or undefined until it can be told.
 */
function pduLengthOf(bytes: Buffer): number | undefined {
  const code = bytes.readUInt8(0);

  if (code === 15 || code === 16) {
    return bytes.length < 6 ? undefined : 6 + bytes.readUInt8(5);
  }

  return 5;
}

/**
 * Starts a server on a free port of the loopback.
 *
 * @param framing - How frames travel.
 * @returns The server, listening.
 */
export async function startModbusServer(framing: 'tcp' | 'rtu' = 'tcp'): Promise<FakeModbusServer> {
  const sockets = new Set<Socket>();
  const server: FakeModbusServer = {
    port: 0,
    framing,
    unit: 1,
    coils: new Map(),
    discrete: new Map(),
    holding: new Map(),
    input: new Map(),
    requests: [],
    connections: 0,
    isSilent: false,
    toLose: 0,
    echo: {},
    /**
     * Refuses nothing until a test says otherwise.
     *
     * @returns No exception.
     */
    refuse: () => undefined,

    /**
     * Stands in until the listener exists.
     *
     * @returns Settles at once.
     */
    close: () => Promise.resolve(),
  };

  /**
   * Reads one request's PDU and answers it, unless the server is not to.
   *
   * @param socket - The client.
   * @param unit - The unit asked.
   * @param pdu - The request's PDU.
   * @param transaction - Its MBAP transaction id.
   */
  const handle = (socket: Socket, unit: number, pdu: Buffer, transaction: number): void => {
    const request: ModbusServerRequest = {
      unit,
      code: pdu.readUInt8(0),
      address: pdu.readUInt16BE(1),
      quantity: pdu.readUInt16BE(3),
    };

    server.requests.push(request);

    if (server.isSilent || unit !== server.unit) {
      return;
    }

    if (server.toLose > 0) {
      server.toLose -= 1;

      return;
    }

    const answer = answerOf(server, pdu, request);

    if (framing === 'tcp') {
      const header = Buffer.alloc(7);

      header.writeUInt16BE(server.echo.transaction ?? transaction, 0);
      header.writeUInt16BE(0, 2);
      header.writeUInt16BE(answer.length + 1, 4);
      header.writeUInt8(server.echo.unit ?? unit, 6);
      socket.write(Buffer.concat([header, answer]));
    } else {
      const body = Buffer.concat([Buffer.from([unit]), answer]);
      const check = Buffer.alloc(2);

      check.writeUInt16LE(crc16(body), 0);
      socket.write(Buffer.concat([body, check]));
    }
  };

  const listener: Server = createServer((socket) => {
    let buffer = Buffer.alloc(0);

    sockets.add(socket);
    server.connections += 1;
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);

      for (;;) {
        const offset = framing === 'tcp' ? 7 : 1;

        if (buffer.length < offset + 5) {
          return;
        }

        const length = pduLengthOf(buffer.subarray(offset));

        if (length === undefined || buffer.length < offset + length + (framing === 'rtu' ? 2 : 0)) {
          return;
        }

        const pdu = buffer.subarray(offset, offset + length);

        if (framing === 'tcp') {
          const transaction = buffer.readUInt16BE(0);
          const unit = buffer.readUInt8(6);

          buffer = buffer.subarray(offset + length);
          handle(socket, unit, pdu, transaction);
        } else {
          const frame = buffer.subarray(0, 1 + length + 2);

          buffer = buffer.subarray(frame.length);

          if (crc16(frame.subarray(0, frame.length - 2)) !== frame.readUInt16LE(frame.length - 2)) {
            throw new Error('The client sent an RTU frame with a wrong CRC');
          }

          handle(socket, frame.readUInt8(0), pdu, 0);
        }
      }
    });
  });

  /**
   * Closes every connection and stops listening.
   *
   * @returns Settles once it no longer listens.
   */
  server.close = async () => {
    for (const socket of sockets) {
      socket.destroy();
    }

    await new Promise<void>((resolve) => {
      listener.close(() => {
        resolve();
      });
    });
  };

  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));

  const address = listener.address();

  server.port = typeof address === 'object' && address !== null ? address.port : 0;

  return server;
}
