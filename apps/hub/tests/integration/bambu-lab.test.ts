/**
 * The Bambu Lab bundle against a real broker and a printer that behaves like one.
 *
 * The printer is simulated, because there is not one on the test bench, and the simulation is
 * narrow on purpose: it answers `pushall` with a full report and `ledctrl` with a delta naming
 * only the light, which is what a P1 or an A1 does. Everything between the two ends is real -
 * the transport, the broker, the bundle read off disk and the mapper built from it - so what
 * this proves is the wiring: that a scan finds the printer by its topic, that identifying it asks
 * it for everything on its own request topic, that the answer lands on the right entities, and
 * that a command goes back the way the firmware expects and its effect comes back as state.
 *
 * TLS is the one thing not exercised. The broker here is plain, and a self-signed certificate
 * would need a certificate to sign; `shouldVerifyCertificate` is passed straight through to the
 * client, and the README says what to look at if a real printer refuses the handshake.
 *
 * Requires the development stack:
 *
 * ```
 * pnpm infra:up
 * ```
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { connectAsync, type MqttClient } from 'mqtt';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { parseEntityId, type CapabilityState, type EntityId } from '@nebulahome/contracts';
import { createLogger, type PlatformLogger } from '@nebulahome/logging';
import {
  driverManifestSchema,
  createDeclarativeIntegration,
  integrationProfileSchema,
  resolveManifest,
  vendorManifestSchema,
  type Claim,
  type Integration,
  type MappingContext,
  type TransportConnection,
  type TransportInbound,
} from '@nebulahome/package-runtime';

import { mqttTransport } from '@/transports/mqtt.js';

/** The test broker (`tests/support/broker.ts`). */
const BROKER = inject('mqttUrl');
const BUNDLE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../bundles/bambu-lab');

/** The driver of the P1 and A1 family, which the simulated printer is one of. */
const DRIVER = path.join(BUNDLE, 'printer-p1-a1');

/** A serial unique to this run, so two runs on one broker cannot see each other's printer. */
const SERIAL = `01P00A${String(Date.now()).slice(-9)}`;

/** What the printer holds and reports. */
const printer = {
  isLightOn: false,
  nozzle: 25.4,
  bed: 24.1,
};

let simulator: MqttClient;
let logger: PlatformLogger;
let connection: TransportConnection;
let integration: Integration;
let delivered: TransportInbound[] = [];

/** The light, as the hub would have named it. */
const LIGHT = parseEntityId('light.p1s_chamber_light');

/** The entity ids the hub would have assigned, keyed by object id. */
const ENTITIES = new Map<string, EntityId>([
  ['chamber_light', LIGHT],
  ['nozzle_temperature', parseEntityId('sensor.p1s_nozzle_temperature')],
  ['bed_temperature', parseEntityId('sensor.p1s_bed_temperature')],
  ['printing', parseEntityId('binary_sensor.p1s_printing')],
]);

/** The printer, once the scan has claimed it. */
let claim: Claim | null = null;

/**
 * The printer's claim, which the later cases depend on the first having made.
 *
 * @returns The claim.
 * @throws {Error} When the scan never claimed it, in which case the later cases are moot.
 */
function claimedPrinter(): Claim {
  if (claim === null) {
    throw new Error('the printer was never claimed');
  }

  return claim;
}

/**
 * The first thing the connection delivered.
 *
 * @returns The message.
 * @throws {Error} When nothing arrived in time.
 */
function first(): TransportInbound {
  const message = delivered[0];

  if (message === undefined) {
    throw new Error('nothing was delivered');
  }

  return message;
}

/**
 * A logger that keeps its output out of the test report.
 *
 * @returns The logger.
 */
function silent(): PlatformLogger {
  return createLogger(
    { service: 'hub-bambu', version: '0.0.0', level: 'fatal' },
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
 * Publishes what the simulated printer would, on its report topic.
 *
 * @param message - The body.
 */
async function report(message: unknown): Promise<void> {
  await simulator.publishAsync(`device/${SERIAL}/report`, JSON.stringify(message));
}

/**
 * The full status the printer answers a `pushall` with.
 *
 * @returns The report.
 */
function fullReport(): unknown {
  return {
    print: {
      nozzle_temper: printer.nozzle,
      nozzle_target_temper: 0,
      bed_temper: printer.bed,
      bed_target_temper: 0,
      gcode_state: 'IDLE',
      mc_percent: 0,
      mc_remaining_time: 0,
      lights_report: [{ node: 'chamber_light', mode: printer.isLightOn ? 'on' : 'off' }],
      command: 'push_status',
      msg: 0,
      sequence_id: '1',
    },
  };
}

/**
 * Waits until enough has been delivered, or gives up.
 *
 * @param count - How many messages to wait for.
 */
async function until(count: number): Promise<void> {
  for (let attempt = 0; attempt < 300 && delivered.length < count; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * Reads the states an inbound message produces, by object id.
 *
 * @param message - What arrived.
 * @param claim - The printer's claim.
 * @returns Each entity's state, keyed by object id.
 */
function statesOf(message: TransportInbound, claim: Claim): Map<string, CapabilityState> {
  const byId = new Map([...ENTITIES].map(([objectId, entityId]) => [entityId, objectId]));
  const context: MappingContext = {
    options: {},
    claim,
    entities: ENTITIES,
    lastState: (): undefined => undefined,
  };

  return new Map(
    integration
      .toState(message, context)
      .map((each) => [byId.get(each.entityId) ?? '?', each.state]),
  );
}

beforeAll(async () => {
  logger = silent();

  const manifest = resolveManifest(
    vendorManifestSchema.parse(
      JSON.parse(await readFile(path.join(BUNDLE, 'manifest.json'), 'utf8')),
    ),
    driverManifestSchema.parse(
      JSON.parse(await readFile(path.join(DRIVER, 'driver.json'), 'utf8')),
    ),
  );
  const profile = integrationProfileSchema.parse(
    JSON.parse(await readFile(path.join(DRIVER, 'profile.json'), 'utf8')),
  );

  integration = createDeclarativeIntegration(manifest, profile);

  // The printer: answers a `pushall` with everything, and a `ledctrl` by doing it and saying so
  // with a delta that names the light and nothing else.
  simulator = await connectAsync(BROKER, { reconnectPeriod: 0 });
  await simulator.subscribeAsync(`device/${SERIAL}/request`);
  simulator.on('message', (topic, raw) => {
    const request = JSON.parse(raw.toString('utf8')) as {
      pushing?: { command?: string };
      system?: { command?: string; led_mode?: string };
    };

    if (request.pushing?.command === 'pushall') {
      void report(fullReport());
    }

    if (request.system?.command === 'ledctrl') {
      printer.isLightOn = request.system.led_mode === 'on';
      void report({
        print: {
          lights_report: [{ node: 'chamber_light', mode: printer.isLightOn ? 'on' : 'off' }],
          command: 'push_status',
          msg: 1,
          sequence_id: '2',
        },
      });
    }
  });

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
  await simulator.endAsync();
});

describe('a Bambu Lab printer on the broker', () => {
  it('is found by a scan, and claimed by its serial', async () => {
    const abort = new AbortController();
    const candidates = [];

    // A scan is a subscription that ends when the pass does. The printer speaks while it runs.
    setTimeout(() => {
      void report({ print: { nozzle_temper: printer.nozzle, command: 'push_status' } });
    }, 300);
    setTimeout(() => {
      abort.abort();
    }, 1500);

    for await (const found of mqttTransport.scan(
      { url: BROKER },
      integration.discovery,
      abort.signal,
    )) {
      candidates.push(found);
    }

    const ours = candidates.find((candidate) => candidate.deviceKey === `device/${SERIAL}/report`);

    expect(ours).toBeDefined();

    claim = ours === undefined ? null : integration.claim(ours, {});

    expect(claim?.externalId).toBe(SERIAL);
  });

  it('is asked for everything once identified, and answers with its temperatures', async () => {
    expect(claim).not.toBeNull();

    delivered = [];
    await connection.apply(integration.subscriptions([claimedPrinter()], {}));
    await until(1);

    const states = statesOf(first(), claimedPrinter());

    expect(states.get('nozzle_temperature')).toEqual({ sensor_numeric: { value: 25.4 } });
    expect(states.get('bed_temperature')).toEqual({ sensor_numeric: { value: 24.1 } });
    expect(states.get('printing')).toEqual({ sensor_binary: { isOn: false } });
    expect(states.get('chamber_light')).toEqual({ on_off: { isOn: false } });
  });

  it('turns the light on the way the firmware expects, and hears it come on', async () => {
    expect(claim).not.toBeNull();

    delivered = [];

    const request = integration.toCommand(
      { entityId: LIGHT, capability: 'on_off', command: { command: 'turn_on' } },
      {
        options: {},
        claim: claimedPrinter(),
        entities: ENTITIES,
        lastState: (): undefined => undefined,
      },
    );

    await connection.send(request, AbortSignal.timeout(2000));
    await until(1);

    // The printer answered with a delta naming the light and nothing else, which is what a P1
    // does. Only the light must change.
    const states = statesOf(first(), claimedPrinter());

    expect(printer.isLightOn).toBe(true);
    expect([...states.keys()]).toEqual(['chamber_light']);
    expect(states.get('chamber_light')).toEqual({ on_off: { isOn: true } });
  });
});
