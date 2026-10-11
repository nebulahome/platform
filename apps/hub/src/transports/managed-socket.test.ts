/**
 * The managed socket, against a real WebSocket server in this process.
 *
 * What is checked is the part a bundle cannot get right on its own: that a drop comes back,
 * that a reset comes back, that closing for good stays closed, and that one-shot mode does
 * neither - and, for a cloud that signs its sockets in, that the headers go with every handshake
 * and never into the log, that a refused handshake says its status, that a silent peer is found
 * out by its missing pong, and that a certificate nobody signed is refused unless allowed.
 */
import { readFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { createServer, type Server } from 'node:https';
import { Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';

import { createLogger, type PlatformLogger } from '@nebulahome/logging';
import type {
  ManagedSocket,
  ManagedSocketClose,
  ManagedSocketOptions,
} from '@nebulahome/package-runtime';

import { openWebSocket } from './managed-socket.js';

let server: WebSocketServer;
let url = '';
const sockets: WebSocket[] = [];

/** The handshakes the server accepted, in order: their headers are what a test reads. */
const requests: IncomingMessage[] = [];

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
 * A logger that keeps every line, at every level.
 *
 * @returns The logger, and the lines it wrote.
 */
function recording(): { logger: PlatformLogger; lines: string[] } {
  const lines: string[] = [];
  const logger = createLogger(
    { service: 'hub-ws', version: '0.0.0', level: 'trace' },
    new Writable({
      /**
       * Keeps a chunk.
       *
       * @param chunk - A line.
       * @param encoding - Ignored.
       * @param done - Called to accept the write.
       */
      write(chunk: Buffer | string, encoding, done): void {
        lines.push(chunk.toString());
        done();
      },
    }),
  );

  return { logger, lines };
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
 * Says where a server listens.
 *
 * @param address - What it says of its address.
 * @returns The port.
 */
function portOf(address: ReturnType<WebSocketServer['address']>): number {
  return typeof address === 'object' && address !== null ? address.port : 0;
}

/**
 * Starts a server on a free port.
 *
 * @param options - What the server does differently: not answering pings, refusing handshakes.
 * @returns Once it listens.
 */
async function listen(
  options: Omit<ConstructorParameters<typeof WebSocketServer>[0] & object, 'port'> = {},
): Promise<void> {
  server = new WebSocketServer({ ...options, port: 0 });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  url = `ws://127.0.0.1:${String(portOf(server.address()))}`;
  server.on('connection', (socket, request) => {
    sockets.push(socket);
    requests.push(request);
  });
}

/**
 * Stops the server, cutting whoever is still connected.
 *
 * @returns Once it stopped.
 */
async function stop(): Promise<void> {
  for (const socket of sockets.splice(0)) {
    socket.terminate();
  }

  requests.splice(0);
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}

/** What the callbacks saw. */
type Seen = { opens: number; closes: string[]; details: ManagedSocketClose[]; messages: string[] };

/**
 * Opens a managed socket to the test server, recording what it reports.
 *
 * @param reconnect - The reconnection setting.
 * @param more - Anything else to open it with: headers, a ping, TLS, a logger.
 * @returns The socket and what it saw.
 */
function open(
  reconnect?: { minMs: number; maxMs: number } | false,
  more: Partial<ManagedSocketOptions> = {},
): {
  socket: ManagedSocket;
  seen: Seen;
} {
  const seen: Seen = { opens: 0, closes: [], details: [], messages: [] };
  const socket = openWebSocket({
    url,
    logger: silent(),
    onOpen: () => {
      seen.opens += 1;
    },
    onMessage: (text) => {
      seen.messages.push(text);
    },
    onClose: (reason, details) => {
      seen.closes.push(reason);
      seen.details.push(details ?? {});
    },
    ...(reconnect === undefined ? {} : { reconnect }),
    ...more,
  });

  return { socket, seen };
}

beforeEach(async () => {
  await listen();
});

afterEach(async () => {
  await stop();
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
    expect(seen.details).toEqual([{ code: 1001 }]);
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

  it('resets for a reason longer than a close frame carries', async () => {
    const { socket, seen } = open({ minMs: 10, maxMs: 20 });
    const reason = `the device said ${'é'.repeat(100)}`;

    await until(() => seen.opens === 1);

    expect(() => {
      socket.reset(reason);
    }).not.toThrow();
    await until(() => seen.opens === 2);

    expect(seen.closes).toEqual([reason]);
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
    await stop();
    const { socket, seen } = open({ minMs: 10, maxMs: 20 });

    await until(() => seen.closes.length >= 2);

    expect(seen.opens).toBe(0);
    expect(seen.closes[0]).toMatch(/^connection not accepted \(.*ECONNREFUSED/);
    expect(seen.details[0]).toEqual({ code: 1006 });
    await socket.close();
    await listen();
  });

  it('refuses a ping without an interval or a timeout', () => {
    expect(() => open(undefined, { ping: { everyMs: 0, timeoutMs: 100 } })).toThrow(RangeError);
  });
});

describe('openWebSocket with headers', () => {
  it('sends them on every handshake, and never logs them', async () => {
    const { logger, lines } = recording();
    const { socket, seen } = open(
      { minMs: 10, maxMs: 20 },
      { headers: { username: 'access-id', password: 'not-for-the-log' }, logger },
    );

    await until(() => seen.opens === 1);
    sockets[0]?.terminate();
    await until(() => seen.opens === 2);

    expect(requests.map((request) => request.headers['username'])).toEqual([
      'access-id',
      'access-id',
    ]);
    expect(requests[1]?.headers['password']).toBe('not-for-the-log');
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain('not-for-the-log');
    await socket.close();
  });

  it('asks a function for them before each attempt', async () => {
    let calls = 0;
    const { socket, seen } = open(
      { minMs: 10, maxMs: 20 },
      {
        headers: () => {
          calls += 1;

          return { authorization: `Bearer token-${String(calls)}` };
        },
      },
    );

    await until(() => seen.opens === 1);
    sockets[0]?.close(1001, 'token expired');
    await until(() => seen.opens === 2);

    expect(requests.map((request) => request.headers.authorization)).toEqual([
      'Bearer token-1',
      'Bearer token-2',
    ]);
    await socket.close();
  });

  it('waits for an async function, and counts one that fails as a failed attempt', async () => {
    let calls = 0;
    const { socket, seen } = open(
      { minMs: 10, maxMs: 20 },
      {
        headers: async () => {
          calls += 1;
          await pause(5);

          if (calls === 1) {
            throw new Error('token service down');
          }

          return { authorization: 'Bearer fresh' };
        },
      },
    );

    await until(() => seen.opens === 1);

    expect(seen.closes).toEqual(['headers failed: token service down']);
    expect(requests.map((request) => request.headers.authorization)).toEqual(['Bearer fresh']);
    await socket.close();
  });

  it('reports a function that throws at once on the next tick, not at the caller', async () => {
    const { socket, seen } = open(false, {
      headers: () => {
        throw new Error('no credentials');
      },
    });

    expect(seen.closes).toEqual([]);
    await until(() => seen.closes.length === 1);

    expect(seen.closes).toEqual(['headers failed: no credentials']);
    expect(requests).toEqual([]);
    await socket.close();
  });
});

describe('openWebSocket refused', () => {
  it('says the status of a refused handshake, and stays closed when closed there', async () => {
    await stop();
    let handshakes = 0;
    await listen({
      verifyClient: (info, done) => {
        handshakes += 1;
        done(false, 401, 'Unauthorized');
      },
    });
    const seen: { reason: string; details: ManagedSocketClose | undefined }[] = [];
    const socket: ManagedSocket = openWebSocket({
      url,
      headers: { username: 'access-id', password: 'wrong' },
      logger: silent(),
      onOpen: () => undefined,
      onMessage: () => undefined,
      onClose: (reason, details) => {
        seen.push({ reason, details });
        // What a vendor does with credentials turned down: stop, rather than retry for ever.
        void socket.close();
      },
      reconnect: { minMs: 10, maxMs: 20 },
    });

    await until(() => seen.length === 1);
    await pause(60);

    expect(seen).toEqual([
      {
        reason: 'connection not accepted (HTTP 401 Unauthorized)',
        details: { code: 1006, status: 401 },
      },
    ]);
    expect(handshakes).toBe(1);
  });
});

describe('openWebSocket pinging', () => {
  it('stays open while the peer answers its pings', async () => {
    const { socket, seen } = open(
      { minMs: 10, maxMs: 20 },
      { ping: { everyMs: 20, timeoutMs: 50 } },
    );

    await until(() => seen.opens === 1);
    await pause(200);

    expect(seen.closes).toEqual([]);
    expect(socket.isOpen).toBe(true);
    await socket.close();
  });

  it('drops a peer that stopped answering, and comes back', async () => {
    await stop();
    await listen({ autoPong: false });
    const { socket, seen } = open(
      { minMs: 10, maxMs: 20 },
      { ping: { everyMs: 20, timeoutMs: 30 } },
    );

    await until(() => seen.opens === 2);

    expect(seen.closes[0]).toBe('no answer to a ping within 30 ms');
    expect(seen.details[0]).toEqual({ code: 1006 });
    await socket.close();
  });
});

describe('openWebSocket over TLS', () => {
  let secure: Server;
  let secureSockets: WebSocketServer;
  let secureUrl = '';

  beforeEach(async () => {
    const fixtures = new URL('../../tests/fixtures/tls/', import.meta.url);
    secure = createServer({
      key: readFileSync(new URL('localhost.key.pem', fixtures)),
      cert: readFileSync(new URL('localhost.crt.pem', fixtures)),
    });
    secureSockets = new WebSocketServer({ server: secure });
    await new Promise<void>((resolve) => secure.listen(0, '127.0.0.1', resolve));
    secureUrl = `wss://127.0.0.1:${String(portOf(secure.address()))}`;
  });

  afterEach(async () => {
    for (const client of secureSockets.clients) {
      client.terminate();
    }

    await new Promise<void>((resolve) => {
      secureSockets.close(() => {
        secure.close(() => {
          resolve();
        });
      });
    });
  });

  it('refuses a certificate nobody signed, unless told not to check', async () => {
    const checked = open(false, { url: secureUrl });

    await until(() => checked.seen.closes.length === 1);

    expect(checked.seen.opens).toBe(0);
    expect(checked.seen.closes[0]).toMatch(/self-signed certificate/);
    await checked.socket.close();

    const unchecked = open(false, { url: secureUrl, tls: { rejectUnauthorized: false } });

    await until(() => unchecked.seen.opens === 1);

    expect(unchecked.socket.isOpen).toBe(true);
    await unchecked.socket.close();
  });
});
