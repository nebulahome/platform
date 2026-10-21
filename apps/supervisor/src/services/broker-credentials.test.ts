/**
 * The username a container is given on the house's broker, which the hub runs, against a hub on a
 * bus in memory.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { BusClient, type BusSubscription } from '@nebulahome/bus';
import { FakeTransport } from '@nebulahome/bus/testing';
import {
  busSubjects,
  ConflictError,
  HUB_MQTT_CREDENTIALS_METHOD,
  HUB_SERVICE,
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
  mqttTopics: ['zigbee2mqtt/#'],
};

/** What is torn down after each test. */
const subscriptions: BusSubscription[] = [];

afterEach(() => {
  for (const subscription of subscriptions.splice(0)) {
    subscription.unsubscribe();
  }
});

/**
 * The supervisor's bus client, and a hub whose broker listens - or does not.
 *
 * @param isListening - Whether the hub's broker gives usernames; no hub at all when undefined.
 * @returns The supervisor's client, and what the hub was asked.
 */
function harness(isListening?: boolean) {
  const transport = new FakeTransport();
  const logger = createLogger({ service: 'supervisor', version: '0.0.0', level: 'fatal' });
  const client = new BusClient({ transport, source: 'supervisor', logger, requestTimeoutMs: 200 });
  const hub = new BusClient({ transport, source: 'hub', logger });
  const asked: unknown[] = [];

  if (isListening !== undefined) {
    subscriptions.push(
      hub.serve(
        busSubjects.service(HUB_SERVICE, HUB_MQTT_CREDENTIALS_METHOD),
        z.unknown(),
        (request) => {
          asked.push(request);

          if (!isListening) {
            throw new ConflictError('The MQTT broker is not running');
          }

          return { username: 'nebula-vendor-zigbee2mqtt', password: 'p4ss', port: 1883 };
        },
      ),
    );
  }

  return { client, asked };
}

describe('brokerFor', () => {
  it('asks the hub for a username held to the topics the container names', async () => {
    const { client, asked } = harness(true);

    await expect(brokerFor(client, ZIGBEE)).resolves.toEqual({
      url: 'mqtt://127.0.0.1:1883',
      username: 'nebula-vendor-zigbee2mqtt',
      password: 'p4ss',
    });
    expect(asked).toEqual([{ owner: 'vendor:zigbee2mqtt', topics: ['zigbee2mqtt/#'] }]);
  });

  it('gives no broker while the hub’s does not listen, or the hub does not answer', async () => {
    await expect(brokerFor(harness(false).client, ZIGBEE)).resolves.toBeUndefined();
    await expect(brokerFor(harness().client, ZIGBEE)).resolves.toBeUndefined();
  });

  it('asks nothing for a container that does not speak MQTT', async () => {
    const { client, asked } = harness(true);
    const quiet = { ...ZIGBEE, env: [{ name: 'TZ', value: '{platform.timezone}' }] };

    expect(speaksMqtt(quiet)).toBe(false);
    await expect(brokerFor(client, quiet)).resolves.toBeUndefined();
    expect(asked).toEqual([]);
  });
});
