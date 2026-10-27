import net from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { serialLineSchema } from '@nebulahome/contracts';

import {
  COM_PORT_OPTION,
  DO,
  IAC,
  lineSubnegotiations,
  openNetworkPort,
  SB,
  SE,
  SET_BAUDRATE,
  TelnetDecoder,
  WILL,
} from './network.js';

/** 9600 8N1. */
const LINE = serialLineSchema.parse({ baudRate: 9600 });

/** A serial server on loopback: what it was sent, and the socket to answer on. */
type Bridge = {
  readonly port: number;
  readonly received: () => Buffer;
  readonly socket: () => Promise<net.Socket>;
  readonly close: () => Promise<void>;
};

let bridge: Bridge | undefined;

afterEach(async () => {
  await bridge?.close();
  bridge = undefined;
});

/**
 * A serial server on loopback.
 *
 * @param onData - Answers what it is sent.
 * @returns It, listening.
 */
async function startBridge(onData: (socket: net.Socket, chunk: Buffer) => void): Promise<Bridge> {
  const chunks: Buffer[] = [];
  const sockets: net.Socket[] = [];
  let accepted: (socket: net.Socket) => void = () => undefined;
  const first = new Promise<net.Socket>((resolve) => {
    accepted = resolve;
  });
  const server = net.createServer((socket) => {
    sockets.push(socket);
    accepted(socket);
    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      onData(socket, chunk);
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address() as net.AddressInfo;

  bridge = {
    port: address.port,
    received: () => Buffer.concat(chunks),
    socket: async () => first,
    close: async () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) {
          socket.destroy();
        }

        server.close(() => {
          resolve();
        });
      }),
  };

  return bridge;
}

/**
 * Waits until a condition holds.
 *
 * @param condition - The condition.
 * @returns Once it holds.
 */
async function until(condition: () => boolean): Promise<void> {
  for (let tries = 0; tries < 100 && !condition(); tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('Telnet', () => {
  it('takes the port’s bytes out of a stream cut anywhere, doubled IACs as one', () => {
    const decoder = new TelnetDecoder();
    const stream = Buffer.from([
      0x41,
      ...[IAC, IAC],
      ...[IAC, DO, COM_PORT_OPTION],
      ...[IAC, SB, COM_PORT_OPTION, 101, 0, 0, IAC, IAC, 0x80, IAC, SE],
      0x42,
    ]);
    const data: number[] = [];
    const negotiations: { verb: number; option: number }[] = [];

    // One byte at a time: every sequence is cut somewhere.
    for (const byte of stream) {
      const result = decoder.push(Uint8Array.of(byte));

      data.push(...result.data);
      negotiations.push(...result.negotiations);
    }

    expect(Buffer.from(data)).toEqual(Buffer.from([0x41, 0xff, 0x42]));
    expect(negotiations).toEqual([{ verb: DO, option: COM_PORT_OPTION }]);
  });

  it('sets a line in five subnegotiations, a 0xFF in a value sent twice', () => {
    const line = serialLineSchema.parse({ baudRate: 65_535, parity: 'even', stopBits: 2 });

    expect(lineSubnegotiations(line).subarray(0, 12)).toEqual(
      Buffer.from([IAC, SB, COM_PORT_OPTION, SET_BAUDRATE, 0, 0, 0xff, 0xff, 0xff, 0xff, IAC, SE]),
    );
    expect(lineSubnegotiations(LINE)).toEqual(
      Buffer.from([
        ...[IAC, SB, COM_PORT_OPTION, 1, 0x00, 0x00, 0x25, 0x80, IAC, SE],
        ...[IAC, SB, COM_PORT_OPTION, 2, 8, IAC, SE],
        ...[IAC, SB, COM_PORT_OPTION, 3, 1, IAC, SE],
        ...[IAC, SB, COM_PORT_OPTION, 4, 1, IAC, SE],
        ...[IAC, SB, COM_PORT_OPTION, 5, 1, IAC, SE],
      ]),
    );
  });
});

describe('a port on the network', () => {
  it('speaks RFC 2217: offers the COM port, sets the line once agreed, escapes its bytes', async () => {
    const server = await startBridge((socket, chunk) => {
      if (chunk.includes(Buffer.from([IAC, WILL, COM_PORT_OPTION]))) {
        // Agrees, and asks for an option the hub never offered.
        socket.write(Buffer.from([IAC, DO, COM_PORT_OPTION, IAC, DO, 24]));
      }
    });
    const session = await openNetworkPort(
      { host: '127.0.0.1', port: server.port, protocol: 'rfc2217' },
      LINE,
    );
    const heard: Buffer[] = [];

    session.onData((bytes) => heard.push(Buffer.from(bytes)));
    await session.write(Uint8Array.of(0x01, 0xff, 0x02));
    await until(() => server.received().includes(Buffer.from([0x01, 0xff, 0xff, 0x02])));

    const received = server.received();

    expect(received.includes(lineSubnegotiations(LINE))).toBe(true);
    // Option 24 refused, as Telnet asks.
    expect(received.includes(Buffer.from([IAC, 0xfc, 24]))).toBe(true);
    expect(received.includes(Buffer.from([0x01, 0xff, 0xff, 0x02]))).toBe(true);

    // The port says something with an 0xFF, around the server's answer to SET-BAUDRATE.
    (await server.socket()).write(
      Buffer.from([0x10, IAC, IAC, IAC, SB, COM_PORT_OPTION, 101, 0, 0, 0x25, 0x80, IAC, SE, 0x11]),
    );
    await until(() => Buffer.concat(heard).length >= 3);
    expect(Buffer.concat(heard)).toEqual(Buffer.from([0x10, 0xff, 0x11]));
    await session.close();
  });

  it('refuses a server that will not speak RFC 2217', async () => {
    const server = await startBridge((socket) => {
      socket.write(Buffer.from([IAC, 0xfe, COM_PORT_OPTION]));
    });

    await expect(
      openNetworkPort({ host: '127.0.0.1', port: server.port, protocol: 'rfc2217' }, LINE),
    ).rejects.toThrow(/does not speak RFC 2217/u);
  });

  it('passes raw TCP bytes as they are, both ways', async () => {
    const server = await startBridge(() => undefined);
    const session = await openNetworkPort(
      { host: '127.0.0.1', port: server.port, protocol: 'raw' },
      LINE,
    );
    const heard: Buffer[] = [];
    const reasons: string[] = [];

    session.onData((bytes) => heard.push(Buffer.from(bytes)));
    session.onClose((reason) => reasons.push(reason));
    await session.write(Uint8Array.of(0xff, 0x00));
    (await server.socket()).write(Buffer.from([0xff, 0x01]));
    await until(() => heard.length > 0 && server.received().length > 0);

    expect(server.received()).toEqual(Buffer.from([0xff, 0x00]));
    expect(Buffer.concat(heard)).toEqual(Buffer.from([0xff, 0x01]));

    (await server.socket()).destroy();
    await until(() => reasons.length > 0);
    expect(reasons).toHaveLength(1);
  });

  it('says why nothing answered', async () => {
    const server = await startBridge(() => undefined);
    const { port } = server;

    await server.close();
    bridge = undefined;

    await expect(
      openNetworkPort({ host: '127.0.0.1', port, protocol: 'raw' }, LINE),
    ).rejects.toThrow(/ECONNREFUSED/u);
  });
});
