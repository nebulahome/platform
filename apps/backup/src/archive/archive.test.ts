/**
 * An archive written and opened again: the manifest, the dump and the folders come back where
 * they belong, and nothing an archive may not carry is ever written.
 */
import { randomBytes } from 'node:crypto';
import {
  createReadStream,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  extractArchive,
  isRestorableEntry,
  readManifest,
  writeArchive,
  type ArchiveManifest,
} from './archive.js';
import { readArchiveHeader } from './stream-cipher.js';

const KEY = randomBytes(32);
const KEY_ID = '12'.repeat(16);
const directories: string[] = [];

/**
 * A fresh folder.
 *
 * @returns Its path.
 */
function folder(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'nebula-archive-'));

  directories.push(directory);

  return directory;
}

/**
 * Writes a file, making its folders.
 *
 * @param file - The file.
 * @param text - What it says.
 */
function put(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const MANIFEST: ArchiveManifest = {
  format: 'nebulahome-backup',
  formatVersion: 1,
  runId: '1a2b3c4d-0000-4000-8000-000000000000',
  createdAt: '2026-09-27T03:00:00.000Z',
  platformVersion: '0.0.0',
  sections: ['configuration', 'packages'],
  schema: { version: 1, latestHash: 'abc' },
  database: {
    postgresVersion: '16.15',
    timescaledbVersion: '2.29.2',
    historyIncluded: false,
    roles: ['nebula_api'],
    bytes: 11,
  },
  files: [],
  sectionBytes: { configuration: 1, history: 0, packages: 2 },
  instanceKeys: { secretsKey: '00'.repeat(32), totpKey: null },
};

describe('an archive', () => {
  it('carries the manifest, the dump, the folders and the volumes, and gives them back', async () => {
    const data = folder();
    const staging = folder();
    const restored = folder();

    put(path.join(data, 'hub/integrations/shelly/bundle.json'), '{"vendor":"shelly"}');
    put(path.join(data, 'proxy/tls/self-signed.crt'), 'certificate');
    put(path.join(data, 'packages/cameras/data/clip.bin'), 'clip');
    put(path.join(data, 'secrets/secrets-key'), 'never taken');
    put(path.join(staging, 'database.pgdump'), 'PGDMP dump');
    put(path.join(staging, 'volumes/web_data.tar'), 'a tar');

    const output = path.join(staging, 'archive.nhbk');

    await writeArchive({
      output,
      stagingDir: staging,
      manifest: MANIFEST,
      databaseDump: path.join(staging, 'database.pgdump'),
      dataDir: data,
      folders: ['hub/integrations', 'proxy/tls', 'packages'],
      volumesDir: path.join(staging, 'volumes'),
      backupKey: KEY,
      keyId: KEY_ID,
    });

    expect(readArchiveHeader(readFileSync(output)).public).toMatchObject({
      sections: ['configuration', 'packages'],
      schema: { version: 1, latestHash: 'abc' },
    });

    await extractArchive({
      source: createReadStream(output),
      keyFor: (keyId) => (keyId === KEY_ID ? KEY : null),
      destination: restored,
    });

    expect(await readManifest(restored)).toEqual(MANIFEST);
    expect(readFileSync(path.join(restored, 'database.pgdump'), 'utf8')).toBe('PGDMP dump');
    expect(
      readFileSync(path.join(restored, 'files/hub/integrations/shelly/bundle.json'), 'utf8'),
    ).toBe('{"vendor":"shelly"}');
    expect(readFileSync(path.join(restored, 'files/proxy/tls/self-signed.crt'), 'utf8')).toBe(
      'certificate',
    );
    expect(readFileSync(path.join(restored, 'files/packages/cameras/data/clip.bin'), 'utf8')).toBe(
      'clip',
    );
    expect(readFileSync(path.join(restored, 'volumes/web_data.tar'), 'utf8')).toBe('a tar');
    expect(() => readFileSync(path.join(restored, 'files/secrets/secrets-key'))).toThrow();
  });
});

describe('isRestorableEntry', () => {
  it.each([
    ['manifest.json', true],
    ['database.pgdump', true],
    ['files/', true],
    ['files/hub/', true],
    ['files/hub/integrations/shelly/bundle.json', true],
    ['files/containers/zigbee2mqtt/data/configuration.yaml', true],
    ['files/proxy/tls/self-signed.key', true],
    ['files/packages/cameras/artefact/package.tgz', true],
    ['volumes/', true],
    ['volumes/web_data.tar', true],
    ['volumes/volumes.json', true],
    ['volumes/web_data/inside', false],
    ['files/secrets/secrets-key', false],
    ['files/cache/maps/1/2/3.png', false],
    ['files/hub/integrations/../../../etc/passwd', false],
    ['/etc/passwd', false],
    ['somewhere/else', false],
  ])('%s: %s', (entry, expected) => {
    expect(isRestorableEntry(entry)).toBe(expected);
  });
});
