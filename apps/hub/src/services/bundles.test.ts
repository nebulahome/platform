import { createSocket } from 'node:dgram';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createLogger, type PlatformLogger } from '@nebula-home/logging';

import { loadBundles, mergeBundleResults, type LoadBundlesResult } from './bundles.js';

let root = '';

/** A profile for a generic REST relay, the smallest thing the declarative tier covers. */
const PROFILE = {
  discovery: {
    probe: { op: 'get', args: { path: '/status' } },
    claim: [{ path: 'relay', exists: true }],
    identity: { externalId: 'device.id' },
  },
  entities: [
    {
      domain: 'switch',
      capabilities: { on_off: {} },
      state: { on_off: { isOn: 'relay.on' } },
      commands: { 'on_off.turn_on': { op: 'get', args: { path: '/relay/on' } } },
    },
  ],
};

/** The vendor that ships the relay. */
const VENDOR = {
  id: 'generic',
  version: '1.0.0',
  sdk: '^1.0.0',
  name: 'Generic',
};

/** The relay's driver manifest. */
const DRIVER = {
  id: 'relay',
  name: 'REST relay',
  transport: 'http',
  kind: 'declarative',
  profile: './profile.json',
  setup: './setup.json',
};

/** What setting up an instance of it asks. */
const SETUP = {
  transport: {
    fields: [{ key: 'hosts', type: 'list', label: 'Addresses', isRequired: true, minItems: 1 }],
  },
};

/** A one-pixel SVG, as a logo. */
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';

/** A transport module of the vendor's own: the smallest factory the contract allows. */
const TRANSPORT_MODULE = `
export default function wire(sdk) {
  return sdk.defineTransport({
    id: 'generic/wire',
    configSchema: sdk.z.object({ host: sdk.z.string() }),
    connectionKey: (config) => config.host,
    connect: () => Promise.reject(new Error('unused')),
    scan: async function* scan() {},
    probe: () => Promise.resolve(sdk.version),
  });
}
`;

/**
 * Writes files into one directory under the temporary root.
 *
 * @param name - The directory, relative to the root: `generic` for a vendor, `generic/relay`
 * for a driver.
 * @param files - What to put in it, keyed by file name. A string is written as is, a Buffer
 * as bytes, anything else as JSON.
 * @returns A promise that settles once the files are on disk.
 */
async function write(name: string, files: Record<string, unknown>): Promise<void> {
  const directory = path.join(root, name);
  await mkdir(directory, { recursive: true });

  for (const [file, content] of Object.entries(files)) {
    await writeFile(
      path.join(directory, file),
      typeof content === 'string' || Buffer.isBuffer(content) ? content : JSON.stringify(content),
    );
  }
}

/**
 * Writes the generic vendor with its one relay driver, varying either file.
 *
 * @param vendor - Extra or replaced vendor files.
 * @param driver - Extra or replaced driver files.
 * @returns A promise that settles once both are on disk.
 */
async function writeRelay(
  vendor: Record<string, unknown> = {},
  driver: Record<string, unknown> = {},
): Promise<void> {
  await write('generic', { 'manifest.json': VENDOR, ...vendor });
  await write('generic/relay', {
    'driver.json': DRIVER,
    'profile.json': PROFILE,
    'setup.json': SETUP,
    ...driver,
  });
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'nebula-bundles-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('loadBundles', () => {
  it('builds a working integration from a declarative driver', async () => {
    await writeRelay();

    const { loaded } = await loadBundles({ directory: root, runtimeVersion: '1.0.0' });

    expect(
      loaded[0]?.integration.claim(
        { deviceKey: 'x', payload: { relay: {}, device: { id: 'a' } } },
        {},
      ),
    ).toMatchObject({ externalId: 'a' });
  });

  it('hands a code driver that exports a function the SDK, and the platform broker in it', async () => {
    await writeRelay(
      {},
      {
        'driver.json': { ...DRIVER, kind: 'code', profile: undefined, entry: './index.js' },
        'index.js': `
export default function relay(sdk) {
  return {
    id: 'generic/relay',
    transport: 'http',
    optionsSchema: sdk.z.object({}),
    discovery: {},
    claim: () => ({ deviceKey: 'x', externalId: sdk.platform.mqtt.url, descriptor: {} }),
    subscriptions: () => [],
    describe: () => ({ externalId: 'x', name: 'x', entities: [] }),
    toState: () => [],
    toCommand: () => ({ deviceKey: 'x', op: 'get', args: {} }),
  };
}
`,
      },
    );

    const { loaded } = await loadBundles({
      directory: root,
      runtimeVersion: '1.0.0',
      platform: { mqtt: { url: 'mqtt://127.0.0.1:1884' } },
    });

    expect(loaded[0]?.integration.claim({ deviceKey: 'x', payload: {} }, {})).toMatchObject({
      externalId: 'mqtt://127.0.0.1:1884',
    });
  });

  it('refuses a vendor whose containers read a setting it does not ask', async () => {
    await writeRelay({
      'manifest.json': {
        ...VENDOR,
        containers: [
          {
            id: 'helper',
            name: 'Helper',
            image: 'example/helper',
            minVersion: '1.0.0',
            env: [{ name: 'PORT', value: '{setup.port}' }],
          },
        ],
      },
    });

    const { vendors, failures } = await loadBundles({ directory: root, runtimeVersion: '1.0.0' });

    expect(vendors).toEqual([]);
    expect(failures[0]?.message).toBe(
      "helper reads the setting port, which the vendor's setup.json does not ask",
    );
  });

  it('names a driver by its vendor and itself', async () => {
    // The kind is what an instance row references and what the catalogue lists, and it is
    // composed here rather than written in either file so the two ids cannot disagree with it.
    await writeRelay();

    const { loaded } = await loadBundles({ directory: root, runtimeVersion: '1.0.0' });

    expect([
      loaded[0]?.manifest.id,
      loaded[0]?.vendorId,
      loaded[0]?.driverId,
      loaded[0]?.driverName,
    ]).toEqual(['generic/relay', 'generic', 'relay', 'REST relay']);
  });

  it('lists each vendor with its drivers and the transports they speak', async () => {
    await writeRelay();
    await write('generic/bridge', {
      'driver.json': { ...DRIVER, id: 'bridge', name: 'Bridge', transport: 'mqtt' },
      'profile.json': PROFILE,
      'setup.json': SETUP,
    });

    const { vendors } = await loadBundles({ directory: root, runtimeVersion: '1.0.0' });

    expect(vendors[0]?.manifest.id).toBe('generic');
    expect(vendors[0]?.drivers.map((driver) => driver.driverId).sort()).toEqual([
      'bridge',
      'relay',
    ]);
    expect([...(vendors[0]?.transports ?? [])].sort()).toEqual(['http', 'mqtt']);
  });

  it('finds nothing rather than failing when no bundle is installed', async () => {
    // A fresh installation has an empty bundle directory, or none at all. Treating that as an
    // error would stop the service before an owner could install anything through it.
    const result = await loadBundles({
      directory: path.join(root, 'absent'),
      runtimeVersion: '1.0.0',
    });

    expect(result).toEqual({ vendors: [], loaded: [], failures: [] });
  });

  it('reads what setting up an instance asks, for the catalogue to serve', async () => {
    await writeRelay();

    const { loaded } = await loadBundles({ directory: root, runtimeVersion: '1.0.0' });

    expect(loaded[0]?.setup.transport.fields.map((field) => field.key)).toEqual(['hosts']);
    expect(loaded[0]?.setup.options.fields).toEqual([]);
  });

  it('reads what setting the vendor up asks, when the vendor asks for anything', async () => {
    // A cloud vendor wants an API key once, not once per device. Its own `setup.json` has the
    // same grammar as a driver's so the same form and the same checks serve both.
    await writeRelay({
      'manifest.json': { ...VENDOR, setup: './setup.json' },
      'setup.json': {
        transport: {
          fields: [{ key: 'apiKey', type: 'secret', label: 'API key', isRequired: true }],
        },
      },
    });

    const { vendors } = await loadBundles({ directory: root, runtimeVersion: '1.0.0' });

    expect(vendors[0]?.setup.transport.fields.map((field) => field.key)).toEqual(['apiKey']);
  });

  it('gives a vendor that asks for nothing an empty declaration rather than none', async () => {
    // So that everything downstream - the catalogue, the API's check, the form - handles one
    // shape, and "needs setting up" is a question about required fields rather than about
    // whether a file exists.
    await writeRelay();

    const { vendors } = await loadBundles({ directory: root, runtimeVersion: '1.0.0' });

    expect(vendors[0]?.setup).toEqual({
      transport: { constants: {}, fields: [] },
      options: { constants: {}, fields: [] },
    });
  });

  it('carries the logo as a data URL typed by its extension', async () => {
    await writeRelay({ 'manifest.json': { ...VENDOR, logo: './logo.svg' }, 'logo.svg': SVG });

    const { vendors } = await loadBundles({ directory: root, runtimeVersion: '1.0.0' });

    expect(vendors[0]?.logo).toBe(
      `data:image/svg+xml;base64,${Buffer.from(SVG, 'utf8').toString('base64')}`,
    );
  });

  it('reads a logo named with the room to leave around it', async () => {
    await writeRelay({
      'manifest.json': { ...VENDOR, logo: { path: './logo.svg', padding: 6 } },
      'logo.svg': SVG,
    });

    const { vendors } = await loadBundles({ directory: root, runtimeVersion: '1.0.0' });

    expect(vendors[0]?.logo).toBe(
      `data:image/svg+xml;base64,${Buffer.from(SVG, 'utf8').toString('base64')}`,
    );
    expect(vendors[0]?.manifest.logo?.padding).toBe(6);
  });

  it('refuses a logo the catalogue could not carry', async () => {
    // The logo rides inside every catalogue reply. One that is too large would slow every
    // page that lists vendors, and a bundle finds that out at startup rather than an owner
    // finding it out on the page.
    await writeRelay({
      'manifest.json': { ...VENDOR, logo: './logo.png' },
      'logo.png': Buffer.alloc(70_000, 1),
    });

    const { vendors, failures } = await loadBundles({ directory: root, runtimeVersion: '1.0.0' });

    expect(vendors).toEqual([]);
    expect(failures[0]?.message).toMatch(/logo/i);
  });

  it('refuses a logo that is neither an SVG nor a PNG', async () => {
    await writeRelay({ 'manifest.json': { ...VENDOR, logo: './logo.gif' }, 'logo.gif': 'GIF89a' });

    const { failures } = await loadBundles({ directory: root, runtimeVersion: '1.0.0' });

    expect(failures[0]?.message).toMatch(/logo/i);
  });

  it('refuses a driver whose setup declaration is missing or malformed', async () => {
    // A driver with no form is a driver nobody can configure, so it is reported like any other
    // broken one rather than loaded and then found useless from the interface.
    await write('generic', { 'manifest.json': VENDOR });
    await write('generic/relay', { 'driver.json': DRIVER, 'profile.json': PROFILE });
    await write('generic/other', {
      'driver.json': { ...DRIVER, id: 'other' },
      'profile.json': PROFILE,
      'setup.json': { transport: { fields: [{ key: 'hosts', type: 'colour', label: 'x' }] } },
    });

    const { loaded, failures } = await loadBundles({ directory: root, runtimeVersion: '1.0.0' });

    expect(loaded).toEqual([]);
    expect(failures.map((failure) => failure.directory).sort()).toEqual(
      [path.join(root, 'generic', 'other'), path.join(root, 'generic', 'relay')].sort(),
    );
  });

  it('keeps the good drivers of a vendor when one is broken', async () => {
    // One malformed driver must not take its siblings down with it. The rest load, and the
    // failure is reported so the interface can say which one and why.
    await writeRelay();
    await write('generic/broken', { 'driver.json': { id: 'broken' } });

    const { vendors, loaded, failures } = await loadBundles({
      directory: root,
      runtimeVersion: '1.0.0',
    });

    expect([loaded.length, failures.length, vendors[0]?.drivers.length]).toEqual([1, 1, 1]);
  });

  it('drops a vendor none of whose drivers loaded', async () => {
    // A vendor with nothing to add a device with is a card with no purpose. The drivers'
    // failures already say what went wrong; a card would only send the owner to a page that
    // cannot do anything.
    await write('generic', { 'manifest.json': VENDOR });
    await write('generic/broken', { 'driver.json': { id: 'broken' } });

    const { vendors, failures } = await loadBundles({ directory: root, runtimeVersion: '1.0.0' });

    expect([vendors.length, failures.length]).toEqual([0, 1]);
  });

  it('reports a vendor that ships no driver at all', async () => {
    await write('generic', { 'manifest.json': VENDOR });

    const { failures } = await loadBundles({ directory: root, runtimeVersion: '1.0.0' });

    expect(failures[0]?.message).toMatch(/driver/i);
  });

  it('fails a vendor whose manifest is broken, drivers and all', async () => {
    await writeRelay({ 'manifest.json': { id: 'generic' } });

    const { vendors, loaded, failures } = await loadBundles({
      directory: root,
      runtimeVersion: '1.0.0',
    });

    expect([vendors.length, loaded.length]).toEqual([0, 0]);
    expect(failures[0]?.directory).toBe(path.join(root, 'generic'));
  });

  it('refuses a vendor whose directory is not called by its id', async () => {
    // The directory name is how a kind is looked up on disk and how a catalogue names what it
    // installs. A manifest saying otherwise would be two names for one thing, and whichever
    // one the interface used would be wrong somewhere.
    await write('generic', { 'manifest.json': { ...VENDOR, id: 'acme' } });
    await write('generic/relay', {
      'driver.json': DRIVER,
      'profile.json': PROFILE,
      'setup.json': SETUP,
    });

    const { failures } = await loadBundles({ directory: root, runtimeVersion: '1.0.0' });

    expect(failures[0]?.message).toMatch(/acme.*generic|generic.*acme/);
  });

  it('refuses a driver whose directory is not called by its id', async () => {
    await writeRelay({}, { 'driver.json': { ...DRIVER, id: 'switch' } });

    const { failures } = await loadBundles({ directory: root, runtimeVersion: '1.0.0' });

    expect(failures[0]?.message).toMatch(/switch.*relay|relay.*switch/);
  });

  it('names both versions when a bundle was written for a different runtime', async () => {
    // The message an owner reads. "Expected string, received number" three files deeper is not
    // something they can act on; "needs ^2.0.0, this is 1.0.0" is.
    await writeRelay({ 'manifest.json': { ...VENDOR, sdk: '^2.0.0' } });

    const { failures } = await loadBundles({ directory: root, runtimeVersion: '1.0.0' });

    expect(failures[0]?.message).toMatch(/\^2\.0\.0.*1\.0\.0|1\.0\.0.*\^2\.0\.0/);
  });

  it('refuses a declarative driver whose profile breaks the ceiling', async () => {
    await writeRelay(
      {},
      { 'profile.json': { ...PROFILE, entities: [{ ...PROFILE.entities[0], each: 'channels' }] } },
    );

    const { loaded, failures } = await loadBundles({ directory: root, runtimeVersion: '1.0.0' });

    expect([loaded.length, failures.length]).toEqual([0, 1]);
  });

  it('refuses a declarative driver whose profile is missing', async () => {
    await write('generic', { 'manifest.json': VENDOR });
    await write('generic/relay', { 'driver.json': DRIVER, 'setup.json': SETUP });

    const { failures } = await loadBundles({ directory: root, runtimeVersion: '1.0.0' });

    expect(failures[0]?.message).toMatch(/profile/i);
  });

  it('ignores a directory that is not a bundle, at either level', async () => {
    await write('notes', { 'readme.md': '# not a bundle' });
    await writeRelay();
    await write('generic/docs', { 'readme.md': '# not a driver' });

    const { vendors, loaded, failures } = await loadBundles({
      directory: root,
      runtimeVersion: '1.0.0',
    });

    expect([vendors.length, loaded.length, failures.length]).toEqual([1, 1, 0]);
  });

  it('loads a transport the vendor ships and names it after the vendor', async () => {
    await writeRelay(
      {
        'manifest.json': { ...VENDOR, transports: { wire: './wire.js' } },
        'wire.js': TRANSPORT_MODULE,
      },
      { 'driver.json': { ...DRIVER, transport: 'generic/wire' } },
    );

    const { vendors, failures } = await loadBundles({ directory: root, runtimeVersion: '1.0.0' });

    expect(failures).toEqual([]);
    expect(vendors[0]?.ownTransports.map((transport) => transport.id)).toEqual(['generic/wire']);
    // The factory was handed the runtime version, which is what the probe answers with.
    await expect(
      vendors[0]?.ownTransports[0]?.probe({ host: 'x' }, new AbortController().signal),
    ).resolves.toBe('1.0.0');
    expect(vendors[0]?.transports).toEqual(['generic/wire']);
  });

  it('fails the whole vendor when a transport of its own calls itself something else', async () => {
    // Its drivers would name a transport that was never registered, so none of them could
    // run; better one failure naming the two ids than a vendor with drivers that cannot start.
    await writeRelay({
      'manifest.json': { ...VENDOR, transports: { rpc: './wire.js' } },
      'wire.js': TRANSPORT_MODULE,
    });

    const { vendors, failures } = await loadBundles({ directory: root, runtimeVersion: '1.0.0' });

    expect(vendors).toEqual([]);
    expect(failures[0]?.message).toMatch(/calls itself generic\/wire; it must be generic\/rpc/);
  });

  it('fails the vendor when a transport module does not export a factory', async () => {
    await writeRelay({
      'manifest.json': { ...VENDOR, transports: { wire: './wire.js' } },
      'wire.js': 'export const nothing = 1;',
    });

    const { failures } = await loadBundles({ directory: root, runtimeVersion: '1.0.0' });

    expect(failures[0]?.message).toMatch(/does not default-export a factory/);
  });

  it('refuses a driver that names a transport its vendor does not ship', async () => {
    await writeRelay({}, { 'driver.json': { ...DRIVER, transport: 'generic/wire' } });

    const { failures } = await loadBundles({ directory: root, runtimeVersion: '1.0.0' });

    expect(failures[0]?.message).toMatch(/names generic\/wire, which the vendor does not ship/);
  });

  it('asks before loading code, when told to ask', async () => {
    await writeRelay({
      'manifest.json': { ...VENDOR, transports: { wire: './wire.js' } },
      'wire.js': TRANSPORT_MODULE,
    });
    const asked: string[] = [];

    const { vendors } = await loadBundles({
      directory: root,
      runtimeVersion: '1.0.0',
      verifyVendor: (vendor) => {
        asked.push(vendor.id);
        throw new Error('not reviewed');
      },
    });

    expect(asked).toEqual(['generic']);
    expect(vendors).toEqual([]);
  });

  it('says a vendor is installed unless told it is under development', async () => {
    await writeRelay();

    const installed = await loadBundles({ directory: root, runtimeVersion: '1.0.0' });
    const development = await loadBundles({
      directory: root,
      origin: 'development',
      runtimeVersion: '1.0.0',
    });

    expect([installed.vendors[0]?.origin, development.vendors[0]?.origin]).toEqual([
      'installed',
      'development',
    ]);
  });
});

/**
 * Writes a vendor with the relay driver under one of the two places.
 *
 * @param place - `development` or `installed`, a directory under the temporary root.
 * @param vendor - The vendor's manifest.
 * @returns A promise that settles once it is on disk.
 */
async function writeRelayAt(place: string, vendor: typeof VENDOR): Promise<void> {
  await write(`${place}/${vendor.id}`, { 'manifest.json': vendor });
  await write(`${place}/${vendor.id}/relay`, {
    'driver.json': DRIVER,
    'profile.json': PROFILE,
    'setup.json': SETUP,
  });
}

/**
 * A logger that keeps what it was told, for the warnings a merge gives.
 *
 * @returns The logger, and the records it wrote.
 */
function capturingLogger(): { logger: PlatformLogger; records: () => Record<string, unknown>[] } {
  const lines: string[] = [];
  const stream = new Writable({
    /**
     * Keeps one batch of records.
     *
     * @param chunk - Newline-delimited JSON.
     * @param encoding - Ignored.
     * @param callback - Signals the write is done.
     */
    write(chunk: Buffer, encoding, callback): void {
      lines.push(...chunk.toString().split('\n').filter(Boolean));
      callback();
    },
  });

  return {
    logger: createLogger({ service: 'hub', version: '0.0.0', level: 'warn' }, stream),
    records: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

/**
 * Loads both places and puts them together.
 *
 * @param logger - Where the merge reports.
 * @returns The merged result.
 */
async function loadBoth(logger: PlatformLogger): Promise<LoadBundlesResult> {
  return mergeBundleResults(
    await loadBundles({
      directory: path.join(root, 'development'),
      origin: 'development',
      runtimeVersion: '1.0.0',
    }),
    await loadBundles({ directory: path.join(root, 'installed'), runtimeVersion: '1.0.0' }),
    logger,
  );
}

describe('mergeBundleResults', () => {
  it('keeps both places when they hold different vendors', async () => {
    await writeRelayAt('development', VENDOR);
    await writeRelayAt('installed', { ...VENDOR, id: 'acme', name: 'ACME' });
    const { logger, records } = capturingLogger();

    const { vendors, loaded, failures } = await loadBoth(logger);

    expect(vendors.map((vendor) => [vendor.manifest.id, vendor.origin]).sort()).toEqual([
      ['acme', 'installed'],
      ['generic', 'development'],
    ]);
    expect([loaded.length, failures.length, records().length]).toEqual([2, 0, 0]);
  });

  it('lets an installed vendor replace the one under development, whole, and says so', async () => {
    // What was put in the data directory was put there on purpose. The two are not mixed
    // driver by driver: a driver of one copy may name a transport only the other ships.
    await writeRelayAt('development', VENDOR);
    await writeRelayAt('installed', { ...VENDOR, version: '2.0.0' });
    const { logger, records } = capturingLogger();

    const { vendors, loaded } = await loadBoth(logger);

    expect(vendors.map((vendor) => [vendor.manifest.version, vendor.origin])).toEqual([
      ['2.0.0', 'installed'],
    ]);
    expect(loaded.map((driver) => driver.directory)).toEqual([
      path.join(root, 'installed', 'generic', 'relay'),
    ]);
    expect(records()).toEqual([
      expect.objectContaining({
        vendor: 'generic',
        installed: path.join(root, 'installed', 'generic'),
        development: path.join(root, 'development', 'generic'),
      }),
    ]);
  });

  it('keeps the vendor under development when its installed copy does not load', async () => {
    await writeRelayAt('development', VENDOR);
    await write('installed/generic', { 'manifest.json': { id: 'generic' } });
    const { logger } = capturingLogger();

    const { vendors, failures } = await loadBoth(logger);

    expect(vendors.map((vendor) => vendor.origin)).toEqual(['development']);
    expect(failures.map((failure) => failure.directory)).toEqual([
      path.join(root, 'installed', 'generic'),
    ]);
  });
});

/** How the generic vendor's relays are found: an mDNS service, a probe, and where they say who they are. */
const DISCOVERY = {
  listen: [{ mdns: '_relay._tcp' }],
  probe: { transport: 'http', op: 'get', args: { path: '/status' } },
  identity: { externalId: 'device.id', model: 'device.model' },
};

/** The relay driver, listing the models it drives and the codes they report. */
const CODED_DRIVER = {
  ...DRIVER,
  models: ['Relay One', 'Relay Two'],
  modelCodes: { 'R-1': 'Relay One', 'R-2': 'Relay Two' },
};

/** A discovery module of the vendor's own, reporting one device and the runtime it was given. */
const DISCOVERY_MODULE = `
export default function lan(sdk) {
  return {
    listen: async function* listen() {
      yield { config: { host: '192.168.1.60' }, payload: { device: { id: 'r1', model: 'R-1' }, sdk: sdk.version } };
    },
  };
}
`;

describe('loadBundles discovery', () => {
  it('reads how a vendor is found, checked against its drivers', async () => {
    await writeRelay({ 'discovery.json': DISCOVERY }, { 'driver.json': CODED_DRIVER });

    const { vendors, failures } = await loadBundles({ directory: root, runtimeVersion: '1.0.0' });
    const discovery = vendors[0]?.discovery;

    expect(failures).toEqual([]);
    expect(discovery?.sources).toEqual([{ kind: 'mdns', service: '_relay._tcp' }]);
    expect(discovery?.plan.codes.get('R-2')).toEqual([
      { driverId: 'relay', models: ['Relay Two'] },
    ]);
  });

  it('leaves a vendor without discovery.json undiscoverable, and otherwise as it was', async () => {
    await writeRelay();

    const { vendors, failures } = await loadBundles({ directory: root, runtimeVersion: '1.0.0' });

    expect(failures).toEqual([]);
    expect(vendors[0]?.discovery).toBeUndefined();
  });

  it('keeps the vendor when its discovery is broken, and names the file', async () => {
    // Discovery is a convenience on top of adding a device by address. A typo in it must not
    // take away the vendor's devices.
    await writeRelay({ 'discovery.json': { listen: [{ ssdp: 'urn:x' }], identity: {} } });

    const { vendors, failures } = await loadBundles({ directory: root, runtimeVersion: '1.0.0' });

    expect(vendors).toHaveLength(1);
    expect(vendors[0]?.discovery).toBeUndefined();
    expect(failures[0]?.directory).toBe(path.join(root, 'generic', 'discovery.json'));
  });

  it('refuses one code mapped by two drivers of a vendor that does not probe, naming both', async () => {
    await writeRelay(
      {
        'discovery.json': {
          listen: [{ mdns: '_relay._tcp' }],
          identity: { model: 'txt.model' },
        },
      },
      { 'driver.json': CODED_DRIVER },
    );
    await write('generic/relay-copy', {
      'driver.json': { ...CODED_DRIVER, id: 'relay-copy' },
      'profile.json': PROFILE,
      'setup.json': SETUP,
    });

    const { vendors, failures } = await loadBundles({ directory: root, runtimeVersion: '1.0.0' });

    expect(vendors[0]?.discovery).toBeUndefined();
    expect(failures[0]?.message).toMatch(/relay.*relay-copy|relay-copy.*relay/);
  });

  it('loads a discovery module the vendor ships, handing it the SDK', async () => {
    await writeRelay(
      {
        'discovery.json': {
          listen: [{ module: './lan/discovery.js' }],
          identity: { externalId: 'device.id', model: 'device.model' },
        },
      },
      { 'driver.json': CODED_DRIVER },
    );
    await write('generic/lan', { 'discovery.js': DISCOVERY_MODULE });

    const { vendors, failures } = await loadBundles({ directory: root, runtimeVersion: '1.0.0' });
    const [source] = vendors[0]?.discovery?.sources ?? [];
    const heard = [];

    if (source?.kind === 'module') {
      for await (const sighting of source.source.listen(new AbortController().signal)) {
        heard.push(sighting);
      }
    }

    expect(failures).toEqual([]);
    expect(heard).toEqual([
      {
        config: { host: '192.168.1.60' },
        payload: { device: { id: 'r1', model: 'R-1' }, sdk: '1.0.0' },
      },
    ]);
  });

  it('refuses a discovery module that does not export a factory', async () => {
    await writeRelay({
      'discovery.json': {
        listen: [{ module: './lan/discovery.js' }],
        identity: { model: 'device.model' },
      },
    });
    await write('generic/lan', { 'discovery.js': 'export default 42;' });

    const { vendors, failures } = await loadBundles({ directory: root, runtimeVersion: '1.0.0' });

    expect(vendors[0]?.discovery).toBeUndefined();
    expect(failures[0]?.message).toMatch(/lan\/discovery\.js/);
  });

  it("frees the ports a vendor's code opened when the vendor is released", async () => {
    // A vendor replaced by an installed copy, or a hub stopping, must not leave a port held by
    // a bundle that forgot to close it.
    const port = await freeUdpPort();

    await writeRelay({
      'discovery.json': {
        listen: [{ module: './lan/discovery.js' }],
        identity: { model: 'device.model' },
      },
    });
    await write('generic/lan', {
      'discovery.js': `
export default function lan(sdk) {
  sdk.openUdpSocket({ port: ${String(port)}, onMessage: () => {} });
  return { listen: async function* listen() {} };
}
`,
    });

    const { vendors } = await loadBundles({ directory: root, runtimeVersion: '1.0.0' });

    await vendors[0]?.release();

    const socket = createSocket('udp4');

    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(port, resolve);
    });
    await new Promise<void>((resolve) => {
      socket.close(() => {
        resolve();
      });
    });
  });
});

/**
 * Finds a UDP port nothing is bound to.
 *
 * @returns The port.
 */
async function freeUdpPort(): Promise<number> {
  const socket = createSocket('udp4');

  await new Promise<void>((resolve) => {
    socket.bind(0, resolve);
  });

  const { port } = socket.address();

  await new Promise<void>((resolve) => {
    socket.close(() => {
      resolve();
    });
  });

  return port;
}
