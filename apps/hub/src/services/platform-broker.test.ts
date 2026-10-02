/**
 * The hub's username on the house's broker - whichever package provides `mqtt-broker` - against
 * a packet-manager and a broker on a bus in memory, and a broker the environment names.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { BusClient, type BusSubscription } from '@nebulahome/bus';
import { FakeTransport } from '@nebulahome/bus/testing';
import {
  busSubjects,
  PACKET_MANAGER_METHODS,
  PACKET_MANAGER_SERVICE,
  type InstalledPackage,
} from '@nebulahome/contracts';
import { createLogger } from '@nebulahome/logging';

import { PlatformBroker } from './platform-broker.js';

const logger = createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' });

/** What is torn down after each test. */
const subscriptions: BusSubscription[] = [];

afterEach(() => {
  for (const subscription of subscriptions.splice(0)) {
    subscription.unsubscribe();
  }
});

/**
 * A package as the packet-manager lists it.
 *
 * @param id - Its id.
 * @param provides - What it provides.
 * @returns It.
 */
function listed(id: string, provides: string[]): InstalledPackage {
  return {
    id,
    version: '1.0.0',
    build: '1.0.0',
    name: id,
    description: `The ${id} package.`,
    category: 'protocol',
    runtime: 'node',
    state: 'running',
    source: 'local',
    isSystem: provides.length > 0,
    repository: null,
    url: null,
    color: null,
    hasLogo: false,
    ui: null,
    entityTypes: [],
    requires: { packages: {}, services: [] },
    provides,
    hasSetup: false,
    previousVersion: null,
    lastStartedAt: null,
    lastError: null,
    installedAt: new Date('2026-10-02T08:00:00Z'),
    updatedAt: new Date('2026-10-02T08:00:00Z'),
    rpcMethods: [],
    problems: [],
    usedBy: [],
    dependsOn: [],
  };
}

/**
 * The hub's bus client, a packet-manager listing the packages, and the broker answering.
 *
 * @param packages - What the packet-manager lists; changed in place, it lists what it holds then.
 * @returns The client, the packet-manager's, and what each package that provides the broker was
 *   asked.
 */
function harness(packages: InstalledPackage[]): {
  client: BusClient;
  packetManager: BusClient;
  asked: unknown[];
} {
  const transport = new FakeTransport();
  const client = new BusClient({ transport, source: 'hub', logger, requestTimeoutMs: 300 });
  const packetManager = new BusClient({ transport, source: 'packet-manager', logger });
  const asked: unknown[] = [];

  subscriptions.push(
    packetManager.serve(
      busSubjects.service(PACKET_MANAGER_SERVICE, PACKET_MANAGER_METHODS.list),
      z.unknown(),
      () => ({ items: packages }),
    ),
  );

  for (const id of ['mqtt', 'mosquitto']) {
    const broker = new BusClient({ transport, source: id, logger });

    subscriptions.push(
      broker.serve(busSubjects.service(id, 'credentials'), z.unknown(), (request) => {
        if (!packages.some((each) => each.id === id && each.state === 'running')) {
          throw new Error(`${id} is not running`);
        }

        asked.push({ [id]: request });

        return { username: 'nebula-hub', password: 'p4ss', port: 1884 };
      }),
    );
  }

  return { client, packetManager, asked };
}

describe('the platform broker', () => {
  it('asks whichever package provides the broker for the hub’s username', async () => {
    const { client, asked } = harness([listed('cards', []), listed('mosquitto', ['mqtt-broker'])]);
    const broker = new PlatformBroker({ client, logger, fixed: null });

    expect(broker.current).toBeNull();

    await broker.refresh();

    expect(asked).toEqual([{ mosquitto: { principal: 'hub' } }]);
    expect(broker.current).toEqual({
      url: 'mqtt://127.0.0.1:1884',
      username: 'nebula-hub',
      password: 'p4ss',
    });
  });

  it('has no broker while no package provides one', async () => {
    const { client } = harness([listed('cards', [])]);
    const broker = new PlatformBroker({ client, logger, fixed: null });

    await broker.refresh();

    expect(broker.current).toBeNull();
  });

  it('asks again when a package starts: a broker that came up after the hub is found', async () => {
    const packages: InstalledPackage[] = [];
    const { client, packetManager } = harness(packages);
    const broker = new PlatformBroker({ client, logger, fixed: null, retryMs: 60_000 });

    await broker.start();

    expect(broker.current).toBeNull();

    packages.push(listed('mqtt', ['mqtt-broker']));
    packetManager.publish(busSubjects.packageEvent('started'), {
      packageId: 'mqtt',
      version: '1.0.0',
      state: 'running',
    });

    await vi.waitFor(() => {
      expect(broker.current?.username).toBe('nebula-hub');
    });
    broker.stop();
  });

  it('asks again every little while it has no broker, with no event to wake it', async () => {
    const packages: InstalledPackage[] = [];
    const { client } = harness(packages);
    const broker = new PlatformBroker({ client, logger, fixed: null, retryMs: 50 });

    await broker.start();
    packages.push(listed('mqtt', ['mqtt-broker']));

    await vi.waitFor(() => {
      expect(broker.current?.username).toBe('nebula-hub');
    });
    broker.stop();
  });

  it('asks nothing while the environment names a broker', async () => {
    const { client, asked } = harness([listed('mqtt', ['mqtt-broker'])]);
    const fixed = { url: 'mqtt://broker.lan:1883', username: 'me', password: 'secret' };
    const broker = new PlatformBroker({ client, logger, fixed });

    await broker.refresh();

    expect(asked).toEqual([]);
    expect(broker.current).toEqual(fixed);
  });
});
