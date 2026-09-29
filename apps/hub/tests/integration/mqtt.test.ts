/**
 * The MQTT transport against a real broker.
 *
 * Deliberately not a fake. Everything worth getting wrong here - wildcard matching, what a
 * subscription set means when it is replaced, what arrives on a topic somebody else published to -
 * is behaviour of a broker, and a fake would agree with whatever this file assumed.
 *
 * Requires the development stack:
 *
 * ```
 * pnpm infra:up
 * ```
 */
import { Writable } from 'node:stream';

import { connectAsync, type MqttClient } from 'mqtt';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createLogger, type PlatformLogger } from '@nebula-home/logging';
import type { TransportConnection, TransportInbound } from '@nebula-home/package-runtime';

import { mqttTransport } from '@/transports/mqtt.js';

/** The test broker (`tests/support/broker.ts`). */
const BROKER = inject('mqttUrl');

let publisher: MqttClient;
let logger: PlatformLogger;
let connection: TransportConnection;
let delivered: TransportInbound[] = [];

/**
 * A logger that writes nowhere.
 *
 * @returns A logger bound to a discarding stream.
 */
function silent(): PlatformLogger {
  return createLogger(
    { service: 'hub-mqtt', version: '0.0.0', level: 'fatal' },
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
 * Waits until something has been delivered, or gives up.
 *
 * @param count - How many messages to wait for.
 * @returns A promise that settles once that many have arrived.
 */
async function until(count: number): Promise<void> {
  for (let attempt = 0; attempt < 200 && delivered.length < count; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

beforeAll(async () => {
  logger = silent();
  publisher = await connectAsync(BROKER, { reconnectPeriod: 0 });

  connection = await mqttTransport.connect(
    { url: BROKER },
    {
      logger,
      deliver: (message): void => {
        delivered.push(message);
      },
      report: (): void => undefined,
    },
  );
});

afterAll(async () => {
  await connection.close();
  await publisher.endAsync();
});

describe('carrying what an integration subscribed to', () => {
  it('delivers a message on a topic that was asked for', async () => {
    delivered = [];
    await connection.apply([{ op: 'topic', args: { filter: 'lab/relay/state' } }]);
    await publisher.publishAsync('lab/relay/state', JSON.stringify({ on: true }));
    await until(1);

    expect(delivered[0]).toMatchObject({
      deviceKey: 'lab/relay/state',
      payload: { topic: 'lab/relay/state', message: { on: true } },
    });
  });

  it('matches a wildcard the way the broker does, not the way we guess', async () => {
    delivered = [];
    await connection.apply([{ op: 'topic', args: { filter: 'zigbee2mqtt/+' } }]);
    await publisher.publishAsync('zigbee2mqtt/kitchen', JSON.stringify({ state: 'ON' }));
    await until(1);

    expect(delivered[0]?.deviceKey).toBe('zigbee2mqtt/kitchen');
  });

  it('carries the topic as well as the message', async () => {
    // zigbee2mqtt puts the device name in the topic and nowhere else, so an integration that
    // could not see it would have to be written in code rather than as a profile.
    delivered = [];
    await connection.apply([{ op: 'topic', args: { filter: 'zigbee2mqtt/+' } }]);
    await publisher.publishAsync('zigbee2mqtt/hallway', JSON.stringify({ state: 'OFF' }));
    await until(1);

    expect(delivered[0]?.payload).toEqual({
      topic: 'zigbee2mqtt/hallway',
      segments: ['zigbee2mqtt', 'hallway'],
      message: { state: 'OFF' },
    });
  });

  it('keeps text that is not JSON, rather than refusing it', async () => {
    // Plenty of switches publish `ON`. Insisting on JSON would exclude them.
    delivered = [];
    await connection.apply([{ op: 'topic', args: { filter: 'lab/plain' } }]);
    await publisher.publishAsync('lab/plain', 'ON');
    await until(1);

    expect(delivered[0]?.payload).toEqual({
      topic: 'lab/plain',
      segments: ['lab', 'plain'],
      message: 'ON',
    });
  });

  it('stops carrying a topic that is no longer in the set', async () => {
    // `apply` replaces rather than adds, which is what lets an instance stop without `hub`
    // tracking which subscription belonged to whom.
    await connection.apply([{ op: 'topic', args: { filter: 'lab/gone' } }]);
    await connection.apply([{ op: 'topic', args: { filter: 'lab/kept' } }]);

    delivered = [];
    await publisher.publishAsync('lab/gone', 'ignored');
    await publisher.publishAsync('lab/kept', 'wanted');
    await until(1);

    expect(delivered.map((message) => message.deviceKey)).toEqual(['lab/kept']);
  });
});

describe('sending to a device', () => {
  it('publishes what an integration asked it to', async () => {
    const heard: string[] = [];
    const listener = await connectAsync(BROKER, { reconnectPeriod: 0 });

    await listener.subscribeAsync('lab/relay/set');
    listener.on('message', (topic, raw) => {
      heard.push(`${topic}:${raw.toString('utf8')}`);
    });

    await connection.send(
      {
        deviceKey: 'lab/relay',
        op: 'publish',
        args: { topic: 'lab/relay/set', payload: { on: true } },
      },
      AbortSignal.timeout(2000),
    );

    for (let attempt = 0; attempt < 200 && heard.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    await listener.endAsync();

    expect(heard).toEqual(['lab/relay/set:{"on":true}']);
  });

  it('refuses an operation it does not have', async () => {
    // The transport's vocabulary is small on purpose. A profile asking for something outside it
    // should fail where it is written, not silently do nothing.
    await expect(
      connection.send(
        { deviceKey: 'lab/relay', op: 'get', args: { path: '/status' } },
        AbortSignal.timeout(2000),
      ),
    ).rejects.toThrow(/mqtt/i);
  });
});

describe('a device that lives on a topic', () => {
  it('hands the topic over in segments, so a path can reach the one that matters', async () => {
    delivered = [];
    await connection.apply([{ op: 'topic', args: { filter: 'device/+/report' } }]);
    await publisher.publishAsync('device/SN123/report', JSON.stringify({ print: {} }));
    await until(1);

    // A path can index a list and cannot split a string. Without this, a serial that only ever
    // appears in the topic could not be a device's identity.
    expect(delivered[0]?.payload).toMatchObject({
      segments: ['device', 'SN123', 'report'],
    });
  });

  it('takes a filter written as segments', async () => {
    delivered = [];
    await connection.apply([{ op: 'topic', args: { filter: ['device', 'SN123', 'report'] } }]);
    await publisher.publishAsync('device/SN123/report', JSON.stringify({ print: { ok: true } }));
    await until(1);

    expect(delivered[0]?.deviceKey).toBe('device/SN123/report');
  });

  it('publishes to a topic written as segments', async () => {
    const heard: string[] = [];
    const listener = await connectAsync(BROKER, { reconnectPeriod: 0 });

    await listener.subscribeAsync('device/SN123/request');
    listener.on('message', (topic) => {
      heard.push(topic);
    });

    await connection.send(
      {
        deviceKey: 'device/SN123/report',
        op: 'publish',
        args: { topic: ['device', 'SN123', 'request'], payload: { pushing: {} } },
      },
      AbortSignal.timeout(2000),
    );

    for (let attempt = 0; attempt < 200 && heard.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    await listener.endAsync();

    expect(heard).toEqual(['device/SN123/request']);
  });

  it('announces a publish in the subscription set as soon as it is applied', async () => {
    // This is how a device that only reports changes is asked for the whole picture: the request
    // for it travels with the subscriptions, and is sent whenever the session is up.
    const heard: string[] = [];
    const listener = await connectAsync(BROKER, { reconnectPeriod: 0 });

    await listener.subscribeAsync('device/SN123/request');
    listener.on('message', (topic, raw) => {
      heard.push(`${topic}:${raw.toString('utf8')}`);
    });

    await connection.apply([
      { op: 'topic', args: { filter: 'device/SN123/report' } },
      {
        op: 'publish',
        args: {
          topic: ['device', 'SN123', 'request'],
          payload: { pushing: { command: 'pushall' } },
        },
      },
    ]);

    for (let attempt = 0; attempt < 200 && heard.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    await listener.endAsync();

    expect(heard).toEqual(['device/SN123/request:{"pushing":{"command":"pushall"}}']);
  });

  it('repeats an announcement on the schedule it was given, and stops when the set changes', async () => {
    const heard: string[] = [];
    const listener = await connectAsync(BROKER, { reconnectPeriod: 0 });

    await listener.subscribeAsync('device/SN123/request');
    listener.on('message', (topic) => {
      heard.push(topic);
    });

    await connection.apply([
      { op: 'publish', args: { topic: 'device/SN123/request', payload: {}, everyMs: 50 } },
    ]);

    // Long enough for the first send and at least two repeats.
    await new Promise((resolve) => setTimeout(resolve, 220));

    // A replaced set must take its timers with it: a repeating publish from an instance that has
    // since been removed is a request to a device nobody is listening to. The count is taken a
    // moment after the set is replaced, not before: a send already on the wire when the timers
    // went is still one the timers made, and it lands after the call returns.
    await connection.apply([]);
    await new Promise((resolve) => setTimeout(resolve, 60));
    const seen = heard.length;

    await new Promise((resolve) => setTimeout(resolve, 150));

    await listener.endAsync();

    expect(seen).toBeGreaterThanOrEqual(3);
    expect(heard.length).toBe(seen);
  });
});

describe('discovering what is on the broker', () => {
  it('reports what is published on the filter it was given', async () => {
    const abort = new AbortController();
    const found: string[] = [];

    const scanning = (async (): Promise<void> => {
      for await (const discovered of mqttTransport.scan(
        { url: BROKER },
        { filter: 'zigbee2mqtt/bridge/devices' },
        abort.signal,
      )) {
        found.push(discovered.deviceKey);
        abort.abort();
      }
    })();

    for (let attempt = 0; attempt < 40 && found.length === 0; attempt += 1) {
      await publisher.publishAsync('zigbee2mqtt/bridge/devices', JSON.stringify([{ ieee: 'a' }]));
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    abort.abort();
    await scanning;

    expect(found).toEqual(['zigbee2mqtt/bridge/devices']);
  });

  it('finds nothing rather than everything when given no filter', async () => {
    // A scan with no filter would subscribe to the whole broker and offer every retained message
    // in the house as a candidate device.
    const found = [];

    for await (const discovered of mqttTransport.scan(
      { url: BROKER },
      {},
      AbortSignal.timeout(500),
    )) {
      found.push(discovered);
    }

    expect(found).toEqual([]);
  });
});

describe('trying a configuration', () => {
  it('connects once, says so, and lets go', async () => {
    const detail = await mqttTransport.probe({ url: BROKER }, AbortSignal.timeout(5000));

    expect(detail).toContain(BROKER);
  });

  it('names the reason when nothing is listening', async () => {
    await expect(
      mqttTransport.probe({ url: 'mqtt://localhost:1' }, AbortSignal.timeout(5000)),
    ).rejects.toThrow(/ECONNREFUSED/u);
  });

  it('gives up when the broker never answers, rather than holding the form open', async () => {
    // A black-hole address: 10.255.255.1 is routable and silent on most networks. The signal
    // ends the attempt; without it mqtt.js would wait its own thirty seconds.
    await expect(
      mqttTransport.probe({ url: 'mqtt://10.255.255.1:1883' }, AbortSignal.timeout(1500)),
    ).rejects.toThrow(/timed out|abort/iu);
  }, 10_000);
});
