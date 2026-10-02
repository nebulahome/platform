/**
 * The username a container is given on the house's broker - whichever package provides
 * `mqtt-broker` - against a packet-manager and a broker on a bus in memory.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { BusClient, type BusSubscription } from '@nebulahome/bus';
import { FakeTransport } from '@nebulahome/bus/testing';
import {
  busSubjects,
  PACKET_MANAGER_METHODS,
  PACKET_MANAGER_SERVICE,
  type ManagedContainerSpec,
} from '@nebulahome/contracts';
import { createLogger } from '@nebulahome/logging';

import { brokerFor, speaksMqtt } from './broker-credentials.js';

/** Zigbee2MQTT, which names the broker and asks for its own topics. */
const ZIGBEE: ManagedContainerSpec = {
  ownerKind: 'vendor',
  vendorId: 'zigbee2mqtt',
  dependencyId: 'zigbee2mqtt',
  name: 'Zigbee2MQTT',
  image: 'koenkk/zigbee2mqtt',
  minVersion: '2.1.0',
  env: [{ name: 'ZIGBEE2MQTT_CONFIG_MQTT_SERVER', value: '{platform.mqtt.url}' }],
  volumes: [],
  devices: [],
  ports: [],
  seed: [],
  webPort: null,
  mqttTopics: ['zigbee2mqtt/#', 'homeassistant/#'],
};

/** What is torn down after each test. */
const subscriptions: BusSubscription[] = [];

afterEach(() => {
  for (const subscription of subscriptions.splice(0)) {
    subscription.unsubscribe();
  }
});

/**
 * A package as the packet-manager lists it, with what matters here.
 *
 * @param id - Its id.
 * @param provides - What it provides.
 * @returns It.
 */
function listed(id: string, provides: string[]): Record<string, unknown> {
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
    installedAt: '2026-10-02T08:00:00Z',
    updatedAt: '2026-10-02T08:00:00Z',
    rpcMethods: [],
    problems: [],
    usedBy: [],
    dependsOn: [],
  };
}

/**
 * A supervisor's bus client, the packet-manager listing the packages, and - when asked - the
 * package that provides the broker answering on the same bus.
 *
 * @param broker - The package that provides `mqtt-broker`; none when not said.
 * @returns The client, and what the broker was asked.
 */
function harness(broker?: string): { client: BusClient; asked: unknown[] } {
  const transport = new FakeTransport();
  const logger = createLogger({ service: 'supervisor', version: '0.0.0', level: 'fatal' });
  const client = new BusClient({ transport, source: 'supervisor', logger, requestTimeoutMs: 300 });
  const packetManager = new BusClient({ transport, source: 'packet-manager', logger });
  const asked: unknown[] = [];

  subscriptions.push(
    packetManager.serve(
      busSubjects.service(PACKET_MANAGER_SERVICE, PACKET_MANAGER_METHODS.list),
      z.unknown(),
      () => ({
        items: [
          listed('cards', []),
          ...(broker === undefined ? [] : [listed(broker, ['mqtt-broker'])]),
        ],
      }),
    ),
  );

  if (broker !== undefined) {
    const answering = new BusClient({ transport, source: broker, logger });

    subscriptions.push(
      answering.serve(busSubjects.service(broker, 'credentials'), z.unknown(), (request) => {
        asked.push(request);

        return { username: 'nebula-vendor-zigbee2mqtt', password: 'p4ss', port: 1883 };
      }),
    );
  }

  return { client, asked };
}

describe('brokerFor', () => {
  it('asks the house broker for a username held to the topics the container names', async () => {
    // Whichever package provides the service: not only the one named mqtt.
    const { client, asked } = harness('mosquitto');

    await expect(brokerFor(client, ZIGBEE)).resolves.toEqual({
      url: 'mqtt://127.0.0.1:1883',
      username: 'nebula-vendor-zigbee2mqtt',
      password: 'p4ss',
    });
    expect(asked).toEqual([
      {
        principal: 'container',
        owner: 'vendor:zigbee2mqtt',
        topics: ['zigbee2mqtt/#', 'homeassistant/#'],
      },
    ]);
  });

  it('gives no broker while no package provides one', async () => {
    await expect(brokerFor(harness().client, ZIGBEE)).resolves.toBeUndefined();
  });

  it('asks nothing for a container that does not speak MQTT', async () => {
    const { client, asked } = harness('mqtt');
    const quiet = { ...ZIGBEE, env: [{ name: 'TZ', value: '{platform.timezone}' }] };

    expect(speaksMqtt(quiet)).toBe(false);
    await expect(brokerFor(client, quiet)).resolves.toBeUndefined();
    expect(asked).toEqual([]);
  });
});
