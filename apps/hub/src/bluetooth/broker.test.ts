import { afterEach, describe, expect, it, vi } from 'vitest';

import {
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
  type TransportInbound,
} from '@nebulahome/package-runtime';

import { memoryBluetoothStore, type BluetoothInstance } from '../persistence/bluetooth.js';
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

/** A broker under test, and what it was given. */
type Rig = {
  readonly broker: BluetoothBroker;
  readonly host: FakeBluetoothHost;
  readonly instances: BluetoothInstance[];

  /** Every op sent to a device, in order. */
  readonly sent: { deviceId: string; op: string; args: JsonObject }[];

  /** What each op answers; a function may throw. */
  readonly answers: Map<string, () => unknown>;
  readonly clock: { now: number };
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
 * @returns The rig, started.
 */
async function rig(
  options: { readonly isProxy?: boolean; readonly host?: FakeBluetoothHost } = {},
): Promise<Rig> {
  const store = memoryBluetoothStore();
  const host = options.host ?? createFakeBluetoothHost();
  const instances: BluetoothInstance[] = [plug()];
  const sent: Rig['sent'] = [];
  const answers = new Map<string, () => unknown>([
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
      }),
    ],
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
    send: async (deviceId, op, args) => {
      sent.push({ deviceId, op, args });

      return Promise.resolve().then(() => answers.get(op)?.());
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
    refreshMs: 0,
    addWaitMs: 2000,
    firstReportMs: 200,
    now: () => clock.now,
  });

  brokers.push(broker);
  await broker.start();

  return { broker, host, instances, sent, answers, clock };
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

    expect(await broker.add(SENSOR, undefined)).toEqual({ deviceId: 'thermometer' });
    expect(broker.sightings()).toEqual([]);
    expect((await broker.found()).items).toEqual([]);
    await expect(broker.add(SENSOR, undefined)).rejects.toThrow(/in the house already/u);
  });

  it('forwards everything while a Nearby lease is held, and the house’s devices after', async () => {
    const { broker, host, sent, clock } = await rig({ isProxy: true });
    const filters = (): unknown[] =>
      sent.filter((each) => each.op === BLUETOOTH_PROXY_OPS.filter).map((each) => each.args);

    host.hear(bthome(-70));
    // The sensor is recognised: forwarded outside Nearby too.
    await vi.waitFor(() => {
      expect(filters()).toEqual([{ addresses: [SENSOR] }]);
    });

    const leaseId = '0b9d8a52-8e0a-4c0f-9b52-6a3c1d9e2f10';

    expect(broker.nearbyLease(leaseId, true).isForwardingAll).toBe(true);
    await vi.waitFor(() => {
      expect(filters().at(-1)).toEqual({ addresses: 'all' });
    });

    expect(broker.nearbyLease(leaseId, false)).toEqual({ isForwardingAll: false, expiresAt: null });
    await vi.waitFor(() => {
      expect(filters().at(-1)).toEqual({ addresses: [SENSOR] });
    });

    broker.nearbyLease(leaseId, true);
    clock.now += 31_000;
    expect((await broker.status()).isForwardingAll).toBe(false);
  });

  it('makes a device a proxy: installs the script, sees it start, hears its first report', async () => {
    const { broker } = await rig();

    expect(await broker.proxyCandidates()).toMatchObject([
      {
        deviceId: PROXY,
        isOnline: true,
        modes: ['passive', 'active'],
        proxy: { eligible: true, version: '1.0.0' },
      },
    ]);

    const job = await broker.addProxy(PROXY, 'active');

    expect(job).toMatchObject({ deviceId: PROXY, mode: 'active', state: 'running' });
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
    expect((await broker.scanners())[1]).toMatchObject({
      id: PROXY,
      scanMode: 'active',
      script: { version: '1.0.0', shipped: '1.1.0', isOutdated: true },
    });
    expect(broker.canConnect()).toEqual({ isAvailable: true, reason: null });
  });

  it('stops a proxy job on its step with what the integration said', async () => {
    const { broker, answers } = await rig();

    answers.set(BLUETOOTH_PROXY_OPS.install, () => {
      throw new Error('Script slots are all in use');
    });

    const job = await broker.addProxy(PROXY, 'passive');

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
    await expect(broker.addProxy('nobody', 'passive')).rejects.toThrow(
      /cannot be a Bluetooth proxy/u,
    );
  });

  it('drops a proxy’s report until it is one, and refuses GATT to what only proxies hear', async () => {
    const { broker } = await rig({ isProxy: true });

    broker.scanner('shelly', { key: 'other', deviceKey: 'other' }).report([bthome(-50)]);
    expect(await broker.nearby()).toEqual([]);

    broker.scanner('shelly', PROXY_KEY).report([bthome(-60)]);
    await expect(
      broker.gatt(
        { deviceKey: SENSOR, op: 'gatt.read', args: { service: '181a', characteristic: '2a6e' } },
        () => undefined,
      ),
    ).rejects.toThrow(/Only proxies hear/u);
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
