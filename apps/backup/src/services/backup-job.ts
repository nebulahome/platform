/**
 * Taking one backup: the database dumped, the folders and the dump packed and encrypted into one
 * archive, and the archive written to every enabled location, each then trimmed by its retention.
 *
 * The archive is made once, in `backups/.staging/<run>/` on the data volume, and read from there
 * by every location; the system location, when enabled, then takes it by a rename - on the same
 * volume, so the largest copy is never made. A location that fails does not stop the others: the
 * run is then `partial`, and the location says why on the Backup page.
 */
import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, stat, statfs } from 'node:fs/promises';
import path from 'node:path';

import type {
  BackupDestination,
  BackupPhase,
  BackupRetention,
  BackupRunStatus,
  BackupSection,
  JsonObject,
} from '@nebulahome/contracts';
import type { Database } from '@nebulahome/db';
import type { PlatformLogger } from '@nebulahome/logging';

import { FILE_SECTIONS, writeArchive, type ArchiveManifest } from '../archive/archive.js';
import { connectAdmin, databaseFacts, historyExclusions } from '../database/admin.js';
import { dumpDatabase } from '../database/pg-tools.js';
import { archiveNameFor } from '../domain/archive-name.js';
import { archivesToRemove } from '../domain/retention.js';
import type { BackupKey } from '../key/backup-key.js';
import {
  readLocations,
  recordLocationResult,
  type StoredLocation,
} from '../persistence/backup-store.js';
import { directorySize } from '../persistence/directory-size.js';
import { openFolder } from '../transports/filesystem.js';
import { openLocation, targetOf, type OpenDependencies } from '../transports/open-location.js';
import type { LocationSession } from '../transports/session.js';

import type { OnDisk } from './estimates.js';

/** What a backup needs from the service around it. */
export type BackupJobContext = {
  readonly db: Database;
  readonly logger: PlatformLogger;
  readonly now: () => Date;
  readonly adminUrl: string;
  readonly pgBinDir: string | undefined;
  readonly dataDir: string;
  readonly backupsDir: string;
  readonly platformVersion: string;
  readonly key: BackupKey;
  readonly secretsKey: Buffer;
  readonly instanceKeys: ArchiveManifest['instanceKeys'];
  readonly open: OpenDependencies;
  readonly measureOnDisk: () => Promise<OnDisk>;

  /** Says what the run is doing, for the status. */
  readonly progress: (phase: BackupPhase, bytesDone?: number, bytesTotal?: number | null) => void;
  readonly signal: AbortSignal;
};

/** How a backup ended. */
export type BackupJobOutcome = {
  readonly status: Exclude<BackupRunStatus, 'running'>;
  readonly archiveName: string | null;
  readonly archiveBytes: number | null;
  readonly sectionBytes: Readonly<Record<string, number>>;
  readonly destinations: readonly BackupDestination[];
  readonly error: string | null;
};

/**
 * Says what went wrong, in one line.
 *
 * @param error - What was thrown.
 * @returns Its message.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Removes what a location's retention no longer keeps.
 *
 * @param session - The location, open.
 * @param retention - What it keeps.
 * @param justWritten - The archive this run wrote.
 * @param now - When.
 * @returns How many were removed.
 */
async function prune(
  session: LocationSession,
  retention: BackupRetention,
  justWritten: string,
  now: Date,
): Promise<number> {
  const names = (await session.list()).map((file) => file.name);
  const doomed = archivesToRemove(names, retention, now, justWritten);

  for (const name of doomed) {
    // eslint-disable-next-line no-await-in-loop -- one at a time, on one connection.
    await session.remove(name);
  }

  return doomed.length;
}

/**
 * Writes the archive to one location and trims it.
 *
 * @param context - The job's context.
 * @param location - The location.
 * @param archivePath - The archive, staged.
 * @param archiveName - Its name.
 * @returns How it went.
 */
async function deliver(
  context: BackupJobContext,
  location: StoredLocation,
  archivePath: string,
  archiveName: string,
): Promise<BackupDestination> {
  const startedAt = Date.now();

  try {
    const session = await openLocation(targetOf(location, context.secretsKey), context.open);

    try {
      const bytes = await session.write(archiveName, createReadStream(archivePath), context.signal);
      const pruned = await prune(session, location.retention, archiveName, context.now());

      await recordLocationResult(context.db, location.id, { error: null }, context.now());

      return {
        locationId: location.id,
        name: location.name,
        kind: location.kind,
        status: 'success',
        error: null,
        bytes,
        durationMs: Date.now() - startedAt,
        pruned,
      };
    } finally {
      await session.close();
    }
  } catch (error: unknown) {
    const message = messageOf(error);

    context.logger.warn(
      { location: location.name, err: error },
      'A location did not take the backup',
    );
    await recordLocationResult(context.db, location.id, { error: message }, context.now()).catch(
      () => undefined,
    );

    return {
      locationId: location.id,
      name: location.name,
      kind: location.kind,
      status: 'failure',
      error: message,
      bytes: null,
      durationMs: Date.now() - startedAt,
      pruned: 0,
    };
  }
}

/**
 * Takes one backup.
 *
 * @param context - See {@link BackupJobContext}.
 * @param run - The run's id and the parts it takes.
 * @param run.runId - The run's id.
 * @param run.sections - The parts it takes.
 * @returns How it ended.
 */
export async function takeBackup(
  context: BackupJobContext,
  run: { readonly runId: string; readonly sections: readonly BackupSection[] },
): Promise<BackupJobOutcome> {
  const createdAt = context.now();
  const archiveName = archiveNameFor(run.runId, createdAt);
  const staging = path.join(context.backupsDir, '.staging', run.runId);
  const sectionBytes: Record<string, number> = {};
  let archiveBytes: number | null = null;

  await mkdir(staging, { recursive: true, mode: 0o700 });

  try {
    context.progress('preparing');

    const locations = await readLocations(context.db, { onlyEnabled: true });

    if (locations.length === 0) {
      throw new Error('No backup location is enabled');
    }

    const hasHistory = run.sections.includes('history');
    const admin = connectAdmin(context.adminUrl);
    let facts;
    let exclusions: string[];

    try {
      facts = await databaseFacts(admin);
      exclusions = hasHistory ? [] : await historyExclusions(admin);
    } finally {
      await admin.end({ timeout: 5 });
    }

    const onDisk = await context.measureOnDisk();
    const expected =
      (onDisk.database.configuration + (hasHistory ? onDisk.database.history : 0)) * 0.5 +
      onDisk.files.configuration +
      (run.sections.includes('packages') ? onDisk.files.packages : 0);
    const room = await statfs(context.backupsDir).catch(() => null);

    if (room !== null && room.bavail * room.bsize < expected * 2) {
      throw new Error(
        'Not enough room on the data volume to make the archive: it needs about twice its size',
      );
    }

    context.progress('dumping');

    const dumpPath = path.join(staging, 'database.pgdump');

    await dumpDatabase(
      { binDir: context.pgBinDir },
      {
        url: context.adminUrl,
        output: dumpPath,
        excludeTableData: exclusions,
        signal: context.signal,
      },
    );

    const dumpBytes = (await stat(dumpPath)).size;
    const folders = FILE_SECTIONS.filter((each) => run.sections.includes(each.section));
    const files = await Promise.all(
      folders.map(async (each) => ({
        section: each.section,
        path: each.path,
        bytes: await directorySize(path.join(context.dataDir, each.path)),
      })),
    );
    const databaseTotal =
      onDisk.database.configuration + (hasHistory ? onDisk.database.history : 0) || 1;
    /**
     * What a part's folders take.
     *
     * @param section - The part.
     * @returns The bytes.
     */
    const filesOf = (section: BackupSection): number =>
      files.filter((each) => each.section === section).reduce((sum, each) => sum + each.bytes, 0);

    // The dump holds both database parts: each is given its share of it, by what it takes on disk.
    sectionBytes['configuration'] = Math.round(
      (dumpBytes * onDisk.database.configuration) / databaseTotal + filesOf('configuration'),
    );
    sectionBytes['history'] = hasHistory
      ? Math.round((dumpBytes * onDisk.database.history) / databaseTotal)
      : 0;
    sectionBytes['packages'] = filesOf('packages');
    // What was on disk, which the next estimate scales from.
    sectionBytes['disk_database_configuration'] = onDisk.database.configuration;
    sectionBytes['disk_database_history'] = onDisk.database.history;
    sectionBytes['disk_files_configuration'] = onDisk.files.configuration;
    sectionBytes['disk_files_packages'] = onDisk.files.packages;

    const manifest: ArchiveManifest = {
      format: 'nebulahome-backup',
      formatVersion: 1,
      runId: run.runId,
      createdAt: createdAt.toISOString(),
      platformVersion: context.platformVersion,
      sections: run.sections,
      schema: facts.schema,
      database: {
        postgresVersion: facts.postgresVersion,
        timescaledbVersion: facts.timescaledbVersion,
        historyIncluded: hasHistory,
        roles: facts.roles,
        bytes: dumpBytes,
      },
      files: files.map((each) => ({ path: each.path, bytes: each.bytes })),
      sectionBytes: {
        configuration: sectionBytes['configuration'] ?? 0,
        history: sectionBytes['history'] ?? 0,
        packages: sectionBytes['packages'] ?? 0,
      },
      instanceKeys: context.instanceKeys,
    };

    context.progress('packing');

    const archivePath = path.join(staging, archiveName);

    archiveBytes = (
      await writeArchive({
        output: archivePath,
        stagingDir: staging,
        manifest,
        databaseDump: dumpPath,
        dataDir: context.dataDir,
        folders: folders.map((each) => each.path),
        backupKey: context.key.key,
        keyId: context.key.keyId,
        signal: context.signal,
      })
    ).bytes;

    await rm(dumpPath, { force: true });
    context.progress('uploading', 0, archiveBytes);

    const destinations: BackupDestination[] = [];
    const remote = locations.filter((location) => location.kind !== 'system');
    const system = locations.find((location) => location.kind === 'system');

    for (const [index, location] of remote.entries()) {
      // eslint-disable-next-line no-await-in-loop -- one location at a time: one upload's bandwidth.
      destinations.push(await deliver(context, location, archivePath, archiveName));
      context.progress('uploading', (index + 1) * archiveBytes, archiveBytes * locations.length);
    }

    if (system !== undefined) {
      // Last, by a rename: the archive is already on this volume.
      const startedAt = Date.now();

      try {
        await rename(archivePath, path.join(context.backupsDir, archiveName));

        const session = await openFolder(context.backupsDir);
        const pruned = await prune(session, system.retention, archiveName, context.now());

        await recordLocationResult(context.db, system.id, { error: null }, context.now());
        destinations.push({
          locationId: system.id,
          name: system.name,
          kind: 'system',
          status: 'success',
          error: null,
          bytes: archiveBytes,
          durationMs: Date.now() - startedAt,
          pruned,
        });
      } catch (error: unknown) {
        await recordLocationResult(
          context.db,
          system.id,
          { error: messageOf(error) },
          context.now(),
        );
        destinations.push({
          locationId: system.id,
          name: system.name,
          kind: 'system',
          status: 'failure',
          error: messageOf(error),
          bytes: null,
          durationMs: Date.now() - startedAt,
          pruned: 0,
        });
      }
    }

    const taken = destinations.filter((each) => each.status === 'success').length;

    return {
      status: taken === destinations.length ? 'success' : taken > 0 ? 'partial' : 'failure',
      archiveName,
      archiveBytes,
      sectionBytes,
      destinations,
      error: taken === 0 ? 'No location took the backup' : null,
    };
  } catch (error: unknown) {
    const isCancelled = context.signal.aborted;

    context.logger.error(
      { err: error },
      isCancelled ? 'The backup was cancelled' : 'The backup failed',
    );

    return {
      status: isCancelled ? 'cancelled' : 'failure',
      archiveName: null,
      archiveBytes,
      sectionBytes,
      destinations: [],
      error: isCancelled ? 'Cancelled' : messageOf(error),
    };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/**
 * A destination, as the run's record stores it.
 *
 * @param destination - The destination.
 * @returns The JSON.
 */
export function destinationJson(destination: BackupDestination): JsonObject {
  return { ...destination };
}
