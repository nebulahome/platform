import { createServer, type Server } from 'node:http';
import { Writable } from 'node:stream';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createLogger, type PlatformLogger } from '@nebula-home/logging';
import type { TransportConnection, TransportInbound } from '@nebula-home/package-runtime';

import { httpTransport } from './http.js';

let server: Server;
let host = '';
const seen: { method: string; url: string; auth: string | undefined }[] = [];

/**
 * A logger that writes nowhere.
 *
 * @returns A logger bound to a discarding stream.
 */
function silent(): PlatformLogger {
  return createLogger(
    { service: 'hub-http', version: '0.0.0', level: 'fatal' },
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
 * Opens a connection to the test server.
 *
 * @param delivered - Where polled responses are recorded.
 * @returns The connection.
 */
async function connect(delivered: TransportInbound[] = []): Promise<TransportConnection> {
  return httpTransport.connect(
    { host, isSecure: false, timeoutMs: 2000 },
    {
      logger: silent(),
      deliver: (message): void => {
        delivered.push(message);
      },
      report: (): void => undefined,
    },
  );
}

beforeAll(async () => {
  server = createServer((request, response) => {
    seen.push({
      method: request.method ?? '',
      url: request.url ?? '',
      auth: request.headers.authorization,
    });

    if (request.url?.startsWith('/status') === true) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ device: { id: 'relay-one' }, relay: { on: true } }));

      return;
    }

    if (request.url?.startsWith('/plain') === true) {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('ON');

      return;
    }

    response.writeHead(404).end();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  host = typeof address === 'object' && address !== null ? `127.0.0.1:${String(address.port)}` : '';
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

describe('asking a device something', () => {
  it('reads what the device answered', async () => {
    const connection = await connect();

    const answer = await connection.send(
      { deviceKey: host, op: 'get', args: { path: '/status' } },
      AbortSignal.timeout(2000),
    );

    await connection.close();

    expect(answer).toEqual({ device: { id: 'relay-one' }, relay: { on: true } });
  });

  it('puts the values a command carried into the query', async () => {
    // The one thing a request template cannot be literal about. The profile writes
    // `{ "$": "command.level" }` and it has to arrive as a parameter the device reads.
    seen.length = 0;
    const connection = await connect();

    await connection.send(
      { deviceKey: host, op: 'get', args: { path: '/status', query: { id: 0, on: true } } },
      AbortSignal.timeout(2000),
    );

    await connection.close();

    expect(seen[0]?.url).toBe('/status?id=0&on=true');
  });

  it('keeps text that is not JSON', async () => {
    const connection = await connect();

    const answer = await connection.send(
      { deviceKey: host, op: 'get', args: { path: '/plain' } },
      AbortSignal.timeout(2000),
    );

    await connection.close();

    expect(answer).toBe('ON');
  });

  it('treats a status that is not a success as a failure', async () => {
    // A device answering 404 to a command has not performed it, and acknowledging it anyway
    // would tell `core` the light changed when it did not.
    const connection = await connect();

    await expect(
      connection.send(
        { deviceKey: host, op: 'get', args: { path: '/nowhere' } },
        AbortSignal.timeout(2000),
      ),
    ).rejects.toThrow(/404/);

    await connection.close();
  });

  it('carries the credentials the owner configured, which a profile never sees', async () => {
    seen.length = 0;

    const connection = await httpTransport.connect(
      { host, isSecure: false, timeoutMs: 2000, username: 'admin', password: 'secret' },
      { logger: silent(), deliver: (): void => undefined, report: (): void => undefined },
    );

    await connection.send(
      { deviceKey: host, op: 'get', args: { path: '/status' } },
      AbortSignal.timeout(2000),
    );

    await connection.close();

    expect(seen[0]?.auth).toBe(`Basic ${Buffer.from('admin:secret').toString('base64')}`);
  });
});

describe('polling', () => {
  it('delivers what a poll read, as though the device had reported it', async () => {
    const delivered: TransportInbound[] = [];
    const connection = await connect(delivered);

    await connection.apply([
      { op: 'poll', args: { deviceKey: host, path: '/status', everyMs: 250 } },
    ]);

    for (let attempt = 0; attempt < 100 && delivered.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    await connection.close();

    expect(delivered[0]).toMatchObject({ deviceKey: host, payload: { relay: { on: true } } });
  });

  it('stops polling what is no longer in the set', async () => {
    // `apply` replaces. Without that, an instance stopping would leave its timers running and the
    // device would keep being asked by a service that no longer owns it.
    const delivered: TransportInbound[] = [];
    const connection = await connect(delivered);

    await connection.apply([
      { op: 'poll', args: { deviceKey: host, path: '/status', everyMs: 250 } },
    ]);
    await connection.apply([]);

    delivered.length = 0;
    await new Promise((resolve) => setTimeout(resolve, 600));
    await connection.close();

    expect(delivered).toEqual([]);
  });

  it('survives a device that is not answering', async () => {
    // A house always has something switched off at the wall. A failing poll must not stop the
    // ones for every other device on the same connection.
    const delivered: TransportInbound[] = [];
    const connection = await connect(delivered);

    await connection.apply([
      { op: 'poll', args: { deviceKey: '127.0.0.1:1', path: '/status', everyMs: 250 } },
      { op: 'poll', args: { deviceKey: host, path: '/status', everyMs: 250 } },
    ]);

    for (let attempt = 0; attempt < 100 && delivered.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    await connection.close();

    expect(delivered[0]?.deviceKey).toBe(host);
  });
});

describe('probing the host an owner configured', () => {
  it('offers the host when it answered the probe', async () => {
    const found = [];

    for await (const discovered of httpTransport.scan(
      { host, isSecure: false, timeoutMs: 2000 },
      { probe: { op: 'get', args: { path: '/status' } } },
      AbortSignal.timeout(3000),
    )) {
      found.push(discovered);
    }

    expect(found).toEqual([
      { deviceKey: host, payload: { device: { id: 'relay-one' }, relay: { on: true } } },
    ]);
  });

  it('offers nothing for a host with nothing behind it', async () => {
    // An address with nothing at it is the ordinary outcome of a typo, not an error worth
    // failing the scan for: the instance simply keeps listening for the device.
    const found = [];

    for await (const discovered of httpTransport.scan(
      { host: '127.0.0.1:1', isSecure: false, timeoutMs: 500 },
      { probe: { op: 'get', args: { path: '/status' } } },
      AbortSignal.timeout(3000),
    )) {
      found.push(discovered.deviceKey);
    }

    expect(found).toEqual([]);
  });
});

describe('trying a configuration', () => {
  it('counts an address that answers at all, whatever it answers', async () => {
    // The test server has no `/`, so it answers 404 - and a 404 is a device talking HTTP at
    // that address, which is what a probe is for. Whether it is the right device is the
    // discovery scan's question, not this one's.
    const detail = await httpTransport.probe(
      { host, isSecure: false, timeoutMs: 2000 },
      AbortSignal.timeout(3000),
    );

    expect(detail).toContain(host);
    expect(detail).toMatch(/answered/u);
  });

  it('names the address that did not answer, and why', async () => {
    await expect(
      httpTransport.probe(
        { host: '127.0.0.1:9', isSecure: false, timeoutMs: 2000 },
        AbortSignal.timeout(3000),
      ),
    ).rejects.toThrow(/127\.0\.0\.1:9/u);
  });

  it('refuses a configuration with nothing to try', async () => {
    // One device is one address. A configuration without one is refused by the schema, at the
    // boundary, naming the field.
    await expect(
      httpTransport.probe({ isSecure: false, timeoutMs: 2000 }, AbortSignal.timeout(3000)),
    ).rejects.toThrow(/host/iu);
  });

  it('sends the credentials, since a device with a password answers 401 without them', async () => {
    seen.length = 0;
    await httpTransport.probe(
      { host, isSecure: false, timeoutMs: 2000, username: 'admin', password: 'pw' },
      AbortSignal.timeout(3000),
    );

    expect(seen[0]?.auth).toBe(`Basic ${Buffer.from('admin:pw').toString('base64')}`);
  });
});
