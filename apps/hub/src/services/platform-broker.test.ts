/**
 * The hub's username on the house's broker - whichever package provides `mqtt-broker` - against
 * a packet-manager and a broker on a bus in memory, and a broker the environment names.
 */
import { afterEach, describe, expect, it } from 'vitest';
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
 * @param packages - What the packet-manager lists.
 * @returns The client, and what each package that provides the broker was asked.
 */
function harness(packages: InstalledPackage[]): { client: BusClient; asked: unknown[] } {
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

  for (const found of packages.filter((each) => each.provides.includes('mqtt-broker'))) {
    const broker = new BusClient({ transport, source: found.id, logger });

    subscriptions.push(
      broker.serve(busSubjects.service(found.id, 'credentials'), z.unknown(), (request) => {
        asked.push({ [found.id]: request });

        return { username: 'nebula-hub', password: 'p4ss', port: 1884 };
      }),
    );
  }

  return { client, asked };
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

  it('asks nothing while the environment names a broker', async () => {
    const { client, asked } = harness([listed('mqtt', ['mqtt-broker'])]);
    const fixed = { url: 'mqtt://broker.lan:1883', username: 'me', password: 'secret' };
    const broker = new PlatformBroker({ client, logger, fixed });

    await broker.refresh();

    expect(asked).toEqual([]);
    expect(broker.current).toEqual(fixed);
  });
});
