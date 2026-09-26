/**
 * The SolaX bundle's dongle API, against a Pocket WiFi in this process that answers as the
 * `solax` library's test fixtures do.
 *
 * What is checked is what the bundle's own transport, `solax/local`, is for: the request the
 * dongle takes (a POST with the form and the password, the `X-Forwarded-For` header, the query
 * string of the older firmware, the X-Hybrid's own page), the family read from `type` and from
 * how many registers came back, the decoding the profiles cannot do (tenths, hundredths, signs,
 * two registers making one counter, a code standing for a word), the entities the profiles read
 * from what is delivered, and the answers that are not data: a refused password, text instead
 * of JSON, a type no table reads. The register values are the library's samples, re-typed.
 */
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { createServer as createTcpServer, type Server as TcpServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  parseEntityId,
  type CapabilityState,
  type EntityId,
  type JsonObject,
} from '@nebula-home/contracts';
import { createLogger } from '@nebula-home/logging';
import {
  createDeclarativeIntegration,
  driverManifestSchema,
  integrationProfileSchema,
  resolveManifest,
  vendorManifestSchema,
  type Discovered,
  type Integration,
  type MappingContext,
  type Transport,
  type TransportInbound,
} from '@nebula-home/package-runtime';

import { loadBundles, type LoadedVendor } from './bundles.js';

/** The bundles, where the service reads them from. */
const BUNDLES = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../bundles');

/** The dongle's registration number, which is its password. */
const PASSWORD = 'SRXXXXXXXX';

/** The drivers that read the dongle API. */
const LOCAL_DRIVERS = [
  'ev-charger',
  'hybrid-single-phase',
  'hybrid-three-phase',
  'inverter-single-phase',
  'inverter-three-phase',
];

/** One request the fake dongle received. */
type Asked = {
  readonly method: string;
  readonly url: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
};

/** How the fake dongle behaves. */
type Dongle = {
  /**
   * The one way of asking it answers; every other way gets `failed`. `hotspot` is a newer
   * firmware's form POST that names the dongle's hotspot as its host, and `locked` a firmware
   * that answers every POST from the LAN with a 405.
   */
  accepts: 'body' | 'hotspot' | 'query' | 'legacy' | 'locked';

  /** Its password; the empty string for none. */
  password: string;

  /** What it answers with when asked the right way with the right password. */
  answer: string;
};

/** Every request, in order. */
const asked: Asked[] = [];

let dongle: Dongle;
let server: Server;
let host = '';
let solax: LoadedVendor;

/**
 * The fake dongle's answer: the library's shape, `Data` built from a few registers.
 *
 * @param type - The inverter type, a code or a model string.
 * @param length - How many registers.
 * @param registers - The ones that are not zero, by index.
 * @param information - `Information`, as the dongle sends it.
 * @returns The JSON text.
 */
function answerOf(
  type: number | string,
  length: number,
  registers: Readonly<Record<number, number>>,
  information: readonly (number | string)[] = [
    5,
    0,
    'H450XXXXXXXXXX',
    8,
    1.24,
    0,
    1.21,
    1.03,
    0,
    1,
  ],
): string {
  const data = Array.from({ length }, (unused, index) => registers[index] ?? 0);

  return JSON.stringify({
    sn: PASSWORD,
    ver: '3.006.04',
    type,
    Data: data,
    Information: information,
  });
}

/**
 * A 16-bit register holding a negative number, as the dongle sends it.
 *
 * @param value - The negative number.
 * @returns The register.
 */
function negative(value: number): number {
  return 0x1_00_00 + value;
}

/** An X1-Hybrid G4, from the library's `X1_HYBRID_G4_RESPONSE`. */
const X1_HYBRID_G4 = answerOf(15, 200, {
  0: 2470,
  1: 11,
  2: 237,
  3: 4986,
  4: 2544,
  5: 2591,
  6: 11,
  7: 12,
  8: 299,
  9: 329,
  11: 3986,
  13: 22,
  14: 23930,
  15: 220,
  16: 541,
  17: 26,
  18: 82,
  26: 30,
  32: 1,
  34: 28670,
  36: 620,
});

/** An X3-Hybrid G4, from the library's `X3_HYBRID_G4_RESPONSE`: 300 registers, type 14. */
const X3_HYBRID_G4 = answerOf(14, 300, {
  0: 2383,
  6: 33,
  7: 81,
  8: 76,
  14: 45,
  15: 58,
  16: 5001,
  19: 2,
  34: 65384,
  35: 65535,
  54: 23,
  68: 44,
  70: 1,
  88: 2009,
  103: 30,
  105: 22,
  168: 0,
  169: 23460,
});

/** A Q.VOLT HYB-G3-3P: type 14 too, but 200 registers, from `QVOLTHYBG33P_RESPONSE_V34`. */
const QVOLT = answerOf(14, 200, {
  6: 162,
  7: 136,
  8: 146,
  9: 444,
  14: 1050,
  15: 977,
  34: 65529,
  35: 65535,
  41: 1616,
  70: 36,
  82: 118,
  103: 95,
  168: 0,
});

/** An X1-Boost on firmware 2.034, from `X1_BOOST_RESPONSE`: type 4, 200 registers. */
const X1_BOOST = answerOf(4, 200, {
  0: 2396,
  1: 126,
  2: 2956,
  7: 1777,
  8: 1336,
  9: 6021,
  11: 1215,
  13: 137,
  39: 43,
  41: 80,
  48: 10,
  49: 65535,
  50: 87,
  52: 8184,
  55: 41,
});

/** An X3-MIC PRO G2, from `X3_MICPRO_G2_RESPONSE`. */
const X3_MIC_PRO_G2 = answerOf(16, 100, {
  6: 1018,
  7: 992,
  8: 970,
  15: 1544,
  16: 1531,
  21: 2,
  22: 7957,
  24: 200,
  72: 2707,
  74: 188,
  75: 1,
});

/** An X3-EVC charging: type 1, 96 registers. */
const X3_EVC = answerOf(1, 96, {
  0: 2,
  1: 2,
  2: 23012,
  5: 1050,
  8: 2416,
  11: 7200,
  12: 53,
  14: 10000,
  15: 1,
  23: 31,
});

/**
 * An X1-Boost-Air-Mini on the older firmware: a model string for a type, 69 real numbers, and
 * only the query string understood.
 */
const X1_MINI_OLD = JSON.stringify({
  type: 'X1-Boost-Air-Mini',
  SN: PASSWORD,
  ver: '2.32.6',
  Data: Array.from(
    { length: 69 },
    (unused, index) =>
      ({ 2: 344.6, 5: 237.7, 6: 290, 7: 38, 9: 1234.5, 10: -25, 11: 290 })[index] ?? 0,
  ),
  Information: [2.5, 4, 'X1-Boost-Air-Mini', 'XBU0XXXXXXXXXX', 1, 3.25, 1.09, 1.1, 0],
});

/**
 * An X-Hybrid's own page, with the empty slots the firmware leaves in `Data` - 58 of them, the
 * shape of the library's `realTimeData.htm` sample.
 */
const X_HYBRID = `{"method":"uploadsn","version":"Solax_SI_CH_2nd_20160912_DE02","type":"AL_SE","SN":"XXXXXXX","Data":[${[
  '1.9',
  '1.8',
  '344.6',
  '237.7',
  '4.4',
  '247.6',
  '1054',
  '34',
  '7.9',
  '15271.4',
  '804',
  '654',
  '427',
  '57.37',
  '0.01',
  '0',
  '18',
  '100',
  '0.0',
  '1877.2',
  ...Array.from({ length: 36 }, () => ''),
  '0',
  '8',
].join(',')}],"Status":"2"}`;

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = '';

    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('end', () => {
      const url = request.url ?? '';
      const method = request.method ?? '';

      asked.push({ method, url, headers: request.headers, body });

      const form = dongle.password === '' ? '' : `pwd=${dongle.password}`;
      const isBody = method === 'POST' && url === '/';
      const isQuery = method === 'POST' && url.startsWith('/?optType=ReadRealTimeData');
      const isLegacy = method === 'GET' && url === '/api/realTimeData.htm';
      const isHotspot = isBody && request.headers.host === '5.8.8.8';
      const taken =
        (dongle.accepts === 'body' && isBody) ||
        (dongle.accepts === 'hotspot' && isHotspot) ||
        (dongle.accepts === 'query' && isQuery) ||
        (dongle.accepts === 'legacy' && isLegacy);

      if (
        (dongle.accepts === 'hotspot' && isBody && !isHotspot) ||
        (dongle.accepts === 'locked' && method === 'POST')
      ) {
        response.writeHead(405, { 'content-type': 'text/plain' }).end('Method Not Allowed');

        return;
      }

      if (!taken) {
        response.writeHead(isLegacy ? 404 : 200, { 'content-type': 'text/plain' }).end('failed');

        return;
      }

      const offered = isBody ? body : url;

      if (!isLegacy && form !== '' && !offered.includes(form)) {
        response.writeHead(401, { 'content-type': 'text/html' }).end('<H1>401 Unauthorized</H1>');

        return;
      }

      response.writeHead(200, { 'content-type': 'application/json' }).end(dongle.answer);
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();

  host = typeof address === 'object' && address !== null ? `127.0.0.1:${String(address.port)}` : '';

  const { vendors } = await loadBundles({ directory: BUNDLES, runtimeVersion: '1.2.0' });
  const found = vendors.find((vendor) => vendor.manifest.id === 'solax');

  if (found === undefined) {
    throw new Error('The SolaX vendor did not load');
  }

  solax = found;
});

afterAll(async () => {
  await solax.release();
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  asked.length = 0;
  dongle = { accepts: 'body', password: PASSWORD, answer: X1_HYBRID_G4 };
});

/**
 * A server that answers each connection with raw text and closes only when the answer is not
 * HTTP - as the small web servers on some dongles do.
 *
 * @param answerOf - What to answer the connection with, by its index.
 * @returns Where it listens, and how to stop it.
 */
async function rawServer(
  answerOf: (index: number) => string,
): Promise<{ readonly host: string; readonly close: () => Promise<void> }> {
  let connections = 0;
  const raw: TcpServer = createTcpServer((socket) => {
    const answer = answerOf(connections);

    connections += 1;
    socket.on('error', () => undefined);
    socket.once('data', () => {
      if (answer.startsWith('HTTP/')) {
        socket.write(answer);
      } else {
        socket.end(answer);
      }
    });
  });

  await new Promise<void>((resolve) => {
    raw.listen(0, '127.0.0.1', resolve);
  });

  const address = raw.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;

  return {
    host: `127.0.0.1:${String(port)}`,
    close: async () =>
      new Promise<void>((resolve) => {
        raw.close(() => {
          resolve();
        });
        // A connection the dongle kept open is not the test's to wait for.
        raw.unref();
      }),
  };
}

/**
 * The dongle transport.
 *
 * @returns It.
 * @throws {Error} When the vendor ships none, which is a broken bundle.
 */
function local(): Transport {
  const transport = solax.ownTransports.find((each) => each.id === 'solax/local');

  if (transport === undefined) {
    throw new Error('The SolaX vendor ships no solax/local');
  }

  return transport;
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
 * Reads the fake dongle once, the way identification does.
 *
 * @param config - The transport settings beyond the host.
 * @returns What it found, if anything.
 */
async function scanned(config: JsonObject = {}): Promise<Discovered | undefined> {
  for await (const found of local().scan(
    { host, password: PASSWORD, ...config },
    {},
    AbortSignal.timeout(10_000),
  )) {
    return found;
  }

  return undefined;
}

/**
 * The payload's values, for the assertions.
 *
 * @param found - What the scan found.
 * @returns Its `values`.
 */
function valuesOf(found: Discovered | undefined): Record<string, unknown> {
  const payload = found?.payload as { values?: Record<string, unknown> } | undefined;

  return payload?.values ?? {};
}

/**
 * A mapping context naming every entity of a profile as `sensor.<objectId>`.
 *
 * @param integration - The integration.
 * @param found - The device it claimed.
 * @returns The context, and the ids by object id.
 * @throws {Error} When the integration does not claim the device.
 */
function contextFor(
  integration: Integration,
  found: Discovered,
): { context: MappingContext; ids: Map<string, EntityId> } {
  const claim = integration.claim(found, {});

  if (claim === null) {
    throw new Error('Not claimed');
  }

  const ids = new Map(
    integration
      .describe(claim, {})
      .entities.map((entity) => [
        entity.objectId ?? '',
        parseEntityId(`sensor.solax_${entity.objectId ?? 'x'}`),
      ]),
  );

  return {
    ids,
    context: {
      options: {},
      claim,
      entities: ids,
      lastState: (): CapabilityState | undefined => undefined,
    },
  };
}

describe('asking the dongle', () => {
  it('posts the form with the registration number and the forwarded-for header', async () => {
    const found = await scanned();

    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      method: 'POST',
      url: '/',
      body: `optType=ReadRealTimeData&pwd=${PASSWORD}`,
    });
    expect(asked[0]?.headers['x-forwarded-for']).toBe('5.8.8.8');
    expect(asked[0]?.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(found?.deviceKey).toBe(host);
  });

  it('asks an older dongle with the query string, trailing & and all, and keeps that way', async () => {
    dongle = { accepts: 'query', password: PASSWORD, answer: X1_MINI_OLD };

    const found = await scanned();

    expect(asked.map((each) => `${each.method} ${each.url}`)).toEqual([
      'POST /',
      'POST /',
      `POST /?optType=ReadRealTimeData&pwd=${PASSWORD}&`,
    ]);
    expect(found?.payload).toMatchObject({ family: 'x1_mini', model: 'X1-Boost-Air-Mini' });

    asked.length = 0;
    await scanned();

    // The way that worked is asked first from then on: one request, not a sweep.
    expect(asked.map((each) => `${each.method} ${each.url}`)).toEqual([
      `POST /?optType=ReadRealTimeData&pwd=${PASSWORD}&`,
    ]);
  });

  it("reads an X-Hybrid's own page, empty slots and all, without a password", async () => {
    dongle = { accepts: 'legacy', password: '', answer: X_HYBRID };

    const found = await scanned();

    expect(asked.at(-1)).toMatchObject({ method: 'GET', url: '/api/realTimeData.htm' });
    expect(found?.payload).toMatchObject({ family: 'x_hybrid', model: 'AL_SE', sn: 'XXXXXXX' });
    expect(valuesOf(found)).toMatchObject({
      grid_power: 804,
      pv_power: 1081,
      battery_soc: 100,
      battery_voltage: 57.37,
      feed_in_total: 0,
    });
  });

  it('asks a newer dongle that turns the LAN away in the name of its own hotspot', async () => {
    dongle = { accepts: 'hotspot', password: PASSWORD, answer: X1_HYBRID_G4 };

    const found = await scanned();
    const answered = asked.find((each) => each.headers.host === '5.8.8.8');

    // Refused when it names the address it was reached at, answered when it names its hotspot.
    expect(asked.some((each) => each.method === 'POST' && each.headers.host === host)).toBe(true);
    expect(answered).toMatchObject({ method: 'POST', url: '/' });
    expect(answered?.headers['x-forwarded-for']).toBe('5.8.8.8');
    expect(found?.payload).toMatchObject({ family: 'x1_hybrid_gen4' });
  });

  it('says a dongle whose firmware closed its local API should be read over Modbus TCP', async () => {
    dongle = { accepts: 'locked', password: PASSWORD, answer: X1_HYBRID_G4 };

    await expect(
      local().probe({ host, password: PASSWORD }, AbortSignal.timeout(10_000)),
    ).rejects.toThrow(/HTTP 405 every way.*Modbus TCP.*port 502/u);
  });

  it('takes the answer as soon as it is whole, from a dongle that keeps the connection open', async () => {
    // A 405 with no length and the connection left open, then data the same way: nothing waits
    // for an end that never comes.
    const answers = [
      'HTTP/1.1 405 Method Not Allowed\r\nConnection: keep-alive\r\n\r\n',
      `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: keep-alive\r\n\r\n${X1_HYBRID_G4}`,
    ];
    const rude = await rawServer((index) => answers[Math.min(index, answers.length - 1)] ?? '');

    try {
      const startedMs = Date.now();

      await expect(
        local().probe({ host: rude.host, password: PASSWORD }, AbortSignal.timeout(8000)),
      ).resolves.toContain('X1-Hybrid G4');
      expect(Date.now() - startedMs).toBeLessThan(2000);
    } finally {
      await rude.close();
    }
  });

  it('says an address that answers something other than HTTP is not a dongle', async () => {
    const other = await rawServer(() => 'Path not managed');

    try {
      await expect(
        local().probe({ host: other.host, password: PASSWORD }, AbortSignal.timeout(8000)),
      ).rejects.toThrow(/not HTTP.*not a SolaX dongle/u);
    } finally {
      await other.close();
    }
  });

  it("sends the web page's username and the password as Basic credentials when given", async () => {
    dongle = { accepts: 'body', password: PASSWORD, answer: X1_HYBRID_G4 };

    await local().probe(
      { host, username: 'admin', password: PASSWORD },
      AbortSignal.timeout(10_000),
    );

    expect(asked.at(-1)?.headers.authorization).toBe(
      `Basic ${Buffer.from(`admin:${PASSWORD}`).toString('base64')}`,
    );
    expect(asked.at(-1)?.body).toContain(`pwd=${PASSWORD}`);
  });

  it('says a refused password in the words an owner can act on', async () => {
    dongle = { accepts: 'body', password: 'SOMETHINGELSE', answer: X1_HYBRID_G4 };

    await expect(
      local().probe({ host, password: PASSWORD }, AbortSignal.timeout(10_000)),
    ).rejects.toThrow(/refused the password \(HTTP 401\)/);
    expect(await scanned()).toBeUndefined();
  });

  it('says an answer that is not data is not data, and finds nothing', async () => {
    dongle = { accepts: 'body', password: PASSWORD, answer: 'failed' };

    await expect(
      local().probe({ host, password: PASSWORD }, AbortSignal.timeout(10_000)),
    ).rejects.toThrow(/not with real-time data/);
    expect(await scanned()).toBeUndefined();
  });

  it('names a type no table reads, and the registers it came with', async () => {
    dongle = { accepts: 'body', password: PASSWORD, answer: answerOf(99, 100, { 0: 1 }) };

    await expect(
      local().probe({ host, password: PASSWORD }, AbortSignal.timeout(10_000)),
    ).rejects.toThrow(/type 99 with 100 registers/);
  });

  it('takes nothing but zeros for an inverter asleep, not for readings', async () => {
    dongle = { accepts: 'body', password: PASSWORD, answer: answerOf(15, 200, {}) };

    await expect(
      local().probe({ host, password: PASSWORD }, AbortSignal.timeout(10_000)),
    ).rejects.toThrow(/nothing but zeros/);
  });

  it('says what answered when it works', async () => {
    await expect(
      local().probe({ host, password: PASSWORD }, AbortSignal.timeout(10_000)),
    ).resolves.toBe(`${host} answered: X1-Hybrid G4, dongle ${PASSWORD}, battery at 82 %`);
  });
});

describe('reading the registers', () => {
  it('scales, signs and pairs an X1-Hybrid G4 the way the library does', async () => {
    const found = await scanned();

    expect(found?.payload).toMatchObject({
      sn: PASSWORD,
      type: 15,
      family: 'x1_hybrid_gen4',
      model: 'X1-Hybrid G4',
      inverterSn: 'H450XXXXXXXXXX',
    });
    expect(valuesOf(found)).toEqual(
      expect.objectContaining({
        ac_voltage: 247,
        ac_current: 1.1,
        ac_power: 237,
        grid_frequency: 49.86,
        pv1_power: 299,
        pv2_power: 329,
        pv_power: 628,
        yield_total: 398.6,
        yield_today: 2.2,
        battery_voltage: 239.3,
        battery_current: 2.2,
        battery_power: 541,
        battery_soc: 82,
        inverter_temperature: 30,
        grid_power: 1,
        feed_in_total: 286.7,
        consumption_total: 6.2,
        home_power: 236,
      }),
    );
  });

  it('reads a discharging battery and an import as negative', async () => {
    dongle.answer = answerOf(15, 200, {
      2: 900,
      14: 23930,
      15: negative(-220),
      16: negative(-541),
      32: negative(-300),
    });

    expect(valuesOf(await scanned())).toMatchObject({
      battery_current: -2.2,
      battery_power: -541,
      grid_power: -300,
      home_power: 1200,
    });
  });

  it('reads a 32-bit grid power, a two-register voltage and the modes of an X3-Hybrid G4', async () => {
    dongle.answer = X3_HYBRID_G4;

    const found = await scanned();

    expect(found?.payload).toMatchObject({ family: 'x3_hybrid_g4', model: 'X3-Hybrid G4' });
    expect(valuesOf(found)).toMatchObject({
      grid_power: -152,
      ac_power: 190,
      home_power: 342,
      battery_voltage: 234.6,
      battery_soc: 30,
      run_mode: 'Normal',
      battery_mode: 'Self Use Mode',
      yield_total: 4.4,
      consumption_total: 20.09,
      pv_power: 103,
    });
  });

  it('tells a Q.VOLT from an X3-Hybrid G4 by the registers it answers with, unless told', async () => {
    dongle.answer = QVOLT;

    const automatic = await scanned();

    expect(automatic?.payload).toMatchObject({
      family: 'qvolt_hyb_g3_3p',
      model: 'Q.VOLT HYB-G3-3P',
      manufacturer: 'Qcells',
    });
    expect(valuesOf(automatic)).toMatchObject({ grid_power: -7, ac_power: 444, yield_today: 11.8 });

    const picked = await scanned({ family: 'x3_hybrid_g4' });

    expect(picked?.payload).toMatchObject({ family: 'x3_hybrid_g4' });
    expect(valuesOf(picked)).toMatchObject({ grid_power: -7, ac_power: 444, yield_today: 3.6 });
  });

  it('reads type 4 with the X1-Boost table unless the owner picks the X1-Mini one', async () => {
    dongle.answer = X1_BOOST;

    expect(valuesOf(await scanned())).toMatchObject({
      ac_power: 2956,
      grid_frequency: 60.21,
      yield_total: 121.5,
      grid_power: 10,
      feed_in_total: 0.87,
      consumption_total: 81.84,
      inverter_temperature: 43,
    });
    expect(valuesOf(await scanned({ family: 'x1_mini_v34' }))).toMatchObject({
      feed_in_total: 8,
      inverter_temperature: 41,
    });
    expect(valuesOf(await scanned({ family: 'x1_mini_v34' }))).not.toHaveProperty('grid_power');
  });

  it('reads the feed-in of an X3-MIC PRO G2 as one 32-bit number', async () => {
    dongle.answer = X3_MIC_PRO_G2;

    expect(valuesOf(await scanned())).toMatchObject({
      grid_power: 2707,
      ac_power: 2980,
      home_power: 273,
      pv_power: 3075,
      run_mode: 'Normal',
      yield_total: 795.7,
      yield_today: 20,
      feed_in_total: 657.24,
    });
  });

  it('reads the X3-EVC as a charger, its lifetime counter unsigned', async () => {
    dongle.answer = X3_EVC;

    const found = await scanned();

    expect(found?.payload).toMatchObject({ family: 'x3_evc', model: 'X3-EVC' });
    expect(valuesOf(found)).toMatchObject({
      charger_state: 'Charging',
      charger_mode: 'ECO',
      ac_voltage_l1: 230.12,
      ac_current_l1: 10.5,
      ac_power: 7200,
      session_energy: 5.3,
      total_energy: 7553.6,
      plug_temperature: 31,
    });
  });
});

describe('the drivers', () => {
  it('claim each family by what the transport decided, and nothing else', async () => {
    dongle.answer = X3_HYBRID_G4;

    const x3 = await scanned();

    dongle.answer = X1_HYBRID_G4;

    const x1 = await scanned();

    if (x3 === undefined || x1 === undefined) {
      throw new Error('Nothing answered');
    }

    const threePhase = await integrationOf('hybrid-three-phase');
    const singlePhase = await integrationOf('hybrid-single-phase');

    expect(threePhase.claim(x3, {})?.externalId).toBe(PASSWORD);
    expect(threePhase.claim(x1, {})).toBeNull();
    expect(singlePhase.claim(x1, {})?.externalId).toBe(PASSWORD);
    expect(singlePhase.claim(x3, {})).toBeNull();
  });

  it('take an older X3-MIC as a three-phase inverter, and not an older X3-Hybrid', async () => {
    const inverter = await integrationOf('inverter-three-phase');
    /**
     * An older dongle's answer for a model string.
     *
     * @param type - The model string.
     * @returns What the scan would have found.
     */
    const older = (type: string): Discovered => ({
      deviceKey: host,
      payload: { sn: PASSWORD, ver: '2.033.20', type, family: 'x3', model: type, values: {} },
    });

    expect(inverter.claim(older('X3-MIC'), {})).not.toBeNull();
    expect(inverter.claim(older('X3-Hybiyd-G3'), {})).toBeNull();
  });

  it('turn what the transport delivers into readings the energy card can use', async () => {
    dongle.answer = X3_HYBRID_G4;

    const found = await scanned();

    if (found === undefined) {
      throw new Error('Nothing answered');
    }

    const integration = await integrationOf('hybrid-three-phase');
    const { context, ids } = contextFor(integration, found);
    const reports = integration.toState(
      { connectionKey: 'solax/local', deviceKey: host, payload: found.payload },
      context,
    );
    /**
     * One entity's state.
     *
     * @param objectId - Which.
     * @returns Its state.
     */
    const stateOf = (objectId: string): CapabilityState | undefined =>
      reports.find((report) => report.entityId === ids.get(objectId))?.state;

    expect(stateOf('grid_power')).toEqual({ sensor_numeric: { value: -152 } });
    expect(stateOf('home_power')).toEqual({ sensor_numeric: { value: 342 } });
    expect(stateOf('battery_soc')).toEqual({ sensor_numeric: { value: 30 } });
    // Energy is registered in the catalogue's canonical unit: 4.4 kWh is 4400 Wh.
    expect(stateOf('yield_total')?.sensor_numeric?.value).toBeCloseTo(4400);
    expect(stateOf('run_mode')).toEqual({ sensor_text: { value: 'Normal' } });
    expect(stateOf('battery_mode')).toEqual({ sensor_text: { value: 'Self Use Mode' } });
    expect(
      integration
        .describe(context.claim, {})
        .entities.find((each) => each.objectId === 'grid_power'),
    ).toMatchObject({ deviceClass: 'power', unitOfMeasurement: 'W' });
  });

  it('read every value the profiles name from some family they claim', async () => {
    const transport = (await import(
      pathToFileURL(path.join(BUNDLES, 'solax/local/transport.js')).href
    )) as {
      decodeAnswer: (
        text: string,
        variant: 'body' | 'query' | 'legacy',
        chosen: string,
      ) => { kind: string; payload?: { family: string; values: Record<string, unknown> } };
    };
    const ones = (length: number): number[] => Array.from({ length }, () => 1);
    const answers: [string, 'body' | 'query' | 'legacy'][] = [
      [JSON.stringify({ sn: 'S', ver: '1', type: 'AL_SE', Data: ones(58) }), 'legacy'],
      [JSON.stringify({ sn: 'S', ver: '1', type: 'X1-Boost-Air-Mini', Data: ones(69) }), 'query'],
      [JSON.stringify({ sn: 'S', ver: '1', type: 'X1-Hybiyd-G3', Data: ones(102) }), 'query'],
      [JSON.stringify({ sn: 'S', ver: '1', type: 'X3-MIC', Data: ones(102) }), 'query'],
      ...[
        [4, 200],
        [4, 69],
        [8, 100],
        [18, 100],
        [15, 200],
        [103, 200],
        [5, 200],
        [14, 200],
        [14, 300],
        [16, 100],
        [25, 300],
        [1, 96],
      ].map(([type, length]): [string, 'body'] => [
        JSON.stringify({ sn: 'S', ver: '1', type, Data: ones(length ?? 0) }),
        'body',
      ]),
    ];
    const delivered = new Map<string, Set<string>>();

    for (const [text, variant] of answers) {
      const outcome = transport.decodeAnswer(text, variant, 'auto');

      if (outcome.payload === undefined) {
        throw new Error(`Not decoded: ${text.slice(0, 60)}`);
      }

      delivered.set(outcome.payload.family, new Set(Object.keys(outcome.payload.values)));
    }

    // Sixteen families, every one of them decoded from its answer.
    expect(delivered.size).toBe(16);

    for (const driver of LOCAL_DRIVERS) {
      const profile = integrationProfileSchema.parse(
        JSON.parse(await readFile(path.join(BUNDLES, 'solax', driver, 'profile.json'), 'utf8')),
      );
      const claimed = profile.discovery.claim.find((each) => each.path === 'family');
      const families = claimed !== undefined && 'oneOf' in claimed ? claimed.oneOf.map(String) : [];

      for (const entity of profile.entities) {
        const source = Object.values(entity.state)
          .flatMap((fields) => Object.values(fields))
          .find((value): value is string => typeof value === 'string');
        const name = source?.replace(/^values\./, '') ?? '';

        expect(
          families.some((family) => delivered.get(family)?.has(name) === true),
          `${driver} reads ${name}, which none of ${families.join(', ')} delivers`,
        ).toBe(true);
      }
    }
  });
});

describe('polling the dongle', () => {
  it('asks every driver for 30 s by default, 5 s at the least, and warns under 10 s', () => {
    for (const driver of solax.drivers.filter((each) => LOCAL_DRIVERS.includes(each.driverId))) {
      const field = driver.setup.options.fields.find((each) => each.key === 'pollInterval');

      expect(field, driver.driverId).toMatchObject({
        type: 'number',
        default: 30,
        min: 5,
        warnBelow: 10,
      });
    }
  });

  it("reads every 30 s until the owner says otherwise, and then at the owner's pace", async () => {
    const integration = await integrationOf('hybrid-single-phase');
    const found = await scanned();

    if (found === undefined) {
      throw new Error('Nothing answered');
    }

    const claim = integration.claim(found, {});

    if (claim === null) {
      throw new Error('Not claimed');
    }

    expect(integration.subscriptions([claim], {})).toEqual([
      { op: 'poll', args: { deviceKey: host, everyMs: 30_000 } },
    ]);
    expect(integration.subscriptions([claim], { pollInterval: 60 })).toEqual([
      { op: 'poll', args: { deviceKey: host, everyMs: 60_000 } },
    ]);
  });

  it('asks the dongle once per interval - one request, whatever the number of entities', async () => {
    const delivered: TransportInbound[] = [];
    const connection = await local().connect(
      { host, password: PASSWORD },
      {
        logger: createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' }),
        deliver: (message): void => {
          delivered.push(message);
        },
        report: (): void => undefined,
      },
    );

    await scanned();
    asked.length = 0;

    // Asked for every 250 ms, the transport holds to its floor of 5 s: one read in the second.
    await connection.apply([{ op: 'poll', args: { deviceKey: host, everyMs: 250 } }]);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await connection.close();

    expect(asked).toHaveLength(1);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.payload).toMatchObject({ family: 'x1_hybrid_gen4' });
    await expect(
      connection.send({ deviceKey: host, op: 'set', args: {} }, AbortSignal.timeout(1000)),
    ).rejects.toThrow(/only reads/);
  });
});
