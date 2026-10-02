/**
 * The backup key: what every archive is encrypted with.
 *
 * Generated on the service's first start - the installation's first - into `secrets/` of the data
 * directory, mode 0600, and never generated again while the file is there (ARCHITECTURE.md 14,
 * "The instance keys"). `NEBULA_BACKUP_KEY` in the environment takes precedence, as it does for
 * every instance key. The owner downloads the file from the Backup page: without it, an archive
 * on another machine opens nothing.
 *
 * The key's id is a hash of the key, so an archive can say which key it needs without saying
 * anything about the key.
 */
import { createHash, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { backupKeyFileSchema, type BackupKeyFile } from '@nebulahome/contracts';

/** The key file's name in `secrets/`. */
export const BACKUP_KEY_FILE = 'backup-key.json';

/** The installation's backup key, and where it came from. */
export type BackupKey = {
  readonly key: Buffer;
  readonly keyId: string;
  readonly source: 'file' | 'environment';
  readonly createdAt: Date | null;

  /** The file the owner downloads. */
  readonly file: BackupKeyFile;
};

/**
 * The id of a key: the first half of a hash of it, which says which key without saying anything
 * about it.
 *
 * @param key - The key.
 * @returns 32 hex characters.
 */
export function keyIdOf(key: Buffer): string {
  return createHash('sha256')
    .update('nebulahome-backup-key-id\0')
    .update(key)
    .digest('hex')
    .slice(0, 32);
}

/**
 * Writes a key as its file.
 *
 * @param key - The key.
 * @param createdAt - When it was made.
 * @returns The file's contents.
 */
export function keyFileOf(key: Buffer, createdAt: Date): BackupKeyFile {
  return {
    format: 'nebulahome-backup-key',
    version: 1,
    keyId: keyIdOf(key),
    key: key.toString('hex'),
    createdAt: createdAt.toISOString(),
  };
}

/**
 * Reads a key file, as the owner uploads it or as it is on disk.
 *
 * @param text - The file's text.
 * @returns The file.
 * @throws {Error} When it is not a key file, or its id does not belong to its key.
 */
export function parseKeyFile(text: string): BackupKeyFile {
  const parsed = backupKeyFileSchema.safeParse(JSON.parse(text));

  if (!parsed.success) {
    throw new Error('Not a NebulaHome backup key file');
  }

  if (keyIdOf(Buffer.from(parsed.data.key, 'hex')) !== parsed.data.keyId) {
    throw new Error('The backup key file is damaged: its id does not match its key');
  }

  return parsed.data;
}

/**
 * Writes a key file, whole or not at all.
 *
 * @param secretsDir - The data directory's `secrets/`.
 * @param file - The file.
 */
export async function writeKeyFile(secretsDir: string, file: BackupKeyFile): Promise<void> {
  await mkdir(secretsDir, { recursive: true, mode: 0o700 });

  const target = path.join(secretsDir, BACKUP_KEY_FILE);
  const partial = `${target}.partial`;

  await writeFile(partial, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  await chmod(partial, 0o600);
  await rename(partial, target);
}

/**
 * Loads the backup key, making it on the first start.
 *
 * @param options - Where the file is, and the environment's key if it gives one.
 * @param options.secretsDir - The data directory's `secrets/`.
 * @param options.environmentKey - `NEBULA_BACKUP_KEY`, when set.
 * @param options.now - The clock, for a new key's date.
 * @returns The key.
 */
export async function loadBackupKey(options: {
  readonly secretsDir: string;
  readonly environmentKey?: string | undefined;
  readonly now: () => Date;
}): Promise<BackupKey & { readonly isNew: boolean }> {
  if (options.environmentKey !== undefined) {
    const key = Buffer.from(options.environmentKey, 'hex');

    return {
      key,
      keyId: keyIdOf(key),
      source: 'environment',
      createdAt: null,
      file: keyFileOf(key, new Date(0)),
      isNew: false,
    };
  }

  const target = path.join(options.secretsDir, BACKUP_KEY_FILE);

  try {
    const file = parseKeyFile(await readFile(target, 'utf8'));

    return {
      key: Buffer.from(file.key, 'hex'),
      keyId: file.keyId,
      source: 'file',
      createdAt: new Date(file.createdAt),
      file,
      isNew: false,
    };
  } catch (error: unknown) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      throw error;
    }
  }

  const file = keyFileOf(randomBytes(32), options.now());

  await writeKeyFile(options.secretsDir, file);

  return {
    key: Buffer.from(file.key, 'hex'),
    keyId: file.keyId,
    source: 'file',
    createdAt: new Date(file.createdAt),
    file,
    isNew: true,
  };
}
