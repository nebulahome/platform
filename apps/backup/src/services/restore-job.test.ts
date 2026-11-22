/**
 * A restore that goes wrong at the switch, or after it: the services come back, the databases are
 * renamed back only when they were renamed, the backup key and the replaced folders are not lost.
 *
 * The database, the location, the archive and `s6` are fakes: what is checked is the order of
 * things, not PostgreSQL.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BackupKeyFile } from '@nebulahome/contracts';
import type { Database } from '@nebulahome/db';
import type { PlatformLogger } from '@nebulahome/logging';

import { keyFileOf, keyIdOf, type BackupKey } from '../key/backup-key.js';
import type { StoredLocation } from '../persistence/backup-store.js';
import type { OpenDependencies } from '../transports/open-location.js';

import { restoreArchive, type RestoreJobContext } from './restore-job.js';
import type { S6Services } from './s6-services.js';

/** What the fake database is asked, and how it answers. */
const database = vi.hoisted(() => {
  const state: {
    asked: string[];
    answer: (query: string) => unknown[] | Error;
    isApiReady: boolean;
  } = { asked: [], answer: () => [], isApiReady: true };

  return state;
});

/**
 * A connection that writes down every query, with identifiers and values in place.
 *
 * @returns The connection.
 */
function fakeSql(): unknown {
  const sql = Object.assign(
    (first: unknown, ...values: unknown[]): unknown => {
      if (!Array.isArray(first)) {
        return { identifier: first };
      }

      const query = (first as readonly string[])
        .map((part, index) => {
          const value = values[index - 1];
          const shown =
            typeof value === 'object' && value !== null && 'identifier' in value
              ? String(value.identifier)
              : String(value);

          return index === 0 ? part : `${shown}${part}`;
        })
        .join('')
        .replaceAll(/\s+/gu, ' ')
        .trim();
      const answer = database.answer(query);

      database.asked.push(query);

      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
    {
      unsafe: async (text: string): Promise<unknown[]> => {
        database.asked.push(text);

        return Promise.resolve([]);
      },
      json: (value: unknown): unknown => value,
      begin: async (body: (transaction: unknown) => Promise<unknown>): Promise<unknown> =>
        body(sql),
      end: async (): Promise<void> => Promise.resolve(),
    },
  );

  return sql;
}

vi.mock('../database/admin.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  connectAdmin: (): unknown => fakeSql(),
  databaseFacts: async (): Promise<unknown> =>
    Promise.resolve({
      postgresVersion: '16',
      timescaledbVersion: null,
      roles: [],
      schema: { version: 1, latestHash: 'abc' },
    }),
  canInstallTimescale: async (): Promise<boolean> => Promise.resolve(true),
}));

vi.mock('../database/pg-tools.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  restoreDatabase: async (): Promise<void> => Promise.resolve(),
}));

vi.mock('../transports/open-location.js', () => ({
  targetOf: (): unknown => ({}),
  openLocation: async (): Promise<unknown> =>
    Promise.resolve({
      read: async (): Promise<Readable> => Promise.resolve(Readable.from([])),
      close: async (): Promise<void> => Promise.resolve(),
    }),
}));

vi.mock('../archive/archive.js', async (importOriginal) => {
  const fs = await import('node:fs');
  const { default: paths } = await import('node:path');

  return {
    ...(await importOriginal<object>()),
    extractArchive: async ({ destination }: { destination: string }): Promise<void> => {
      fs.writeFileSync(
        paths.join(destination, 'manifest.json'),
        JSON.stringify({
          format: 'nebulahome-backup',
          formatVersion: 1,
          createdAt: '2026-11-01T03:00:00.000Z',
          schema: { version: 1, latestHash: 'abc' },
          database: { timescaledbVersion: null, roles: [] },
          instanceKeys: { secretsKey: 'aa', totpKey: null },
        }),
      );
      fs.writeFileSync(paths.join(destination, 'database.pgdump'), 'PGDMP');
      fs.mkdirSync(paths.join(destination, 'files/hub/integrations'), { recursive: true });
      fs.writeFileSync(paths.join(destination, 'files/hub/integrations/restored.json'), '{}');

      return Promise.resolve();
    },
  };
});

vi.mock('./s6-services.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  waitForApi: async (): Promise<boolean> => Promise.resolve(database.isApiReady),
}));

const RUN_ID = '1a2b3c4d-0000-4000-8000-000000000000';
const PREVIOUS = 'nebula_pre_restore_1a2b3c4d';
const OWN_KEY = randomBytes(32);
const OWN_FILE = keyFileOf(OWN_KEY, new Date('2026-01-01T00:00:00.000Z'));
let root = '';

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'nebula-restore-'));
  mkdirSync(path.join(root, 'secrets'), { recursive: true });
  writeFileSync(path.join(root, 'secrets/secrets-key'), 'aa\n');
  writeFileSync(path.join(root, 'secrets/backup-key.json'), 'the own key file');
  mkdirSync(path.join(root, 'hub/integrations'), { recursive: true });
  writeFileSync(path.join(root, 'hub/integrations/before.json'), '{}');
  database.asked = [];
  database.answer = (query): unknown[] =>
    query.includes('FROM pg_database WHERE datname IN')
      ? [{ datname: 'nebula' }, { datname: PREVIOUS }]
      : [];
  database.isApiReady = true;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A fake that answers at once. */
type Fake = ReturnType<typeof vi.fn<() => Promise<void>>>;

/**
 * A restore's context, every collaborator a fake.
 *
 * @returns The context, and the fakes to look at.
 */
function fakes(): {
  readonly context: RestoreJobContext;
  readonly stop: Fake;
  readonly start: Fake;
  readonly resume: Fake;
  readonly adoptKey: ReturnType<typeof vi.fn<(file: BackupKeyFile) => Promise<void>>>;
} {
  const key: BackupKey = {
    key: OWN_KEY,
    keyId: keyIdOf(OWN_KEY),
    source: 'file',
    createdAt: null,
    file: OWN_FILE,
  };
  const stop = vi.fn(async () => Promise.resolve());
  const start = vi.fn(async () => Promise.resolve());
  const resume = vi.fn(async () => Promise.resolve());
  const adoptKey = vi.fn<(file: BackupKeyFile) => Promise<void>>(async () => Promise.resolve());
  const context: RestoreJobContext = {
    db: {} as unknown as Database,
    logger: {
      error: vi.fn(),
      fatal: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
    } as unknown as PlatformLogger,
    now: () => new Date('2026-11-11T00:00:00.000Z'),
    adminUrl: 'postgres://nebula:secret@localhost:5432/nebula',
    pgBinDir: undefined,
    dataDir: root,
    backupsDir: path.join(root, 'backups'),
    secretsDir: path.join(root, 'secrets'),
    apiUrl: 'http://localhost:1',
    key,
    secretsKey: Buffer.alloc(32),
    currentKeys: { secretsKey: 'aa', totpKey: null },
    open: {} as unknown as OpenDependencies,
    s6Services: { stop, start } as unknown as S6Services,
    managedContainers: {
      suspend: vi.fn(async () => Promise.resolve()),
      resume,
      importVolumes: vi.fn(async () => Promise.resolve()),
    },
    progress: () => undefined,
    announce: () => undefined,
    safetyBackup: vi.fn(),
    adoptKey,
    signal: new AbortController().signal,
  };

  return { context, stop, start, resume, adoptKey };
}

const REQUEST = {
  runId: RUN_ID,
  location: {} as unknown as StoredLocation,
  archiveName: 'nebulahome-x.nhbk',
  uploadedKey: null,
  takeSafetyBackup: false,
};

describe('restoreArchive', () => {
  it('starts the services again when stopping them failed before the switch', async () => {
    const { context, stop, start, resume } = fakes();

    stop.mockRejectedValueOnce(new Error('s6-svc timed out'));

    const result = await restoreArchive(context, REQUEST);

    expect(result.outcome).toBe('failed');
    expect(start).toHaveBeenCalledWith(['core', 'hub', 'api']);
    expect(resume).toHaveBeenCalled();
  });

  it('leaves the databases alone when the switch renamed nothing', async () => {
    const { context } = fakes();

    database.answer = (query): unknown[] | Error =>
      query.includes(`RENAME TO ${PREVIOUS}`)
        ? new Error('database "nebula" is being accessed by other users')
        : query.includes('FROM pg_database WHERE datname IN')
          ? [{ datname: 'nebula' }]
          : [];

    const result = await restoreArchive(context, REQUEST);

    expect(result.outcome).toBe('rolled_back');
    expect(database.asked.filter((query) => query.includes('_failed_'))).toEqual([
      'DROP DATABASE IF EXISTS nebula_failed_1a2b3c4d WITH (FORCE)',
    ]);
    expect(database.asked).toContain('ALTER DATABASE nebula ALLOW_CONNECTIONS true');
  });

  it('keeps the folders it replaced when putting things back failed', async () => {
    const { context } = fakes();

    database.isApiReady = false;
    database.answer = (query): unknown[] | Error =>
      query.includes('RENAME TO nebula_failed')
        ? new Error('the server went away')
        : query.includes('FROM pg_database WHERE datname IN')
          ? [{ datname: 'nebula' }, { datname: PREVIOUS }]
          : [];

    const result = await restoreArchive(context, REQUEST);
    const previous = path.join(root, 'backups/.staging', `restore-${RUN_ID}`, 'previous');

    expect(result.outcome).toBe('manual');
    expect(result.message).toContain(previous);
    expect(existsSync(path.join(previous, 'hub/integrations/before.json'))).toBe(true);
    expect(existsSync(path.join(root, 'backups/.staging', `restore-${RUN_ID}`, 'archive'))).toBe(
      false,
    );
  });

  it('puts the backup key back when the restore is rolled back', async () => {
    const { context, adoptKey } = fakes();
    const uploaded = keyFileOf(randomBytes(32), new Date('2025-01-01T00:00:00.000Z'));

    database.isApiReady = false;

    const result = await restoreArchive(context, { ...REQUEST, uploadedKey: uploaded });

    expect(result.outcome).toBe('rolled_back');
    expect(readFileSync(path.join(root, 'secrets/backup-key.json'), 'utf8')).toBe(
      'the own key file\n',
    );
    expect(adoptKey).toHaveBeenLastCalledWith(OWN_FILE);
    expect(readFileSync(path.join(root, 'hub/integrations/before.json'), 'utf8')).toBe('{}');
  });
});
