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

import { createMatterTransport } from '../transports/matter.js';

import { MatterBroker } from './broker.js';
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

/** A plug. */
const plug: MatterNodeSnapshot = {
  nodeId: '2',
  isAvailable: true,
  attributes: { ...descriptor(0, [22], [29, 40], [1]), ...descriptor(1, [266], [6, 29]) },
};

/** A bridge with two lamps behind it. */
const bridge: MatterNodeSnapshot = {
  nodeId: '4',
  isAvailable: true,
  attributes: {
    ...descriptor(0, [22], [29, 40], [1, 2, 3]),
    ...descriptor(1, [14], [29], [2, 3]),
    ...descriptor(2, [19, 256], [6, 29, 57]),
    ...descriptor(3, [19, 256], [6, 29, 57]),
  },
};

/**
 * A fabric in memory, holding the plug and the bridge.
 *
 * @returns How to open it, what was asked of it, and how to make it speak.
 */
function fakeFabric() {
  const nodes = new Map([plug, bridge].map((node) => [node.nodeId, node]));
  const calls: string[] = [];
  let events: MatterFabricEvents | undefined;

  const open: OpenMatterFabric = (options) => {
    events = options.events;

    return Promise.resolve({
      fabricId: 'abc',
      nodes: () => [...nodes.values()],
      node: (nodeId) => nodes.get(nodeId),
      commission: (code) => {
        calls.push(`commission ${code}`);

        if (code === '00000000000') {
          return Promise.reject(new Error('The device did not answer'));
        }

        nodes.set('9', { ...plug, nodeId: '9' });

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
      stop: () => Promise.resolve(),
    });
  };

  return {
    open,
    calls,

    /**
     * Has the fabric say a node changed.
     *
     * @param nodeId - The node.
     * @param paths - What changed, or null.
     */
    emit: (nodeId: string, paths: readonly string[] | null) => {
      events?.onNode(nodeId, paths);
    },
  };
}

let storageDir: string | undefined;

/**
 * A started broker over a fake fabric, in a folder of its own.
 *
 * @param open - How the fabric opens; the fake when not said.
 * @returns The broker and the fake.
 */
async function started(open?: OpenMatterFabric | null) {
  storageDir ??= await mkdtemp(path.join(os.tmpdir(), 'nebula-matter-'));

  const fabric = fakeFabric();
  const broker = new MatterBroker({
    open: open === null ? undefined : (open ?? fabric.open),
    storageDir,
    logger: silent(),
    version: '1.0.0',
    isLanReachable: true,
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

  it('commissions one node at a time, and says how it went', async () => {
    const { broker, fabric } = await started();
    const job = broker.commission('34970112332');

    expect(job.state).toBe('running');
    expect(() => broker.commission('34970112332')).toThrow(/already/u);
    await vi.waitFor(() => {
      expect(broker.status().commissioning).toMatchObject({ state: 'succeeded', nodeId: '9' });
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

  it('takes a node off the fabric only once none of it is left in the house', async () => {
    const { broker, fabric } = await started();

    await broker.release('4');
    await broker.release('4:2');
    expect(fabric.calls).toEqual([]);
    expect(broker.devices().map((device) => device.deviceKey)).toEqual(['2', '4:3']);

    await broker.release('4:3');
    await vi.waitFor(() => {
      expect(fabric.calls).toEqual(['decommission 4']);
    });
    expect(broker.isRemoved('4:2')).toBe(false);
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
