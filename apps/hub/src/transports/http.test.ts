import { readFileSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { Writable } from 'node:stream';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createLogger, type PlatformLogger } from '@nebula-home/logging';
import type { TransportConnection, TransportInbound } from '@nebula-home/package-runtime';

import { httpTransport } from './http.js';

let server: Server;
let host = '';
const seen: {
  method: string;
  url: string;
  auth: string | undefined;
  headers: IncomingHttpHeaders;
  body: string;
}[] = [];

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
    let body = '';

    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('end', () => {
      seen.push({
        method: request.method ?? '',
        url: request.url ?? '',
        auth: request.headers.authorization,
        headers: request.headers,
        body,
      });

      const url = request.url ?? '';

      if (url.startsWith('/status') || url.startsWith('/api/')) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ device: { id: 'relay-one' }, relay: { on: true } }));

        return;
      }

      if (url.startsWith('/plain')) {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end('ON');

        return;
      }

      response.writeHead(404).end();
    });
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

describe('devices that are not asked with a GET', () => {
  it('sends the verb a template names, with its body as JSON', async () => {
    // A Sonoff in DIY mode answers only a POST carrying `{"deviceid":"","data":{}}`, and a GET
    // at the same path hangs it.
    seen.length = 0;
    const connection = await connect();

    await connection.send(
      {
        deviceKey: host,
        op: 'post',
        args: { path: '/status', body: { deviceid: '', data: {} } },
      },
      AbortSignal.timeout(2000),
    );
    await connection.close();

    expect(seen[0]?.method).toBe('POST');
    expect(seen[0]?.headers['content-type']).toBe('application/json');
    expect(JSON.parse(seen[0]?.body ?? '')).toEqual({ deviceid: '', data: {} });
  });

  it('sends a PUT, the way a Nanoleaf takes its state', async () => {
    seen.length = 0;
    const connection = await connect();

    await connection.send(
      { deviceKey: host, op: 'put', args: { path: '/status', body: { on: { value: true } } } },
      AbortSignal.timeout(2000),
    );
    await connection.close();

    expect([seen[0]?.method, seen[0]?.body]).toEqual(['PUT', '{"on":{"value":true}}']);
  });

  it('sends no body with a GET', async () => {
    seen.length = 0;
    const connection = await connect();

    await connection.send(
      { deviceKey: host, op: 'get', args: { path: '/status' } },
      AbortSignal.timeout(2000),
    );
    await connection.close();

    expect([seen[0]?.method, seen[0]?.body, seen[0]?.headers['content-type']]).toEqual([
      'GET',
      '',
      undefined,
    ]);
  });

  it('refuses a verb it does not speak, naming it', async () => {
    // A profile written for another transport - `call` is the Shelly RPC's - fails loudly at the
    // first command instead of quietly sending a GET the device ignores.
    const connection = await connect();

    await expect(
      connection.send(
        { deviceKey: host, op: 'call', args: { path: '/status' } },
        AbortSignal.timeout(2000),
      ),
    ).rejects.toThrow(/call/);
    await connection.close();
  });

  it('polls with the verb and body the subscription names', async () => {
    seen.length = 0;
    const delivered: TransportInbound[] = [];
    const connection = await connect(delivered);

    await connection.apply([
      {
        op: 'poll',
        args: {
          deviceKey: host,
          path: '/status',
          method: 'post',
          body: { data: {} },
          everyMs: 250,
        },
      },
    ]);

    for (let attempt = 0; attempt < 100 && delivered.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    await connection.close();

    expect([seen[0]?.method, seen[0]?.body]).toEqual(['POST', '{"data":{}}']);
  });

  it('probes with the verb and body the probe names', async () => {
    seen.length = 0;
    const found: string[] = [];

    for await (const discovered of httpTransport.scan(
      { host, isSecure: false, timeoutMs: 2000 },
      { probe: { op: 'post', args: { path: '/status', body: { data: {} } } } },
      AbortSignal.timeout(3000),
    )) {
      found.push(discovered.deviceKey);
    }

    expect(found).toEqual([host]);
    expect([seen[0]?.method, seen[0]?.body]).toEqual(['POST', '{"data":{}}']);
  });
});

describe('a token instead of a password', () => {
  it('carries the token in the header the bundle names, and not in the address', async () => {
    // Plex takes `X-Plex-Token`, a Hue bridge `hue-application-key`: neither is basic auth.
    seen.length = 0;
    const connection = await httpTransport.connect(
      { host, timeoutMs: 2000, token: 'plex-secret', tokenHeader: 'X-Plex-Token' },
      { logger: silent(), deliver: (): void => undefined, report: (): void => undefined },
    );

    await connection.send(
      { deviceKey: host, op: 'get', args: { path: '/status' } },
      AbortSignal.timeout(2000),
    );
    await connection.close();

    expect(seen[0]?.headers['x-plex-token']).toBe('plex-secret');
    expect(seen[0]?.url).toBe('/status');
  });

  it('puts the scheme a header wants in front of the token', async () => {
    seen.length = 0;
    await httpTransport.probe(
      {
        host,
        timeoutMs: 2000,
        token: 'abc',
        tokenHeader: 'authorization',
        tokenPrefix: 'Bearer ',
      },
      AbortSignal.timeout(3000),
    );

    expect(seen[0]?.auth).toBe('Bearer abc');
  });

  it('puts the token where the path prefix says, encoded, in front of every path', async () => {
    // A Nanoleaf takes its token as a path segment: `/api/v1/<token>/state`.
    seen.length = 0;
    const connection = await httpTransport.connect(
      { host, timeoutMs: 2000, token: 'a/b c', pathPrefix: '/api/v1/{token}' },
      { logger: silent(), deliver: (): void => undefined, report: (): void => undefined },
    );

    await connection.send(
      { deviceKey: host, op: 'put', args: { path: '/state', body: { on: { value: true } } } },
      AbortSignal.timeout(2000),
    );
    await connection.close();

    expect(seen[0]?.url).toBe('/api/v1/a%2Fb%20c/state');
  });

  it('keeps two configurations with different tokens apart', () => {
    expect(
      httpTransport.connectionKey({ host, token: 'one', tokenHeader: 'X-Plex-Token' }),
    ).not.toBe(httpTransport.connectionKey({ host, token: 'two', tokenHeader: 'X-Plex-Token' }));
  });
});

describe('a device with a certificate of its own', () => {
  let secure: ReturnType<typeof createSecureServer>;
  let secureHost = '';

  beforeAll(async () => {
    const fixtures = new URL('./fixtures/', import.meta.url);

    secure = createSecureServer(
      {
        key: readFileSync(new URL('self-signed.key.pem', fixtures)),
        cert: readFileSync(new URL('self-signed.cert.pem', fixtures)),
      },
      (request, response) => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ bridge: { id: 'hue-one' } }));
      },
    );

    await new Promise<void>((resolve) => {
      secure.listen(0, '127.0.0.1', resolve);
    });

    const address = secure.address();
    secureHost =
      typeof address === 'object' && address !== null ? `127.0.0.1:${String(address.port)}` : '';
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      secure.close(() => {
        resolve();
      });
    });
  });

  it('refuses a certificate nobody vouches for, by default', async () => {
    await expect(
      httpTransport.probe(
        { host: secureHost, isSecure: true, timeoutMs: 2000 },
        AbortSignal.timeout(3000),
      ),
    ).rejects.toThrow(secureHost);
  });

  it('reaches it when the bundle says the device signs its own, as a Hue bridge does', async () => {
    const connection = await httpTransport.connect(
      { host: secureHost, isSecure: true, timeoutMs: 2000, shouldVerifyCertificate: false },
      { logger: silent(), deliver: (): void => undefined, report: (): void => undefined },
    );

    const answer = await connection.send(
      { deviceKey: secureHost, op: 'get', args: { path: '/' } },
      AbortSignal.timeout(2000),
    );
    await connection.close();

    expect(answer).toEqual({ bridge: { id: 'hue-one' } });
  });
});
