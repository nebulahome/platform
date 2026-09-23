import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadBundles } from './bundles.js';

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
});
