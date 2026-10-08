/**
 * The MQTT session the hub keeps up on a bundle's behalf (`sdk.openMqtt`), against a real broker.
 *
 * Zigbee2MQTT's vendor reaches the house's broker through it and ECOVACS its cloud's; their
 * repositories test their code against a fake session. What only a broker can say is here: that
 * the session comes up and hears what it asked for, publishes, lets go of a topic, refuses to
 * publish while down, and asks again for its topics when it comes back - the client is told not
 * to, so the session must.
 *
 * Requires nothing but the test broker (`tests/support/broker.ts`).
 */
import { Writable } from 'node:stream';

import { connectAsync, type MqttClient } from 'mqtt';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { ulid } from '@nebulahome/bus';
import { createLogger, type PlatformLogger } from '@nebulahome/logging';
import type { ManagedMqtt } from '@nebulahome/package-runtime';

import { openMqtt } from '@/transports/managed-mqtt.js';

/** The test broker (`tests/support/broker.ts`). */
const BROKER = inject('mqttUrl');

let publisher: MqttClient;
let logger: PlatformLogger;

/**
 * A logger that writes nowhere.
 *
 * @returns A logger bound to a discarding stream.
 */
function silent(): PlatformLogger {
  return createLogger(
    { service: 'hub-managed-mqtt', version: '0.0.0', level: 'fatal' },
    new Writable({
      /**
       * Discards a chunk.
       *
       * @param chunk - Ignored.
       * @param encoding - Ignored.
       * @param done - Called to accept the write.
       */
      write(chunk, encoding, done): void {
        done();
      },
    }),
  );
}

/**
 * Waits until a condition holds, or gives up.
 *
 * @param condition - What must hold.
 * @param timeoutMs - How long to wait at most.
 * @returns Whether it held.
 */
async function until(condition: () => boolean, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (!condition() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  return condition();
}

beforeAll(async () => {
  logger = silent();
  publisher = await connectAsync(BROKER, { reconnectPeriod: 0 });
});

afterAll(async () => {
  await publisher.endAsync();
});

describe('a session a bundle opens', () => {
  it('comes up, and hands over what it subscribed to as bytes', async () => {
    const heard: { topic: string; payload: Buffer }[] = [];
    let connects = 0;
    const session = openMqtt({
      url: BROKER,
      logger,
      onConnect: () => {
        connects += 1;
      },
      onMessage: (topic, payload) => {
        heard.push({ topic, payload });
      },
    });

    try {
      session.subscribe('lab/managed/+');
      expect(await until(() => session.isConnected)).toBe(true);
      expect(connects).toBe(1);

      // The subscription is sent on connect; give the broker a moment to hold it.
      await new Promise((resolve) => setTimeout(resolve, 100));
      await publisher.publishAsync('lab/managed/one', Buffer.from([0x00, 0xff, 0x10]));

      expect(await until(() => heard.length === 1)).toBe(true);
      expect(heard[0]?.topic).toBe('lab/managed/one');
      expect([...(heard[0]?.payload ?? [])]).toEqual([0x00, 0xff, 0x10]);
    } finally {
      await session.close();
    }
  });

  it('publishes for another client to hear, and lets go of a topic it no longer wants', async () => {
    const heard: string[] = [];
    const listener = await connectAsync(BROKER, { reconnectPeriod: 0 });

    await listener.subscribeAsync('lab/managed/out');
    listener.on('message', (topic, raw) => {
      heard.push(`${topic}:${raw.toString('utf8')}`);
    });

    const received: string[] = [];
    const session = openMqtt({
      url: BROKER,
      logger,
      onMessage: (topic) => {
        received.push(topic);
      },
    });

    try {
      expect(await until(() => session.isConnected)).toBe(true);

      await session.publish('lab/managed/out', '{"on":true}');
      expect(await until(() => heard.length === 1)).toBe(true);
      expect(heard).toEqual(['lab/managed/out:{"on":true}']);

      session.subscribe('lab/managed/gone');
      await new Promise((resolve) => setTimeout(resolve, 100));
      session.unsubscribe('lab/managed/gone');
      await new Promise((resolve) => setTimeout(resolve, 100));
      await publisher.publishAsync('lab/managed/gone', 'ignored');
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(received).toEqual([]);
    } finally {
      await session.close();
      await listener.endAsync();
    }
  });

  it('refuses to publish while it is not up, and says why it dropped', async () => {
    const reasons: string[] = [];
    // Nothing listens on the discard port: the session never comes up.
    const session: ManagedMqtt = openMqtt({
      url: 'mqtt://127.0.0.1:9',
      logger,
      onMessage: () => undefined,
      onClose: (reason) => {
        reasons.push(reason);
      },
    });

    try {
      await expect(session.publish('lab/managed/never', 'x')).rejects.toThrow(/not up/);
      expect(await until(() => reasons.length > 0)).toBe(true);
      expect(session.isConnected).toBe(false);
    } finally {
      await session.close();
    }
  });

  it('asks again for its topics when it comes back after the broker dropped it', async () => {
    // The client is told not to resubscribe; the session does, on every connect. A second client
    // under the same id makes the broker drop the first, which comes back on its own.
    const clientId = `managed-${ulid().toLowerCase()}`;
    const heard: string[] = [];
    let connects = 0;
    const session = openMqtt({
      url: BROKER,
      clientId,
      logger,
      onConnect: () => {
        connects += 1;
      },
      onMessage: (topic) => {
        heard.push(topic);
      },
    });

    try {
      session.subscribe('lab/managed/again');
      expect(await until(() => connects === 1)).toBe(true);

      const intruder = await connectAsync(BROKER, { clientId, reconnectPeriod: 0 });

      expect(await until(() => connects === 2, 15_000)).toBe(true);
      await intruder.endAsync(true);

      await new Promise((resolve) => setTimeout(resolve, 100));
      await publisher.publishAsync('lab/managed/again', 'back');

      expect(await until(() => heard.length === 1)).toBe(true);
      expect(heard).toEqual(['lab/managed/again']);
    } finally {
      await session.close();
    }
  }, 30_000);
});
