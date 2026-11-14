/**
 * After writing an archive to a location, older ones are removed by its retention - but only when
 * the new one arrived whole, and never by the backup taken before a restore.
 *
 * The database, the dump, the archive and the location are fakes.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '@nebulahome/db';
import type { PlatformLogger } from '@nebulahome/logging';

import type { BackupKey } from '../key/backup-key.js';
import type { OpenDependencies } from '../transports/open-location.js';

import { takeBackup, type BackupJobContext } from './backup-job.js';

/** The location, as the fakes see it. */
const location = vi.hoisted(() => {
  const state: { writtenBytes: number; remove: (name: string) => void } = {
    writtenBytes: 10,
    remove: () => undefined,
  };

  return state;
});

/** What the archive is: ten bytes. */
const ARCHIVE_TEXT = '0123456789';

vi.mock('../persistence/backup-store.js', () => ({
  readLocations: async (): Promise<unknown[]> =>
    Promise.resolve([
      {
        id: 'location-1',
        name: 'NAS',
        kind: 'ftp',
        config: {},
        isEnabled: true,
        retention: { mode: 'count', value: 1 },
      },
    ]),
  recordLocationResult: async (): Promise<void> => Promise.resolve(),
}));

vi.mock('../database/admin.js', () => ({
  connectAdmin: (): unknown => ({ end: async (): Promise<void> => Promise.resolve() }),
  databaseFacts: async (): Promise<unknown> =>
    Promise.resolve({
      postgresVersion: '16',
      timescaledbVersion: null,
      roles: [],
      schema: { version: 1, latestHash: 'abc' },
    }),
  historyExclusions: async (): Promise<string[]> => Promise.resolve([]),
}));

vi.mock('../database/pg-tools.js', async () => {
  const { writeFile } = await import('node:fs/promises');

  return {
    dumpDatabase: async (...[, options]: [unknown, { output: string }]): Promise<void> =>
      writeFile(options.output, 'PGDMP'),
  };
});

vi.mock('../persistence/directory-size.js', () => ({
  directorySize: async (): Promise<number> => Promise.resolve(0),
}));

vi.mock('../archive/archive.js', async (importOriginal) => {
  const { writeFile } = await import('node:fs/promises');

  return {
    ...(await importOriginal<object>()),
    writeArchive: async (options: { output: string }): Promise<{ bytes: number }> => {
      await writeFile(options.output, ARCHIVE_TEXT);

      return { bytes: ARCHIVE_TEXT.length };
    },
  };
});

vi.mock('../transports/open-location.js', () => ({
  targetOf: (): unknown => ({}),
  openLocation: async (): Promise<unknown> =>
    Promise.resolve({
      write: async (): Promise<number> => Promise.resolve(location.writtenBytes),
      list: async (): Promise<unknown[]> =>
        Promise.resolve([
          { name: 'nebulahome-20260101T030000Z-aaaaaaaa.nhbk', bytes: 10 },
          { name: 'nebulahome-20260102T030000Z-bbbbbbbb.nhbk', bytes: 10 },
        ]),
      remove: async (name: string): Promise<void> => {
        location.remove(name);

        return Promise.resolve();
      },
      close: async (): Promise<void> => Promise.resolve(),
    }),
}));

let root = '';

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'nebula-backup-'));
  location.writtenBytes = ARCHIVE_TEXT.length;
  location.remove = vi.fn();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/**
 * A backup's context, every collaborator a fake.
 *
 * @returns The context.
 */
function contextOf(): BackupJobContext {
  return {
    db: {} as unknown as Database,
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as unknown as PlatformLogger,
    now: () => new Date('2026-11-11T03:00:00.000Z'),
    adminUrl: 'postgres://nebula:secret@localhost:5432/nebula',
    pgBinDir: undefined,
    dataDir: root,
    backupsDir: path.join(root, 'backups'),
    platformVersion: '0.0.0',
    key: { key: Buffer.alloc(32), keyId: '12'.repeat(16) } as unknown as BackupKey,
    secretsKey: Buffer.alloc(32),
    instanceKeys: { secretsKey: 'aa', totpKey: null },
    open: {} as unknown as OpenDependencies,
    measureOnDisk: async () =>
      Promise.resolve({
        database: { configuration: 0, history: 0 },
        files: { configuration: 0, packages: 0, containers: 0 },
      }),
    exportVolumes: vi.fn(),
    progress: () => undefined,
    signal: new AbortController().signal,
  };
}

const RUN = { runId: '1a2b3c4d-0000-4000-8000-000000000000', sections: ['configuration'] } as const;

describe('takeBackup', () => {
  it('trims a location by its retention once the archive is there whole', async () => {
    const outcome = await takeBackup(contextOf(), { ...RUN, prunes: true });

    expect(outcome.status).toBe('success');
    expect(location.remove).toHaveBeenCalledWith('nebulahome-20260101T030000Z-aaaaaaaa.nhbk');
  });

  it('fails the location and trims nothing when the archive did not arrive whole', async () => {
    location.writtenBytes = 3;

    const outcome = await takeBackup(contextOf(), { ...RUN, prunes: true });

    expect(outcome.status).toBe('failure');
    expect(outcome.destinations[0]?.error).toContain('not written whole');
    expect(location.remove).not.toHaveBeenCalled();
  });

  it('trims nothing for the backup taken before a restore', async () => {
    const outcome = await takeBackup(contextOf(), { ...RUN, prunes: false });

    expect(outcome.status).toBe('success');
    expect(location.remove).not.toHaveBeenCalled();
  });
});
