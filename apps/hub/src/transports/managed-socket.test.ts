/**
 * The managed socket, against a real WebSocket server in this process.
 *
 * What is checked is the part a bundle cannot get right on its own: that a drop comes back,
 * that a reset comes back, that closing for good stays closed, and that one-shot mode does
 * neither.
 */
import { Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';

import { createLogger, type PlatformLogger } from '@nebula-home/logging';
import type { ManagedSocket } from '@nebula-home/package-runtime';

import { openWebSocket } from './managed-socket.js';

let server: WebSocketServer;
let url = '';
const sockets: WebSocket[] = [];

/**
 * A logger that writes nowhere.
 *
 * @returns A logger bound to a discarding stream.
 */
function silent(): PlatformLogger {
  return createLogger(
    { service: 'hub-ws', version: '0.0.0', level: 'fatal' },
    new Writable({
      /**
       * Discards a chunk.
       *
       * @param chunk - Ignored.
       * @param encoding - Ignored.
       * @param done - Called to accept the write.
       */
      write(chunk, encoding, done): void {
        done();
      },
    }),
  );
}

/**
 * Waits until a condition holds, polling.
 *
 * @param condition - What to wait for.
 * @param timeoutMs - How long before giving up.
 */
async function until(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting');
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * Lets a little time pass.
 *
 * @param ms - How much.
 */
async function pause(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Starts a server on a free port.
 *
 * @returns Once it listens.
 */
async function listen(): Promise<void> {
  server = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  url = `ws://127.0.0.1:${String(port)}`;
  server.on('connection', (socket) => {
    sockets.push(socket);
  });
}

/** What the callbacks saw. */
type Seen = { opens: number; closes: string[]; messages: string[] };

/**
 * Opens a managed socket to the test server, recording what it reports.
 *
 * @param reconnect - The reconnection setting.
 * @returns The socket and what it saw.
 */
function open(reconnect?: { minMs: number; maxMs: number } | false): {
  socket: ManagedSocket;
  seen: Seen;
} {
  const seen: Seen = { opens: 0, closes: [], messages: [] };
  const socket = openWebSocket({
    url,
    logger: silent(),
    onOpen: () => {
      seen.opens += 1;
    },
    onMessage: (text) => {
      seen.messages.push(text);
    },
    onClose: (reason) => {
      seen.closes.push(reason);
    },
    ...(reconnect === undefined ? {} : { reconnect }),
  });

  return { socket, seen };
}

beforeEach(async () => {
  await listen();
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    socket.terminate();
  }

  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

describe('openWebSocket', () => {
  it('opens, delivers frames, and sends them', async () => {
    server.on('connection', (peer) => {
      peer.on('message', (data) => {
        peer.send(`echo ${Buffer.isBuffer(data) ? data.toString('utf8') : ''}`);
      });
    });
    const { socket, seen } = open();

    await until(() => seen.opens === 1);
    socket.send('hello');
    await until(() => seen.messages.length === 1);

    expect(seen.messages).toEqual(['echo hello']);
    expect(socket.isOpen).toBe(true);
    await socket.close();
  });

  it('refuses to send before it is open', async () => {
    const { socket } = open();

    expect(() => {
      socket.send('too soon');
    }).toThrow(/not open/);

    await socket.close();
  });

  it('comes back after the server drops it, and says why it went', async () => {
    const { socket, seen } = open({ minMs: 10, maxMs: 20 });

    await until(() => seen.opens === 1);
    sockets[0]?.close(1001, 'going away');
    await until(() => seen.opens === 2);

    expect(seen.closes).toEqual(['going away']);
    await socket.close();
  });

  it('comes back when reset, which is what a timed-out request asks for', async () => {
    const { socket, seen } = open({ minMs: 10, maxMs: 20 });

    await until(() => seen.opens === 1);
    socket.reset('request timed out');
    await until(() => seen.opens === 2);

    expect(seen.closes).toEqual(['request timed out']);
    await socket.close();
  });

  it('stays closed once closed for good', async () => {
    const { socket, seen } = open({ minMs: 10, maxMs: 20 });

    await until(() => seen.opens === 1);
    await socket.close();
    await pause(60);

    expect(seen.opens).toBe(1);
    expect(socket.isOpen).toBe(false);
  });

  it('tries once and no more in one-shot mode', async () => {
    const { socket, seen } = open(false);

    await until(() => seen.opens === 1);
    sockets[0]?.close(1000, 'done');
    await until(() => seen.closes.length === 1);
    await pause(60);

    expect(seen.opens).toBe(1);
    await socket.close();
  });

  it('reports an address it cannot even open, rather than throwing at the caller', async () => {
    // A host with a space in it is refused by the WebSocket constructor itself. The bundle
    // that asked must hear it as a drop, like any other address with nothing behind it.
    const seen: string[] = [];
    let socket: ManagedSocket | undefined;

    expect(() => {
      socket = openWebSocket({
        url: 'ws://not a host/rpc',
        logger: silent(),
        onOpen: () => undefined,
        onMessage: () => undefined,
        onClose: (reason) => {
          seen.push(reason);
        },
        reconnect: false,
      });
    }).not.toThrow();
    await until(() => seen.length === 1);

    expect(seen[0]).toMatch(/.+/);
    await socket?.close();
  });

  it('reports a connection that never opened, then keeps trying', async () => {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
    const { socket, seen } = open({ minMs: 10, maxMs: 20 });

    await until(() => seen.closes.length >= 2);

    expect(seen.opens).toBe(0);
    expect(seen.closes[0]).toMatch(/^connection not accepted/);
    await socket.close();
    await listen();
  });
});
