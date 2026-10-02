/**
 * Which vendors wait for a package, against a packet-manager on a bus in memory.
 *
 * What is asserted is that a vendor needing the broker waits until a package that provides it
 * runs, and says so in a sentence naming both; that a package event is what makes it read again
 * and tell only the vendors whose standing changed; and that a vendor needing nothing is never
 * held.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { BusClient } from '@nebulahome/bus';
import { FakeTransport } from '@nebulahome/bus/testing';
import {
  busSubjects,
  PACKET_MANAGER_METHODS,
  PACKET_MANAGER_SERVICE,
  type InstalledPackage,
} from '@nebulahome/contracts';
import { createLogger } from '@nebulahome/logging';

import { PackageWatch } from './package-watch.js';

/**
 * The broker, as the packet-manager lists it.
 *
 * @param state - Where it stands.
 * @returns It.
 */
function broker(state: InstalledPackage['state']): InstalledPackage {
  return {
    id: 'mqtt',
    version: '1.0.0',
    name: 'MQTT',
    description: 'The broker.',
    category: 'protocol',
    runtime: 'node',
    state,
    source: 'builtin',
    isSystem: true,
    repository: null,
    url: null,
    color: null,
    hasLogo: false,
    ui: null,
    entityTypes: [],
    requires: { packages: {}, services: [] },
    provides: ['mqtt-broker'],
    hasSetup: false,
    previousVersion: null,
    lastStartedAt: null,
    lastError: null,
    installedAt: new Date('2026-09-28T08:00:00Z'),
    updatedAt: new Date('2026-09-29T08:00:00Z'),
    rpcMethods: [],
    problems: [],
    usedBy: [],
    dependsOn: [],
  };
}

/** What is torn down after each test. */
const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

/**
 * A watch over a packet-manager that lists what is given, and a way to change it.
 *
 * @param listed - What it lists at first; undefined for a packet-manager that is not there.
 * @returns The watch, what it was told, and a way to publish a package event.
 */
function harness(listed: InstalledPackage[] | undefined) {
  const transport = new FakeTransport();
  const logger = createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' });
  const hub = new BusClient({ transport, source: 'hub', logger, requestTimeoutMs: 500 });
  const packetManager = new BusClient({
    transport,
    source: 'packet-manager',
    logger,
    requestTimeoutMs: 500,
  });
  const state = { listed };
  const onChange = vi.fn<(vendorIds: readonly string[]) => void>();

  if (listed !== undefined) {
    const subscription = packetManager.serve(
      busSubjects.service(PACKET_MANAGER_SERVICE, PACKET_MANAGER_METHODS.list),
      z.unknown(),
      () => ({ items: state.listed ?? [] }),
    );

    cleanups.push(() => {
      subscription.unsubscribe();
    });
  }

  const watch = new PackageWatch({ client: hub, logger, platformVersion: '1.0.0', onChange });

  cleanups.push(() => {
    watch.stop();
  });

  return {
    watch,
    onChange,
    state,

    /**
     * Says a package started or stopped, as the packet-manager does.
     *
     * @param event - Which.
     */
    publish: (event: 'started' | 'stopped'): void => {
      packetManager.publish(busSubjects.packageEvent(event), {
        packageId: 'mqtt',
        version: '1.0.0',
        state: event === 'started' ? 'running' : 'stopped',
      });
    },
  };
}

/** Zigbee2MQTT, which needs the broker, and Shelly, which needs nothing. */
const VENDORS = [
  { id: 'zigbee2mqtt', name: 'Zigbee2MQTT', requires: { packages: {}, services: ['mqtt-broker'] } },
  { id: 'shelly', name: 'Shelly', requires: { packages: {}, services: [] } },
];

describe('PackageWatch', () => {
  it('holds a vendor until a package that provides what it needs runs', async () => {
    const { watch, onChange, state, publish } = harness([broker('stopped')]);

    await watch.start(VENDORS);

    expect(watch.problemsOf('zigbee2mqtt')).toEqual([
      'Zigbee2MQTT needs the MQTT package, which is not running',
    ]);
    expect(watch.problemsOf('shelly')).toEqual([]);

    state.listed = [broker('running')];
    publish('started');

    await vi.waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith(['zigbee2mqtt']);
    });
    expect(watch.problemsOf('zigbee2mqtt')).toEqual([]);
  });

  it('names what is missing when nothing provides it', async () => {
    const { watch } = harness([]);

    await watch.start(VENDORS);

    expect(watch.problemsOf('zigbee2mqtt')).toEqual([
      'Zigbee2MQTT needs a package that provides mqtt-broker, and none does',
    ]);
  });

  it('holds a vendor while the packet-manager has not said what runs', async () => {
    const { watch } = harness(undefined);

    await watch.start(VENDORS);

    expect(watch.problemsOf('zigbee2mqtt')).toEqual([
      'Zigbee2MQTT waits for the packet-manager to say whether what it needs is running',
    ]);
    expect(watch.problemsOf('shelly')).toEqual([]);
  });

  it('asks nobody anything when no vendor needs a package', async () => {
    const { watch, onChange } = harness(undefined);
    const shelly = VENDORS.filter((vendor) => vendor.id === 'shelly');

    await watch.start(shelly);

    expect(watch.problemsOf('shelly')).toEqual([]);
    expect(onChange).not.toHaveBeenCalled();
  });
});
