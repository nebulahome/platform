import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BLUETOOTH_PROXY_GATT_OPS,
  BLUETOOTH_PROXY_OPS,
  BLUETOOTH_TRANSPORT,
  type BluetoothAdvertInput,
  type JsonObject,
} from '@nebulahome/contracts';
import { createLogger } from '@nebulahome/logging';
import {
  resolveDiscovery,
  vendorDiscoverySchema,
  type LoadedVendor,
  type TransportConnection,
  type TransportInbound,
} from '@nebulahome/package-runtime';

import { memoryBluetoothStore, type BluetoothInstance } from '../persistence/bluetooth.js';
import { BLUETOOTH_COMMAND_TIMEOUT_MS } from '../services/instance.js';
import { platformBluetoothVendor } from '../services/platform-vendors.js';
import {
  createFakeBluetoothHost,
  fakeAdapter,
  type FakeBluetoothHost,
} from '../testing/bluetooth-host.js';
import { createBluetoothTransport } from '../transports/bluetooth.js';

import { BluetoothBroker, isOutdated, isPrivateAddress, type BluetoothRoles } from './broker.js';

/** A BTHome thermometer: 23.5 °C. */
const SENSOR = 'A4:C1:38:0B:5E:ED';

/** The Shelly plug that is a proxy. */
const PROXY = 'kitchen-plug';

/** The proxy's connection, and its device key on it. */
const PROXY_KEY = { key: 'shelly/rpc 192.168.1.20', deviceKey: 'shellyplugs-1' };

/**
 * A BTHome advertisement.
 *
 * @param rssi - How loud.
 * @returns It.
 */
function bthome(rssi: number): BluetoothAdvertInput {
  return {
    address: SENSOR,
    addressType: 'public',
    rssi,
    name: 'ATC_0B5EED',
    serviceData: { fcd2: '40022d09' },
    at: new Date(),
  };
}

/**
 * The Shelly integration as far as the broker reads it: a plug whose profile declares a proxy,
 * and rules that recognise its own Bluetooth buttons.
 *
 * @returns The vendor.
 */
function shellyVendor(): LoadedVendor {
  return {
    manifest: { id: 'shelly', name: 'Shelly' },
    drivers: [
      { manifest: { id: 'shelly/plug' }, bluetoothProxy: { modes: ['passive', 'active'] } },
    ],
    discovery: {
      plan: resolveDiscovery(
        'shelly',
        vendorDiscoverySchema.parse({
          bluetooth: { match: [{ path: "manufacturerData.'2985'", exists: true }] },
        }),
        [{ id: 'blu-button', name: 'BLU Button', transport: BLUETOOTH_TRANSPORT, models: [] }],
      ),
      sources: [],
    },
  } as unknown as LoadedVendor;
}

/**
 * The plug, as an instance of the house.
 *
 * @param state - How it stands.
 * @returns It.
 */
function plug(state = 'running'): BluetoothInstance {
  return {
    id: PROXY,
    kind: 'shelly/plug',
    transport: 'shelly/rpc',
    externalId: 'shellyplugs-1',
    name: 'Kitchen Plug S',
    areaId: null,
    state,
    createdAt: new Date('2026-10-01T00:00:00Z'),
  };
}

/**
 * The thermometer, as a device of the house.
 *
 * @returns It.
 */
function thermometer(): BluetoothInstance {
  return {
    id: 'thermometer',
    kind: 'bluetooth/bthome',
    transport: BLUETOOTH_TRANSPORT,
    externalId: SENSOR,
    name: 'Bedroom thermometer',
    areaId: null,
    state: 'running',
    createdAt: new Date(),
  };
}

/** A broker under test, and what it was given. */
type Rig = {
  readonly broker: BluetoothBroker;
  readonly host: FakeBluetoothHost;
  readonly instances: BluetoothInstance[];

  /** Every op sent to a device, in order, and the time or the signal it went within. */
  readonly sent: { deviceId: string; op: string; args: JsonObject; within: number | AbortSignal }[];

  /** What each op answers, by its arguments; a function may throw. */
  readonly answers: Map<string, (args: JsonObject) => unknown>;
  readonly clock: { now: number };

  /** The filters sent to proxies, in order. */
  readonly filters: () => unknown[];
};

const brokers: BluetoothBroker[] = [];

afterEach(async () => {
  await Promise.all(brokers.splice(0).map(async (broker) => broker.stop()));
});

/**
 * A broker over a fake host and memory store.
 *
 * @param options - What differs.
 * @param options.isProxy - Whether the plug is a proxy already.
 * @param options.host - The host; one adapter when absent.
 * @param options.refreshMs - How often the broker looks again; never when absent.
 * @param options.connects - Whether the proxy says it connects, with three connections free.
 * @returns The rig, started.
 */
async function rig(
  options: {
    readonly isProxy?: boolean;
    readonly host?: FakeBluetoothHost;
    readonly refreshMs?: number;
    readonly connects?: boolean;
  } = {},
): Promise<Rig> {
  const store = memoryBluetoothStore();
  const host = options.host ?? createFakeBluetoothHost();
  const instances: BluetoothInstance[] = [plug()];
  const sent: Rig['sent'] = [];
  const answers = new Map<string, (args: JsonObject) => unknown>([
    [BLUETOOTH_PROXY_OPS.install, () => null],
    [BLUETOOTH_PROXY_OPS.filter, () => null],
    [BLUETOOTH_PROXY_OPS.remove, () => null],
    [
      BLUETOOTH_PROXY_OPS.state,
      () => ({
        eligible: true,
        installed: true,
        version: '1.0.0',
        shipped: '1.1.0',
        running: true,
        ...(options.connects === true ? { connections: { free: 3, limit: 3 } } : {}),
      }),
    ],
    [BLUETOOTH_PROXY_GATT_OPS.connect, () => ({ mtu: 247 })],
    [BLUETOOTH_PROXY_GATT_OPS.disconnect, () => null],
    [BLUETOOTH_PROXY_GATT_OPS.read, () => ({ data: '0a09' })],
    [BLUETOOTH_PROXY_GATT_OPS.write, () => null],
    [BLUETOOTH_PROXY_GATT_OPS.notify, () => null],
  ]);
  const clock = { now: Date.parse('2026-10-27T20:00:00Z') };

  if (options.isProxy === true) {
    await store.saveProxy({
      integrationId: PROXY,
      scanMode: 'passive',
      scriptVersion: '1.0.0',
      installedAt: null,
    });
  }

  const roles: BluetoothRoles = {
    send: async (deviceId, op, args, within) => {
      sent.push({ deviceId, op, args, within });

      return Promise.resolve().then(() => answers.get(op)?.(args));
    },
    deviceOf: (key, deviceKey) =>
      key === PROXY_KEY.key && deviceKey === PROXY_KEY.deviceKey ? PROXY : undefined,
  };
  const broker = new BluetoothBroker({
    store,
    host,
    logger: createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' }),
    vendors: () => [shellyVendor(), platformBluetoothVendor('2026.10.0', '1.6.0')],
    instances: async () => Promise.resolve([...instances]),
    roles,
    refreshMs: options.refreshMs ?? 0,
    addWaitMs: 2000,
    firstReportMs: 200,
    now: () => clock.now,
  });

  brokers.push(broker);
  await broker.start();

  return {
    broker,
    host,
    instances,
    sent,
    answers,
    clock,
    filters: () =>
      sent.filter((each) => each.op === BLUETOOTH_PROXY_OPS.filter).map((each) => each.args),
  };
}

describe('the Bluetooth broker', () => {
  it('scans on the adapter and says why when there is none', async () => {
    const { broker, host } = await rig();

    expect(host.scanning.get('hci0')).toBe('active');
    expect(await broker.status()).toMatchObject({
      state: 'running',
      adapter: { id: 'hci0', scanMode: 'active', canPassive: true },
      adapterProblem: null,
    });

    const none = createFakeBluetoothHost([]);

    none.problem = 'no-dbus';

    const lonely = (await rig({ host: none })).broker;

    expect(await lonely.status()).toMatchObject({
      state: 'unavailable',
      adapter: null,
      adapterProblem: 'no-dbus',
    });
    expect(lonely.canConnect()).toEqual({ isAvailable: false, reason: 'no-adapter' });
  });

  it('keeps each address by scanner, the loudest first, and puts the device on its best scanner', async () => {
    const { broker, host, instances } = await rig({ isProxy: true });

    instances.push({
      id: 'thermometer',
      kind: 'bluetooth/bthome',
      transport: BLUETOOTH_TRANSPORT,
      externalId: SENSOR,
      name: 'Bedroom thermometer',
      areaId: null,
      state: 'running',
      createdAt: new Date(),
    });
    host.hear(bthome(-82));
    broker.scanner('shelly', PROXY_KEY).report([bthome(-61)]);

    const [device] = await broker.devices();

    expect(device).toMatchObject({
      deviceId: 'thermometer',
      address: SENSOR,
      rssi: -61,
      link: 'listening',
      heardBy: [
        { scannerId: PROXY, scannerName: 'Kitchen Plug S', rssi: -61 },
        { scannerId: 'adapter:hci0', scannerName: 'This server', rssi: -82 },
      ],
    });
    expect((await broker.map()).links).toContainEqual({
      source: SENSOR,
      target: PROXY,
      network: 'ble',
      strength: 'strong',
      rssi: -61,
    });
    expect(await broker.status()).toMatchObject({
      heard: { devices: 1, advertsPerMinute: 2 },
      devices: { total: 1, online: 1 },
      proxies: { total: 1, reporting: 1 },
    });

    const [adapter, proxy] = await broker.scanners();

    expect(adapter?.hearsBest).toEqual([]);
    expect(proxy).toMatchObject({
      id: PROXY,
      kind: 'proxy',
      forwarding: 'house',
      hearsBest: [{ address: SENSOR, deviceId: 'thermometer', rssi: -61 }],
    });
  });

  it('forgets an address not heard for the days the owner says', async () => {
    const { broker, host, clock } = await rig();

    host.hear(bthome(-70));
    clock.now += 2 * 24 * 60 * 60_000;
    expect((await broker.found()).items).toHaveLength(1);

    await broker.saveSettings({ ...(await broker.status()).settings, forgetAfterDays: 1 });
    expect((await broker.found()).items).toEqual([]);
  });

  it('drops the oldest addresses nobody uses past ten thousand, never one recognised', async () => {
    // Phones rotate their private address every quarter hour: a week of them is a lot of rows.
    const { broker, host, clock } = await rig();

    host.hear(bthome(-70));

    for (let index = 0; index < 10_000; index += 1) {
      clock.now += 1;
      host.hear({
        address: `4A:00:00:${[index >> 16, (index >> 8) & 0xff, index & 0xff]
          .map((byte) => byte.toString(16).padStart(2, '0').toUpperCase())
          .join(':')}`,
        addressType: 'random',
        rssi: -80,
        at: new Date(),
      });
    }

    await broker.saveSettings({ ...(await broker.status()).settings, showPrivate: true });

    const nearby = (await broker.nearby()).map((each) => each.address);

    expect(nearby).toContain(SENSOR);
    expect(nearby).not.toContain('4A:00:00:00:00:00');
    expect((await broker.status()).heard.devices).toBe(9000);
  });

  it('flags private addresses and lists them in Nearby only when the settings say', async () => {
    expect(isPrivateAddress('4A:11:22:33:44:55', 'random')).toBe(true);
    expect(isPrivateAddress('0A:11:22:33:44:55', 'random')).toBe(true);
    expect(isPrivateAddress('C4:11:22:33:44:55', 'random')).toBe(false);
    expect(isPrivateAddress('4A:11:22:33:44:55', 'public')).toBe(false);

    const { broker, host } = await rig();

    host.hear({
      address: '4A:11:22:33:44:55',
      addressType: 'random',
      rssi: -50,
      manufacturerData: { 76: '1005' },
      at: new Date(),
    });
    host.hear(bthome(-70));
    expect((await broker.nearby()).map((each) => each.address)).toEqual([SENSOR]);

    await broker.saveSettings({ ...(await broker.status()).settings, showPrivate: true });
    expect(await broker.nearby()).toMatchObject([
      { address: '4A:11:22:33:44:55', isPrivate: true, maker: 'Apple', companyId: 76, claims: [] },
      { address: SENSOR, isPrivate: false },
    ]);
  });

  it('recognises BTHome itself, and adds it once the house has it', async () => {
    const { broker, host, instances } = await rig();

    host.hear(bthome(-70));
    expect((await broker.found()).items).toMatchObject([
      {
        address: SENSOR,
        name: 'ATC_0B5EED',
        scannerName: 'This server',
        claims: [
          {
            vendorId: 'bluetooth',
            vendorName: 'Nebula',
            kind: 'bluetooth/bthome',
            model: 'BTHome',
          },
        ],
      },
    ]);

    let proposed = 0;

    broker.onDevices(() => {
      proposed = broker.sightings().length;

      // Discovery proposes it, `api` adds it: the registry has it a moment later.
      if (proposed === 1) {
        instances.push({
          id: 'thermometer',
          kind: 'bluetooth/bthome',
          transport: BLUETOOTH_TRANSPORT,
          externalId: SENSOR,
          name: 'ATC_0B5EED',
          areaId: null,
          state: 'running',
          createdAt: new Date(),
        });
      }
    });

    // A second click while the first waits joins it.
    const [first, again] = await Promise.all([
      broker.add(SENSOR, undefined),
      broker.add(SENSOR, undefined),
    ]);

    expect(first).toEqual({ deviceId: 'thermometer' });
    expect(again).toBe(first);
    expect(broker.sightings()).toEqual([]);
    expect((await broker.found()).items).toEqual([]);
    await expect(broker.add(SENSOR, undefined)).rejects.toThrow(/in the house already/u);
  });

  it('forwards everything, scanning actively, while a Nearby lease is held, and the house’s devices at rest after', async () => {
    const { broker, host, clock, filters } = await rig({ isProxy: true });

    host.hear(bthome(-70));
    // The sensor is recognised: forwarded outside Nearby too.
    await vi.waitFor(() => {
      expect(filters()).toEqual([{ addresses: [SENSOR], active: false }]);
    });

    const leaseId = '0b9d8a52-8e0a-4c0f-9b52-6a3c1d9e2f10';

    expect(broker.nearbyLease(leaseId, true).isForwardingAll).toBe(true);
    await vi.waitFor(() => {
      expect(filters().at(-1)).toEqual({ addresses: 'all', active: true });
    });
    expect((await broker.scanners())[1]?.scanMode).toBe('active');

    expect(broker.nearbyLease(leaseId, false)).toEqual({ isForwardingAll: false, expiresAt: null });
    await vi.waitFor(() => {
      expect(filters().at(-1)).toEqual({ addresses: [SENSOR], active: false });
    });
    expect((await broker.scanners())[1]?.scanMode).toBe('passive');

    broker.nearbyLease(leaseId, true);
    clock.now += 31_000;
    expect((await broker.status()).isForwardingAll).toBe(false);
  });

  it('asks the proxies hearing a device being added to scan actively until it is in the house', async () => {
    const { broker, instances, filters } = await rig({ isProxy: true });

    broker.scanner('shelly', PROXY_KEY).report([bthome(-60)]);

    const adding = broker.add(SENSOR, undefined);

    await vi.waitFor(() => {
      expect(filters().at(-1)).toEqual({ addresses: [SENSOR], active: true });
    });

    instances.push(thermometer());
    await expect(adding).resolves.toEqual({ deviceId: 'thermometer' });
    await vi.waitFor(() => {
      expect(filters().at(-1)).toEqual({ addresses: [SENSOR], active: false });
    });
  });

  it('asks the proxy hearing a followed device best to scan actively when its refresh falls due', async () => {
    const { broker, clock, filters } = await rig({ isProxy: true, refreshMs: 20 });
    const proxy = broker.scanner('shelly', PROXY_KEY);
    const connection = await createBluetoothTransport(broker).connect(
      {},
      {
        logger: createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' }),
        deliver: () => undefined,
        report: () => undefined,
      },
    );
    const scanMode = async (): Promise<string | undefined> =>
      (await broker.scanners())[1]?.scanMode;

    proxy.report([bthome(-60)]);
    await connection.apply([{ op: 'follow', args: { address: SENSOR, activeEveryMinutes: 10 } }]);
    // Never refreshed: due at once.
    await vi.waitFor(() => {
      expect(filters().at(-1)).toEqual({ addresses: [SENSOR], active: true });
    });
    expect(await scanMode()).toBe('active');

    // Heard again while scanning actively: back to rest.
    proxy.report([bthome(-59)]);
    await vi.waitFor(() => {
      expect(filters().at(-1)).toEqual({ addresses: [SENSOR], active: false });
    });
    expect(await scanMode()).toBe('passive');

    // Not due for ten minutes.
    clock.now += 9 * 60_000;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(filters().at(-1)).toEqual({ addresses: [SENSOR], active: false });

    // Due again; not heard, so back to rest after 30 s.
    clock.now += 60_000;
    await vi.waitFor(() => {
      expect(filters().at(-1)).toEqual({ addresses: [SENSOR], active: true });
    });
    clock.now += 30_000;
    await vi.waitFor(() => {
      expect(filters().at(-1)).toEqual({ addresses: [SENSOR], active: false });
    });
    await connection.close();
  });

  it('makes a device a proxy resting passive: installs the script, sees it start, hears its first report', async () => {
    const { broker, sent } = await rig();

    expect(await broker.proxyCandidates()).toMatchObject([
      {
        deviceId: PROXY,
        isOnline: true,
        modes: ['passive', 'active'],
        proxy: { eligible: true, version: '1.0.0' },
      },
    ]);

    const job = await broker.addProxy(PROXY);

    expect(job).toMatchObject({ deviceId: PROXY, state: 'running' });
    expect(job).not.toHaveProperty('mode');
    await vi.waitFor(() => {
      expect(broker.job(job.id).steps[2]?.state).toBe('running');
    });

    broker.scanner('shelly', PROXY_KEY).report([bthome(-64)]);
    await vi.waitFor(() => {
      expect(broker.job(job.id)).toMatchObject({
        state: 'succeeded',
        error: null,
        steps: [
          { id: 'installing', state: 'done', message: 'Script 1.0.0' },
          { id: 'started', state: 'done' },
          { id: 'first-report', state: 'done' },
        ],
      });
    });
    expect(sent.find((each) => each.op === BLUETOOTH_PROXY_OPS.install)?.args).toEqual({
      mode: 'passive',
    });
    expect((await broker.scanners())[1]).toMatchObject({
      id: PROXY,
      scanMode: 'passive',
      script: { version: '1.0.0', shipped: '1.1.0', isOutdated: true },
    });
    expect(broker.canConnect()).toEqual({ isAvailable: true, reason: null });
  });

  it('stops a proxy job on its step with what the integration said', async () => {
    const { broker, answers } = await rig();

    answers.set(BLUETOOTH_PROXY_OPS.install, () => {
      throw new Error('Script slots are all in use');
    });

    const job = await broker.addProxy(PROXY);

    await vi.waitFor(() => {
      expect(broker.job(job.id)).toMatchObject({
        state: 'failed',
        error: 'Script slots are all in use',
        steps: [
          { id: 'installing', state: 'failed', message: 'Script slots are all in use' },
          { id: 'started', state: 'pending' },
          { id: 'first-report', state: 'pending' },
        ],
      });
    });
    expect((await broker.scanners()).map((each) => each.kind)).toEqual(['adapter']);
    await expect(broker.addProxy('nobody')).rejects.toThrow(/cannot be a Bluetooth proxy/u);
  });

  it('drops a proxy’s report until it is one, and refuses GATT to what only a proxy that listens hears', async () => {
    const { broker } = await rig({ isProxy: true });

    broker.scanner('shelly', { key: 'other', deviceKey: 'other' }).report([bthome(-50)]);
    expect(await broker.nearby()).toEqual([]);

    broker.scanner('shelly', PROXY_KEY).report([bthome(-60)]);
    await expect(
      broker.gatt(
        { deviceKey: SENSOR, op: 'gatt.read', args: { service: '181a', characteristic: '2a6e' } },
        () => undefined,
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow(
      `Nothing that hears ${SENSOR} can connect to it: Kitchen Plug S: it cannot connect; the server’s adapter: it does not hear it`,
    );
  });

  it('tells Matter the adapter went off', async () => {
    const { broker, host } = await rig();
    let isOff = false;

    broker.onAdapterOff(() => {
      isOff = true;
    });
    broker.markPairing(true);
    expect((await broker.status()).isMatterPairing).toBe(true);

    host.adapterList = [{ ...fakeAdapter(), isPowered: false }];
    host.change();
    await vi.waitFor(() => {
      expect(isOff).toBe(true);
    });
    expect(broker.canConnect()).toEqual({ isAvailable: false, reason: 'adapter-off' });
    expect(host.scanning.size).toBe(0);
  });

  it('stops using the adapter when the owner says, and starts again', async () => {
    const { broker, host } = await rig();
    const { settings } = await broker.status();

    expect(await broker.saveSettings({ ...settings, localEnabled: false })).toMatchObject({
      state: 'disabled',
      adapterProblem: 'disabled',
    });
    expect(host.scanning.size).toBe(0);
    expect(broker.canConnect()).toEqual({ isAvailable: false, reason: 'adapter-off' });

    expect(
      await broker.saveSettings({ ...settings, localEnabled: true, localScanMode: 'passive' }),
    ).toMatchObject({ state: 'running', adapter: { scanMode: 'passive' } });
    expect(host.scanning.get('hci0')).toBe('passive');
  });
});

describe('GATT through a proxy that connects', () => {
  /** A SwitchBot Bot. */
  const BOT = 'C4:BE:84:12:34:56';

  /** SwitchBot's service: a request written to one characteristic, its answer notified by another. */
  const SWITCHBOT = {
    service: 'cba20d00-224d-11e6-9fb8-0002a5d5c51b',
    characteristic: 'cba20002-224d-11e6-9fb8-0002a5d5c51b',
    notify: 'cba20003-224d-11e6-9fb8-0002a5d5c51b',
  };

  const { connect, disconnect, read, notify } = BLUETOOTH_PROXY_GATT_OPS;

  /**
   * An advertisement of an address.
   *
   * @param address - The address.
   * @param rssi - How loud.
   * @returns It.
   */
  const heard = (address: string, rssi: number): BluetoothAdvertInput => ({
    address,
    addressType: 'random',
    rssi,
    at: new Date(),
  });

  /**
   * A machine with no adapter it can use, as Docker Desktop is.
   *
   * @returns It.
   */
  const noAdapter = (): FakeBluetoothHost => {
    const host = createFakeBluetoothHost([]);

    host.problem = 'no-dbus';

    return host;
  };

  /**
   * The proxy's connections, as the Scanners page shows them.
   *
   * @param each - The rig.
   * @returns Them.
   */
  const connections = async (each: Rig): Promise<unknown> =>
    (await each.broker.scanners()).find((scanner) => scanner.kind === 'proxy')?.connections;

  /**
   * Opens the proxy's scanner, and waits for it to say its connections.
   *
   * @param each - The rig.
   * @returns The scanner.
   */
  const connecting = async (each: Rig): Promise<ReturnType<BluetoothBroker['scanner']>> => {
    const scanner = each.broker.scanner('shelly', PROXY_KEY);

    await vi.waitFor(async () => {
      expect(await connections(each)).toEqual({ used: 0, max: 3 });
    });

    return scanner;
  };

  /**
   * The GATT ops the proxy was sent, in order.
   *
   * @param each - The rig.
   * @returns Their names.
   */
  const gattOps = (each: Rig): string[] =>
    each.sent
      .filter((sent) => (Object.values(BLUETOOTH_PROXY_GATT_OPS) as string[]).includes(sent.op))
      .map((sent) => sent.op);

  /**
   * Reads a characteristic of the `181a` service.
   *
   * @param broker - The broker.
   * @param address - The device.
   * @param characteristic - The characteristic.
   * @param signal - The command's deadline.
   * @returns What it answered.
   */
  const readOf = async (
    broker: BluetoothBroker,
    address: string,
    characteristic = '2a6e',
    signal = AbortSignal.timeout(1000),
  ): Promise<unknown> =>
    broker.gatt(
      { deviceKey: address, op: 'gatt.read', args: { service: '181a', characteristic } },
      () => undefined,
      signal,
    );

  /**
   * Turns SwitchBot's answers on or off.
   *
   * @param broker - The broker.
   * @param isOn - Which.
   * @returns Once done.
   */
  const notifyOf = async (broker: BluetoothBroker, isOn: boolean): Promise<unknown> =>
    broker.gatt(
      {
        deviceKey: BOT,
        op: 'gatt.notify',
        args: { service: SWITCHBOT.service, characteristic: SWITCHBOT.notify, isOn },
      },
      () => undefined,
      AbortSignal.timeout(1000),
    );

  /**
   * The transport's connection over the broker.
   *
   * @param broker - The broker.
   * @param delivered - Where what it delivers goes.
   * @returns The connection.
   */
  const transportOf = async (
    broker: BluetoothBroker,
    delivered: TransportInbound[] = [],
  ): Promise<TransportConnection> =>
    createBluetoothTransport(broker).connect(
      {},
      {
        logger: createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' }),
        deliver: (message) => delivered.push(message),
        report: () => undefined,
      },
    );

  afterEach(() => {
    vi.useRealTimers();
  });

  it('connects through the adapter hearing a device well, else through the proxy hearing it best, and stays on it', async () => {
    const each = await rig({ isProxy: true, connects: true });
    const proxy = await connecting(each);

    // Heard at -80 dBm by the adapter: near enough, though the proxy hears it louder.
    each.host.hear(heard(SENSOR, -80));
    proxy.report([heard(SENSOR, -50)]);
    each.host.values.set(`${SENSOR} 181a 2a6e`, '0b09');
    await expect(readOf(each.broker, SENSOR)).resolves.toEqual({ data: '0b09' });
    expect(gattOps(each)).toEqual([]);

    // Heard at -90 dBm: through the proxy, with what is left of the command's time.
    const signal = AbortSignal.timeout(1000);

    each.instances.push({ ...thermometer(), id: 'bot', externalId: BOT, name: 'Bot' });
    each.host.hear(heard(BOT, -90));
    proxy.report([heard(BOT, -60)]);
    await expect(readOf(each.broker, BOT, '2a6e', signal)).resolves.toEqual({ data: '0a09' });
    expect(each.sent.filter((sent) => sent.op === connect || sent.op === read)).toEqual([
      { deviceId: PROXY, op: connect, args: { address: BOT }, within: signal },
      {
        deviceId: PROXY,
        op: read,
        args: { address: BOT, service: '181a', characteristic: '2a6e' },
        within: signal,
      },
    ]);
    expect(await connections(each)).toEqual({ used: 1, max: 3 });
    expect((await each.broker.devices()).find((device) => device.address === BOT)?.link).toBe(
      'connected',
    );

    // Heard louder by the adapter now: the link it has stays on the proxy.
    each.host.hear(heard(BOT, -40));
    await readOf(each.broker, BOT);
    expect(gattOps(each)).toEqual([connect, read, read]);
  });

  it('tries the next way when one does not connect, and says what it tried when none does', async () => {
    const each = await rig({ isProxy: true, connects: true });
    const proxy = await connecting(each);
    const other = 'C4:BE:84:00:00:02';

    each.answers.set(connect, () => {
      throw new Error('Timed out connecting');
    });
    each.host.hear(heard(BOT, -90));
    proxy.report([heard(BOT, -60)]);
    each.host.values.set(`${BOT} 181a 2a6e`, '0c09');
    await expect(readOf(each.broker, BOT)).resolves.toEqual({ data: '0c09' });
    // Told to let go, in case it connected after all; its connection is free again.
    expect(gattOps(each)).toEqual([connect, disconnect]);
    expect(await connections(each)).toEqual({ used: 0, max: 3 });

    each.host.hear(heard(other, -90));
    proxy.report([heard(other, -60)]);
    await expect(readOf(each.broker, other)).rejects.toThrow(
      `Could not connect to ${other}: Kitchen Plug S: Timed out connecting; the server’s adapter: The device has no characteristic 2a6e`,
    );
  });

  it('passes over a proxy with no connection free, as it last said', async () => {
    const each = await rig({ isProxy: true, connects: true });
    const proxy = await connecting(each);

    proxy.gatt({ kind: 'slots', free: 0, limit: 3 });
    expect(await connections(each)).toEqual({ used: 3, max: 3 });
    proxy.report([heard(BOT, -60)]);
    await expect(readOf(each.broker, BOT)).rejects.toThrow(
      `Nothing that hears ${BOT} can connect to it: Kitchen Plug S: no free connection; the server’s adapter: it does not hear it`,
    );
    expect(gattOps(each)).toEqual([]);
  });

  it('takes one request at a time per address, in order, the next going once one runs out of time', async () => {
    const each = await rig({ host: noAdapter(), isProxy: true, connects: true });
    const proxy = await connecting(each);
    const connection = await transportOf(each.broker);
    const reads = (): unknown[] =>
      each.sent.filter((sent) => sent.op === read).map((sent) => sent.args['characteristic']);
    let release: (value: unknown) => void = () => undefined;

    each.answers.set(read, (args) =>
      args['characteristic'] === '2a6e'
        ? new Promise((resolve) => {
            release = resolve;
          })
        : { data: '02' },
    );
    proxy.report([heard(BOT, -60)]);

    const first = readOf(each.broker, BOT, '2a6e');
    const second = readOf(each.broker, BOT, '2a6f');

    await vi.waitFor(() => {
      expect(reads()).toEqual(['2a6e']);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(reads()).toEqual(['2a6e']);
    release({ data: '01' });
    await expect(first).resolves.toEqual({ data: '01' });
    await expect(second).resolves.toEqual({ data: '02' });
    expect(reads()).toEqual(['2a6e', '2a6f']);

    // The transport ends a request at its command's deadline, and the one behind it goes.
    each.answers.set(read, (args) =>
      args['characteristic'] === '2a6e' ? new Promise(() => undefined) : { data: '03' },
    );

    const stuck = connection.send(
      { deviceKey: BOT, op: 'gatt.read', args: { service: '181a', characteristic: '2a6e' } },
      AbortSignal.timeout(50),
    );
    const after = readOf(each.broker, BOT, '2a6f');

    await expect(stuck).rejects.toThrow(/timeout/u);
    await expect(after).resolves.toEqual({ data: '03' });
    await connection.close();
  });

  it('delivers what a characteristic turned on through the proxy notifies, until it is turned off', async () => {
    const each = await rig({ host: noAdapter(), isProxy: true, connects: true });
    const proxy = await connecting(each);
    const delivered: TransportInbound[] = [];
    const connection = await transportOf(each.broker, delivered);
    const value = {
      kind: 'notification',
      address: BOT.toLowerCase(),
      service: SWITCHBOT.service.toUpperCase(),
      characteristic: SWITCHBOT.notify,
      data: '01FF',
    } as const;

    proxy.report([heard(BOT, -60)]);
    await connection.send(
      {
        deviceKey: BOT,
        op: 'gatt.notify',
        args: { service: SWITCHBOT.service, characteristic: SWITCHBOT.notify, isOn: true },
      },
      AbortSignal.timeout(1000),
    );
    proxy.gatt(value);
    // Another proxy's word for it is not taken.
    each.broker.scanner('shelly', { key: 'other', deviceKey: 'other' }).gatt(value);
    expect(delivered).toEqual([
      {
        connectionKey: BLUETOOTH_TRANSPORT,
        deviceKey: BOT,
        payload: { service: SWITCHBOT.service, characteristic: SWITCHBOT.notify, data: '01ff' },
      },
    ]);

    await notifyOf(each.broker, false);
    proxy.gatt(value);
    expect(delivered).toHaveLength(1);
    expect(gattOps(each)).toEqual([connect, notify, notify]);
    await connection.close();
  });

  it('fails the requests waiting on a link the proxy lost, and connects again for the next', async () => {
    const each = await rig({ host: noAdapter(), isProxy: true, connects: true });
    const proxy = await connecting(each);
    let fail: (error: Error) => void = () => undefined;

    proxy.report([heard(BOT, -60)]);
    await readOf(each.broker, BOT);
    each.answers.set(
      read,
      async () =>
        new Promise((resolve, reject) => {
          fail = reject;
        }),
    );

    const first = readOf(each.broker, BOT, '2a6e');
    const second = readOf(each.broker, BOT, '2a6f');

    await vi.waitFor(() => {
      expect(gattOps(each)).toEqual([connect, read, read]);
    });
    proxy.gatt({ kind: 'disconnected', address: BOT, reason: 'out of range' });
    fail(new Error('Not connected'));
    await expect(first).rejects.toThrow('Not connected');
    await expect(second).rejects.toThrow(`${BOT} lost its link (out of range)`);
    expect(await connections(each)).toEqual({ used: 0, max: 3 });

    each.answers.set(read, () => ({ data: '05' }));
    await expect(readOf(each.broker, BOT)).resolves.toEqual({ data: '05' });
    expect(gattOps(each)).toEqual([connect, read, read, connect, read]);

    // Its connection lost: every link through it goes.
    proxy.close();
    expect(await connections(each)).toBeNull();
  });

  it('lets go of a link 5 s after its last request, unless notifications are on', async () => {
    const each = await rig({ host: noAdapter(), isProxy: true, connects: true });
    const proxy = await connecting(each);

    proxy.report([heard(BOT, -60)]);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await readOf(each.broker, BOT);
    await vi.advanceTimersByTimeAsync(4000);
    // Another request starts the 5 s again.
    await readOf(each.broker, BOT);
    await vi.advanceTimersByTimeAsync(4999);
    expect(gattOps(each)).toEqual([connect, read, read]);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => {
      expect(gattOps(each)).toEqual([connect, read, read, disconnect]);
    });
    expect(await connections(each)).toEqual({ used: 0, max: 3 });

    await notifyOf(each.broker, true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(gattOps(each).at(-1)).toBe(notify);
    await notifyOf(each.broker, false);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.waitFor(() => {
      expect(gattOps(each).at(-1)).toBe(disconnect);
    });
  });

  it('carries a SwitchBot conversation through the transport and a proxy, on one link, within the command’s 10 s', async () => {
    const each = await rig({ host: noAdapter(), isProxy: true, connects: true });
    const proxy = await connecting(each);
    const connection = await transportOf(each.broker);
    const deadline = AbortSignal.timeout(BLUETOOTH_COMMAND_TIMEOUT_MS);

    // The Bot hands out its key's IV, then takes the command sealed with it.
    each.answers.set(BLUETOOTH_PROXY_GATT_OPS.exchange, (args) => ({
      data: args['data'] === '570f2101' ? '01a1b2c3d4' : '01',
    }));
    proxy.report([heard(BOT, -70)]);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    /**
     * Sends one step.
     *
     * @param data - The request.
     * @returns What the Bot answered.
     */
    const step = async (data: string): Promise<unknown> =>
      connection.send(
        { deviceKey: BOT, op: 'gatt.exchange', args: { ...SWITCHBOT, data } },
        deadline,
      );

    await expect(step('570f2101')).resolves.toEqual({ data: '01a1b2c3d4' });
    await expect(step('570f2a01a1b2c3d4')).resolves.toEqual({ data: '01' });
    expect(each.sent.filter((sent) => gattOps(each).includes(sent.op))).toEqual([
      { deviceId: PROXY, op: connect, args: { address: BOT }, within: deadline },
      ...['570f2101', '570f2a01a1b2c3d4'].map((data) => ({
        deviceId: PROXY,
        op: BLUETOOTH_PROXY_GATT_OPS.exchange,
        args: { address: BOT, ...SWITCHBOT, data, withResponse: false, timeoutMs: 5000 },
        within: deadline,
      })),
    ]);
    expect(await connections(each)).toEqual({ used: 1, max: 3 });

    await vi.advanceTimersByTimeAsync(5000);
    await vi.waitFor(() => {
      expect(gattOps(each).at(-1)).toBe(disconnect);
    });
    expect(await connections(each)).toEqual({ used: 0, max: 3 });
    await connection.close();
  });
});

describe('the bluetooth transport', () => {
  it('delivers what the followed addresses advertise, and reads GATT on the adapter', async () => {
    const { broker, host } = await rig();
    const delivered: TransportInbound[] = [];
    const transport = createBluetoothTransport(broker);
    const connection = await transport.connect(
      {},
      {
        logger: createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' }),
        deliver: (message) => delivered.push(message),
        report: () => undefined,
      },
    );

    await connection.apply([{ op: 'follow', args: { address: SENSOR } }]);
    host.hear(bthome(-70));
    host.hear({ address: '11:22:33:44:55:66', addressType: 'public', rssi: -70, at: new Date() });
    // The same reading again within the minute is not delivered twice.
    host.hear(bthome(-71));
    expect(delivered).toMatchObject([
      { connectionKey: BLUETOOTH_TRANSPORT, deviceKey: SENSOR, payload: { rssi: -70 } },
    ]);

    // Handed over as JSON, scanned or delivered: a driver's claim keeps the advertisement, and the
    // device's row stores the claim.
    const scanned: unknown[] = [];

    for await (const found of transport.scan({}, {}, AbortSignal.timeout(1000))) {
      scanned.push(found.payload);
    }

    expect(scanned).toMatchObject([
      { deviceKey: SENSOR, advert: { at: expect.any(String) as string } },
    ]);
    expect(delivered[0]?.payload).toMatchObject({ at: expect.any(String) as string });

    host.values.set(`${SENSOR} 181a 2a6e`, '0a09');
    expect(
      await connection.send(
        { deviceKey: SENSOR, op: 'gatt.read', args: { service: '181a', characteristic: '2a6e' } },
        AbortSignal.timeout(1000),
      ),
    ).toEqual({ data: '0a09' });
    await connection.send(
      {
        deviceKey: SENSOR,
        op: 'gatt.notify',
        args: { service: '181a', characteristic: '2a6e', isOn: true },
      },
      AbortSignal.timeout(1000),
    );
    host.push(SENSOR, '2a6e', '0b09');
    expect(delivered.at(-1)).toMatchObject({
      deviceKey: SENSOR,
      payload: { service: '181a', characteristic: '2a6e', data: '0b09' },
    });
    host.answers.set('570100', '01');
    expect(
      await connection.send(
        {
          deviceKey: SENSOR,
          op: 'gatt.exchange',
          args: { service: '181a', characteristic: '2a6f', notify: '2a6e', data: '570100' },
        },
        AbortSignal.timeout(1000),
      ),
    ).toEqual({ data: '01' });
    expect(host.written.at(-1)).toEqual({
      address: SENSOR,
      characteristic: '2a6f',
      data: '570100',
    });
    expect((await broker.devices()).length).toBe(0);

    const found: unknown[] = [];

    for await (const each of transport.scan({}, {}, AbortSignal.timeout(1000))) {
      found.push(each);
    }

    expect(found).toMatchObject([
      { deviceKey: SENSOR, payload: { deviceKey: SENSOR, kind: 'bluetooth/bthome' } },
    ]);
    await connection.close();
  });
});

describe('isOutdated', () => {
  it('compares script versions as semantic versions when they are', () => {
    expect(isOutdated('1.0.0', '1.1.0')).toBe(true);
    expect(isOutdated('1.2.0', '1.1.0')).toBe(false);
    expect(isOutdated('2026-10-01', '2026-10-27')).toBe(true);
    expect(isOutdated('2026-10-27', '2026-10-27')).toBe(false);
    expect(isOutdated(null, '1.0.0')).toBe(false);
  });
});
