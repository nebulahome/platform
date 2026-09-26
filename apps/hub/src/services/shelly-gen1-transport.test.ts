/**
 * The Shelly Gen1 transport, against a device in this process that speaks the Gen1 HTTP API.
 *
 * Nothing here touches a device. The HTTP side is a `node:http` server answering `/shelly`,
 * `/status` and `/relay/0` the way the Gen1 docs show them, behind basic authentication when the
 * test switches a login on; the CoIoT side is the SDK's UDP socket, faked, so a status packet is
 * handed to the transport as the hub's socket would hand it. What is checked is what the
 * transport promises: the status read on connect with the energy in watt-hours, a read right after
 * a command, a read when the device's CoIoT packet says it changed - and not when it repeats
 * itself - the poll's interval, and the login. Whether the firmware still speaks this dialect is
 * the one thing a test cannot settle; the bundle's README says what has not met a device.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createLogger, type PlatformLogger } from '@nebula-home/logging';
import {
  defineStreamSource,
  defineTransport,
  type BundleSdk,
  type ManagedUdpSocket,
  type ManagedUdpSocketOptions,
  type Transport,
  type TransportConnection,
  type TransportFactory,
  type TransportInbound,
  type TransportStatus,
} from '@nebula-home/package-runtime';

/** The bundle's Gen1 directory, where the loader imports its modules from. */
const GEN1 = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../bundles/shelly/gen1');

/** What the CoIoT module exports, as far as the test reads it. */
type CoiotModule = {
  readonly parseCoiotStatus: (
    bytes: Buffer,
  ) => { deviceType?: string; deviceId?: string; serial?: number } | undefined;
};

/** The factory the transport module exports, read the way the loader reads it. */
let createShellyGen1: TransportFactory;

/** The CoIoT module, for its parser. */
let coiot: CoiotModule;

/** The device's MAC, as `/shelly` and `/status` report it. */
const MAC = 'A4CF12F45CC4';

/** The login the device asks for when the test switches one on. */
const LOGIN = { username: 'admin', password: 'secret' };

/** One request the device heard. */
type Heard = {
  readonly path: string;
  readonly query: Record<string, string>;
  readonly authorization: string | undefined;
};

/** What the simulated device is doing, and what it heard. */
const device = {
  isOn: false,
  isLoginOn: false,
  heard: [] as Heard[],
};

let server: Server;
let host: string;

/**
 * Answers one request the way a Gen1 1PM does.
 *
 * @param request - What came in.
 * @param response - Where the answer goes.
 */
function answer(request: IncomingMessage, response: ServerResponse): void {
  const url = new URL(request.url ?? '/', 'http://device');
  const authorization = request.headers.authorization;
  const expected = `Basic ${Buffer.from(`${LOGIN.username}:${LOGIN.password}`).toString('base64')}`;

  device.heard.push({
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    authorization,
  });

  /**
   * Sends JSON.
   *
   * @param body - What to send.
   */
  const json = (body: unknown): void => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  };

  if (url.pathname === '/shelly') {
    // Answers without a login, even with one switched on: the docs say so.
    json({ type: 'SHSW-PM', mac: MAC, auth: device.isLoginOn, fw: '20230913-112003/v1.14.0' });

    return;
  }

  if (device.isLoginOn && authorization !== expected) {
    response.writeHead(401);
    response.end('401 Unauthorized');

    return;
  }

  if (url.pathname === '/status') {
    json({
      relays: [{ ison: device.isOn, has_timer: false, overpower: false, source: 'http' }],
      meters: [{ power: device.isOn ? 42.5 : 0, is_valid: true, total: 600 }],
      tmp: { tC: 41.2, tF: 106.2, is_valid: true },
      update: { status: 'idle', has_update: false },
      mac: MAC,
    });

    return;
  }

  if (url.pathname === '/relay/0') {
    const turn = url.searchParams.get('turn');

    device.isOn = turn === 'toggle' ? !device.isOn : turn === 'on';
    json({ ison: device.isOn, has_timer: false, source: 'http' });

    return;
  }

  if (url.pathname === '/light/0') {
    json({ ison: true, brightness: Number(url.searchParams.get('brightness')) });

    return;
  }

  response.writeHead(404);
  response.end();
}

beforeAll(async () => {
  const loaded = (await import(pathToFileURL(path.join(GEN1, 'transport.js')).href)) as {
    default: TransportFactory;
  };

  createShellyGen1 = loaded.default;
  coiot = (await import(pathToFileURL(path.join(GEN1, 'coiot.js')).href)) as CoiotModule;

  server = createServer(answer);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  host = `127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  device.isOn = false;
  device.isLoginOn = false;
  device.heard = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * A logger that writes nowhere.
 *
 * @returns A logger bound to a discarding stream.
 */
function silent(): PlatformLogger {
  return createLogger(
    { service: 'hub-shelly-gen1', version: '0.0.0', level: 'fatal' },
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

/** The UDP socket the transport asked the SDK for. */
type FakeUdp = { options: ManagedUdpSocketOptions; closes: number };

/**
 * Builds the transport with a UDP opener that records the socket instead of binding one.
 *
 * @returns The transport and the sockets it opened.
 */
function build(): { transport: Transport; sockets: FakeUdp[] } {
  const sockets: FakeUdp[] = [];
  const sdk: BundleSdk = {
    version: '1.0.0',
    z,
    logger: silent(),
    defineTransport,
    openWebSocket: () => {
      throw new Error('A Gen1 speaks no WebSocket');
    },
    openUdpSocket: (options): ManagedUdpSocket => {
      const fake: FakeUdp = { options, closes: 0 };

      sockets.push(fake);

      return {
        port: 5683,
        send: (): Promise<void> => Promise.reject(new Error('CoIoT is only listened to')),
        close: (): Promise<void> => {
          fake.closes += 1;

          return Promise.resolve();
        },
      };
    },
    openMqtt: () => {
      throw new Error('A Gen1 speaks no MQTT here');
    },
    defineStreamSource,
    openRtsp: () => {
      throw new Error('not opened in this test');
    },
  };

  return { transport: createShellyGen1(sdk), sockets };
}

/** What a connection delivered and reported. */
type Observed = { delivered: TransportInbound[]; statuses: TransportStatus[] };

/**
 * Opens a connection to the simulated device.
 *
 * @param transport - The transport.
 * @param config - What the owner typed, beyond the address.
 * @returns The connection, and what it delivers.
 */
async function connect(
  transport: Transport,
  config: Record<string, unknown> = {},
): Promise<{ connection: TransportConnection } & Observed> {
  const delivered: TransportInbound[] = [];
  const statuses: TransportStatus[] = [];
  const connection = await transport.connect(
    { host, ...config },
    {
      logger: silent(),
      deliver: (message): void => {
        delivered.push(message);
      },
      report: (status): void => {
        statuses.push(status);
      },
    },
  );

  return { connection, delivered, statuses };
}

/**
 * Waits until a condition holds, or fails after a second.
 *
 * @param condition - What to wait for.
 * @param what - What it is, for the failure.
 */
async function until(condition: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Timed out waiting for ${what}`);
}

/**
 * How many times the device was asked for its status.
 *
 * @returns The count.
 */
function statusReads(): number {
  return device.heard.filter((each) => each.path === '/status').length;
}

/**
 * Encodes a CoAP option's delta or length as a nibble and its extension.
 *
 * @param value - The delta or the length.
 * @returns The nibble and the bytes that follow the option's first byte.
 */
function nibble(value: number): { nibble: number; extension: number[] } {
  if (value < 13) {
    return { nibble: value, extension: [] };
  }

  if (value < 269) {
    return { nibble: 13, extension: [value - 13] };
  }

  return { nibble: 14, extension: [(value - 269) >> 8, (value - 269) & 0xff] };
}

/**
 * Builds a CoIoT status publish as a Gen1 multicasts it: code 0.30, URI /cit/s, the device id and
 * the serial among its options, and a payload the transport does not read.
 *
 * @param options - What differs between packets.
 * @param options.deviceId - The device id in option 3332.
 * @param options.serial - The status serial in option 3420.
 * @param options.code - The CoAP code; 30 for a status publish.
 * @param options.path - The URI path segments.
 * @returns The datagram.
 */
function coiotPacket(options: {
  deviceId: string;
  serial: number;
  code?: number;
  path?: readonly string[];
}): Buffer {
  const parts: number[] = [0x50, options.code ?? 30, 0x00, 0x2a];
  let last = 0;

  /**
   * Appends one option, its number as a delta from the last.
   *
   * @param number - The option number.
   * @param value - Its value.
   */
  const option = (number: number, value: Buffer): void => {
    const delta = nibble(number - last);
    const length = nibble(value.length);

    last = number;
    parts.push((delta.nibble << 4) | length.nibble, ...delta.extension, ...length.extension);
    parts.push(...value);
  };

  for (const segment of options.path ?? ['cit', 's']) {
    option(11, Buffer.from(segment));
  }

  option(3332, Buffer.from(`SHSW-PM#${options.deviceId}#2`));
  option(3412, Buffer.from([0x00, 0x96]));
  option(3420, Buffer.from([options.serial >> 8, options.serial & 0xff]));

  return Buffer.concat([
    Buffer.from(parts),
    Buffer.from([0xff]),
    Buffer.from('{"G":[[0,1101,1]]}'),
  ]);
}

describe('reading a CoIoT status packet', () => {
  it('reads who sent it and its serial', () => {
    expect(coiot.parseCoiotStatus(coiotPacket({ deviceId: MAC, serial: 300 }))).toEqual({
      deviceType: 'SHSW-PM',
      deviceId: MAC,
      serial: 300,
    });
  });

  it('ignores what is not a status publish', () => {
    // A description (/cit/d) and an ordinary CoAP response are on the same port.
    expect(
      coiot.parseCoiotStatus(coiotPacket({ deviceId: MAC, serial: 1, path: ['cit', 'd'] })),
    ).toBeUndefined();
    expect(coiot.parseCoiotStatus(coiotPacket({ deviceId: MAC, serial: 1, code: 69 }))).toBe(
      undefined,
    );
    expect(coiot.parseCoiotStatus(Buffer.from('not coap'))).toBeUndefined();
  });
});

describe('the Shelly Gen1 transport', () => {
  it('reads the status on connect, with the energy in watt-hours beside the watt-minutes', async () => {
    const { transport } = build();
    const { connection, delivered, statuses } = await connect(transport);

    try {
      await until(() => delivered.length > 0, 'the first status');

      const [message] = delivered;

      expect(message?.deviceKey).toBe(host);
      expect(message?.payload).toMatchObject({
        relays: [{ ison: false }],
        meters: [{ total: 600, total_wh: 10 }],
        mac: MAC,
      });
      expect(statuses).toEqual(['up']);
    } finally {
      await connection.close();
    }
  });

  it('reads the status again right after a command, which it sends as the docs word it', async () => {
    const { transport } = build();
    const { connection, delivered } = await connect(transport);

    try {
      await until(() => delivered.length > 0, 'the first status');

      const answer = await connection.send(
        { deviceKey: host, op: 'get', args: { path: '/relay/0', query: { turn: 'on' } } },
        AbortSignal.timeout(2000),
      );

      expect(answer).toMatchObject({ ison: true });
      await until(
        () => JSON.stringify(delivered.at(-1)?.payload).includes('"ison":true'),
        'the status after the command',
      );
      expect(device.heard.map((each) => each.path)).toEqual(['/status', '/relay/0', '/status']);
      expect(device.heard[1]?.query).toEqual({ turn: 'on' });
    } finally {
      await connection.close();
    }
  });

  it('reads at once when a CoIoT packet from the device says its status changed', async () => {
    const { transport, sockets } = build();
    const { connection, delivered } = await connect(transport);

    try {
      await until(() => delivered.length > 0, 'the first status');

      const [socket] = sockets;

      // One socket, on CoAP's port, in the group Gen1 devices publish to.
      expect(socket?.options).toMatchObject({
        port: 5683,
        reuseAddr: true,
        multicast: { group: '224.0.1.187' },
      });

      device.isOn = true;
      socket?.options.onMessage(coiotPacket({ deviceId: MAC, serial: 7 }), {
        address: '127.0.0.1',
        port: 5683,
      });

      await until(() => statusReads() === 2, 'the read the packet asked for');
      await until(
        () => JSON.stringify(delivered.at(-1)?.payload).includes('"ison":true'),
        'the changed status',
      );
    } finally {
      await connection.close();
    }
  });

  it('does not read for a packet that repeats its serial, or for another device', async () => {
    const { transport, sockets } = build();
    const { connection, delivered } = await connect(transport);

    try {
      await until(() => delivered.length > 0, 'the first status');

      const onMessage = sockets[0]?.options.onMessage;

      onMessage?.(coiotPacket({ deviceId: MAC, serial: 9 }), { address: '127.0.0.1', port: 5683 });
      await until(() => statusReads() === 2, 'the read the first packet asked for');

      // The periodic packet repeats the serial of the last change; another device is not ours.
      onMessage?.(coiotPacket({ deviceId: MAC, serial: 9 }), { address: '127.0.0.1', port: 5683 });
      onMessage?.(coiotPacket({ deviceId: 'AABBCC112233', serial: 10 }), {
        address: '192.168.1.99',
        port: 5683,
      });
      await new Promise((resolve) => setTimeout(resolve, 400));

      expect(statusReads()).toBe(2);
    } finally {
      await connection.close();
    }
  });

  it('knows its device by the MAC a packet carries, from an address it did not expect', async () => {
    // What the owner typed may be a name, or the device's address may have changed; the id in
    // the packet ends with the MAC the status said.
    const { transport, sockets } = build();
    const { connection, delivered } = await connect(transport);

    try {
      await until(() => delivered.length > 0, 'the first status');
      sockets[0]?.options.onMessage(coiotPacket({ deviceId: MAC, serial: 3 }), {
        address: '192.168.1.77',
        port: 5683,
      });
      await until(() => statusReads() === 2, 'the read the packet asked for');
    } finally {
      await connection.close();
    }
  });

  it('polls at the interval asked for, and never more often than every 5 s', async () => {
    const interval = vi.spyOn(globalThis, 'setInterval');
    const { transport } = build();
    const { connection, delivered } = await connect(transport);

    try {
      await until(() => delivered.length > 0, 'the first status');
      await connection.apply([{ op: 'poll', args: { deviceKey: host, everyMs: 30_000 } }]);
      await connection.apply([{ op: 'poll', args: { deviceKey: host, everyMs: 1000 } }]);

      expect(interval.mock.calls.map((call) => call[1])).toEqual([30_000, 5000]);

      // What the timer runs is a read of the status.
      const before = statusReads();
      const tick = interval.mock.calls.at(-1)?.[0] as () => void;

      tick();
      await until(() => statusReads() === before + 1, 'the polled read');
    } finally {
      await connection.close();
    }
  });

  it('sends basic authentication when the owner gave a password', async () => {
    device.isLoginOn = true;

    const { transport } = build();
    const { connection, delivered } = await connect(transport, LOGIN);

    try {
      await until(() => delivered.length > 0, 'the first status');

      expect(device.heard[0]?.authorization).toBe(
        `Basic ${Buffer.from('admin:secret').toString('base64')}`,
      );
    } finally {
      await connection.close();
    }
  });

  it('says the device is down when the login is refused', async () => {
    device.isLoginOn = true;

    const { transport } = build();
    const { connection, statuses } = await connect(transport, { ...LOGIN, password: 'wrong' });

    try {
      await until(() => statuses.length > 0, 'the health report');

      expect(statuses).toEqual(['down']);
    } finally {
      await connection.close();
    }
  });

  it('holds a brightness to 1-100 and a position to whole percents, as the API accepts', async () => {
    const { transport } = build();
    const { connection, delivered } = await connect(transport);

    try {
      await until(() => delivered.length > 0, 'the first status');
      await connection.send(
        { deviceKey: host, op: 'get', args: { path: '/light/0', query: { brightness: 0 } } },
        AbortSignal.timeout(2000),
      );
      await connection.send(
        { deviceKey: host, op: 'get', args: { path: '/light/0', query: { brightness: 37.6 } } },
        AbortSignal.timeout(2000),
      );

      expect(
        device.heard.filter((each) => each.path === '/light/0').map((each) => each.query),
      ).toEqual([{ brightness: '1' }, { brightness: '38' }]);
    } finally {
      await connection.close();
    }
  });

  it('refuses an op or a path it does not speak', async () => {
    const { transport } = build();
    const { connection } = await connect(transport);

    try {
      await expect(
        connection.send(
          { deviceKey: host, op: 'call', args: { method: 'Switch.Set' } },
          AbortSignal.timeout(2000),
        ),
      ).rejects.toThrow(/does not know the call op/u);
      await expect(
        connection.send(
          { deviceKey: host, op: 'get', args: { path: 'http://elsewhere/' } },
          AbortSignal.timeout(2000),
        ),
      ).rejects.toThrow(/no path/u);
    } finally {
      await connection.close();
    }
  });

  it('closes the CoIoT socket with the last connection', async () => {
    const { transport, sockets } = build();
    const first = await connect(transport);
    const second = await connect(transport);

    await first.connection.close();

    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.closes).toBe(0);

    await second.connection.close();

    expect(sockets[0]?.closes).toBe(1);
  });

  it('answers a scan with what GET /shelly said', async () => {
    const { transport } = build();
    const found = [];

    for await (const each of transport.scan(
      { host },
      { probe: { op: 'get', args: { path: '/shelly' } } },
      AbortSignal.timeout(2000),
    )) {
      found.push(each);
    }

    expect(found).toEqual([
      {
        deviceKey: host,
        payload: { type: 'SHSW-PM', mac: MAC, auth: false, fw: '20230913-112003/v1.14.0' },
      },
    ]);
  });

  it('tests an address by who answers, and a login by the status it opens', async () => {
    const { transport } = build();

    await expect(transport.probe({ host }, AbortSignal.timeout(2000))).resolves.toBe(
      `${host} answered: SHSW-PM, firmware 20230913-112003/v1.14.0`,
    );

    device.isLoginOn = true;

    await expect(transport.probe({ host }, AbortSignal.timeout(2000))).rejects.toThrow(
      'asks for a username and password',
    );
    await expect(
      transport.probe({ host, ...LOGIN, password: 'wrong' }, AbortSignal.timeout(2000)),
    ).rejects.toThrow('refused the username or password');
    await expect(transport.probe({ host, ...LOGIN }, AbortSignal.timeout(2000))).resolves.toMatch(
      /answered: SHSW-PM/u,
    );
  });

  it('says so when nothing answers at the address', async () => {
    const { transport } = build();

    await expect(
      transport.probe({ host: '127.0.0.1:1', timeoutMs: 500 }, AbortSignal.timeout(2000)),
    ).rejects.toThrow(/127\.0\.0\.1:1 did not answer/u);
  });
});
