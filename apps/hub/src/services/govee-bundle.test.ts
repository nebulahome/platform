/**
 * The Govee LAN bundle, against a light in this process that speaks the LAN API over UDP.
 *
 * What is checked is what the bundle needs the SDK's UDP sockets for: a scan sent to the multicast
 * group - or to one address, for the device an owner typed - answered on port 4002; a status asked
 * on port 4003 and answered on 4002; the commands the LAN API documents. The light listens on the
 * API's own ports, 4001 and 4003, and the hub on 4002, so the test needs the three free.
 */
import { createSocket, type Socket } from 'node:dgram';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseEntityId, type CapabilityState } from '@nebula-home/contracts';
import { createLogger } from '@nebula-home/logging';
import {
  associateModel,
  createDeclarativeIntegration,
  driverManifestSchema,
  identifySighting,
  integrationProfileSchema,
  resolveManifest,
  vendorManifestSchema,
  type Claim,
  type Integration,
  type MappingContext,
  type Sighting,
  type Transport,
  type TransportInbound,
} from '@nebula-home/package-runtime';

import { loadBundles, type LoadedVendor } from './bundles.js';

/** The bundles, where the service reads them from. */
const BUNDLES = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../bundles');

/** The light's own id, as the LAN API reports it. */
const DEVICE = '1F:80:C5:32:32:36:72:4E';

/** What the light said it is. */
const SKU = 'H618E';

/** Every message the light was sent, in order. */
const heard: { port: number; msg: { cmd: string; data: unknown } }[] = [];

/** The light's state. */
const light = { onOff: 1, brightness: 80, colorTemInKelvin: 3000 };

let scanSocket: Socket;
let commandSocket: Socket;
let govee: LoadedVendor;

/**
 * Answers one datagram the way a Govee light does: to the sender's address, on port 4002.
 *
 * @param socket - The socket it came in on.
 * @param port - Which of the light's ports that is.
 * @param message - What came in.
 * @param from - Who sent it.
 * @param from.address - Their address.
 */
function answer(socket: Socket, port: number, message: Buffer, from: { address: string }): void {
  const { msg } = JSON.parse(message.toString()) as { msg: { cmd: string; data: unknown } };

  heard.push({ port, msg });

  if (msg.cmd === 'scan') {
    const data = { ip: '127.0.0.1', device: DEVICE, sku: SKU, wifiVersionSoft: '1.02.03' };

    socket.send(JSON.stringify({ msg: { cmd: 'scan', data } }), 4002, from.address);
  }

  if (msg.cmd === 'turn') {
    light.onOff = (msg.data as { value: number }).value;
  }

  if (msg.cmd === 'devStatus') {
    socket.send(JSON.stringify({ msg: { cmd: 'devStatus', data: light } }), 4002, from.address);
  }
}

beforeAll(async () => {
  scanSocket = createSocket({ type: 'udp4', reuseAddr: true });
  commandSocket = createSocket('udp4');
  scanSocket.on('message', (message, from) => {
    answer(scanSocket, 4001, message, from);
  });
  commandSocket.on('message', (message, from) => {
    answer(commandSocket, 4003, message, from);
  });

  await new Promise<void>((resolve) => {
    scanSocket.bind(4001, () => {
      scanSocket.addMembership('239.255.255.250');
      resolve();
    });
  });
  await new Promise<void>((resolve) => {
    commandSocket.bind(4003, '127.0.0.1', resolve);
  });

  const { vendors } = await loadBundles({ directory: BUNDLES, runtimeVersion: '1.1.0' });
  const found = vendors.find((vendor) => vendor.manifest.id === 'govee');

  if (found === undefined) {
    throw new Error('The Govee vendor did not load');
  }

  govee = found;
});

afterAll(async () => {
  await govee.release();
  scanSocket.close();
  commandSocket.close();
});

/**
 * The vendor's own transport.
 *
 * @returns It.
 * @throws {Error} When the vendor ships none, which is a broken bundle.
 */
function lan(): Transport {
  const [transport] = govee.ownTransports;

  if (transport === undefined) {
    throw new Error('The Govee vendor ships no transport');
  }

  return transport;
}

/**
 * Builds the light's integration the way the hub builds a declarative driver.
 *
 * @returns The integration.
 */
async function lightLan(): Promise<Integration> {
  const read = async (file: string): Promise<unknown> =>
    JSON.parse(await readFile(path.join(BUNDLES, 'govee', file), 'utf8')) as unknown;

  return createDeclarativeIntegration(
    resolveManifest(
      vendorManifestSchema.parse(await read('manifest.json')),
      driverManifestSchema.parse(await read('light-lan/driver.json')),
    ),
    integrationProfileSchema.parse(await read('light-lan/profile.json')),
  );
}

/**
 * Identifies the light at the address an owner typed, as an instance does.
 *
 * @param integration - The light's integration.
 * @returns The claim.
 */
async function identified(integration: Integration): Promise<Claim> {
  for await (const found of lan().scan(
    { host: '127.0.0.1' },
    integration.discovery,
    AbortSignal.timeout(3000),
  )) {
    const claim = integration.claim(found, {});

    if (claim !== null) {
      return claim;
    }
  }

  throw new Error('The light was not identified');
}

/**
 * A mapping context for the claimed light.
 *
 * @param claim - The claim.
 * @returns The context.
 */
function context(claim: Claim): MappingContext {
  return {
    options: {},
    claim,
    entities: new Map([['', parseEntityId('light.govee_strip')]]),
    lastState: (): CapabilityState | undefined => undefined,
  };
}

describe('the Govee vendor', () => {
  it('ships a transport and a listener of its own', () => {
    expect(govee.ownTransports.map((transport) => transport.id)).toEqual(['govee/lan']);
    expect(govee.discovery?.sources.map((source) => source.kind)).toEqual(['module']);
  });

  it('hears a light answering the scan it multicasts, and knows which model it is', async () => {
    const [source] = govee.discovery?.sources ?? [];
    const plan = govee.discovery?.plan;

    if (source?.kind !== 'module' || plan === undefined) {
      throw new Error('No listener to listen with');
    }

    const stop = new AbortController();
    let sighting: Sighting | undefined;

    for await (const each of source.source.listen(stop.signal)) {
      sighting = each;
      stop.abort();
    }

    const identity = identifySighting(plan, sighting?.payload);

    expect(sighting?.config).toEqual({ host: '127.0.0.1' });
    expect(identity).toMatchObject({ externalId: DEVICE, modelCode: SKU });
    expect(associateModel(plan, identity.modelCode)).toEqual({
      driverId: 'light-lan',
      model: SKU,
      modelChoices: [SKU],
    });
  });

  it('identifies the light at the address an owner typed, by the id it announced', async () => {
    const claim = await identified(await lightLan());

    expect(claim.externalId).toBe(DEVICE);
  });

  it('reads on, brightness and colour temperature from the status it polls', async () => {
    const integration = await lightLan();
    const claim = await identified(integration);
    const delivered: TransportInbound[] = [];
    const connection = await lan().connect(
      { host: '127.0.0.1' },
      {
        logger: createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' }),
        deliver: (message): void => {
          delivered.push(message);
        },
        report: (): void => undefined,
      },
    );

    await connection.apply(
      integration.subscriptions([claim], {}).map((each) => ({
        ...each,
        args: { ...each.args, everyMs: 250 },
      })),
    );

    for (let attempt = 0; attempt < 100 && delivered.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    await connection.close();

    const [message] = delivered;

    if (message === undefined) {
      throw new Error('The status was never read');
    }

    expect(integration.toState(message, context(claim)).map((report) => report.state)).toEqual([
      { on_off: { isOn: true }, level: { level: 80 }, color_temp: { mireds: 333 } },
    ]);
  });

  it('switches, dims and warms the light with the commands the LAN API documents', async () => {
    const integration = await lightLan();
    const claim = await identified(integration);
    const entityId = parseEntityId('light.govee_strip');
    const connection = await lan().connect(
      { host: '127.0.0.1' },
      {
        logger: createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' }),
        deliver: (): void => undefined,
        report: (): void => undefined,
      },
    );

    heard.length = 0;

    for (const command of [
      { capability: 'on_off', command: { command: 'turn_off' } },
      { capability: 'level', command: { command: 'set_level', level: 35 } },
      { capability: 'color_temp', command: { command: 'set_color_temp', mireds: 250 } },
    ] as const) {
      await connection.send(
        integration.toCommand({ entityId, ...command }, context(claim)),
        AbortSignal.timeout(2000),
      );
    }

    for (let attempt = 0; attempt < 100 && heard.length < 3; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    await connection.close();

    expect(heard).toEqual([
      { port: 4003, msg: { cmd: 'turn', data: { value: 0 } } },
      { port: 4003, msg: { cmd: 'brightness', data: { value: 35 } } },
      {
        port: 4003,
        msg: { cmd: 'colorwc', data: { color: { r: 0, g: 0, b: 0 }, colorTemInKelvin: 4000 } },
      },
    ]);
    expect(light.onOff).toBe(0);
  });
});
