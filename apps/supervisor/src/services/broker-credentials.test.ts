/**
 * The username a container is given on the house's broker, against a broker on a bus in memory.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { BusClient, type BusSubscription } from '@nebulahome/bus';
import { FakeTransport } from '@nebulahome/bus/testing';
import { busSubjects, type ManagedContainerSpec } from '@nebulahome/contracts';
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
 * A supervisor's bus client and, when asked, the broker answering on the same bus.
 *
 * @param isBrokerUp - Whether the broker answers.
 * @returns The client, and what the broker was asked.
 */
function harness(isBrokerUp: boolean): { client: BusClient; asked: unknown[] } {
  const transport = new FakeTransport();
  const logger = createLogger({ service: 'supervisor', version: '0.0.0', level: 'fatal' });
  const client = new BusClient({ transport, source: 'supervisor', logger, requestTimeoutMs: 300 });
  const asked: unknown[] = [];

  if (isBrokerUp) {
    const broker = new BusClient({ transport, source: 'mqtt', logger, requestTimeoutMs: 300 });

    subscriptions.push(
      broker.serve(busSubjects.service('mqtt', 'credentials'), z.unknown(), (request) => {
        asked.push(request);

        return { username: 'nebula-vendor-zigbee2mqtt', password: 'p4ss', port: 1883 };
      }),
    );
  }

  return { client, asked };
}

describe('brokerFor', () => {
  it('asks the house broker for a username held to the topics the container names', async () => {
    const { client, asked } = harness(true);

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

  it("leaves the platform's broker in place when the house broker does not answer", async () => {
    await expect(brokerFor(harness(false).client, ZIGBEE)).resolves.toBeUndefined();
  });

  it('asks nothing for a container that does not speak MQTT', async () => {
    const { client, asked } = harness(true);
    const quiet = { ...ZIGBEE, env: [{ name: 'TZ', value: '{platform.timezone}' }] };

    expect(speaksMqtt(quiet)).toBe(false);
    await expect(brokerFor(client, quiet)).resolves.toBeUndefined();
    expect(asked).toEqual([]);
  });
});
