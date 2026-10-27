import net from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { serialLineSchema, type SerialUsb } from '@nebulahome/contracts';
import { createLogger } from '@nebulahome/logging';
import {
  resolveDiscovery,
  vendorDiscoverySchema,
  type LoadedVendor,
} from '@nebulahome/package-runtime';

import { memorySerialStore, type SerialInstance } from '../persistence/serial.js';
import { createFakeSerialHost, type FakeSerialHost } from '../testing/serial-host.js';

import { SerialBroker, type ContainerPort } from './broker.js';
import type { SeenSerialPort } from './host.js';

/** 9600 8N1. */
const LINE = serialLineSchema.parse({ baudRate: 9600 });

/** A UPS cable: a USB serial adapter an integration's rules know. */
const UPS: SeenSerialPort = {
  devicePath: '/dev/ttyUSB0',
  stablePath: '/dev/serial/by-id/usb-INNO_TECH_USB_to_Serial-if00-port0',
  kind: 'usb',
  usb: {
    vendorId: '0665',
    productId: '5161',
    serialNumber: null,
    manufacturer: 'INNO TECH',
    product: 'USB to Serial',
  },
};

/** The PC's first UART. */
const COM1: SeenSerialPort = {
  devicePath: '/dev/ttyS0',
  stablePath: '/dev/ttyS0',
  kind: 'builtin',
  usb: null,
};

/**
 * A SkyConnect, or a plain board with the same CP210x.
 *
 * @param product - What it says it is.
 * @returns The port.
 */
function cp210x(product: string | null): SeenSerialPort {
  const usb: SerialUsb = {
    vendorId: '10c4',
    productId: 'ea60',
    serialNumber: 'a1b2',
    manufacturer: 'Nabu Casa',
    product,
  };

  return {
    devicePath: '/dev/ttyUSB1',
    stablePath: '/dev/serial/by-id/usb-Nabu_Casa-if00-port0',
    kind: 'usb',
    usb,
  };
}

/**
 * An integration that knows its UPSes by the USB strings of their cable.
 *
 * @returns The vendor, as the loader hands it over.
 */
function upsVendor(): LoadedVendor {
  return {
    manifest: { id: 'acme-ups', name: 'Acme UPS' },
    drivers: [],
    discovery: {
      plan: resolveDiscovery(
        'acme-ups',
        vendorDiscoverySchema.parse({
          serial: { match: [{ path: 'vendorId', equals: '0665' }] },
        }),
        [{ id: 'ups', name: 'UPS', kind: 'serial', transport: 'acme-ups/line', models: [] }],
      ),
      sources: [],
    },
  } as unknown as LoadedVendor;
}

/**
 * A device of the UPS integration whose config names a port.
 *
 * @param id - Its instance.
 * @param portId - The port.
 * @param state - How its instance stands.
 * @returns It.
 */
function device(id: string, portId: string, state = 'running'): SerialInstance {
  return {
    id,
    kind: 'acme-ups/ups',
    name: `UPS ${id}`,
    areaId: null,
    state,
    config: { portId, line: LINE },
  };
}

let broker: SerialBroker | undefined;

afterEach(async () => {
  await broker?.stop();
  broker = undefined;
});

/**
 * A broker over a fake machine, its store in memory.
 *
 * @param host - The machine.
 * @param options - The devices, the containers' ports, and whether Docker is Desktop.
 * @param options.instances - The devices whose config names a port.
 * @param options.containers - The devices the containers are given.
 * @param options.isDesktop - Whether Docker runs in Docker Desktop.
 * @returns The broker, started.
 */
async function started(
  host: FakeSerialHost,
  options: {
    instances?: SerialInstance[];
    containers?: ContainerPort[];
    isDesktop?: boolean;
  } = {},
): Promise<SerialBroker> {
  broker = new SerialBroker({
    store: memorySerialStore(),
    host,
    logger: createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' }),
    vendors: () => [upsVendor()],
    // Read when asked: a test adds devices once it knows their port's id.
    instances: async () => Promise.resolve(options.instances ?? []),
    containerPorts: async () => Promise.resolve(options.containers ?? []),
    isDesktop: async () => Promise.resolve(options.isDesktop ?? false),
    rescanMs: 0,
  });
  await broker.start();

  return broker;
}

/**
 * The id the broker gave a port.
 *
 * @param serial - The broker.
 * @param stablePath - The port's path.
 * @returns Its id.
 */
async function idOf(serial: SerialBroker, stablePath: string): Promise<string> {
  const port = (await serial.ports()).find((each) => each.path === stablePath);

  if (port === undefined) {
    throw new Error(`No port at ${stablePath}`);
  }

  return port.id;
}

describe('the ports the broker sees', () => {
  it('lists USB ports by their strings, and built-in ones only when asked', async () => {
    const serial = await started(createFakeSerialHost([UPS, COM1]));

    expect(await serial.ports()).toMatchObject([
      {
        kind: 'usb',
        name: 'INNO TECH USB to Serial',
        path: UPS.stablePath,
        devicePath: '/dev/ttyUSB0',
        holder: null,
        isConnected: true,
      },
    ]);
    expect(await serial.status()).toMatchObject({
      state: 'running',
      access: 'ok',
      ports: { seen: 1, inUse: 0 },
      hotplug: { isWatching: true, lastChangeAt: null },
    });

    await serial.saveSettings({ showBuiltin: true });

    // By name: a port that says nothing is named by its path.
    expect((await serial.ports()).map((port) => port.name)).toEqual([
      '/dev/ttyS0',
      'INNO TECH USB to Serial',
    ]);
  });

  it('says it has no hardware when the container sees no port, and why on Docker Desktop', async () => {
    const none = await started(createFakeSerialHost());

    expect(await none.status()).toMatchObject({ state: 'unavailable', access: 'none' });
    await none.stop();

    const desktop = await started(createFakeSerialHost(), { isDesktop: true });

    // The supervisor is asked without holding the scan: its answer counts from the next one.
    await desktop.rescan();
    expect(await desktop.status()).toMatchObject({ state: 'unavailable', access: 'desktop' });

    // A port on the network is something to hold.
    await desktop.saveNetworkPort({
      name: 'Meter bridge',
      host: '192.168.1.50',
      port: 6638,
      protocol: 'raw',
    });
    expect((await desktop.status()).state).toBe('running');
  });

  it('keeps a port’s id and holder while it is unplugged, and says when it comes back', async () => {
    const host = createFakeSerialHost([UPS]);
    const instances: SerialInstance[] = [];
    const serial = await started(host, { instances });
    const portId = await idOf(serial, UPS.stablePath);
    const plugged: string[] = [];

    instances.push(device('ups-1', portId));

    serial.onPlugged((port) => plugged.push(port.id));
    expect(await serial.claim('ups-1', { portId, line: LINE })).toBe(true);

    const session = await serial.openForVendor('acme-ups', portId, LINE);
    const reasons: string[] = [];

    session.onClose((reason) => reasons.push(reason));
    host.unplug('/dev/ttyUSB0');
    await serial.rescan();

    expect(reasons).toEqual(['Unplugged']);
    expect(await serial.port(portId)).toMatchObject({
      isConnected: false,
      devicePath: null,
      holder: { kind: 'device', deviceId: 'ups-1' },
      line: LINE,
    });
    expect((await serial.status()).hotplug.lastChangeAt).not.toBeNull();
    await expect(serial.openForVendor('acme-ups', portId, LINE)).rejects.toMatchObject({
      name: 'SerialPortMissing',
    });

    host.ports = [{ ...UPS, devicePath: '/dev/ttyUSB3' }];
    await serial.rescan();

    expect(plugged).toEqual([portId]);
    expect(await serial.port(portId)).toMatchObject({
      isConnected: true,
      devicePath: '/dev/ttyUSB3',
      holder: { deviceId: 'ups-1' },
    });
  });
});

describe('who holds a port', () => {
  it('opens a port once, for a device of the vendor that holds it', async () => {
    const host = createFakeSerialHost([UPS, cp210x(null)]);
    const instances: SerialInstance[] = [];
    const serial = await started(host, { instances });
    const portId = await idOf(serial, UPS.stablePath);
    const free = await idOf(serial, cp210x(null).stablePath);

    instances.push(device('ups-1', portId));

    await serial.claim('ups-1', { portId, line: LINE });

    const session = await serial.openForVendor('acme-ups', portId, { baudRate: 2400 });

    expect(host.opened.get('/dev/ttyUSB0')?.line).toMatchObject({ baudRate: 2400, dataBits: 8 });
    await expect(serial.openForVendor('acme-ups', portId, LINE)).rejects.toMatchObject({
      name: 'SerialPortHeld',
    });
    await expect(serial.openForVendor('other', portId, LINE)).rejects.toMatchObject({
      name: 'SerialPortHeld',
    });
    await expect(serial.openForVendor('acme-ups', free, LINE)).rejects.toMatchObject({
      name: 'SerialPortHeld',
    });
    await expect(serial.openConsole(portId, LINE)).rejects.toMatchObject({
      name: 'ConflictError',
    });
    // Another device's claim leaves it with the first.
    expect(await serial.claim('ups-2', { portId, line: LINE })).toBe(false);

    await session.close();
    await expect(session.write(Uint8Array.of(1))).rejects.toMatchObject({ name: 'SerialClosed' });

    const again = await serial.openForVendor('acme-ups', portId, LINE);

    await again.write(Uint8Array.of(0x51, 0x31, 0x0d));
    expect(host.opened.get('/dev/ttyUSB0')?.written).toEqual([Buffer.from('Q1\r')]);
  });

  it('closes a stopped device’s port and frees a removed device’s', async () => {
    const host = createFakeSerialHost([UPS]);
    const instances: SerialInstance[] = [];
    const serial = await started(host, { instances });
    const portId = await idOf(serial, UPS.stablePath);

    instances.push(device('ups-1', portId));

    await serial.claim('ups-1', { portId, line: LINE });
    await serial.openForVendor('acme-ups', portId, LINE);
    await serial.stopped('ups-1');

    expect(host.opened.get('/dev/ttyUSB0')?.isOpen()).toBe(false);
    expect((await serial.port(portId)).holder?.deviceId).toBe('ups-1');

    await serial.releaseInstance('ups-1');
    expect((await serial.port(portId)).holder).toBeNull();
  });

  it('shows a container’s port held and read-only, and a broker’s port as the broker’s', async () => {
    const serial = await started(createFakeSerialHost([UPS, cp210x('SkyConnect v1.0')]), {
      containers: [{ host: UPS.stablePath, vendorId: 'zigbee', name: 'zigbee2mqtt' }],
    });
    const held = await idOf(serial, UPS.stablePath);
    const radio = await idOf(serial, cp210x(null).stablePath);

    expect((await serial.port(held)).holder).toMatchObject({
      kind: 'container',
      container: 'zigbee2mqtt',
      vendorId: 'zigbee',
    });
    await expect(serial.release(held)).rejects.toMatchObject({ name: 'ConflictError' });
    await expect(serial.claimForBroker('thread', held)).rejects.toMatchObject({
      name: 'ConflictError',
    });

    expect(await serial.claimForBroker('thread', radio)).toEqual({
      stablePath: cp210x(null).stablePath,
      devicePath: '/dev/ttyUSB1',
    });
    expect((await serial.port(radio)).holder).toMatchObject({
      kind: 'broker',
      broker: 'thread',
      name: 'Thread broker',
    });
    expect((await serial.status()).ports.inUse).toBe(2);

    await serial.releaseBroker('thread');
    expect((await serial.port(radio)).holder).toBeNull();
  });

  it('says which ports two devices want, and how many devices run', async () => {
    const instances: SerialInstance[] = [];
    const serial = await started(createFakeSerialHost([UPS]), { instances });
    const portId = await idOf(serial, UPS.stablePath);

    instances.push(device('ups-1', portId), device('ups-2', portId, 'failed'));
    await serial.claim('ups-1', { portId, line: LINE });

    expect(await serial.status()).toMatchObject({
      conflicts: [
        {
          portId,
          name: 'ttyUSB0',
          wantedBy: [
            { deviceId: 'ups-1', name: 'UPS ups-1' },
            { deviceId: 'ups-2', name: 'UPS ups-2' },
          ],
        },
      ],
      devices: { total: 2, online: 1 },
    });
    expect(
      (await serial.devices()).map(({ deviceId, portName, isOnline }) => [
        deviceId,
        portName,
        isOnline,
      ]),
    ).toEqual([
      ['ups-1', 'INNO TECH USB to Serial', true],
      ['ups-2', 'INNO TECH USB to Serial', false],
    ]);
  });
});

describe('suggestions', () => {
  it('names a port by an integration’s rules, and a known radio as Thread’s', async () => {
    const serial = await started(createFakeSerialHost([UPS, cp210x('SkyConnect v1.0')]));
    const ports = await serial.ports();

    expect(ports.find((port) => port.path === UPS.stablePath)?.claims).toEqual([
      {
        kind: 'integration',
        vendorId: 'acme-ups',
        vendorName: 'Acme UPS',
        driverKind: 'acme-ups/ups',
        model: 'UPS',
      },
    ]);
    expect(ports.find((port) => port.devicePath === '/dev/ttyUSB1')?.claims).toEqual([
      { kind: 'broker', broker: 'thread', model: 'SkyConnect v1.0' },
    ]);
  });

  it('does not take any CP210x board for a radio', async () => {
    const serial = await started(createFakeSerialHost([cp210x('CP2102N USB to UART Bridge')]));

    expect((await serial.ports())[0]?.claims).toEqual([]);
  });
});

describe('the console', () => {
  it('holds a free port, keeps a ring of what it said and sent, and lets go when closed', async () => {
    const host = createFakeSerialHost([UPS]);
    const serial = await started(host);
    const portId = await idOf(serial, UPS.stablePath);
    const opened = await serial.openConsole(portId, LINE);
    const port = host.opened.get('/dev/ttyUSB0');

    expect((await serial.port(portId)).holder).toMatchObject({ kind: 'console', name: 'Console' });
    await expect(serial.claim('ups-1', { portId, line: LINE })).resolves.toBe(false);

    for (let index = 0; index < 1005; index += 1) {
      port?.say(Uint8Array.of(index & 0xff));
    }

    const first = serial.readConsole(opened.consoleId, undefined);

    expect(first.chunks).toHaveLength(1000);
    expect(first.chunks[0]).toMatchObject({ seq: 6, direction: 'in', data: '05' });
    expect(first).toMatchObject({ cursor: 1005, isTruncated: true, isOpen: true, error: null });

    expect(await serial.writeConsole(opened.consoleId, '5131', 'crlf')).toBe(4);
    expect(port?.written).toEqual([Buffer.from('Q1\r\n')]);

    const next = serial.readConsole(opened.consoleId, first.cursor);

    expect(next).toMatchObject({ cursor: 1006, isTruncated: false });
    expect(next.chunks).toMatchObject([{ seq: 1006, direction: 'out', data: '51310d0a' }]);
    expect(serial.readConsole(opened.consoleId, next.cursor)).toMatchObject({
      chunks: [],
      cursor: 1006,
    });

    expect(await serial.closeConsole(opened.consoleId)).toBe(true);
    expect(port?.isOpen()).toBe(false);
    expect((await serial.port(portId)).holder).toBeNull();
    expect(() => serial.readConsole(opened.consoleId, undefined)).toThrow(/no serial console/u);
  });

  it('says when its port went away', async () => {
    const host = createFakeSerialHost([UPS]);
    const serial = await started(host);
    const portId = await idOf(serial, UPS.stablePath);
    const opened = await serial.openConsole(portId, LINE);

    host.unplug('/dev/ttyUSB0');

    expect(serial.readConsole(opened.consoleId, undefined)).toMatchObject({
      isOpen: false,
      error: 'Unplugged',
    });
    await expect(serial.writeConsole(opened.consoleId, '00', 'none')).rejects.toMatchObject({
      name: 'ConflictError',
    });
  });
});

describe('ports on the network', () => {
  it('keeps one port per address and forgets it, refusing to forget one plugged in', async () => {
    const serial = await started(createFakeSerialHost([UPS]));
    const saved = await serial.saveNetworkPort({
      name: 'Meter bridge',
      host: '192.168.1.50',
      port: 6638,
      protocol: 'rfc2217',
    });

    expect(saved).toMatchObject({
      kind: 'network',
      path: 'tcp://192.168.1.50:6638',
      network: { host: '192.168.1.50', port: 6638, protocol: 'rfc2217' },
    });
    await expect(
      serial.saveNetworkPort({ name: 'Again', host: '192.168.1.50', port: 6638, protocol: 'raw' }),
    ).rejects.toMatchObject({ name: 'ConflictError' });
    await expect(serial.forget(await idOf(serial, UPS.stablePath))).rejects.toMatchObject({
      name: 'ConflictError',
    });
    expect(await serial.forget(saved.id)).toBe(true);
    expect(await serial.forget(saved.id)).toBe(false);
  });

  it('tests and opens one over TCP, and says when it does not answer', async () => {
    const received: Buffer[] = [];
    const server = net.createServer((socket) => {
      socket.on('data', (chunk: Buffer) => received.push(chunk));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });

    const { port } = server.address() as net.AddressInfo;
    const instances: SerialInstance[] = [];
    const serial = await started(createFakeSerialHost(), { instances });

    expect(
      await serial.testNetworkPort({ host: '127.0.0.1', port, protocol: 'raw' }),
    ).toMatchObject({ isConnected: true, error: null });

    const saved = await serial.saveNetworkPort({
      name: 'Meter bridge',
      host: '127.0.0.1',
      port,
      protocol: 'raw',
    });

    instances.push(device('meter-1', saved.id));
    await serial.claim('meter-1', { portId: saved.id, line: LINE });

    const session = await serial.openForVendor('acme-ups', saved.id, LINE);

    await session.write(Uint8Array.of(0x2f, 0x3f, 0x21));
    await session.close();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });

    expect(Buffer.concat(received)).toEqual(Buffer.from('/?!'));
    await expect(serial.openForVendor('acme-ups', saved.id, LINE)).rejects.toMatchObject({
      name: 'SerialPortMissing',
    });
    expect(await serial.port(saved.id)).toMatchObject({ isConnected: false });
    expect(
      await serial.testNetworkPort({ host: '127.0.0.1', port, protocol: 'raw' }),
    ).toMatchObject({ isConnected: false, ms: null });
  });
});
