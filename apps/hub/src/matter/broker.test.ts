import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLogger, type PlatformLogger } from '@nebulahome/logging';
import type {
  MatterAttributes,
  MatterNodeSnapshot,
  TransportInbound,
} from '@nebulahome/package-runtime';

import { memoryMatterNetworksStore } from '../persistence/matter.js';
import { createMatterTransport } from '../transports/matter.js';

import { MatterBroker, type MatterBrokerOptions } from './broker.js';
import type { MatterFabricEvents, OpenMatterFabric } from './fabric.js';

/**
 * A logger that writes nowhere.
 *
 * @returns The logger.
 */
function silent(): PlatformLogger {
  return createLogger(
    { service: 'hub-matter', version: '0.0.0', level: 'fatal' },
    new Writable({
      /**
       * Discards a chunk.
       *
       * @param chunk - Ignored.
       * @param encoding - Ignored.
       * @param done - Accepts the write.
       */
      write(chunk, encoding, done): void {
        done();
      },
    }),
  );
}

/**
 * The Descriptor of one endpoint.
 *
 * @param endpoint - The endpoint.
 * @param types - Its device types.
 * @param servers - Its clusters.
 * @param parts - The endpoints under it.
 * @returns Its attributes.
 */
function descriptor(
  endpoint: number,
  types: readonly number[],
  servers: readonly number[],
  parts: readonly number[] = [],
): MatterAttributes {
  return {
    [`${String(endpoint)}/29/0`]: types.map((type) => ({ '0': type })),
    [`${String(endpoint)}/29/1`]: servers,
    [`${String(endpoint)}/29/3`]: parts,
  };
}

/** A plug, on the house's Wi-Fi. */
const plug: MatterNodeSnapshot = {
  nodeId: '2',
  isAvailable: true,
  attributes: {
    ...descriptor(0, [22], [29, 40], [1]),
    ...descriptor(1, [266], [6, 29]),
    '0/49/1': [
      { '0': Buffer.from('Guests').toString('base64'), '1': false },
      { '0': Buffer.from('Casa').toString('base64'), '1': true },
    ],
    '0/54/3': 6,
  },
};

/** A bridge with two lamps behind it, a router on the house's Thread network. */
const bridge: MatterNodeSnapshot = {
  nodeId: '4',
  isAvailable: true,
  attributes: {
    ...descriptor(0, [22], [29, 40], [1, 2, 3]),
    ...descriptor(1, [14], [29], [2, 3]),
    ...descriptor(2, [19, 256], [6, 29, 57]),
    ...descriptor(3, [19, 256], [6, 29, 57]),
    '0/53/0': 15,
  },
};

/**
 * A fabric in memory, holding the plug and the bridge.
 *
 * @returns How to open it, what was asked of it, and how to make it speak.
 */
function fakeFabric() {
  const nodes = new Map(
    [plug, bridge].map((node) => [node.nodeId, { ...node, commissionedAt: null }]),
  );
  const calls: string[] = [];
  const opens: string[] = [];
  const openedWith: { ble: boolean; threadDiagnostics: boolean }[] = [];

  // A commissioning that runs until the controller closes.
  const closing: (() => void)[] = [];
  let events: MatterFabricEvents | undefined;

  const open: OpenMatterFabric = (options) => {
    events = options.events;
    opens.push(options.acceptTestCertificates === true ? 'accepting test' : 'as it is');
    openedWith.push({
      ble: options.ble === true,
      threadDiagnostics: options.threadDiagnostics === true,
    });

    return Promise.resolve({
      fabricId: 'abc',
      nodes: () => [...nodes.values()],
      node: (nodeId) => nodes.get(nodeId),
      commission: (code, onStep, newDevice) => {
        if (newDevice !== undefined) {
          // A new device: 44444444444 takes Thread, any other Wi-Fi; 55555555555 says nothing of
          // its network when given none.
          const network = code === '44444444444' ? 'thread' : 'wifi';

          calls.push(
            `commission ${code} new, wifi ${newDevice.wifi?.ssid ?? 'none'}, thread ${newDevice.threadDataset ?? 'none'}`,
          );
          onStep?.(0);

          if (
            code === '55555555555' &&
            newDevice.wifi === null &&
            newDevice.threadDataset === null
          ) {
            return Promise.reject(
              new Error(
                'Commission failed: No Wi-Fi/Thread network credentials are configured for commissioning and no Ethernet interface is available on the device and no interface already connected.',
              ),
            );
          }

          newDevice.onNetwork(network);

          if ((network === 'wifi' ? newDevice.wifi : newDevice.threadDataset) === null) {
            return new Promise<string>((resolve, reject) => {
              closing.push(() => {
                reject(new Error('The controller closed'));
              });
            });
          }

          onStep?.(16);
          onStep?.(18);
          nodes.set('9', { ...plug, nodeId: '9', commissionedAt: null });

          return Promise.resolve('9');
        }

        calls.push(`commission ${code}`);

        if (code === '00000000000') {
          return Promise.reject(new Error('The device did not answer'));
        }

        if (code === '22222222222') {
          onStep?.(0);

          return new Promise<string>((resolve, reject) => {
            closing.push(() => {
              reject(new Error('The controller closed'));
            });
          });
        }

        if (code === '11111111111' && options.acceptTestCertificates !== true) {
          onStep?.(0);
          onStep?.(10);

          return Promise.reject(
            new Error('Commission failed: This device uses a test/development certificate.'),
          );
        }

        onStep?.(0);
        onStep?.(11);
        nodes.set('9', { ...plug, nodeId: '9', commissionedAt: null });

        return Promise.resolve('9');
      },
      decommission: (nodeId) => {
        calls.push(`decommission ${nodeId}`);
        nodes.delete(nodeId);

        return Promise.resolve();
      },
      invoke: (nodeId, request) => {
        calls.push(`invoke ${nodeId} ${String(request.cluster)} ${request.command}`);

        return Promise.resolve();
      },
      write: (nodeId, request) => {
        calls.push(`write ${nodeId} ${String(request.attribute)}`);

        return Promise.resolve();
      },
      checkUpdate: () => Promise.resolve(null),
      installUpdate: () => Promise.resolve(),
      topology: () => ({
        collected_at: Date.UTC(2026, 9, 23, 12),
        nodes: [
          {
            id: '2',
            kind: 'matter',
            network_type: 'wifi',
            node_id: 2,
            role: 'station',
            available: true,
          },
          {
            id: 'ap_AABBCCDDEEFF',
            kind: 'wifi_ap',
            network_type: 'wifi',
            network_name: 'AA:BB:CC:DD:EE:FF',
          },
          {
            id: '4',
            kind: 'matter',
            network_type: 'thread',
            node_id: 4,
            role: 'router',
            available: true,
            is_bridge: true,
            network_name: 'Casa',
            ext_address: '0011223344556677',
          },
          {
            id: 'unknown_8899AABBCCDDEEFF',
            kind: 'thread_unknown',
            network_type: 'thread',
            role: 'leader',
          },
        ],
        connections: [
          {
            source: '2',
            target: 'ap_AABBCCDDEEFF',
            network: 'wifi',
            strength: 'strong',
            source_to_target: { rssi: -52 },
          },
          {
            source: '4',
            target: 'unknown_8899AABBCCDDEEFF',
            network: 'thread',
            strength: 'strong',
            source_to_target: { lqi: 2, rssi: -71 },
            target_to_source: { lqi: 3, rssi: -58 },
          },
        ],
      }),
      stop: () => {
        for (const close of closing.splice(0)) {
          close();
        }

        return Promise.resolve();
      },
    });
  };

  return {
    open,
    calls,
    opens,
    openedWith,

    /**
     * Has the fabric say a node changed.
     *
     * @param nodeId - The node.
     * @param paths - What changed, or null.
     */
    emit: (nodeId: string, paths: readonly string[] | null) => {
      events?.onNode(nodeId, paths);
    },

    /**
     * Has a node stop or start answering, as the controller sees it.
     *
     * @param nodeId - The node.
     * @param isAvailable - Whether it answers.
     */
    answers: (nodeId: string, isAvailable: boolean) => {
      const node = nodes.get(nodeId);

      if (node !== undefined) {
        nodes.set(nodeId, { ...node, isAvailable });
      }
    },
  };
}

let storageDir: string | undefined;

/**
 * A started broker over a fake fabric, in a folder of its own.
 *
 * @param open - How the fabric opens; the fake when not said.
 * @param inHouse - The devices the house has; every one of the fabric when not said.
 * @param before - Done to the fake before the broker opens it.
 * @param extra - The Bluetooth, networks and Thread the broker is given.
 * @returns The broker and the fake.
 */
async function started(
  open?: OpenMatterFabric | null,
  inHouse: ReadonlySet<string> = new Set(['2', '4', '4:2', '4:3']),
  before?: (fabric: ReturnType<typeof fakeFabric>) => void,
  extra: Pick<MatterBrokerOptions, 'bluetooth' | 'networks' | 'thread'> = {},
) {
  storageDir ??= await mkdtemp(path.join(os.tmpdir(), 'nebula-matter-'));

  const fabric = fakeFabric();

  before?.(fabric);

  const broker = new MatterBroker({
    open: open === null ? undefined : (open ?? fabric.open),
    storageDir,
    logger: silent(),
    version: '1.0.0',
    isLanReachable: true,
    inHouse: () => Promise.resolve(inHouse),
    ...extra,
  });

  await broker.start();

  return { broker, fabric };
}

afterEach(async () => {
  if (storageDir !== undefined) {
    await rm(storageDir, { recursive: true, force: true });
    storageDir = undefined;
  }
});

describe('MatterBroker', () => {
  it('says it is off, or why it failed, and refuses what needs the fabric', async () => {
    const { broker: off } = await started(null);

    expect(off.status().state).toBe('disabled');
    expect(() => off.commission('34970112332')).toThrow(/off/u);

    const { broker: failed } = await started(() => Promise.reject(new Error('port 5540 is taken')));

    expect(failed.status()).toMatchObject({ state: 'failed', error: 'port 5540 is taken' });
    expect(() => failed.probe()).toThrow(/port 5540 is taken/u);
  });

  it('lists every device of every node, the bridge and each device behind it', async () => {
    const { broker } = await started();

    expect(broker.status()).toMatchObject({ state: 'running', nodes: { total: 2, online: 2 } });
    expect(broker.devices().map((device) => device.deviceKey)).toEqual(['2', '4', '4:2', '4:3']);
  });

  it('commissions one node at a time, step by step, until it is in the house', async () => {
    const { broker, fabric } = await started();
    const job = broker.commission('34970112332');

    expect(job.state).toBe('running');
    expect(job.steps.map((step) => step.state)).toEqual([
      'done',
      'running',
      'pending',
      'pending',
      'pending',
      'pending',
    ]);
    expect(() => broker.commission('34970112332')).toThrow(/already/u);

    // On the fabric and read, it waits to be in the house: a device added for it.
    await vi.waitFor(() => {
      expect(
        broker.status().commissioning?.steps.find((step) => step.id === 'in-house'),
      ).toMatchObject({
        state: 'running',
      });
    });
    expect(broker.status().commissioning?.state).toBe('running');
    expect(
      broker.status((nodeId) => (nodeId === '9' ? 'plug-9' : undefined)).commissioning,
    ).toMatchObject({
      state: 'succeeded',
      nodeId: '9',
      deviceId: 'plug-9',
    });

    broker.commission('00000000000');
    await vi.waitFor(() => {
      expect(broker.status().commissioning).toMatchObject({
        state: 'failed',
        error: 'The device did not answer',
      });
    });
    expect(fabric.calls).toEqual(['commission 34970112332', 'commission 00000000000']);
  });

  it('stops on a test certificate, and adds the device anyway when the owner says so', async () => {
    const { broker, fabric } = await started();
    const job = broker.commission('11111111111');

    await vi.waitFor(() => {
      expect(broker.status().commissioning).toMatchObject({ state: 'needs-answer' });
    });
    expect(
      broker.status().commissioning?.steps.find((step) => step.id === 'certificate')?.state,
    ).toBe('warning');

    broker.answer(job.id, true);
    await vi.waitFor(() => {
      expect(fabric.opens).toEqual(['as it is', 'accepting test', 'as it is']);
    });
    expect(fabric.calls).toEqual(['commission 11111111111', 'commission 11111111111']);
    expect(broker.status().commissioning?.nodeId).toBe('9');
  });

  it('cancels a commissioning before the device joins, and restarts once none runs', async () => {
    const { broker, fabric } = await started();
    const job = broker.commission('22222222222');

    await expect(broker.restart()).rejects.toThrow(/being added/u);
    expect(broker.cancel(job.id)).toMatchObject({ state: 'cancelled' });
    await vi.waitFor(() => {
      expect(fabric.opens).toEqual(['as it is', 'as it is']);
    });
    // Cut off, the commissioning failed: the job stays cancelled.
    expect(broker.status().commissioning).toMatchObject({ state: 'cancelled', error: null });
    expect(broker.cancel(job.id).state).toBe('cancelled');

    const asking = broker.commission('11111111111');

    await vi.waitFor(() => {
      expect(broker.status().commissioning).toMatchObject({ state: 'needs-answer' });
    });
    expect(broker.cancel(asking.id).state).toBe('failed');
    expect(() => broker.cancel('another')).toThrow(/No such/u);

    await broker.restart();
    expect(fabric.opens).toHaveLength(3);
    expect(broker.status().state).toBe('running');
  });

  it('takes a node off the fabric only once none of it is left in the house', async () => {
    const { broker, fabric } = await started();
    const told = vi.fn();

    broker.onNodes(told);
    await broker.release('4');
    // At once, before the row goes: discovery would otherwise offer the device back.
    expect(told).toHaveBeenCalledOnce();
    await broker.release('4:2');
    expect(fabric.calls).toEqual([]);
    expect(broker.devices().map((device) => device.deviceKey)).toEqual(['2', '4:3']);

    await broker.release('4:3');
    await vi.waitFor(() => {
      expect(fabric.calls).toEqual(['decommission 4']);
    });
    expect(broker.isRemoved('4:2')).toBe(false);
  });

  it('takes a bridge off the fabric when the devices behind it were never added', async () => {
    const { broker, fabric } = await started(undefined, new Set(['2', '4']));

    await broker.release('4');
    await vi.waitFor(() => {
      expect(fabric.calls).toEqual(['decommission 4']);
    });
  });

  it('waits for a node that does not answer, and takes it off once it does', async () => {
    const { broker, fabric } = await started();

    fabric.answers('2', false);
    await broker.release('2');
    // Given a moment, it still stays: forgotten here, the plug would keep the house's fabric.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fabric.calls).toEqual([]);

    fabric.answers('2', true);
    fabric.emit('2', null);
    await vi.waitFor(() => {
      expect(fabric.calls).toEqual(['decommission 2']);
    });
  });

  it('takes off, as the fabric opens, a node removed while it could not leave', async () => {
    const { broker } = await started(undefined, new Set(['4', '4:2', '4:3']), (fabric) => {
      fabric.answers('2', false);
    });

    await broker.release('2');

    const { fabric } = await started(undefined, new Set(['4', '4:2', '4:3']));

    await vi.waitFor(() => {
      expect(fabric.calls).toEqual(['decommission 2']);
    });
  });

  it('says how each node reaches the house: its network, channel, Wi-Fi and links', async () => {
    const { broker } = await started();
    const network = broker.network();

    expect(network.collectedAt).toEqual(new Date('2026-10-23T12:00:00Z'));
    expect(network.nodes).toEqual([
      expect.objectContaining({ id: '2', nodeId: '2', network: 'wifi', channel: 6, ssid: 'Casa' }),
      expect.objectContaining({ kind: 'wifi_ap', bssid: 'AA:BB:CC:DD:EE:FF', networkName: null }),
      expect.objectContaining({
        nodeId: '4',
        role: 'router',
        isBridge: true,
        networkName: 'Casa',
        channel: 15,
        ssid: null,
      }),
      expect.objectContaining({ kind: 'thread_unknown', nodeId: null, isAvailable: null }),
    ]);
    // Of the two ends, the one that heard the other better.
    expect(network.links[1]).toMatchObject({ lqi: 3, rssi: -58 });

    const { broker: off } = await started(null);

    expect(off.network()).toEqual({ collectedAt: null, nodes: [], links: [] });
  });

  it('remembers what was removed across a restart, and brings a device back', async () => {
    const { broker } = await started();

    await broker.release('4:2');
    expect(JSON.parse(await readFile(path.join(storageDir ?? '', 'removed.json'), 'utf8'))).toEqual(
      ['4:2'],
    );

    const { broker: again } = await started();

    expect(again.isRemoved('4:2')).toBe(true);
    expect(await again.restore('4:2')).toBe(true);
    expect(again.devices().map((device) => device.deviceKey)).toContain('4:2');
  });
});

describe('the matter transport', () => {
  it('delivers each device what changed of its own, and every device whole when applied', async () => {
    const { broker, fabric } = await started();
    const transport = createMatterTransport(broker);
    const delivered: TransportInbound[] = [];
    const connection = await transport.connect(
      {},
      {
        logger: silent(),
        deliver: (message) => {
          delivered.push(message);
        },
        report: () => undefined,
      },
    );

    fabric.emit('4', ['3/6/0']);
    expect(
      delivered.map((message) => [
        message.deviceKey,
        (message.payload as { changed: unknown }).changed,
      ]),
    ).toEqual([['4:3', ['3/6/0']]]);

    delivered.length = 0;
    await connection.apply([]);
    expect(delivered.map((message) => message.deviceKey)).toEqual(['2', '4', '4:2', '4:3']);

    await connection.send(
      {
        deviceKey: '4:2',
        op: 'invoke',
        args: { endpoint: 2, cluster: 6, command: 'on', payload: {} },
      },
      AbortSignal.timeout(1000),
    );
    expect(fabric.calls).toEqual(['invoke 4 6 on']);
    await connection.close();
  });

  it('yields the devices identification binds by their key', async () => {
    const { broker } = await started();
    const keys: string[] = [];

    for await (const found of createMatterTransport(broker).scan(
      {},
      {},
      AbortSignal.timeout(1000),
    )) {
      keys.push(found.deviceKey);
    }

    expect(keys).toEqual(['2', '4', '4:2', '4:3']);
  });
});

/**
 * The server's Bluetooth, as the Bluetooth broker hands it to Matter.
 *
 * @param isAvailable - Whether the adapter can connect.
 * @returns It, what Matter told it, and how to turn its adapter off.
 */
function fakeBluetooth(isAvailable = true) {
  const pairing: boolean[] = [];
  const offListeners = new Set<() => void>();
  const state = { isAvailable };
  const bluetooth: NonNullable<MatterBrokerOptions['bluetooth']> = {
    canConnect: () =>
      state.isAvailable
        ? { isAvailable: true, reason: null }
        : { isAvailable: false, reason: 'adapter-off' },
    markPairing: (isPairing) => {
      pairing.push(isPairing);
    },
    onAdapterOff: (listener) => {
      offListeners.add(listener);

      return () => offListeners.delete(listener);
    },
  };

  return {
    bluetooth,
    pairing,
    turnOff: () => {
      state.isAvailable = false;

      for (const listener of offListeners) {
        listener();
      }
    },
  };
}

/**
 * Waits for the job to stand some way.
 *
 * @param broker - The broker.
 * @param isThere - Whether it does.
 * @returns Once it does.
 */
async function until(
  broker: MatterBroker,
  isThere: (job: ReturnType<MatterBroker['status']>['commissioning']) => boolean,
): Promise<void> {
  await vi.waitFor(() => {
    expect(isThere(broker.status().commissioning)).toBe(true);
  });
}

describe('MatterBroker, new devices', () => {
  it('refuses a new device while the server cannot pair over Bluetooth, and says why', async () => {
    const { broker } = await started(undefined, undefined, undefined, {
      bluetooth: fakeBluetooth(false).bluetooth,
    });

    expect(broker.status().ble).toEqual({ isAvailable: false, reason: 'adapter-off' });
    expect(() => broker.commission('33333333333', 'new')).toThrow(/adapter is off/u);

    const { broker: none } = await started();

    expect(none.status().ble).toEqual({ isAvailable: false, reason: 'no-adapter' });
  });

  it('pairs a Wi-Fi device over Bluetooth with the saved Wi-Fi, step by step', async () => {
    const networks = memoryMatterNetworksStore();
    const { bluetooth, pairing } = fakeBluetooth();

    await networks.saveWifi({ ssid: 'Casa', password: 'secret-pass' });

    const { broker, fabric } = await started(undefined, undefined, undefined, {
      bluetooth,
      networks,
      thread: {
        isSetUp: () => true,
        dataset: async () => Promise.resolve('0e08aabb'),
        network: async () => Promise.resolve({ networkName: 'Casa', channel: 15 }),
      },
    });

    // Bluetooth was usable when it opened, and Thread set up.
    expect(fabric.openedWith).toEqual([{ ble: true, threadDiagnostics: true }]);

    const job = broker.commission('33333333333', 'new');

    expect(job.mode).toBe('new');
    expect(job.steps.map((step) => [step.id, step.state])).toEqual([
      ['looking', 'running'],
      ['found', 'pending'],
      ['network', 'pending'],
      ['joining', 'pending'],
      ['added', 'pending'],
    ]);

    await until(broker, (now) => now?.nodeId === '9');

    expect(fabric.calls).toEqual(['commission 33333333333 new, wifi Casa, thread 0e08aabb']);
    expect(pairing).toEqual([true, false]);
    expect(
      broker
        .status()
        .commissioning?.steps.map((step) => [step.id, step.state, step.detail.network]),
    ).toEqual([
      ['looking', 'done', undefined],
      ['found', 'done', 'wifi'],
      ['network', 'done', undefined],
      ['joining', 'done', undefined],
      ['added', 'running', undefined],
    ]);
    expect(
      broker.status((nodeId) => (nodeId === '9' ? 'plug-9' : undefined)).commissioning,
    ).toMatchObject({ state: 'succeeded', deviceId: 'plug-9' });
  });

  it('asks for the Wi-Fi a device needs, saves it when asked, and pairs it with it', async () => {
    const networks = memoryMatterNetworksStore();
    const { broker, fabric } = await started(undefined, undefined, undefined, {
      bluetooth: fakeBluetooth().bluetooth,
      networks,
    });
    const job = broker.commission('33333333333', 'new');

    await until(broker, (now) => now?.state === 'needs-answer');

    const asking = broker.status().commissioning;

    expect(asking).toMatchObject({ question: 'needs-wifi' });
    expect(asking?.steps.find((step) => step.id === 'found')?.detail.network).toBe('wifi');

    const answered = broker.answer(job.id, true, {
      ssid: 'Casa',
      password: 'secret-pass',
      isSaved: true,
    });

    expect(answered.state).toBe('running');
    expect(answered.question).toBeUndefined();
    await until(broker, (now) => now?.nodeId === '9');
    expect(fabric.calls).toEqual([
      'commission 33333333333 new, wifi none, thread none',
      'commission 33333333333 new, wifi Casa, thread none',
    ]);
    await expect(networks.wifi()).resolves.toEqual({ ssid: 'Casa', password: 'secret-pass' });
  });

  it('stops on a Thread device while Thread is not set up, answered by cancelling', async () => {
    const { broker } = await started(undefined, undefined, undefined, {
      bluetooth: fakeBluetooth().bluetooth,
      networks: memoryMatterNetworksStore(),
    });
    const job = broker.commission('44444444444', 'new');

    await until(broker, (now) => now?.state === 'needs-answer');
    expect(broker.status().commissioning).toMatchObject({ question: 'needs-thread' });
    expect(
      broker.status().commissioning?.steps.find((step) => step.id === 'found')?.detail.network,
    ).toBe('thread');
    expect(broker.cancel(job.id)).toMatchObject({ state: 'cancelled' });
  });

  it('asks for Wi-Fi when a device given no network did not say which it takes', async () => {
    const { broker } = await started(undefined, undefined, undefined, {
      bluetooth: fakeBluetooth().bluetooth,
    });

    broker.commission('55555555555', 'new');
    await until(broker, (now) => now?.state === 'needs-answer');
    expect(broker.status().commissioning).toMatchObject({ question: 'needs-wifi' });
  });

  it('opens the controller with Bluetooth for a new device, and without once the adapter goes', async () => {
    const { bluetooth, turnOff } = fakeBluetooth();
    const state = { isAvailable: false };
    const late: NonNullable<MatterBrokerOptions['bluetooth']> = {
      ...bluetooth,
      // The adapter is found after the controller opened.
      canConnect: () =>
        state.isAvailable ? bluetooth.canConnect() : { isAvailable: false, reason: 'no-adapter' },
    };
    const { broker, fabric } = await started(undefined, undefined, undefined, { bluetooth: late });

    expect(fabric.openedWith).toEqual([{ ble: false, threadDiagnostics: false }]);
    state.isAvailable = true;

    const job = broker.commission('33333333333', 'new');

    await vi.waitFor(() => {
      expect(fabric.openedWith.at(-1)).toEqual({ ble: true, threadDiagnostics: false });
    });
    await until(broker, (now) => now?.state === 'needs-answer');
    broker.cancel(job.id);
    state.isAvailable = false;
    turnOff();
    await vi.waitFor(() => {
      expect(fabric.openedWith.at(-1)).toEqual({ ble: false, threadDiagnostics: false });
    });
  });

  it("says the networks a new device is given, never the Wi-Fi's password", async () => {
    const networks = memoryMatterNetworksStore();
    const { broker } = await started(undefined, undefined, undefined, {
      networks,
      thread: {
        isSetUp: () => true,
        dataset: async () => Promise.resolve(null),
        network: async () => Promise.resolve({ networkName: 'Casa', channel: 15 }),
      },
    });

    await expect(broker.networks()).resolves.toEqual({
      wifi: { ssid: null, hasPassword: false },
      thread: { networkName: 'Casa', channel: 15 },
    });
    await expect(
      broker.saveNetworks({ wifi: { ssid: 'Casa', password: 'secret-pass' } }),
    ).resolves.toMatchObject({ wifi: { ssid: 'Casa', hasPassword: true } });
    // A password left out keeps the saved one.
    await broker.saveNetworks({ wifi: { ssid: 'Casa' } });
    await expect(networks.wifi()).resolves.toEqual({ ssid: 'Casa', password: 'secret-pass' });
    await expect(broker.saveNetworks({ wifi: null })).resolves.toMatchObject({
      wifi: { ssid: null, hasPassword: false },
    });
  });
});
