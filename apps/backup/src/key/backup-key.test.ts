/**
 * The backup key: made once, kept, read back the same; the environment's over the file; and a
 * key file that is not one, or not whole, refused.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { BACKUP_KEY_FILE, keyIdOf, loadBackupKey, parseKeyFile } from './backup-key.js';

const directories: string[] = [];

/**
 * A fresh secrets folder.
 *
 * @returns Its path.
 */
function secretsDir(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'nebula-secrets-'));

  directories.push(directory);

  return path.join(directory, 'secrets');
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const now = (): Date => new Date('2026-09-27T00:00:00Z');

describe('loadBackupKey', () => {
  it('makes the key on the first start and reads the same one afterwards', async () => {
    const directory = secretsDir();
    const first = await loadBackupKey({ secretsDir: directory, now });
    const second = await loadBackupKey({ secretsDir: directory, now });

    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(false);
    expect(second.key.equals(first.key)).toBe(true);
    expect(second.keyId).toBe(keyIdOf(first.key));
    expect(parseKeyFile(readFileSync(path.join(directory, BACKUP_KEY_FILE), 'utf8'))).toEqual(
      first.file,
    );
  });

  it('takes the environment’s key over the file', async () => {
    const hex = 'cd'.repeat(32);
    const key = await loadBackupKey({ secretsDir: secretsDir(), environmentKey: hex, now });

    expect(key.source).toBe('environment');
    expect(key.key.toString('hex')).toBe(hex);
  });
});

describe('parseKeyFile', () => {
  it('refuses a file whose id is not its key’s', () => {
    const text = JSON.stringify({
      format: 'nebulahome-backup-key',
      version: 1,
      keyId: '0'.repeat(32),
      key: 'ab'.repeat(32),
      createdAt: '2026-09-27T00:00:00.000Z',
    });

    expect(() => parseKeyFile(text)).toThrow(/damaged/u);
  });

  it('refuses what is not a key file', () => {
    expect(() => parseKeyFile('{"hello":"world"}')).toThrow(/Not a NebulaHome backup key/u);
  });
});
