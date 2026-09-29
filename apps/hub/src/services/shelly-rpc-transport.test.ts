/**
 * The Shelly transport, driven through a socket the test holds both ends of.
 *
 * Nothing here touches a device. What is checked is the protocol as the docs state it: the
 * frame a request becomes, the digest that answers a challenge, the snapshot a notification is
 * laid over, and the words a failed probe uses. The one thing a test cannot settle is whether
 * the firmware still speaks this dialect, and the bundle's README says where to look.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { JsonObject } from '@nebula-home/contracts';
import { createLogger, type PlatformLogger } from '@nebula-home/logging';
import {
  defineAccount,
  defineStreamSource,
  defineTransport,
  type BundleSdk,
  type ManagedSocket,
  type ManagedSocketOptions,
  type Transport,
  type TransportConnection,
  type TransportFactory,
  type TransportInbound,
  type TransportStatus,
} from '@nebula-home/package-runtime';

/** The transport module, where the bundle ships it and where the loader imports it from. */
const MODULE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../bundles/shelly/rpc/transport.js',
);

/** The factory the module exports, read the way the loader reads it. */
let createShellyRpc: TransportFactory;

beforeAll(async () => {
  const loaded = (await import(pathToFileURL(MODULE).href)) as { default: TransportFactory };

  createShellyRpc = loaded.default;
});

/** One end of a socket the test holds. */
type FakeSocket = {
  readonly options: ManagedSocketOptions;
  readonly sent: string[];
  isOpen: boolean;
  resets: string[];
  closes: number;
};

/** The address the owner typed. */
const HOST = '192.168.1.40';

/** What the device calls itself in every frame. */
const DEVICE = 'shellyplus1pm-aabbcc';

/** What the kept socket names itself: the hub's prefix and a suffix of its own. */
const HUB_SOURCE = expect.stringMatching(/^nebula-hub-[0-9a-f]{6}$/) as unknown;

/** The challenge a device with a password answers with, as firmware 2.x sends it. */
const CHALLENGE = {
  code: 401,
  message: JSON.stringify({
    auth_type: 'digest',
    nonce: 'AAAAAABn',
    realm: DEVICE,
    algorithm: 'SHA-256',
  }),
};

/** A status as a 1PM Gen3 answers it, cut to what matters. */
const STATUS = {
  sys: { mac: 'AABBCC', uptime: 10 },
  'switch:0': {
    id: 0,
    output: false,
    apower: 0,
    voltage: 231.2,
    current: 0,
    aenergy: { total: 12.5 },
    temperature: { tC: 41.2 },
  },
};

/** What the device says it is, asked once the status is in: its firmware version above all. */
const INFO = { id: DEVICE, ver: '1.4.2', fw_id: '20240819-074343/1.4.2-gc2639da' };

/** How a device that is not installing firmware reads, laid beside every status. */
const IDLE = { isInstalling: false, progress: null };

/**
 * A logger that writes nowhere.
 *
 * @returns A logger bound to a discarding stream.
 */
function silent(): PlatformLogger {
  return createLogger(
    { service: 'hub-shelly', version: '0.0.0', level: 'fatal' },
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
 * Lets the transport's own awaits run their course.
 */
async function settle(): Promise<void> {
  for (let round = 0; round < 8; round += 1) {
    await Promise.resolve();
  }
}

/**
 * Builds the transport with a fake socket factory that records every socket opened.
 *
 * @returns The transport and the sockets it opened, in order.
 */
function build(): { transport: Transport; sockets: FakeSocket[] } {
  const sockets: FakeSocket[] = [];
  const sdk: BundleSdk = {
    version: '1.0.0',
    z,
    logger: silent(),
    defineTransport,
    openWebSocket: (options): ManagedSocket => {
      const fake: FakeSocket = { options, sent: [], isOpen: false, resets: [], closes: 0 };
      sockets.push(fake);

      return {
        get isOpen(): boolean {
          return fake.isOpen;
        },
        send: (text): void => {
          if (!fake.isOpen) {
            throw new Error('not open');
          }

          fake.sent.push(text);
        },
        reset: (reason): void => {
          fake.resets.push(reason);
          fake.isOpen = false;
        },
        close: (): Promise<void> => {
          fake.closes += 1;
          fake.isOpen = false;

          return Promise.resolve();
        },
      };
    },
    openUdpSocket: () => {
      throw new Error('Shelly speaks no UDP');
    },
    openMqtt: () => {
      throw new Error('Shelly speaks no MQTT here');
    },
    defineStreamSource,
    defineAccount,
    codecs: { lzma: () => Buffer.alloc(0) },
    images: { png: () => Buffer.alloc(0) },
    openRtsp: () => {
      throw new Error('not opened in this test');
    },
    platform: { mqtt: null },
  };

  return { transport: createShellyRpc(sdk), sockets };
}

/**
 * Opens the fake socket as the device would.
 *
 * @param socket - The socket.
 */
function open(socket: FakeSocket): void {
  socket.isOpen = true;
  socket.options.onOpen();
}

/**
 * Reads the last frame sent, parsed.
 *
 * @param socket - The socket.
 * @returns The frame.
 */
function lastFrame(socket: FakeSocket): Record<string, unknown> {
  return JSON.parse(socket.sent.at(-1) ?? '{}') as Record<string, unknown>;
}

/**
 * Answers the last request with a result.
 *
 * @param socket - The socket.
 * @param result - What the device answers.
 */
function answer(socket: FakeSocket, result: unknown): void {
  const { id } = lastFrame(socket);
  socket.options.onMessage(JSON.stringify({ id, src: DEVICE, dst: 'nebula-hub', result }));
}

/**
 * Answers the last request with an error frame.
 *
 * @param socket - The socket.
 * @param error - The error object.
 */
function fail(socket: FakeSocket, error: unknown): void {
  const { id } = lastFrame(socket);
  socket.options.onMessage(JSON.stringify({ id, src: DEVICE, dst: 'nebula-hub', error }));
}

/**
 * Sends a notification, as the device pushes it.
 *
 * @param socket - The socket.
 * @param method - `NotifyStatus`, `NotifyFullStatus` or `NotifyEvent`.
 * @param params - The params.
 */
function notify(socket: FakeSocket, method: string, params: unknown): void {
  socket.options.onMessage(JSON.stringify({ src: DEVICE, dst: 'nebula-hub', method, params }));
}

/**
 * Computes the digest the device would compute, from the auth object a frame carried.
 *
 * @param auth - The frame's auth object.
 * @param password - The password the device holds.
 * @returns The expected response.
 */
function expectedResponse(auth: Record<string, unknown>, password: string): string {
  const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
  const ha1 = sha(`admin:${String(auth['realm'])}:${password}`);
  const ha2 = sha('dummy_method:dummy_uri');

  return sha(
    `${ha1}:${String(auth['nonce'])}:${String(auth['nc'])}:${String(auth['cnonce'])}:auth:${ha2}`,
  );
}

/** A connection with its socket and what it reported. */
type Opened = {
  connection: TransportConnection;
  socket: FakeSocket;
  delivered: TransportInbound[];
  statuses: TransportStatus[];
};

/**
 * Opens a connection to the fake device.
 *
 * @param config - What the owner typed.
 * @returns The connection, its socket and what it reported.
 */
async function connect(config: Record<string, unknown> = { host: HOST }): Promise<Opened> {
  const { transport, sockets } = build();
  const delivered: TransportInbound[] = [];
  const statuses: TransportStatus[] = [];
  const connection = await transport.connect(config, {
    logger: silent(),
    deliver: (message): void => {
      delivered.push(message);
    },
    report: (status): void => {
      statuses.push(status);
    },
  });
  const socket = sockets[0];

  if (socket === undefined) {
    throw new Error('The transport opened no socket');
  }

  return { connection, socket, delivered, statuses };
}

/**
 * Opens a connection with one status subscription applied and the device answering the first
 * status, so the tests start from a device that is up and known.
 *
 * @returns The connection, the socket and what was delivered.
 */
async function running(): Promise<Opened> {
  const opened = await connect();

  await opened.connection.apply([{ op: 'status', args: { deviceKey: HOST, everyMs: 60_000 } }]);
  open(opened.socket);
  await settle();
  answer(opened.socket, STATUS);
  await settle();
  answer(opened.socket, INFO);
  await settle();

  // Only the last: the status as the device knows it, with what it said about itself.
  opened.delivered.splice(0, opened.delivered.length - 1);

  return opened;
}

/**
 * Asks the device one thing through the connection.
 *
 * @param connection - The connection.
 * @param method - The method.
 * @param params - Its parameters.
 * @returns The device's answer.
 */
function call(
  connection: TransportConnection,
  method: string,
  params?: JsonObject,
): Promise<unknown> {
  return connection.send(
    { deviceKey: HOST, op: 'call', args: { method, ...(params === undefined ? {} : { params }) } },
    new AbortController().signal,
  );
}

describe('shelly/rpc', () => {
  it('calls itself after its vendor', () => {
    expect(build().transport.id).toBe('shelly/rpc');
  });

  it('shares nothing between two addresses, and everything between two of the same', () => {
    const { transport } = build();

    expect(transport.connectionKey({ host: 'a' })).toBe(
      transport.connectionKey({ host: 'a', password: 'x' }),
    );
    expect(transport.connectionKey({ host: 'a' })).not.toBe(transport.connectionKey({ host: 'b' }));
  });

  it('refuses settings with no address', () => {
    expect(() => build().transport.connectionKey({})).toThrow();
  });
});

describe('a running connection', () => {
  it('asks for the status as soon as the socket opens, and delivers it', async () => {
    const { connection, socket, delivered, statuses } = await running();

    expect(socket.options.url).toBe(`ws://${HOST}/rpc`);
    expect(socket.sent.map((frame) => JSON.parse(frame) as unknown)).toMatchObject([
      { src: HUB_SOURCE, method: 'Shelly.GetStatus' },
      { src: HUB_SOURCE, method: 'Shelly.GetDeviceInfo' },
    ]);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({
      deviceKey: HOST,
      payload: { ...STATUS, device_info: { ver: '1.4.2', fw_id: INFO.fw_id }, ota: IDLE },
    });
    expect(statuses).toEqual(['up']);
    await connection.close();
  });

  it('lays a notification over the snapshot and delivers the whole', async () => {
    const { connection, socket, delivered } = await running();

    notify(socket, 'NotifyStatus', {
      ts: 1,
      'switch:0': { id: 0, output: true, source: 'button' },
    });

    expect(delivered).toHaveLength(2);
    expect(delivered[1]?.payload).toEqual({
      sys: { mac: 'AABBCC', uptime: 10 },
      'switch:0': {
        id: 0,
        output: true,
        source: 'button',
        apower: 0,
        voltage: 231.2,
        current: 0,
        aenergy: { total: 12.5 },
        temperature: { tC: 41.2 },
      },
      device_info: { ver: '1.4.2', fw_id: INFO.fw_id },
      ota: IDLE,
    });
    await connection.close();
  });

  it('removes an attribute a notification sets to null, as the docs say it means', async () => {
    const { connection, socket, delivered } = await running();

    notify(socket, 'NotifyStatus', { ts: 1, 'switch:0': { apower: null } });

    const relay = (delivered[1]?.payload as Record<string, Record<string, unknown>>)['switch:0'];

    expect(relay).toMatchObject({ output: false, voltage: 231.2 });
    expect(relay).not.toHaveProperty('apower');
    await connection.close();
  });

  it('asks once for the status when a change arrives before any, and ignores an event', async () => {
    const { connection, socket, delivered } = await connect();

    await connection.apply([{ op: 'status', args: { deviceKey: HOST } }]);
    open(socket);
    notify(socket, 'NotifyStatus', { ts: 1, 'switch:0': { output: true } });
    notify(socket, 'NotifyEvent', {
      ts: 1,
      events: [{ component: 'input:0', event: 'single_push' }],
    });

    // The status asked for on open is still on its way; the change does not ask a second time.
    expect(socket.sent.map((frame) => (JSON.parse(frame) as { method: string }).method)).toEqual([
      'Shelly.GetStatus',
    ]);
    expect(delivered).toEqual([]);
    await connection.close();
  });

  it('takes a full status notification as the snapshot when it has none yet', async () => {
    const { connection, socket, delivered } = await connect();

    await connection.apply([{ op: 'status', args: { deviceKey: HOST } }]);
    open(socket);
    notify(socket, 'NotifyFullStatus', { ts: 1, ...STATUS });

    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.payload).toEqual({ ...STATUS, ota: IDLE });
    await connection.close();
  });

  it('asks for the status shortly after a command no notification followed', async () => {
    const { connection, socket } = await running();

    const reply = call(connection, 'Switch.Set', { id: 0, on: true });
    answer(socket, { was_on: false });
    await reply;
    await new Promise((resolve) => setTimeout(resolve, 450));

    expect(lastFrame(socket)).toMatchObject({ method: 'Shelly.GetStatus' });
    await connection.close();
  });

  it('does not ask again when the device already said what the command changed', async () => {
    const { connection, socket } = await running();

    const reply = call(connection, 'Switch.Set', { id: 0, on: true });
    notify(socket, 'NotifyStatus', { ts: 2, 'switch:0': { output: true } });
    answer(socket, { was_on: false });
    await reply;
    await new Promise((resolve) => setTimeout(resolve, 450));

    expect(lastFrame(socket)).toMatchObject({ method: 'Switch.Set' });
    await connection.close();
  });

  it('gives every socket a source of its own, so none takes the notifications of another', async () => {
    const first = await connect();
    const second = await connect();

    open(first.socket);
    open(second.socket);
    void call(first.connection, 'Shelly.GetStatus').catch(() => undefined);
    void call(second.connection, 'Shelly.GetStatus').catch(() => undefined);

    expect(lastFrame(first.socket)['src']).not.toBe(lastFrame(second.socket)['src']);
    await first.connection.close();
    await second.connection.close();
  });

  it('turns a call into a request frame and answers with the result', async () => {
    const { connection, socket } = await connect();

    open(socket);
    const reply = call(connection, 'Switch.Set', { id: 0, on: true });

    expect(lastFrame(socket)).toMatchObject({
      src: HUB_SOURCE,
      method: 'Switch.Set',
      params: { id: 0, on: true },
    });
    answer(socket, { was_on: false });

    await expect(reply).resolves.toEqual({ was_on: false });
    await connection.close();
  });

  it('answers a challenge with the digest the docs describe, and reuses the nonce', async () => {
    // The count goes as a number and into the hash in decimal, the way Home Assistant's client
    // sends it to every firmware; the device hashes what it was sent.
    const { connection, socket } = await connect({ host: HOST, password: 'hunter2' });

    open(socket);
    const first = call(connection, 'Shelly.GetStatus');
    fail(socket, CHALLENGE);

    const retried = lastFrame(socket);
    const auth = retried['auth'] as Record<string, unknown>;

    expect(socket.sent).toHaveLength(2);
    expect(retried['method']).toBe('Shelly.GetStatus');
    expect(auth).toMatchObject({
      realm: DEVICE,
      username: 'admin',
      nonce: 'AAAAAABn',
      nc: 1,
      algorithm: 'SHA-256',
    });
    expect(typeof auth['cnonce']).toBe('number');
    expect(auth['response']).toBe(expectedResponse(auth, 'hunter2'));
    answer(socket, STATUS);
    await expect(first).resolves.toEqual(STATUS);

    // The next request carries the nonce already, with the count moved on: no second challenge.
    void call(connection, 'Switch.Toggle', { id: 0 }).catch(() => undefined);
    expect((lastFrame(socket)['auth'] as Record<string, unknown>)['nc']).toBe(2);
    await connection.close();
  });

  it('starts counting where an older firmware says to, echoing its numeric nonce', async () => {
    // Before firmware 2.0 the challenge carried a number for a nonce and a count of its own.
    const { connection, socket } = await connect({ host: HOST, password: 'hunter2' });

    open(socket);
    const first = call(connection, 'Shelly.GetStatus');
    fail(socket, {
      code: 401,
      message: JSON.stringify({
        auth_type: 'digest',
        nonce: 1625053638,
        nc: 1,
        realm: DEVICE,
        algorithm: 'SHA-256',
      }),
    });

    const auth = lastFrame(socket)['auth'] as Record<string, unknown>;

    expect([auth['nonce'], auth['nc']]).toEqual([1625053638, 1]);
    expect(auth['response']).toBe(expectedResponse(auth, 'hunter2'));
    answer(socket, STATUS);
    await expect(first).resolves.toEqual(STATUS);
    await connection.close();
  });

  it('takes a fresh nonce when the one in use has gone stale', async () => {
    const { connection, socket } = await connect({ host: HOST, password: 'hunter2' });

    open(socket);
    const first = call(connection, 'Shelly.GetStatus');
    fail(socket, CHALLENGE);
    answer(socket, STATUS);
    await first;

    const second = call(connection, 'Switch.Toggle', { id: 0 });
    fail(socket, {
      code: 401,
      message: JSON.stringify({
        auth_type: 'digest',
        nonce: 'BBBBBBBn',
        realm: DEVICE,
        algorithm: 'SHA-256',
        stale: true,
      }),
    });
    const auth = lastFrame(socket)['auth'] as Record<string, unknown>;

    expect([auth['nonce'], auth['nc']]).toEqual(['BBBBBBBn', 1]);
    answer(socket, { was_on: true });
    await expect(second).resolves.toEqual({ was_on: true });
    await connection.close();
  });

  it('declines a call the device makes, rather than leaving it waiting', async () => {
    const { connection, socket } = await connect();

    open(socket);
    socket.options.onMessage(
      JSON.stringify({ id: 99, src: DEVICE, method: 'Hub.Hello', params: {} }),
    );

    expect(lastFrame(socket)).toEqual({
      id: 99,
      src: HUB_SOURCE,
      dst: DEVICE,
      error: { code: 500, message: 'Not Implemented' },
    });
    await connection.close();
  });

  it('gives up on a password the device refuses twice', async () => {
    const { connection, socket } = await connect({ host: HOST, password: 'wrong' });

    open(socket);
    const reply = call(connection, 'Shelly.GetStatus');
    fail(socket, CHALLENGE);
    fail(socket, CHALLENGE);

    await expect(reply).rejects.toThrow(`${HOST} refused the password`);
    await connection.close();
  });

  it('says the device asks for a password when there is none to give', async () => {
    const { connection, socket } = await connect();

    open(socket);
    const reply = call(connection, 'Shelly.GetStatus');
    fail(socket, CHALLENGE);

    await expect(reply).rejects.toThrow(`${HOST} asks for a password`);
    await connection.close();
  });

  it('passes an error that is not a challenge on, in the words the device used', async () => {
    const { connection, socket } = await connect();

    open(socket);
    const reply = call(connection, 'Switch.Set', { id: 7, on: true });
    fail(socket, { code: -105, message: 'Argument id, value 7 not found!' });

    await expect(reply).rejects.toThrow(/Argument id, value 7 not found!/);
    await connection.close();
  });

  it('resets the socket when a request is not answered and the device said nothing', async () => {
    const { connection, socket } = await connect({ host: HOST, timeoutMs: 100 });

    open(socket);
    const reply = call(connection, 'Shelly.GetStatus');

    await expect(reply).rejects.toThrow(/did not answer Shelly.GetStatus/);
    expect(socket.resets).toEqual(['request timed out']);
    await connection.close();
  });

  it('keeps the socket when the device spoke while a request went unanswered', async () => {
    // A lost answer on a live socket: resetting it would drop the notifications it carries.
    const { connection, socket } = await connect({ host: HOST, timeoutMs: 100 });

    open(socket);
    const reply = call(connection, 'Shelly.GetStatus');
    await new Promise((resolve) => setTimeout(resolve, 60));
    notify(socket, 'NotifyStatus', { ts: 1, 'switch:0': { output: true } });

    await expect(reply).rejects.toThrow(/did not answer Shelly.GetStatus/);
    expect(socket.resets).toEqual([]);
    await connection.close();
  });

  it('fails what was in flight when the socket drops, and reports down', async () => {
    const { connection, socket, statuses } = await running();

    const reply = call(connection, 'Switch.Toggle', { id: 0 });
    socket.isOpen = false;
    socket.options.onClose('going away');

    await expect(reply).rejects.toThrow(/dropped \(going away\)/);
    expect(statuses).toEqual(['up', 'down']);
    await connection.close();
  });

  it('asks for the status again after a drop, once the socket is back', async () => {
    const { connection, socket, delivered } = await running();

    socket.isOpen = false;
    socket.options.onClose('going away');
    open(socket);
    await settle();

    expect(lastFrame(socket)).toMatchObject({ method: 'Shelly.GetStatus' });
    answer(socket, { ...STATUS, 'switch:0': { ...STATUS['switch:0'], output: true } });
    await settle();

    expect(delivered).toHaveLength(2);
    expect(delivered[1]?.payload).toMatchObject({ 'switch:0': { output: true } });
    await connection.close();
  });

  it('follows a firmware update from the ask to the device back on its new version', async () => {
    const { connection, socket, delivered } = await running();

    const reply = call(connection, 'Shelly.Update', { stage: 'stable' });
    answer(socket, null);
    await reply;

    expect(delivered.at(-1)?.payload).toMatchObject({ ota: { isInstalling: true, progress: 0 } });

    notify(socket, 'NotifyEvent', {
      ts: 2,
      events: [{ component: 'sys', event: 'ota_progress', progress_percent: 42 }],
    });

    expect(delivered.at(-1)?.payload).toMatchObject({ ota: { isInstalling: true, progress: 42 } });

    // Asked again while it installs: nothing reaches the device.
    const sent = socket.sent.length;

    await expect(call(connection, 'Shelly.Update', { stage: 'stable' })).resolves.toBeNull();
    expect(socket.sent).toHaveLength(sent);

    notify(socket, 'NotifyEvent', { ts: 3, events: [{ component: 'sys', event: 'ota_success' }] });

    // Flashed, and rebooting: still installing until it is back on something new.
    expect(delivered.at(-1)?.payload).toMatchObject({ ota: { isInstalling: true, progress: 100 } });

    socket.isOpen = false;
    socket.options.onClose('rebooting');
    open(socket);
    await settle();
    answer(socket, STATUS);
    await settle();
    answer(socket, { ...INFO, ver: '1.5.0' });
    await settle();

    expect(delivered.at(-1)?.payload).toMatchObject({
      device_info: { ver: '1.5.0' },
      ota: { isInstalling: false, progress: null },
    });
    await connection.close();
  });

  it('stops showing an update as installing when the device says it failed', async () => {
    const { connection, socket, delivered } = await running();

    notify(socket, 'NotifyEvent', { ts: 2, events: [{ component: 'sys', event: 'ota_begin' }] });

    expect(delivered.at(-1)?.payload).toMatchObject({ ota: { isInstalling: true, progress: 0 } });

    notify(socket, 'NotifyEvent', { ts: 3, events: [{ component: 'sys', event: 'ota_error' }] });

    expect(delivered.at(-1)?.payload).toMatchObject({ ota: { isInstalling: false } });
    await connection.close();
  });

  it('refuses an op it does not know', async () => {
    const { connection } = await connect();

    await expect(
      connection.send({ deviceKey: HOST, op: 'publish', args: {} }, new AbortController().signal),
    ).rejects.toThrow(/does not know the publish op/);
    await connection.close();
  });

  it('closes its socket when closed', async () => {
    const { connection, socket } = await running();

    await connection.close();

    expect(socket.closes).toBe(1);
  });
});

describe('finding and testing a device', () => {
  it('scans by asking the one address who it is, over a socket it closes again', async () => {
    const { transport, sockets } = build();
    const found: unknown[] = [];
    const info = {
      id: 'shelly1pmg3-aabbcc',
      model: 'S3SW-001P16EU',
      gen: 3,
      app: '1PMG3',
      ver: '1.4.4',
      auth_en: false,
    };
    const scanning = (async (): Promise<void> => {
      for await (const each of transport.scan(
        { host: HOST },
        { probe: { op: 'call', args: { method: 'Shelly.GetDeviceInfo' } } },
        new AbortController().signal,
      )) {
        found.push(each);
      }
    })();

    await settle();
    const socket = sockets[0];

    if (socket === undefined) {
      throw new Error('The transport opened no socket');
    }

    expect(socket.options.reconnect).toBe(false);
    open(socket);
    await settle();
    expect(lastFrame(socket)).toMatchObject({ method: 'Shelly.GetDeviceInfo' });
    answer(socket, info);
    await scanning;

    expect(found).toEqual([{ deviceKey: HOST, payload: info }]);
    expect(socket.closes).toBe(1);
  });

  it('finds nothing at an address that never opens', async () => {
    const { transport, sockets } = build();
    const found: unknown[] = [];
    const scanning = (async (): Promise<void> => {
      for await (const each of transport.scan({ host: HOST }, {}, new AbortController().signal)) {
        found.push(each);
      }
    })();

    await settle();
    sockets[0]?.options.onClose('ECONNREFUSED');
    await scanning;

    expect(found).toEqual([]);
  });

  it('tests an address by asking who it is, and names the model', async () => {
    const { transport, sockets } = build();
    const probing = transport.probe({ host: HOST }, new AbortController().signal);

    await settle();
    const socket = sockets[0];

    if (socket === undefined) {
      throw new Error('The transport opened no socket');
    }

    open(socket);
    await settle();
    answer(socket, { model: 'S3DM-0010WW', ver: '1.5.0', auth_en: false });

    await expect(probing).resolves.toBe(`${HOST} answered: S3DM-0010WW, firmware 1.5.0`);
    expect(socket.closes).toBe(1);
  });

  it('fails the test when the device wants a password nobody typed', async () => {
    const { transport, sockets } = build();
    const probing = transport.probe({ host: HOST }, new AbortController().signal);

    await settle();
    const socket = sockets[0];

    if (socket === undefined) {
      throw new Error('The transport opened no socket');
    }

    open(socket);
    await settle();
    answer(socket, { model: 'S3DM-0010WW', ver: '1.5.0', auth_en: true });

    await expect(probing).rejects.toThrow(`${HOST} asks for a password`);
  });

  it('tries the password during the test, so a wrong one fails here', async () => {
    const { transport, sockets } = build();
    const probing = transport.probe(
      { host: HOST, password: 'wrong' },
      new AbortController().signal,
    );

    await settle();
    const socket = sockets[0];

    if (socket === undefined) {
      throw new Error('The transport opened no socket');
    }

    open(socket);
    await settle();
    answer(socket, { model: 'S3DM-0010WW', ver: '1.5.0', auth_en: true });
    await settle();
    expect(lastFrame(socket)).toMatchObject({ method: 'Shelly.GetStatus' });
    fail(socket, CHALLENGE);
    fail(socket, CHALLENGE);

    await expect(probing).rejects.toThrow(`${HOST} refused the password`);
  });

  it('says an address did not answer, and why', async () => {
    const { transport, sockets } = build();
    const probing = transport.probe({ host: HOST }, new AbortController().signal);

    await settle();
    sockets[0]?.options.onClose('ECONNREFUSED');

    await expect(probing).rejects.toThrow(`${HOST} did not answer: ECONNREFUSED`);
  });

  it('gives up on a test the caller abandons', async () => {
    const { transport, sockets } = build();
    const controller = new AbortController();
    const probing = transport.probe({ host: HOST }, controller.signal);

    await settle();
    controller.abort();

    await expect(probing).rejects.toThrow(`${HOST} did not answer: timed out`);
    expect(sockets[0]?.closes).toBe(1);
  });
});
