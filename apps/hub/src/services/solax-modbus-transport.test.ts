/**
 * The SolaX bundle's Modbus TCP transport, against a Modbus server in this process that answers
 * functions 03 and 04 from a register image.
 *
 * What is checked is the transport's own work: the frames (the MBAP header, a transaction id per
 * request; RTU frames with their CRC for an adapter in transparent mode), one request at a time
 * over one socket, the serial number read where the Home Assistant integration reads it (and
 * byte-swapped at 0x300), the family found by its prefix, the registers grouped into blocks so a
 * poll is a handful of reads and not one per entity, the decoding (scales, 16- and 32-bit signs,
 * low word first), the layout that changes with the register document's version, and what fails:
 * a block the firmware refuses, a unit that says nothing, a port nobody listens on, a serial no
 * table reads. It has not met a real inverter; the vendor README says what that leaves open.
 */
import { readFile } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { parseEntityId, type CapabilityState } from '@nebula-home/contracts';
import { createLogger } from '@nebula-home/logging';
import {
  createDeclarativeIntegration,
  driverManifestSchema,
  integrationProfileSchema,
  resolveManifest,
  vendorManifestSchema,
  type BundleSdk,
  type Discovered,
  type Integration,
  type Transport,
  type TransportInbound,
} from '@nebula-home/package-runtime';

import { createBundleSdk } from './bundle-sdk.js';
import { loadBundles, type LoadedVendor } from './bundles.js';

/** The bundles, where the service reads them from. */
const BUNDLES = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../bundles');

/** The drivers that read over Modbus: the four an owner reads either way, and the retrofit. */
const MODBUS_DRIVERS = [
  'hybrid-single-phase',
  'hybrid-three-phase',
  'inverter-single-phase',
  'inverter-three-phase',
  'modbus-retrofit',
];

/** One request the server received. */
type Request = {
  readonly transaction: number;
  readonly protocol: number;
  readonly length: number;
  readonly unit: number;
  readonly code: number;
  readonly start: number;
  readonly count: number;
};

/** A block the transport planned. */
type Block = { table: 'input' | 'holding'; start: number; count: number };

/** What the transport module exports beside its factory, for the tests that read it directly. */
type TransportModule = {
  default: (sdk: BundleSdk) => Transport;
  crc16: (bytes: Buffer) => number;
  planOf: (family: { id: string }, protocol: number) => Block[];
  isServerHeld: (host: string, port: number) => boolean;
};

/** The families module. */
type FamiliesModule = {
  MODBUS_FAMILIES: readonly { id: string }[];
};

/** Says which exception to answer a read with, if any. */
type Refusal = (table: 'input' | 'holding', start: number, count: number) => number | undefined;

/**
 * Refuses nothing.
 *
 * @returns No exception.
 */
const refuseNothing: Refusal = () => undefined;

/** What a gateway may put in an answer's header in place of the request's own. */
type Echo = { readonly unit?: number; readonly transaction?: number };

/** A server that echoes the request's own. */
const NO_ECHO: Echo = {};

/** How the server behaves. */
const server = {
  framing: 'tcp' as 'tcp' | 'rtu',
  unit: 1,
  input: new Map<number, number>(),
  holding: new Map<number, number>(),

  refuse: refuseNothing,

  /** Whether it swallows requests without answering. */
  isSilent: false,

  /** What it puts in an answer's header instead of the request's own, as some gateways do. */
  echo: NO_ECHO,

  /** Requests it swallows before it starts answering, as a dongle on a weak link loses some. */
  toLose: 0,
  requests: [] as Request[],
  connections: 0,
};

let tcp: Server;
let port = 0;
let solax: LoadedVendor;
let modbus: TransportModule;
let families: FamiliesModule;

/**
 * Seven registers of ASCII, two characters to a register, as an inverter keeps its serial.
 *
 * @param text - The serial.
 * @param isSwapped - Whether each register's bytes are swapped, as some inverters do at 0x300.
 * @returns The registers.
 */
function serialRegisters(text: string, isSwapped = false): number[] {
  const bytes = Buffer.alloc(14);

  bytes.write(text, 'latin1');

  return Array.from({ length: 7 }, (unused, index) => {
    const high = bytes[index * 2] ?? 0;
    const low = bytes[index * 2 + 1] ?? 0;

    return isSwapped ? low * 256 + high : high * 256 + low;
  });
}

/**
 * Writes registers into an image.
 *
 * @param image - The image.
 * @param start - The first address.
 * @param values - The registers.
 */
function put(image: Map<number, number>, start: number, values: readonly number[]): void {
  values.forEach((value, offset) => {
    image.set(start + offset, value);
  });
}

/**
 * A 32-bit value as SolaX lays it out: low word first.
 *
 * @param value - The value, signed or not.
 * @returns The two registers.
 */
function words(value: number): [number, number] {
  const unsigned = value < 0 ? 0x1_00_00_00_00 + value : value;

  return [unsigned % 0x1_00_00, Math.floor(unsigned / 0x1_00_00)];
}

/**
 * A 16-bit register holding a negative number.
 *
 * @param value - The number.
 * @returns The register.
 */
function negative(value: number): number {
  return 0x1_00_00 + value;
}

/**
 * The Modbus CRC, written here independently of the transport's.
 *
 * @param bytes - The frame.
 * @returns The CRC.
 */
function crc(bytes: Buffer): number {
  let value = 0xff_ff;

  for (const byte of bytes) {
    value ^= byte;

    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? (value >>> 1) ^ 0xa0_01 : value >>> 1;
    }
  }

  return value;
}

/**
 * Answers one request the way an inverter does.
 *
 * @param request - The request.
 * @returns The PDU of the answer: the function code and what follows.
 */
function answerPdu(request: Request): Buffer {
  const table = request.code === 0x04 ? 'input' : 'holding';
  const refusal = server.refuse(table, request.start, request.count);

  if (refusal !== undefined) {
    return Buffer.from([request.code | 0x80, refusal]);
  }

  const image = table === 'input' ? server.input : server.holding;
  const pdu = Buffer.alloc(2 + request.count * 2);

  pdu.writeUInt8(request.code, 0);
  pdu.writeUInt8(request.count * 2, 1);

  for (let index = 0; index < request.count; index += 1) {
    pdu.writeUInt16BE(image.get(request.start + index) ?? 0, 2 + index * 2);
  }

  return pdu;
}

/**
 * Serves one socket: reads requests off it, answers each.
 *
 * @param socket - The client.
 */
function serve(socket: Socket): void {
  let buffer = Buffer.alloc(0);

  server.connections += 1;
  socket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);

    for (;;) {
      if (server.framing === 'tcp') {
        if (buffer.length < 12) {
          return;
        }

        const request: Request = {
          transaction: buffer.readUInt16BE(0),
          protocol: buffer.readUInt16BE(2),
          length: buffer.readUInt16BE(4),
          unit: buffer.readUInt8(6),
          code: buffer.readUInt8(7),
          start: buffer.readUInt16BE(8),
          count: buffer.readUInt16BE(10),
        };

        buffer = buffer.subarray(12);
        server.requests.push(request);

        if (server.isSilent || request.unit !== server.unit) {
          continue;
        }

        if (server.toLose > 0) {
          server.toLose -= 1;
          continue;
        }

        const pdu = answerPdu(request);
        const header = Buffer.alloc(7);

        header.writeUInt16BE(server.echo.transaction ?? request.transaction, 0);
        header.writeUInt16BE(0, 2);
        header.writeUInt16BE(pdu.length + 1, 4);
        header.writeUInt8(server.echo.unit ?? request.unit, 6);
        socket.write(Buffer.concat([header, pdu]));
      } else {
        if (buffer.length < 8) {
          return;
        }

        const frame = buffer.subarray(0, 8);

        buffer = buffer.subarray(8);

        if (crc(frame.subarray(0, 6)) !== frame.readUInt16LE(6)) {
          throw new Error('The transport sent an RTU frame with a wrong CRC');
        }

        const request: Request = {
          transaction: 0,
          protocol: 0,
          length: 0,
          unit: frame.readUInt8(0),
          code: frame.readUInt8(1),
          start: frame.readUInt16BE(2),
          count: frame.readUInt16BE(4),
        };

        server.requests.push(request);

        if (server.isSilent || request.unit !== server.unit) {
          continue;
        }

        const body = Buffer.concat([Buffer.from([request.unit]), answerPdu(request)]);
        const check = Buffer.alloc(2);

        check.writeUInt16LE(crc(body), 0);
        socket.write(Buffer.concat([body, check]));
      }
    }
  });
  socket.on('error', () => undefined);
}

/** Fills the image with an X1-Hybrid G4, one reading of each kind the transport decodes. */
function x1HybridG4(): void {
  put(server.holding, 0x00, serialRegisters('H450XXXXXXXXXX'));
  put(server.holding, 0x8b, [1]);
  put(server.input, 0x00, [2470, 11, 237, 2544, 2591, 11, 12, 4986, 30, 2, 299, 329]);
  put(server.input, 0x14, [2393, negative(-22), negative(-541)]);
  put(server.input, 0x18, [26]);
  put(server.input, 0x1c, [82, ...words(1234)]);
  put(server.input, 0x21, words(2345));
  put(server.input, 0x46, [...words(-152), ...words(28670), ...words(620)]);
  put(server.input, 0x50, [22]);
  put(server.input, 0x52, words(65541));
}

beforeAll(async () => {
  tcp = createServer(serve);

  await new Promise<void>((resolve) => {
    tcp.listen(0, '127.0.0.1', resolve);
  });

  const address = tcp.address();

  port = typeof address === 'object' && address !== null ? address.port : 0;

  const { vendors } = await loadBundles({ directory: BUNDLES, runtimeVersion: '1.2.0' });
  const found = vendors.find((vendor) => vendor.manifest.id === 'solax');

  if (found === undefined) {
    throw new Error('The SolaX vendor did not load');
  }

  solax = found;
  modbus = (await import(
    pathToFileURL(path.join(BUNDLES, 'solax/modbus/transport.js')).href
  )) as TransportModule;
  families = (await import(
    pathToFileURL(path.join(BUNDLES, 'solax/modbus/families.js')).href
  )) as FamiliesModule;
});

afterAll(async () => {
  await solax.release();
  await new Promise<void>((resolve) => {
    tcp.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  server.framing = 'tcp';
  server.unit = 1;
  server.input.clear();
  server.holding.clear();
  server.refuse = refuseNothing;
  server.isSilent = false;
  server.echo = NO_ECHO;
  server.toLose = 0;
  server.requests.length = 0;
  x1HybridG4();
});

/**
 * The Modbus transport.
 *
 * @returns It.
 * @throws {Error} When the vendor does not ship it.
 */
function transport(): Transport {
  const found = solax.ownTransports.find((each) => each.id === 'solax/modbus');

  if (found === undefined) {
    throw new Error('The SolaX vendor ships no solax/modbus');
  }

  return found;
}

/**
 * Identifies the unit once, the way identification does.
 *
 * @param config - Settings beyond the address.
 * @returns What it found, if anything.
 */
async function scanned(config: Record<string, unknown> = {}): Promise<Discovered | undefined> {
  for await (const found of transport().scan(
    { host: '127.0.0.1', port, timeoutMs: 1000, ...config },
    {},
    AbortSignal.timeout(10_000),
  )) {
    return found;
  }

  return undefined;
}

/**
 * The payload's values.
 *
 * @param found - What the scan found.
 * @returns Its `values`.
 */
function valuesOf(found: Discovered | undefined): Record<string, unknown> {
  const payload = found?.payload as { values?: Record<string, unknown> } | undefined;

  return payload?.values ?? {};
}

/**
 * Builds one driver's integration the way the hub builds a declarative driver.
 *
 * @param driver - The driver's directory.
 * @returns The integration.
 */
async function integrationOf(driver: string): Promise<Integration> {
  const read = async (file: string): Promise<unknown> =>
    JSON.parse(await readFile(path.join(BUNDLES, 'solax', file), 'utf8')) as unknown;

  return createDeclarativeIntegration(
    resolveManifest(
      vendorManifestSchema.parse(await read('manifest.json')),
      driverManifestSchema.parse(await read(`${driver}/driver.json`)),
    ),
    integrationProfileSchema.parse(await read(`${driver}/profile.json`)),
  );
}

/**
 * The family a planning test is about.
 *
 * @param id - Its id.
 * @returns It.
 * @throws {Error} When there is no such family.
 */
function family(id: string): { id: string } {
  const found = families.MODBUS_FAMILIES.find((each) => each.id === id);

  if (found === undefined) {
    throw new Error(`No family ${id}`);
  }

  return found;
}

describe('the frames', () => {
  it('asks with an MBAP header, a new transaction id each time, function 03 or 04', async () => {
    await scanned();

    const [serial, ...reads] = server.requests;

    expect(serial).toEqual({
      transaction: expect.any(Number) as number,
      protocol: 0,
      length: 6,
      unit: 1,
      code: 0x03,
      start: 0x00,
      count: 7,
    });
    expect(reads.map((each) => each.code)).toEqual([0x04, 0x04, 0x03]);
    expect(new Set(server.requests.map((each) => each.transaction)).size).toBe(
      server.requests.length,
    );
  });

  it('computes the Modbus CRC an RTU frame carries', () => {
    // The textbook frame: read ten holding registers from 0 on unit 1 ends C5 CD.
    expect(modbus.crc16(Buffer.from([0x01, 0x03, 0x00, 0x00, 0x00, 0x0a]))).toBe(0xcd_c5);
  });

  it('speaks RTU over TCP to an adapter in transparent mode, CRC and all', async () => {
    server.framing = 'rtu';

    const found = await scanned({ framing: 'rtu' });

    expect(found?.payload).toMatchObject({ serial: 'H450XXXXXXXXXX', family: 'hybrid_g4_x1' });
    expect(valuesOf(found)).toMatchObject({ grid_power: -152, battery_soc: 82 });
  });

  it('asks the unit the owner named, and nobody else', async () => {
    server.unit = 4;

    const found = await scanned({ unitId: 4 });

    expect(found?.deviceKey).toBe(`127.0.0.1:${String(port)}#4`);
    expect(new Set(server.requests.map((each) => each.unit))).toEqual(new Set([4]));
  });
});

describe('identifying the inverter', () => {
  it('reads the serial at holding 0x0 and knows the family by its prefix', async () => {
    const found = await scanned();

    expect(found?.payload).toMatchObject({
      serial: 'H450XXXXXXXXXX',
      family: 'hybrid_g4_x1',
      model: 'X1-Hybrid G4',
      protocol: 0,
    });
  });

  it('falls back to 0x300 and swaps the bytes back when the inverter swapped them', async () => {
    server.holding.clear();
    put(server.holding, 0x300, serialRegisters('XB3XXXXXXXXXXX', true));
    server.refuse = (table, start) => (table === 'holding' && start === 0x00 ? 2 : undefined);
    put(server.input, 0x400, [3000, 0, 50, 0, 2390, 0, 0, 5000, 0, 0, 55]);
    put(server.input, 0x40d, [40, 1480, 2]);
    put(server.input, 0x414, [1500, 0]);
    put(server.input, 0x423, [...words(12345), ...words(87)]);
    put(server.input, 0x43b, [...words(-420), ...words(1000), ...words(2000)]);

    const found = await scanned();

    expect(server.requests.slice(0, 2).map((each) => each.start)).toEqual([0x00, 0x300]);
    expect(found?.payload).toMatchObject({
      serial: 'XB3XXXXXXXXXXX',
      family: 'mic_g2_x1',
      model: 'X1-Boost',
    });
    expect(valuesOf(found)).toMatchObject({
      pv1_voltage: 300,
      pv1_current: 5,
      ac_voltage: 239,
      grid_frequency: 50,
      ac_current: 5.5,
      inverter_temperature: 40,
      ac_power: 1480,
      run_mode: 'Normal',
      pv_power: 1500,
      yield_total: 1234.5,
      yield_today: 8.7,
      grid_power: -420,
      home_power: 1900,
      feed_in_total: 10,
      consumption_total: 20,
    });
  });

  it('refuses a serial no table reads, naming it', async () => {
    put(server.holding, 0x00, serialRegisters('ZZZ0XXXXXXXXXX'));

    await expect(
      transport().probe({ host: '127.0.0.1', port, timeoutMs: 1000 }, AbortSignal.timeout(5000)),
    ).rejects.toThrow(/serial ZZZ0XXXXXXXXXX is not a SolaX model/);
    expect(await scanned()).toBeUndefined();
  });

  it('says what answered when it works', async () => {
    await expect(
      transport().probe({ host: '127.0.0.1', port, timeoutMs: 1000 }, AbortSignal.timeout(5000)),
    ).resolves.toBe(
      `127.0.0.1:${String(port)} unit 1 answered: X1-Hybrid G4, serial H450XXXXXXXXXX`,
    );
  });
});

describe('reading the registers', () => {
  it('scales, signs and pairs them, low word first', async () => {
    expect(valuesOf(await scanned())).toEqual(
      expect.objectContaining({
        ac_voltage: 247,
        ac_current: 1.1,
        ac_power: 237,
        pv1_voltage: 254.4,
        pv2_voltage: 259.1,
        pv1_current: 1.1,
        pv2_current: 1.2,
        grid_frequency: 49.86,
        inverter_temperature: 30,
        run_mode: 'Normal',
        pv1_power: 299,
        pv2_power: 329,
        pv_power: 628,
        battery_voltage: 239.3,
        battery_current: -2.2,
        battery_power: -541,
        battery_temperature: 26,
        battery_soc: 82,
        battery_discharge_total: 123.4,
        battery_charge_total: 234.5,
        grid_power: -152,
        feed_in_total: 286.7,
        consumption_total: 6.2,
        home_power: 389,
        yield_today: 2.2,
        yield_total: 6554.1,
        battery_mode: 'Feed-in Priority',
      }),
    );
  });

  it('reads the fifth generation the old way below register document 1.00, the new way from it', async () => {
    server.holding.clear();
    put(server.holding, 0x00, serialRegisters('H3BC25XXXXXXXX'));
    put(server.input, 0x6c, [1000]);
    put(server.input, 0x70, [1100]);
    put(server.input, 0x74, [1200]);
    put(server.input, 0x16, [negative(-500)]);
    put(server.input, 0x1c, [40]);
    put(server.input, 0x122, [3000, 45, 1350]);
    put(server.input, 0x129, [negative(-300)]);
    put(server.input, 0x12d, [60]);
    put(server.input, 0x38, [...words(2500), 0, 0, 77]);

    const legacy = await scanned();

    expect(legacy?.payload).toMatchObject({
      family: 'hybrid_g5_x3_pv3',
      model: 'X3-Ultra',
      protocol: 0,
    });
    expect(valuesOf(legacy)).toMatchObject({
      battery_power: -800,
      battery_soc: 40,
      ac_power: 3300,
      pv3_power: 1350,
    });

    put(server.holding, 0x82, [105]);

    const current = await scanned();

    expect(current?.payload).toMatchObject({ protocol: 105 });
    expect(valuesOf(current)).toMatchObject({ battery_power: 2500, battery_soc: 77 });
  });

  it('delivers the rest when the firmware refuses one block', async () => {
    server.refuse = (table, start) => (table === 'input' && start === 0x46 ? 2 : undefined);

    const values = valuesOf(await scanned());

    expect(values).toMatchObject({ battery_soc: 82, pv_power: 628 });
    expect(values).not.toHaveProperty('grid_power');
    expect(values).not.toHaveProperty('home_power');
  });
});

describe('planning the reads', () => {
  it('groups what a family needs into a few blocks, not one read per entity', () => {
    expect(modbus.planOf(family('hybrid_g4_x1'), 0)).toEqual([
      { table: 'input', start: 0x00, count: 0x23 },
      { table: 'input', start: 0x46, count: 0x0e },
      { table: 'holding', start: 0x8b, count: 1 },
    ]);
    // A three-phase inverter has no single-phase output at 0x0 and 0x1: its first block starts later.
    expect(modbus.planOf(family('hybrid_g4_x3'), 0)).toEqual([
      { table: 'input', start: 0x02, count: 0x21 },
      { table: 'input', start: 0x46, count: 0x0e },
      { table: 'input', start: 0x6a, count: 0x0b },
      { table: 'holding', start: 0x8b, count: 1 },
    ]);
  });

  it('starts a block where the integration says older firmware needs one', () => {
    expect(modbus.planOf(family('mic_g2_x1'), 0)).toEqual([
      { table: 'input', start: 0x400, count: 0x27 },
      { table: 'input', start: 0x43b, count: 6 },
    ]);
  });

  it('never asks for more than 100 registers at once', () => {
    for (const each of families.MODBUS_FAMILIES) {
      for (const protocol of [0, 100]) {
        for (const block of modbus.planOf(each, protocol)) {
          expect(block.count, each.id).toBeLessThanOrEqual(100);
        }
      }
    }
  });
});

describe('what fails', () => {
  it('gives up on a unit that says nothing, and says to check the unit id', async () => {
    server.isSilent = true;

    await expect(
      transport().probe({ host: '127.0.0.1', port, timeoutMs: 500 }, AbortSignal.timeout(5000)),
    ).rejects.toThrow(/took the connection, but unit 1 did not answer: check the Modbus unit ID/);
    // Every place the serial may be was tried before giving up.
    expect(server.requests.map((each) => each.start)).toEqual([0x00, 0x300, 0x1a10]);
  });

  it('says what a unit that gives no serial it knows is not', async () => {
    server.holding.clear();
    put(server.holding, 0x00, serialRegisters('ZZZXXXXXXXXXXX'));

    await expect(
      transport().probe({ host: '127.0.0.1', port, timeoutMs: 500 }, AbortSignal.timeout(5000)),
    ).rejects.toThrow(/answers Modbus, but serial ZZZ.*is it a SolaX inverter\?/);
  });

  it('says so when nothing listens on the port', async () => {
    const closed = createServer();

    await new Promise<void>((resolve) => {
      closed.listen(0, '127.0.0.1', resolve);
    });

    const address = closed.address();
    const unused = typeof address === 'object' && address !== null ? address.port : 0;

    await new Promise<void>((resolve) => {
      closed.close(() => {
        resolve();
      });
    });
    await expect(
      transport().probe(
        { host: '127.0.0.1', port: unused, timeoutMs: 1000 },
        AbortSignal.timeout(5000),
      ),
    ).rejects.toThrow(/takes no Modbus TCP connection \(ECONNREFUSED\).*firmware 3\.004\.03/);
  });

  it('takes an answer a gateway sends under another unit id, or transaction 0', async () => {
    server.echo = { unit: 0, transaction: 0 };

    const found = await scanned();

    expect(found?.payload).toMatchObject({ serial: 'H450XXXXXXXXXX', family: 'hybrid_g4_x1' });
    expect(valuesOf(found)).toMatchObject({ battery_soc: 82 });
  });

  it('asks a lost block once more before a poll gives up', async () => {
    const delivered: TransportInbound[] = [];
    const connection = await transport().connect(
      { host: '127.0.0.1', port, timeoutMs: 500 },
      {
        logger: createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' }),
        deliver: (message): void => {
          delivered.push(message);
        },
        report: (): void => undefined,
      },
    );

    server.toLose = 1;
    await connection.apply([
      {
        op: 'poll',
        args: {
          deviceKey: `127.0.0.1:${String(port)}#1`,
          everyMs: 60_000,
          family: 'hybrid_g4_x1',
          protocol: 0,
        },
      },
    ]);

    for (let attempt = 0; attempt < 100 && delivered.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    await connection.close();

    expect(server.requests.slice(0, 2).map((each) => [each.code, each.start])).toEqual([
      [0x04, 0x00],
      [0x04, 0x00],
    ]);
    expect(delivered[0]?.payload).toMatchObject({ values: { battery_soc: 82 } });
  });

  it('asks only for the serial when testing, and for no readings when the sweep asks', async () => {
    await transport().probe({ host: '127.0.0.1', port }, AbortSignal.timeout(5000));

    expect(server.requests.map((each) => [each.code, each.start])).toEqual([[0x03, 0x00]]);

    server.requests.length = 0;

    for await (const found of transport().scan(
      { host: '127.0.0.1', port },
      { identityOnly: true },
      AbortSignal.timeout(5000),
    )) {
      expect(found.payload).toEqual({
        serial: 'H450XXXXXXXXXX',
        family: 'hybrid_g4_x1',
        model: 'X1-Hybrid G4',
        protocol: 0,
      });
    }

    expect(server.requests).toHaveLength(1);
  });

  it('shares one socket with every transport made from the module', async () => {
    const other = modbus.default(
      createBundleSdk({
        version: '1.2.0',
        logger: createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' }),
        openUdpSocket: () => {
          throw new Error('Not in this test');
        },
      }),
    );
    const connection = await transport().connect(
      { host: '127.0.0.1', port },
      {
        logger: createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' }),
        deliver: (): void => undefined,
        report: (): void => undefined,
      },
    );
    const before = server.connections;

    await transport().probe({ host: '127.0.0.1', port }, AbortSignal.timeout(5000));
    await other.probe({ host: '127.0.0.1', port }, AbortSignal.timeout(5000));
    await connection.close();

    expect(server.connections - before).toBe(1);
    expect(modbus.isServerHeld('127.0.0.1', port)).toBe(false);
  });

  it('answers a command with a refusal: this release only reads', async () => {
    const connection = await transport().connect(
      { host: '127.0.0.1', port },
      {
        logger: createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' }),
        deliver: (): void => undefined,
        report: (): void => undefined,
      },
    );

    await expect(
      connection.send({ deviceKey: 'x', op: 'write', args: {} }, AbortSignal.timeout(1000)),
    ).rejects.toThrow(/only reads/);
    await connection.close();
  });
});

describe('through solax/inverter', () => {
  /**
   * The transport the inverter drivers name.
   *
   * @returns It.
   * @throws {Error} When the vendor does not ship it.
   */
  const inverter = (): Transport => {
    const found = solax.ownTransports.find((each) => each.id === 'solax/inverter');

    if (found === undefined) {
      throw new Error('The SolaX vendor ships no solax/inverter');
    }

    return found;
  };

  it('reads over Modbus by default, and says which way it read', async () => {
    const found: Discovered[] = [];

    for await (const each of inverter().scan(
      { host: '127.0.0.1', port },
      {},
      AbortSignal.timeout(5000),
    )) {
      found.push(each);
    }

    expect(found[0]?.payload).toMatchObject({
      serial: 'H450XXXXXXXXXX',
      family: 'hybrid_g4_x1',
      protocol: 0,
      connection: 'modbus',
    });
    expect(valuesOf(found[0])).toMatchObject({ battery_soc: 82 });
  });

  it('says to try the web API when nothing takes the Modbus connection', async () => {
    const closed = createServer();

    await new Promise<void>((resolve) => {
      closed.listen(0, '127.0.0.1', resolve);
    });

    const address = closed.address();
    const unused = typeof address === 'object' && address !== null ? address.port : 0;

    await new Promise<void>((resolve) => {
      closed.close(() => {
        resolve();
      });
    });
    await expect(
      inverter().probe(
        { connection: 'modbus', host: '127.0.0.1', port: unused },
        AbortSignal.timeout(5000),
      ),
    ).rejects.toThrow(/firmware 3\.004\.03.*set Connection to 'Dongle web API'/u);
  });
});

describe('polling', () => {
  it('reads each block once per interval and delivers one payload, over one socket', async () => {
    const integration = await integrationOf('hybrid-single-phase');
    const found = await scanned();

    if (found === undefined) {
      throw new Error('Nothing answered');
    }

    const claim = integration.claim(found, {});

    if (claim === null) {
      throw new Error('Not claimed');
    }

    const subscriptions = integration.subscriptions([claim], {});

    expect(subscriptions).toEqual([
      {
        op: 'poll',
        args: {
          deviceKey: `127.0.0.1:${String(port)}#1`,
          everyMs: 15_000,
          family: 'hybrid_g4_x1',
          protocol: 0,
        },
      },
    ]);
    expect(integration.subscriptions([claim], { pollInterval: 30 })[0]?.args['everyMs']).toBe(
      30_000,
    );

    const delivered: TransportInbound[] = [];
    const connection = await transport().connect(
      { host: '127.0.0.1', port, timeoutMs: 1000 },
      {
        logger: createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' }),
        deliver: (message): void => {
          delivered.push(message);
        },
        report: (): void => undefined,
      },
    );
    const connectionsBefore = server.connections;

    server.requests.length = 0;
    await connection.apply(subscriptions);

    for (let attempt = 0; attempt < 100 && delivered.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    // A probe while the connection is up goes through the same socket.
    await transport().probe(
      { host: '127.0.0.1', port, timeoutMs: 1000 },
      AbortSignal.timeout(5000),
    );
    await connection.close();

    // Twenty-eight entities, three reads: two blocks of input registers and one holding.
    expect(integration.describe(claim, {}).entities).toHaveLength(28);
    expect(server.requests.slice(0, 3).map((each) => [each.code, each.start, each.count])).toEqual([
      [0x04, 0x00, 0x23],
      [0x04, 0x46, 0x0e],
      [0x03, 0x8b, 1],
    ]);
    expect(delivered).toHaveLength(1);
    expect(server.connections - connectionsBefore).toBe(1);

    const ids = new Map(
      integration
        .describe(claim, {})
        .entities.map((entity) => [
          entity.objectId ?? '',
          parseEntityId(`sensor.solax_${entity.objectId ?? 'x'}`),
        ]),
    );
    const [message] = delivered;

    if (message === undefined) {
      throw new Error('Nothing delivered');
    }

    const reports = integration.toState(message, {
      options: {},
      claim,
      entities: ids,
      lastState: (): CapabilityState | undefined => undefined,
    });
    /**
     * One entity's state.
     *
     * @param objectId - Which.
     * @returns Its state.
     */
    const stateOf = (objectId: string): CapabilityState | undefined =>
      reports.find((report) => report.entityId === ids.get(objectId))?.state;

    expect(stateOf('grid_power')).toEqual({ sensor_numeric: { value: -152 } });
    expect(stateOf('battery_power')).toEqual({ sensor_numeric: { value: -541 } });
    expect(stateOf('battery_soc')).toEqual({ sensor_numeric: { value: 82 } });
    expect(stateOf('pv_power')).toEqual({ sensor_numeric: { value: 628 } });
    expect(stateOf('battery_mode')).toEqual({ sensor_text: { value: 'Feed-in Priority' } });
  });

  it('asks every driver for 15 s by default, 5 s at the least, and warns under 10 s', () => {
    for (const driver of solax.drivers.filter((each) => MODBUS_DRIVERS.includes(each.driverId))) {
      expect(['solax/inverter', 'solax/modbus'], driver.driverId).toContain(
        driver.manifest.transport,
      );
      expect(
        driver.setup.transport.fields.map((field) => field.key),
        driver.driverId,
      ).toEqual(expect.arrayContaining(['host', 'port', 'unitId', 'framing']));
      expect(
        driver.setup.options.fields.find((field) => field.key === 'pollInterval'),
        driver.driverId,
      ).toMatchObject({ default: 15, min: 5, warnBelow: 10 });
    }
  });

  it('claims every family in exactly one driver, and names a model for every prefix', async () => {
    const claimed = new Map<string, string>();
    const ids = new Set(families.MODBUS_FAMILIES.map((each) => each.id));

    for (const driver of MODBUS_DRIVERS) {
      const profile = integrationProfileSchema.parse(
        JSON.parse(await readFile(path.join(BUNDLES, 'solax', driver, 'profile.json'), 'utf8')),
      );
      const condition = profile.discovery.claim.find((each) => each.path === 'family');
      const oneOf = condition !== undefined && 'oneOf' in condition ? condition.oneOf : [];

      for (const id of oneOf.filter((each) => ids.has(String(each)))) {
        expect(claimed.get(String(id)), `${String(id)} claimed twice`).toBeUndefined();
        claimed.set(String(id), driver);
      }
    }

    expect([...claimed.keys()].sort()).toEqual(
      families.MODBUS_FAMILIES.map((each) => each.id).sort(),
    );
  });
});
