/**
 * The MQTT broker on a bus in memory: a container's username is the supervisor's to ask for, and
 * nobody else's.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { BusClient } from '@nebulahome/bus';
import { FakeTransport } from '@nebulahome/bus/testing';
import {
  busSubjects,
  HUB_MQTT_CREDENTIALS_METHOD,
  HUB_SERVICE,
  mqttCredentialsReplySchema,
  PermissionError,
} from '@nebulahome/contracts';
import { createLogger } from '@nebulahome/logging';

import { NOTHING_TAKEN } from '../domain/taken.js';
import { MqttBroker } from '../mqtt/broker.js';

import { serveMqtt } from './mqtt-management.js';

const logger = createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' });

/** What is torn down after each test. */
const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

describe('the MQTT broker’s methods', () => {
  it('give a container’s username to the supervisor alone', async () => {
    const storageDir = mkdtempSync(path.join(os.tmpdir(), 'hub-mqtt-'));
    const broker = new MqttBroker({ storageDir, port: 0, logger });
    const transport = new FakeTransport();
    const hub = new BusClient({ transport, source: 'hub', logger, requestTimeoutMs: 500 });
    /**
     * A client of the bus, as another service.
     *
     * @param source - Which service.
     * @returns Its client.
     */
    const as = (source: string): BusClient =>
      new BusClient({ transport, source, logger, requestTimeoutMs: 500 });

    cleanups.push(() => {
      rmSync(storageDir, { recursive: true, force: true });
    });
    await broker.start();
    cleanups.push(async () => broker.stop());

    const subscriptions = serveMqtt({
      client: hub,
      broker,
      discovery: () => undefined,
      taken: () => Promise.resolve(NOTHING_TAKEN),
    });

    cleanups.push(() => {
      for (const subscription of subscriptions) {
        subscription.unsubscribe();
      }
    });

    const subject = busSubjects.service(HUB_SERVICE, HUB_MQTT_CREDENTIALS_METHOD);
    const asked = { owner: 'vendor:zigbee2mqtt', topics: ['zigbee2mqtt/#'] };

    await expect(
      as('supervisor').request(subject, asked, mqttCredentialsReplySchema),
    ).resolves.toMatchObject({ username: 'nebula-vendor-zigbee2mqtt' });
    await expect(as('api').request(subject, asked, mqttCredentialsReplySchema)).rejects.toThrow(
      PermissionError,
    );
  });
});
