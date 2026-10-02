/**
 * The Zigbee2MQTT bundle against a real broker, with Zigbee2MQTT played by the test.
 *
 * The bundle is loaded the way the hub loads it, handed the development broker as the platform's,
 * and the messages a Zigbee2MQTT bridge publishes - retained, as it does - are published here. What
 * is checked is what only a broker can say: that the retained list reaches a scan that starts
 * after it was published, that a device's state reaches the device by its IEEE address under a
 * friendly name with a slash in it, and that a command arrives where Zigbee2MQTT listens.
 *
 * Requires the development stack:
 *
 * ```
 * pnpm infra:up
 * ```
 */
import path from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { connectAsync, type MqttClient } from 'mqtt';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createLogger, type PlatformLogger } from '@nebulahome/logging';
import type { Transport, TransportInbound } from '@nebulahome/package-runtime';

import { RUNTIME_VERSION } from '@/config.js';
import { loadBundles } from '@/services/bundles.js';

/** The test broker (`tests/support/broker.ts`). */
const BROKER = inject('mqttUrl');

/** A base topic of the test's own, so a real Zigbee2MQTT on the broker is left alone. */
const BASE = `z2mtest${String(Date.now()).slice(-6)}`;

/** The bundles under development. */
const BUNDLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../bundles');

/** A plug, as `bridge/devices` lists it. */
const PLUG = {
  ieee_address: '0x0c4314fffe1a2b3c',
  friendly_name: 'kitchen/coffee plug',
  type: 'Router',
  supported: true,
  interview_state: 'SUCCESSFUL',
  definition: {
    model: 'TS011F_plug_1',
    vendor: 'Tuya',
    exposes: [
      {
        type: 'switch',
        features: [
          {
            type: 'binary',
            name: 'state',
            property: 'state',
            access: 7,
            value_on: 'ON',
            value_off: 'OFF',
          },
        ],
      },
      { type: 'numeric', name: 'power', property: 'power', access: 5, unit: 'W' },
    ],
  },
};

let publisher: MqttClient;
let logger: PlatformLogger;
let transport: Transport;

/**
 * A logger that writes nowhere.
 *
 * @returns A logger bound to a discarding stream.
 */
function silent(): PlatformLogger {
  return createLogger(
    { service: 'hub-z2m', version: '0.0.0', level: 'fatal' },
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
 * @param condition - What to wait for.
 * @returns A promise that settles once it holds, or after two seconds.
 */
async function until(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !condition(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

beforeAll(async () => {
  logger = silent();
  publisher = await connectAsync(BROKER, { reconnectPeriod: 0 });

  await publisher.publishAsync(`${BASE}/bridge/devices`, JSON.stringify([PLUG]), { retain: true });

  const { vendors, failures } = await loadBundles({
    directory: BUNDLES,
    runtimeVersion: RUNTIME_VERSION,
    logger,
    platform: { mqtt: { url: BROKER } },
  });
  const vendor = vendors.find((each) => each.manifest.id === 'zigbee2mqtt');
  const found = vendor?.ownTransports.find((each) => each.id === 'zigbee2mqtt/mqtt');

  expect(failures).toEqual([]);

  if (found === undefined) {
    throw new Error('The bundle ships no zigbee2mqtt/mqtt');
  }

  transport = found;
});

afterAll(async () => {
  // Retained messages outlive the test unless they are cleared with an empty one.
  await publisher.publishAsync(`${BASE}/bridge/devices`, '', { retain: true });
  await publisher.endAsync();
});

describe('Zigbee2MQTT on a real broker', () => {
  it('finds a device the bridge listed before the scan began', async () => {
    const abort = new AbortController();
    const found: string[] = [];

    for await (const discovered of transport.scan({ baseTopic: BASE }, {}, abort.signal)) {
      found.push(discovered.deviceKey);
      abort.abort();
    }

    expect(found).toEqual([PLUG.ieee_address]);
  });

  it("hands a device's state to it by IEEE address, and takes its commands", async () => {
    const delivered: TransportInbound[] = [];
    const connection = await transport.connect(
      { baseTopic: BASE },
      {
        logger,
        deliver: (message): void => {
          delivered.push(message);
        },
        report: (): void => undefined,
      },
    );
    const commands: string[] = [];
    const listener = await connectAsync(BROKER, { reconnectPeriod: 0 });

    listener.on('message', (topic, payload) => {
      commands.push(`${topic} ${payload.toString()}`);
    });
    await listener.subscribeAsync(`${BASE}/+/set`);

    // The retained list names the plug before its state is published.
    await until(() => delivered.some((message) => message.deviceKey === 'bridge'));
    await publisher.publishAsync(
      `${BASE}/kitchen/coffee plug`,
      JSON.stringify({ state: 'ON', power: 812 }),
    );
    await until(() =>
      delivered.some(
        (message) =>
          message.deviceKey === PLUG.ieee_address &&
          (message.payload as { kind?: string }).kind === 'state',
      ),
    );

    expect(delivered).toContainEqual({
      connectionKey: connection.key,
      deviceKey: PLUG.ieee_address,
      payload: { kind: 'state', state: { state: 'ON', power: 812 } },
    });

    await connection.send(
      { deviceKey: PLUG.ieee_address, op: 'set', args: { payload: { state: 'OFF' } } },
      AbortSignal.timeout(2000),
    );
    await until(() => commands.length > 0);

    expect(commands).toEqual([`${BASE}/${PLUG.ieee_address}/set {"state":"OFF"}`]);

    await listener.endAsync();
    await connection.close();
  });
});
