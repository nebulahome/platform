import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import type { MatterNetwork, PlatformServiceRequest, ThreadStatus } from '@nebulahome/contracts';
import { createLogger, type PlatformLogger } from '@nebulahome/logging';
import type { MdnsAnnouncement } from '@nebulahome/package-runtime';

import type { MdnsSource } from '../discovery/mdns-source.js';
import type { BluetoothInstance } from '../persistence/bluetooth.js';
import { memorySerialStore } from '../persistence/serial.js';
import { memoryThreadStore, type ThreadStore } from '../persistence/thread.js';
import { SerialBroker } from '../serial/broker.js';
import type { SeenSerialPort } from '../serial/host.js';
import { FAKE_TLVS, startFakeOtbr, type FakeOtbr } from '../testing/otbr-server.js';
import { createFakeSerialHost, type FakeSerialHost } from '../testing/serial-host.js';

import { ThreadBroker } from './broker.js';
import { createLinuxThreadHost, OTBR_CONF } from './host.js';
import { encodeHdlc, NCP_VERSION_QUESTION } from './spinel.js';

/**
 * A logger that writes nowhere.
 *
 * @returns The logger.
 */
function silent(): PlatformLogger {
  return createLogger(
    { service: 'hub-thread', version: '0.0.0', level: 'fatal' },
    new Writable({
      write(chunk, encoding, done): void {
        done();
      },
    }),
  );
}

/** A SkyConnect, as the Serial broker sees it. */
const SKYCONNECT: SeenSerialPort = {
  devicePath: '/dev/ttyUSB0',
  stablePath: '/dev/serial/by-id/usb-Nabu_Casa_SkyConnect_v1.0_a1b2-if00-port0',
  kind: 'usb',
  usb: {
    vendorId: '10c4',
    productId: 'ea60',
    serialNumber: 'a1b2',
    manufacturer: 'Nabu Casa',
    product: 'SkyConnect v1.0',
  },
};

/** A plain USB serial cable. */
const CABLE: SeenSerialPort = {
  devicePath: '/dev/ttyUSB1',
  stablePath: '/dev/serial/by-id/usb-FTDI_FT232R-if00-port0',
  kind: 'usb',
  usb: {
    vendorId: '0403',
    productId: '6001',
    serialNumber: null,
    manufacturer: 'FTDI',
    product: 'FT232R USB UART',
  },
};

/** Thread's answer to the version question. */
const RCP_ANSWER = encodeHdlc(
  Uint8Array.from([0x81, 0x06, 0x02, ...Buffer.from('SL-OPENTHREAD/2.4.4.0; EFR32'), 0]),
);

/** The Matter fabric's view of a small Thread network. */
const MATTER_NETWORK: MatterNetwork = {
  collectedAt: new Date('2026-10-28T10:00:00Z'),
  nodes: [
    {
      id: '4',
      kind: 'matter',
      network: 'thread',
      nodeId: '4',
      role: 'router',
      isAvailable: true,
      isBridge: false,
      networkName: 'Casa',
      channel: 15,
      ssid: null,
      bssid: null,
      extAddress: 'AA00000000000004',
    },
    {
      id: '7',
      kind: 'matter',
      network: 'thread',
      nodeId: '7',
      role: 'sleepy_end_device',
      isAvailable: false,
      isBridge: false,
      networkName: 'Casa',
      channel: 15,
      ssid: null,
      bssid: null,
      extAddress: 'AA00000000000007',
    },
    {
      id: '2',
      kind: 'matter',
      network: 'wifi',
      nodeId: '2',
      role: 'station',
      isAvailable: true,
      isBridge: false,
      networkName: null,
      channel: 6,
      ssid: 'Casa',
      bssid: null,
      extAddress: null,
    },
    {
      id: 'unknown_BB00000000000001',
      kind: 'thread_unknown',
      network: 'thread',
      nodeId: null,
      role: 'router',
      isAvailable: null,
      isBridge: false,
      networkName: null,
      channel: null,
      ssid: null,
      bssid: null,
      extAddress: 'BB00000000000001',
    },
  ],
  links: [
    { source: '7', target: '4', network: 'thread', strength: 'medium', lqi: 2, rssi: -78 },
    {
      source: '4',
      target: 'unknown_BB00000000000001',
      network: 'thread',
      strength: 'strong',
      lqi: 3,
      rssi: -60,
    },
  ],
};

/**
 * One instance of the house.
 *
 * @param id - Its instance.
 * @param externalId - The Matter node it is.
 * @param name - Its name.
 * @returns It.
 */
function instance(id: string, externalId: string, name: string): BluetoothInstance {
  return {
    id,
    kind: 'matter/generic',
    transport: 'matter',
    externalId,
    name,
    areaId: null,
    state: 'running',
    createdAt: new Date(),
  };
}

let root: string | undefined;
const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const close of closing.splice(0)) {
    await close();
  }

  if (root !== undefined) {
    await rm(root, { recursive: true, force: true });
    root = undefined;
  }
});

/**
 * A Thread broker over a fake machine: its serial ports, `/proc`, a supervisor, a border router
 * and the mDNS a test says.
 *
 * @param options - What differs from a Linux server on the host's network with a SkyConnect.
 * @param options.ports - The serial ports plugged in.
 * @param options.network - The platform's network, as the supervisor says it.
 * @param options.isDesktop - Whether Docker is Docker Desktop.
 * @param options.otbr - The border router's state at first.
 * @param options.store - The broker's store.
 * @param options.announcements - What answers `_meshcop._udp`.
 * @returns The broker and every fake under it.
 */
async function started(
  options: {
    ports?: SeenSerialPort[];
    network?: string;
    isDesktop?: boolean;
    otbr?: Parameters<typeof startFakeOtbr>[0];
    store?: ThreadStore;
    announcements?: MdnsAnnouncement[];
  } = {},
) {
  root = await mkdtemp(path.join(os.tmpdir(), 'nebula-thread-'));

  const proc = path.join(root, 'proc');
  const configDir = path.join(root, 'data', 'hub', 'thread');
  const files: Record<string, string> = {
    'net/route':
      'Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\neth0\t00000000\t0101A8C0\t0003\t0\t0\t100\t00000000',
    'sys/net/ipv6/conf/eth0/accept_ra': '1',
    'sys/net/ipv6/conf/eth0/forwarding': '1',
    'sys/net/ipv6/conf/eth0/accept_ra_rt_info_max_plen': '0',
  };

  for (const [name, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(proc, name)), { recursive: true });
    await writeFile(path.join(proc, name), text);
  }

  const otbr: FakeOtbr = await startFakeOtbr(options.otbr);

  closing.push(otbr.close);

  const serialHost: FakeSerialHost = createFakeSerialHost(options.ports ?? [SKYCONNECT, CABLE]);

  serialHost.respond = (devicePath, bytes) =>
    devicePath === SKYCONNECT.devicePath && Buffer.from(bytes).equals(NCP_VERSION_QUESTION)
      ? RCP_ANSWER
      : null;

  const serial = new SerialBroker({
    store: memorySerialStore(),
    host: serialHost,
    logger: silent(),
    vendors: () => [],
    instances: async () => Promise.resolve([]),
    containerPorts: async () => Promise.resolve([]),
    rescanMs: 0,
  });

  await serial.start();
  closing.push(async () => serial.stop());

  const supervised: PlatformServiceRequest['action'][] = [];
  const heard = { listener: undefined as ((announcement: MdnsAnnouncement) => void) | undefined };
  const mdns: MdnsSource = {
    start: (services, onAnnouncement) => {
      expect(services).toEqual(['_meshcop._udp']);
      heard.listener = onAnnouncement;
    },
    query: () => {
      for (const announcement of options.announcements ?? []) {
        heard.listener?.(announcement);
      }
    },
    stop: async () => Promise.resolve(),
  };
  let changes = 0;
  const broker = new ThreadBroker({
    store: options.store ?? memoryThreadStore(),
    host: createLinuxThreadHost({ configDir, procDir: proc, agent: path.join(root, 'none') }),
    serial,
    supervisor: {
      status: async () =>
        Promise.resolve({
          platformNetwork: options.network ?? 'host',
          isDesktop: options.isDesktop ?? false,
        }),
      service: async (action) => {
        supervised.push(action);

        return Promise.resolve();
      },
    },
    mdns,
    logger: silent(),
    matterNetwork: () => MATTER_NETWORK,
    instances: async () =>
      Promise.resolve([instance('dev-4', '4', 'Kitchen plug'), instance('dev-7', '7', 'Window')]),
    onChange: () => {
      changes += 1;
    },
    localUrl: otbr.url,
    waits: { borderRouterMs: 2000, roleMs: 2000, pollMs: 10, browseMs: 10, probeMs: 300 },
  });

  await broker.start();
  closing.push(async () => broker.stop());

  const portIdOf = async (port: SeenSerialPort): Promise<string> =>
    (await serial.ports()).find((each) => each.path === port.stablePath)?.id ?? '';

  return {
    broker,
    serial,
    serialHost,
    otbr,
    supervised,
    configDir,
    portIdOf,
    changes: () => changes,
  };
}

/**
 * Waits for the setup job to end.
 *
 * @param broker - The broker.
 * @returns The status once it ended.
 */
async function settled(broker: ThreadBroker): Promise<ThreadStatus> {
  for (let tries = 0; tries < 200; tries += 1) {
    const status = await broker.status();

    if (status.setup?.state !== 'running') {
      return status;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error('The setup did not end');
}

describe('ThreadBroker', () => {
  it('says no hardware before setup with no radio, and not set up with one', async () => {
    const { broker: bare } = await started({ ports: [] });

    await expect(bare.status()).resolves.toMatchObject({
      state: 'unavailable',
      mode: 'none',
      borderRouter: null,
      setupBlockedBy: null,
      devices: { routers: 0, total: 0, online: 0 },
    });

    const { broker } = await started();

    await expect(broker.status()).resolves.toMatchObject({ state: 'disabled', mode: 'none' });
  });

  it('lists the free ports a radio may be on, the recognised radios first', async () => {
    const { broker, portIdOf } = await started();

    await expect(broker.radios()).resolves.toEqual([
      {
        portId: await portIdOf(SKYCONNECT),
        name: 'Nabu Casa SkyConnect v1.0',
        path: SKYCONNECT.stablePath,
        model: 'SkyConnect v1.0',
        flasherUrl: 'https://toolbox.openhomefoundation.org/',
      },
      {
        portId: await portIdOf(CABLE),
        name: 'FTDI FT232R USB UART',
        path: CABLE.stablePath,
        model: null,
        flasherUrl: null,
      },
    ]);
  });

  it('asks a radio its firmware, and lets go of the port after', async () => {
    const { broker, serial, portIdOf } = await started();

    await expect(broker.checkRadio(await portIdOf(SKYCONNECT))).resolves.toEqual({
      firmware: 'openthread-rcp',
      version: 'SL-OPENTHREAD/2.4.4.0; EFR32',
      error: null,
    });
    await expect(broker.checkRadio(await portIdOf(CABLE))).resolves.toMatchObject({
      firmware: 'zigbee',
      error: expect.stringMatching(/Zigbee/u) as unknown,
    });
    expect((await serial.ports()).every((port) => port.holder === null)).toBe(true);
  });

  it('refuses to set up on a bridge network or Docker Desktop, and says why', async () => {
    const { broker, portIdOf } = await started({ network: 'bridge' });

    await expect(broker.status()).resolves.toMatchObject({ setupBlockedBy: 'bridge' });
    await expect(
      broker.setup({
        border: { mode: 'local', portId: await portIdOf(SKYCONNECT) },
        network: { action: 'create', name: 'Casa', channel: null },
        useForMatter: true,
      }),
    ).rejects.toThrow(/host's network/u);

    const { broker: desktop } = await started({ isDesktop: true });

    await expect(desktop.status()).resolves.toMatchObject({ setupBlockedBy: 'desktop' });
  });

  it('sets the platform border router up on a radio, forms a network and hands it to Matter', async () => {
    const { broker, serial, otbr, supervised, configDir, portIdOf, changes } = await started();
    const portId = await portIdOf(SKYCONNECT);

    const starting = await broker.setup({
      border: { mode: 'local', portId },
      network: { action: 'create', name: 'NebulaHome-1A2B', channel: 20 },
      useForMatter: true,
    });

    expect(starting.setup?.state).toBe('running');

    const status = await settled(broker);

    expect(status.setup).toMatchObject({ state: 'succeeded', error: null });
    expect(status.setup?.steps).toEqual([
      { id: 'border-router', state: 'done', message: null },
      { id: 'radio', state: 'done', message: 'RCP SL-OPENTHREAD/2.4.4.0; EFR32' },
      { id: 'network', state: 'done', message: 'Leader' },
      { id: 'matter', state: 'done', message: 'Handed to Matter' },
    ]);
    await expect(readFile(path.join(configDir, OTBR_CONF), 'utf8')).resolves.toBe(
      `RADIO_URL=spinel+hdlc+uart://${SKYCONNECT.stablePath}?uart-baudrate=460800\nINFRA_IF=eth0\n`,
    );
    expect(supervised).toEqual(['restart']);
    expect((await serial.port(portId)).holder).toMatchObject({ kind: 'broker', broker: 'thread' });
    // A new network: its own key and PAN, the name and channel asked for.
    expect(otbr.state.active).toMatchObject({ networkName: 'NebulaHome-1A2B', channel: 20 });
    expect(otbr.state.active?.['networkKey']).toMatch(/^[0-9a-f]{32}$/u);
    expect(otbr.state.active?.['networkKey']).not.toBe('00112233445566778899aabbccddeeff');
    expect(changes()).toBe(1);
    expect(broker.isSetUp()).toBe(true);

    expect(status).toMatchObject({
      state: 'running',
      mode: 'local',
      error: null,
      borderRouter: { isRunning: true, version: null, url: otbr.url },
      radio: {
        portId,
        path: SKYCONNECT.stablePath,
        firmware: 'SL-OPENTHREAD/2.4.4.0; EFR32',
        isConnected: true,
      },
      network: { name: 'NebulaHome-1A2B', channel: 20, role: 'leader' },
      useForMatter: true,
      ipv6: {
        isOk: false,
        interface: 'eth0',
        fixes: [
          { key: 'net.ipv6.conf.eth0.accept_ra', current: '1', wanted: '2' },
          { key: 'net.ipv6.conf.eth0.accept_ra_rt_info_max_plen', current: '0', wanted: '64' },
        ],
      },
    });
    await expect(broker.matterDataset()).resolves.toBe(FAKE_TLVS);
    await expect(broker.matterNetwork()).resolves.toEqual({
      networkName: 'NebulaHome-1A2B',
      channel: 20,
    });
  });

  it('stops on the border-router step for a radio with other firmware, and lets it go', async () => {
    const { broker, serial, serialHost, supervised, portIdOf } = await started();
    const portId = await portIdOf(SKYCONNECT);

    serialHost.respond = () => null;
    await broker.setup({
      border: { mode: 'local', portId },
      network: { action: 'create', name: 'Casa', channel: null },
      useForMatter: true,
    });

    const status = await settled(broker);

    expect(status.setup).toMatchObject({
      state: 'failed',
      error: expect.stringMatching(/other firmware/u) as unknown,
    });
    expect(status.setup?.steps.map((step) => step.state)).toEqual([
      'failed',
      'pending',
      'pending',
      'pending',
    ]);
    expect(status.mode).toBe('none');
    expect(supervised).toEqual([]);
    expect((await serial.port(portId)).holder).toBeNull();
  });

  it('uses an external border router and the network it has, which it does not restart', async () => {
    const { broker, otbr } = await started({
      otbr: {
        role: 'router',
        active: {
          networkKey: 'ffeeddccbbaa99887766554433221100',
          networkName: 'Apple',
          extPanId: '1111222233334444',
          meshLocalPrefix: 'fd00:1:2:3::/64',
          panId: 0x4321,
          channel: 25,
        },
        activeTlvs: 'aabbcc',
      },
    });

    await broker.setup({
      border: { mode: 'external', url: otbr.url },
      network: { action: 'keep' },
      useForMatter: false,
    });

    const status = await settled(broker);

    expect(status.setup?.steps.map((step) => [step.id, step.message])).toEqual([
      ['border-router', `External · ${new URL(otbr.url).host}`],
      ['radio', 'Managed by the external border router'],
      ['network', 'Router'],
      ['matter', 'Not handed to Matter'],
    ]);
    expect(status).toMatchObject({
      state: 'running',
      mode: 'external',
      radio: null,
      network: { name: 'Apple', panId: '0x4321', extPanId: '1111222233334444', role: 'router' },
    });
    await expect(broker.restart()).rejects.toThrow(/where it runs/u);
    await expect(broker.matterDataset()).resolves.toBeNull();
  });

  it('changes the name and channel as a pending dataset, and reads the secrets on demand', async () => {
    const { broker, otbr, portIdOf } = await started();

    await broker.setup({
      border: { mode: 'local', portId: await portIdOf(SKYCONNECT) },
      network: { action: 'create', name: 'Casa', channel: 15 },
      useForMatter: true,
    });
    await settled(broker);

    const status = await broker.saveSettings({ name: 'Casa', channel: 25, useForMatter: false });

    expect(otbr.state.pending).toEqual([
      {
        activeDataset: {
          activeTimestamp: { seconds: 2, ticks: 0, authoritative: false },
          channel: 25,
        },
        delay: 300_000,
      },
    ]);
    expect(status.useForMatter).toBe(false);
    await expect(broker.networkKey()).resolves.toEqual({
      networkKey: otbr.state.active?.['networkKey'],
    });
    await expect(broker.dataset()).resolves.toEqual({ dataset: FAKE_TLVS });
  });

  it('joins another network by its dataset', async () => {
    const { broker, otbr, portIdOf } = await started();

    await broker.setup({
      border: { mode: 'local', portId: await portIdOf(SKYCONNECT) },
      network: { action: 'create', name: 'Casa', channel: null },
      useForMatter: true,
    });
    await settled(broker);
    await broker.join('0E080000000000010000');

    expect(otbr.state.activeTlvs).toBe('0e080000000000010000');
    expect(otbr.state.role).toBe('leader');
  });

  it('removes the platform border router: its file first, then the service, then the radio', async () => {
    const { broker, serial, supervised, configDir, portIdOf, changes } = await started();
    const portId = await portIdOf(SKYCONNECT);

    await expect(broker.remove()).resolves.toEqual({ isRemoved: false });
    await broker.setup({
      border: { mode: 'local', portId },
      network: { action: 'create', name: 'Casa', channel: null },
      useForMatter: true,
    });
    await settled(broker);

    await expect(broker.remove()).resolves.toEqual({ isRemoved: true });
    await expect(readFile(path.join(configDir, OTBR_CONF), 'utf8')).rejects.toThrow(/ENOENT/u);
    expect(supervised).toEqual(['restart', 'stop']);
    expect((await serial.port(portId)).holder).toBeNull();
    expect(broker.isSetUp()).toBe(false);
    expect(changes()).toBe(2);
    await expect(broker.networkKey()).rejects.toThrow(/not set up/u);
  });

  it("lists the network's nodes: the house's from the Matter fabric, then the unknown ones", async () => {
    const { broker, otbr, portIdOf } = await started({
      otbr: {
        devices: [
          {
            id: 'bb00000000000001',
            type: 'threadDevice',
            attributes: { extAddress: 'bb00000000000001', role: 'router' },
          },
          {
            id: 'cc00000000000002',
            type: 'threadDevice',
            attributes: {
              extAddress: 'cc00000000000002',
              role: 'child',
              mode: { rxOnWhenIdle: false },
            },
          },
          {
            id: '0a0b0c0d0e0f1011',
            type: 'threadBorderRouter',
            attributes: { extAddress: '0a0b0c0d0e0f1011', role: 'leader' },
          },
        ],
      },
    });

    await broker.setup({
      border: { mode: 'local', portId: await portIdOf(SKYCONNECT) },
      network: { action: 'create', name: 'Casa', channel: null },
      useForMatter: true,
    });
    await settled(broker);

    await expect(broker.devices()).resolves.toEqual([
      {
        extAddress: 'aa00000000000004',
        deviceId: 'dev-4',
        name: 'Kitchen plug',
        areaId: null,
        role: 'router',
        parentExtAddress: null,
        parentName: null,
        linkQuality: 3,
        rssi: -60,
        lastSeenAt: MATTER_NETWORK.collectedAt,
      },
      {
        extAddress: 'aa00000000000007',
        deviceId: 'dev-7',
        name: 'Window',
        areaId: null,
        role: 'sleepy',
        parentExtAddress: 'aa00000000000004',
        parentName: 'Kitchen plug',
        linkQuality: 2,
        rssi: -78,
        lastSeenAt: null,
      },
      {
        extAddress: 'bb00000000000001',
        deviceId: null,
        name: null,
        areaId: null,
        role: 'router',
        parentExtAddress: null,
        parentName: null,
        linkQuality: 3,
        rssi: -60,
        lastSeenAt: null,
      },
      {
        extAddress: 'cc00000000000002',
        deviceId: null,
        name: null,
        areaId: null,
        role: 'sleepy',
        parentExtAddress: null,
        parentName: null,
        linkQuality: null,
        rssi: null,
        lastSeenAt: null,
      },
    ]);
    expect(otbr.state.actions).toContain('updateDeviceCollectionTask');
    await expect(broker.status()).resolves.toMatchObject({
      devices: { routers: 2, endDevices: 0, sleepy: 2, total: 2, online: 1 },
    });
  });

  it('lists the border routers heard, this server first, by the extended PAN ID of its network', async () => {
    const meshcop = (instance: string, txt: Record<string, string>): MdnsAnnouncement => ({
      service: '_meshcop._udp',
      instance,
      host: `${instance}.local`,
      address: '192.168.1.20',
      port: 49_154,
      txt,
    });
    const { broker, otbr, portIdOf } = await started({
      announcements: [
        meshcop('HomePod', {
          vn: 'Apple Inc.',
          mn: 'HomePod',
          nn: 'MyHome',
          xp: '1122334455667788',
        }),
        meshcop('NebulaHome Border Router', {
          vn: 'NebulaHome',
          mn: 'Border Router',
          nn: 'Casa',
          xp: 'dead00beef00cafe',
          xa: '0a0b0c0d0e0f1011',
        }),
      ],
    });

    await broker.setup({
      border: { mode: 'local', portId: await portIdOf(SKYCONNECT) },
      network: { action: 'join', dataset: 'aabb' },
      useForMatter: true,
    });
    await settled(broker);

    expect(otbr.state.active?.['extPanId']).toBe('dead00beef00cafe');
    await expect(broker.borderRouters()).resolves.toEqual([
      {
        id: 'NebulaHome Border Router',
        name: 'NebulaHome Border Router',
        vendor: 'NebulaHome',
        model: 'Border Router',
        networkName: 'Casa',
        extPanId: 'dead00beef00cafe',
        address: '192.168.1.20',
        isThisServer: true,
        isSameNetwork: true,
      },
      {
        id: 'HomePod',
        name: 'HomePod',
        vendor: 'Apple Inc.',
        model: 'HomePod',
        networkName: 'MyHome',
        extPanId: '1122334455667788',
        address: '192.168.1.20',
        isThisServer: false,
        isSameNetwork: false,
      },
    ]);
  });
});
