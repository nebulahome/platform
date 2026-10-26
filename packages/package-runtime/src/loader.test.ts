import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { INSTALL_MARKER_FILE, type InstallMarker } from './install-marker.js';
import {
  findVendorFolder,
  loadBundleDirectory,
  loadVendorFolder,
  readVendorDirectory,
  type LoadBundleDirectoryOptions,
} from './loader.js';
import type { BundleSdk } from './sdk.js';
import { defineTransport } from './transport.js';

let root = '';

/** The smallest vendor there is. */
const VENDOR = { id: 'acme', version: '1.0.0', sdk: '^1.0.0', name: 'Acme' };

/** One declarative driver of it. */
const DRIVER = {
  id: 'relay',
  name: 'Relay',
  transport: 'http',
  kind: 'declarative',
  profile: './profile.json',
  setup: './setup.json',
};

/** What adding a relay asks. */
const SETUP = { transport: { fields: [{ key: 'host', type: 'text', label: 'Address' }] } };

/** The relay's profile. */
const PROFILE = {
  discovery: {
    probe: { op: 'get', args: { path: '/status' } },
    claim: [{ path: 'relay', exists: true }],
    identity: { externalId: 'id' },
  },
  entities: [
    {
      domain: 'switch',
      capabilities: { on_off: {} },
      state: { on_off: { isOn: 'relay.on' } },
      commands: { 'on_off.turn_on': { op: 'get', args: { path: '/on' } } },
    },
  ],
};

/** A transport module of the vendor's own. */
const TRANSPORT = `
export default (sdk) => sdk.defineTransport({
  id: 'acme/wire',
  configSchema: sdk.z.object({}),
  connectionKey: () => 'one',
  connect: () => Promise.reject(new Error('unused')),
  scan: async function* scan() {},
});
`;

/**
 * Writes files under the temporary root.
 *
 * @param folder - The folder, relative to the root.
 * @param files - What to put in it; a string as is, anything else as JSON.
 * @returns A promise that settles once they are on disk.
 */
async function write(folder: string, files: Record<string, unknown>): Promise<void> {
  const directory = path.join(root, folder);

  await mkdir(directory, { recursive: true });

  for (const [file, content] of Object.entries(files)) {
    await writeFile(
      path.join(directory, file),
      typeof content === 'string' ? content : JSON.stringify(content),
    );
  }
}

/**
 * Writes the vendor with its relay into a folder.
 *
 * @param folder - The vendor's folder, relative to the root.
 * @param manifest - Its manifest.
 * @returns A promise that settles once it is on disk.
 */
async function writeVendor(
  folder: string,
  manifest: Record<string, unknown> = VENDOR,
): Promise<void> {
  await write(folder, { 'manifest.json': manifest });
  await write(`${folder}/relay`, {
    'driver.json': DRIVER,
    'setup.json': SETUP,
    'profile.json': PROFILE,
  });
}

/**
 * Loader options with an SDK that has what the fixtures' code uses.
 *
 * @param released - Counts each release.
 * @param released.count - How many so far.
 * @returns The options, without the directory.
 */
function options(
  released: { count: number } = { count: 0 },
): Omit<LoadBundleDirectoryOptions, 'directory'> {
  return {
    runtimeVersion: '1.0.0',
    createSdk: () => ({
      sdk: { version: '1.0.0', z, defineTransport } as unknown as BundleSdk,
      release: async () => {
        released.count += 1;

        return Promise.resolve();
      },
    }),
  };
}

/** A marker naming a build. */
const MARKER: InstallMarker = {
  build: '1.0.0-a1b2c3d4',
  version: '1.0.0',
  source: 'local',
  artifactSha256: 'a'.repeat(64),
  installedAt: '2026-10-04T10:00:00.000Z',
  installedBy: null,
};

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'nebula-loader-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('readVendorDirectory', () => {
  it('reads every file and imports nothing', async () => {
    await writeVendor('acme', { ...VENDOR, transports: { wire: './wire.js' } });
    await write('acme', { 'wire.js': 'throw new Error("imported");' });

    const declaration = await readVendorDirectory(path.join(root, 'acme'), {
      runtimeVersion: '1.0.0',
    });

    expect(declaration.drivers.map((driver) => driver.driverId)).toEqual(['relay']);
    expect(declaration.transports).toEqual([
      { name: 'wire', path: path.join(root, 'acme', 'wire.js') },
    ]);
    expect(declaration.failures).toEqual([]);
  });

  it('reads a modbus driver’s template, every entity given its id', async () => {
    await writeVendor('acme');
    await write('acme/meter', {
      'driver.json': {
        id: 'meter',
        name: 'Meter',
        transport: 'modbus',
        kind: 'modbus',
        template: './template.json',
        setup: './setup.json',
      },
      'setup.json': { transport: { fields: [] } },
      'template.json': {
        name: 'Meter',
        entities: [
          {
            name: 'Power',
            domain: 'sensor',
            capabilities: { sensor_numeric: { read: { function: 4, address: 12, type: 'f32' } } },
          },
        ],
      },
    });

    const declaration = await readVendorDirectory(path.join(root, 'acme'), {
      runtimeVersion: '1.0.0',
    });
    const meter = declaration.drivers.find((driver) => driver.driverId === 'meter');

    expect(declaration.failures).toEqual([]);
    expect(meter?.modbusTemplate?.entities[0]?.id).toBe('power');
  });

  it('drops the $schema an editor reads at the top of each file', async () => {
    await writeVendor('acme', { $schema: './manifest.schema.json', ...VENDOR });
    await write('acme/relay', {
      'driver.json': { $schema: '../driver.schema.json', ...DRIVER },
      'profile.json': { $schema: '../profile.schema.json', ...PROFILE },
    });

    const declaration = await readVendorDirectory(path.join(root, 'acme'));

    expect(declaration.failures).toEqual([]);
    expect(declaration.drivers).toHaveLength(1);
  });

  it('says which module a vendor names is not in the bundle', async () => {
    await writeVendor('acme', { ...VENDOR, transports: { wire: './wire.js' } });

    await expect(readVendorDirectory(path.join(root, 'acme'))).rejects.toThrow(
      'acme transport wire names ./wire.js, which is not in the bundle',
    );
  });

  it('finds modules where it is told: a source tree written in TypeScript', async () => {
    await writeVendor('acme', { ...VENDOR, transports: { wire: './wire.js' } });
    await write('acme', { 'wire.ts': 'export default () => null;' });

    const declaration = await readVendorDirectory(path.join(root, 'acme'), {
      resolveModule: async (directory, file) =>
        Promise.resolve(path.join(directory, file.replace(/\.js$/u, '.ts'))),
    });

    expect(declaration.transports[0]?.path).toBe(path.join(root, 'acme', 'wire.ts'));
  });

  it('reads a source manifest with the version and range the build writes', async () => {
    const { version, sdk, ...source } = VENDOR;

    await writeVendor('acme', source);

    const declaration = await readVendorDirectory(path.join(root, 'acme'), {
      stamp: { version, sdk },
      runtimeVersion: '1.0.0',
    });

    expect([declaration.manifest.version, declaration.manifest.sdk]).toEqual(['1.0.0', '^1.0.0']);
  });

  it('refuses a source manifest that says what the build writes', async () => {
    await writeVendor('acme');

    await expect(
      readVendorDirectory(path.join(root, 'acme'), { stamp: { version: '1.0.0', sdk: '^1.0.0' } }),
    ).rejects.toThrow('manifest.json says version and sdk, which the build writes: remove them');
  });

  it('checks the id against the name it is given rather than the folder', async () => {
    await writeVendor('acme/1.0.0-a1b2c3d4');

    const declaration = await readVendorDirectory(path.join(root, 'acme', '1.0.0-a1b2c3d4'), {
      expectedId: 'acme',
    });

    expect(declaration.vendorId).toBe('acme');
  });
});

describe('findVendorFolder', () => {
  it('reads a vendor from its own folder when the manifest is there', async () => {
    await writeVendor('acme');

    await expect(findVendorFolder(root, 'acme')).resolves.toEqual({
      vendorId: 'acme',
      directory: path.join(root, 'acme'),
    });
  });

  it('reads an installed vendor from the build its marker names', async () => {
    await writeVendor(`acme/${MARKER.build}`);
    await writeVendor('acme/0.9.0-old');
    await write('acme', { [INSTALL_MARKER_FILE]: MARKER });

    await expect(findVendorFolder(root, 'acme')).resolves.toEqual({
      vendorId: 'acme',
      directory: path.join(root, 'acme', MARKER.build),
      install: MARKER,
    });
  });

  it('passes over a folder that is no vendor, and names a marker whose build is gone', async () => {
    await write('notes', { 'readme.txt': 'nothing' });
    await write('acme', { [INSTALL_MARKER_FILE]: MARKER });

    await expect(findVendorFolder(root, 'notes')).resolves.toBeNull();
    await expect(findVendorFolder(root, 'acme')).rejects.toThrow(
      /names the build 1\.0\.0-a1b2c3d4/u,
    );
  });
});

describe('loadBundleDirectory', () => {
  it('loads flat vendors and installed builds side by side, saying how each was installed', async () => {
    await writeVendor('acme');
    await writeVendor(`other/${MARKER.build}`, { ...VENDOR, id: 'other', name: 'Other' });
    await write('other', { [INSTALL_MARKER_FILE]: MARKER });

    const { vendors, failures } = await loadBundleDirectory({ directory: root, ...options() });

    expect(failures).toEqual([]);
    expect(vendors.map((vendor) => [vendor.manifest.id, vendor.install?.build ?? null])).toEqual([
      ['acme', null],
      ['other', MARKER.build],
    ]);
  });

  it('builds the transports a vendor ships with the SDK it is handed', async () => {
    await writeVendor('acme', { ...VENDOR, transports: { wire: './wire.js' } });
    await write('acme', { 'wire.js': TRANSPORT });

    const { vendors } = await loadBundleDirectory({ directory: root, ...options() });

    expect(vendors[0]?.ownTransports.map((transport) => transport.id)).toEqual(['acme/wire']);
  });

  it('lets go of what a vendor opened when its code does not build', async () => {
    const released = { count: 0 };

    await writeVendor('acme', { ...VENDOR, transports: { wire: './wire.js' } });
    await write('acme', { 'wire.js': 'export default 42;' });

    const { vendors, failures } = await loadBundleDirectory({
      directory: root,
      ...options(released),
    });

    expect(vendors).toEqual([]);
    expect(failures).toEqual([
      {
        directory: path.join(root, 'acme'),
        message: 'acme transport wire does not default-export a factory',
        vendorId: 'acme',
      },
    ]);
    expect(released.count).toBe(1);
  });

  it('names the vendor of a driver that fails, for its page', async () => {
    await writeVendor('acme');
    await write('acme/broken', { 'driver.json': { ...DRIVER, id: 'broken' } });

    const { failures } = await loadBundleDirectory({ directory: root, ...options() });

    expect(failures.map((failure) => failure.vendorId)).toEqual(['acme']);
  });
});

describe('loadVendorFolder', () => {
  it('reads one vendor, and nothing for a folder that is not there', async () => {
    await writeVendor('acme');

    const found = await loadVendorFolder(root, 'acme', options());
    const missing = await loadVendorFolder(root, 'gone', options());

    expect(found?.vendor?.manifest.id).toBe('acme');
    expect(missing).toBeNull();
  });
});
