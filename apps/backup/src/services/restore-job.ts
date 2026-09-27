/**
 * Restoring an archive: the installation brought back to what it was when the archive was made.
 *
 * Into a new database, then swapped by name, rather than over the live one: until the swap the
 * installation runs as it was, and a failure before it costs nothing; after it, the swap is
 * undone by renaming back (DATABASE.md 15). In order:
 *
 * 1. The archive is fetched from its location, decrypted and unpacked into staging - only what an
 *    archive may carry - and its manifest checked: the same schema, a TimescaleDB this server can
 *    install.
 * 2. Optionally, a backup of what is here now, first: the way back.
 * 3. Maintenance: `api` answers 503 from here on; `core` and `hub` go on running.
 * 4. The dump is restored into a new database, with TimescaleDB's pre- and post-restore around it.
 * 5. What belongs to this machine rather than to the archive is carried over into it from the
 *    live one: the backup locations, the backup settings and runs, the audit trail since the
 *    archive was made. Every session is revoked: the users are the archive's now.
 * 6. The services are stopped, the databases swapped by name, the data directory's folders
 *    swapped for the archive's, the instance keys put back as the archive has them.
 * 7. The services start again, rebuilding what they hold in memory from what they now find.
 */
import { existsSync } from 'node:fs';
import {
  chown,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import type postgres from 'postgres';

import type {
  BackupKeyFile,
  BackupPhase,
  JsonObject,
  MaintenanceState,
} from '@nebula-home/contracts';
import type { Database } from '@nebula-home/db';
import type { PlatformLogger } from '@nebula-home/logging';

import {
  DATABASE_ENTRY,
  extractArchive,
  FILE_SECTIONS,
  FILES_ENTRY,
  readManifest,
} from '../archive/archive.js';
import {
  canInstallTimescale,
  connectAdmin,
  databaseFacts,
  databaseNameOf,
  type AdminSql,
} from '../database/admin.js';
import { restoreDatabase } from '../database/pg-tools.js';
import { writeKeyFile, type BackupKey } from '../key/backup-key.js';
import { finishRun, type StoredLocation } from '../persistence/backup-store.js';
import { openLocation, targetOf, type OpenDependencies } from '../transports/open-location.js';

import { messageOf, type BackupJobOutcome } from './backup-job.js';
import { RESTORED_SERVICES, waitForApi, type Supervisor } from './supervisor.js';

/** What a restore needs from the service around it. */
export type RestoreJobContext = {
  readonly db: Database;
  readonly logger: PlatformLogger;
  readonly now: () => Date;
  readonly adminUrl: string;
  readonly pgBinDir: string | undefined;
  readonly dataDir: string;
  readonly backupsDir: string;
  readonly secretsDir: string;
  readonly apiUrl: string;
  readonly key: BackupKey;
  readonly secretsKey: Buffer;

  /** The instance keys the running services use now. */
  readonly currentKeys: { readonly secretsKey: string; readonly totpKey: string | null };
  readonly open: OpenDependencies;
  readonly supervisor: Supervisor;

  /**
   * The containers the integrations run, which keep their data in the folders a restore swaps:
   * stopped before the swap and started after it. Best effort - a machine without Docker has
   * none, and the restore does not wait on one that does not answer.
   */
  readonly managedContainers: {
    readonly suspend: () => Promise<void>;
    readonly resume: () => Promise<void>;
  };

  /** Says what the run is doing, for the status and the maintenance screen. */
  readonly progress: (phase: BackupPhase, percent: number | null) => void;

  /** Announces the maintenance state. */
  readonly announce: (state: MaintenanceState) => void;

  /** Takes a backup of what is here now. */
  readonly safetyBackup: () => Promise<BackupJobOutcome>;

  /** Makes a key the installation's own, after an archive made with it is restored. */
  readonly adoptKey: (file: BackupKeyFile) => Promise<void>;
  readonly signal: AbortSignal;
};

/** What a restore is asked to do. */
export type RestoreRequest = {
  readonly runId: string;
  readonly location: StoredLocation;
  readonly archiveName: string;

  /** The key file the owner uploaded, for an archive made with another installation's key. */
  readonly uploadedKey: BackupKeyFile | null;
  readonly takeSafetyBackup: boolean;
};

/** How a restore ended. */
export type RestoreOutcome = {
  readonly outcome: 'restored' | 'failed' | 'rolled_back' | 'manual';
  readonly message: string | null;
  readonly switchedAt: Date | null;
};

/** The file each instance key is kept in, in `secrets/`, by the container (nebula-env). */
const KEY_FILES = { secretsKey: 'secrets-key', totpKey: 'totp-key' } as const;

/**
 * Gives a folder tree to an owner.
 *
 * @param target - The folder.
 * @param uid - The owner.
 * @param gid - Its group.
 */
async function chownTree(target: string, uid: number, gid: number): Promise<void> {
  await chown(target, uid, gid);

  if (!(await lstat(target)).isDirectory()) {
    return;
  }

  for (const entry of await readdir(target, { withFileTypes: true })) {
    if (!entry.isSymbolicLink()) {
      // eslint-disable-next-line no-await-in-loop -- a walk, one entry at a time.
      await chownTree(path.join(target, entry.name), uid, gid);
    }
  }
}

/**
 * Inserts whole rows of a table, given as JSON the way another database had them.
 *
 * @param to - The database - or transaction - they go to.
 * @param table - The table, as `schema.table`.
 * @param rows - The rows.
 */
async function insertRows(
  to: AdminSql | postgres.TransactionSql,
  table: string,
  rows: readonly JsonObject[],
): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const [schema = 'system', name = ''] = table.split('.');

  await to`
    INSERT INTO ${to(schema)}.${to(name)}
    SELECT * FROM jsonb_populate_recordset(null::${to(schema)}.${to(name)}, ${to.json(rows)})`;
}

/**
 * Carries over what belongs to this machine rather than to the archive, and revokes every
 * session.
 *
 * @param live - The live database.
 * @param fresh - The database just restored.
 * @param since - When the archive was made: the audit trail after it is kept.
 */
async function reconcile(live: AdminSql, fresh: AdminSql, since: string): Promise<void> {
  const users = new Set(
    (await fresh<{ id: string }[]>`SELECT id::text FROM auth.users`).map((row) => row.id),
  );
  /**
   * A user reference, kept only when the restored database has that user.
   *
   * @param id - The user's id.
   * @returns It, or null.
   */
  const keepUser = (id: unknown): unknown => (typeof id === 'string' && users.has(id) ? id : null);
  const locations = await live<
    JsonObject[]
  >`SELECT to_jsonb(l) AS row FROM system.backup_locations l`;
  const runs = await live<JsonObject[]>`SELECT to_jsonb(r) AS row FROM system.backup_runs r`;
  const settings = await live<{ key: string; value: JsonObject; updated_by: string | null }[]>`
    SELECT key, value, updated_by::text FROM system.settings WHERE key LIKE 'backup.%'`;
  const audit = await live<JsonObject[]>`
    SELECT to_jsonb(a) AS row FROM system.audit_log a WHERE a.time > ${since}::timestamptz`;
  /**
   * The rows of a `to_jsonb` query.
   *
   * @param result - The query's result.
   * @returns The rows.
   */
  const rowsOf = (result: readonly JsonObject[]): JsonObject[] =>
    result.map((each) => each['row'] as JsonObject);

  await fresh.begin(async (transaction) => {
    await transaction`DELETE FROM system.backup_runs`;
    await transaction`DELETE FROM system.backup_locations`;
    await insertRows(
      transaction,
      'system.backup_locations',
      rowsOf(locations).map((row) => ({
        ...row,
        created_by: keepUser(row['created_by']) as string | null,
      })),
    );
    await insertRows(
      transaction,
      'system.backup_runs',
      rowsOf(runs).map((row) => ({
        ...row,
        requested_by: keepUser(row['requested_by']) as string | null,
      })),
    );

    for (const setting of settings) {
      // eslint-disable-next-line no-await-in-loop -- four rows.
      await transaction`
        UPDATE system.settings
        SET value = ${transaction.json(setting.value)}, updated_by = ${keepUser(setting.updated_by) as string | null}
        WHERE key = ${setting.key}`;
    }

    await insertRows(transaction, 'system.audit_log', rowsOf(audit));
    await transaction`
      UPDATE auth.sessions SET revoked_at = now(), revoked_reason = 'restore'
      WHERE revoked_at IS NULL`;
  });
}

/**
 * Reads a key file of the container's, when it is there.
 *
 * @param file - The file.
 * @returns Its content, trimmed, or null.
 */
async function readKey(file: string): Promise<string | null> {
  try {
    return (await readFile(file, 'utf8')).trim();
  } catch {
    return null;
  }
}

/**
 * Restores an archive.
 *
 * @param context - See {@link RestoreJobContext}.
 * @param request - See {@link RestoreRequest}.
 * @returns How it ended.
 */
export async function restoreArchive(
  context: RestoreJobContext,
  request: RestoreRequest,
): Promise<RestoreOutcome> {
  const short = request.runId.replaceAll('-', '').slice(0, 8);
  const liveName = databaseNameOf(context.adminUrl);
  const freshName = `${liveName}_restore_${short}`;
  const previousName = `${liveName}_pre_restore_${short}`;
  const staging = path.join(context.backupsDir, '.staging', `restore-${request.runId}`);
  const extracted = path.join(staging, 'archive');
  const previous = path.join(staging, 'previous');
  const swappedFolders: string[] = [];
  const replacedKeys: { file: string; before: string | null }[] = [];
  let isSwitched = false;
  let switchedAt: Date | null = null;

  await mkdir(extracted, { recursive: true, mode: 0o700 });

  /**
   * Undoes the swap: the databases back by name, the folders and the keys back where they were.
   */
  const rollBack = async (): Promise<void> => {
    await context.supervisor.stop(RESTORED_SERVICES).catch(() => undefined);

    const postgres = connectAdmin(context.adminUrl, 'postgres');

    try {
      const failedName = `${liveName}_failed_${short}`;

      await postgres`ALTER DATABASE ${postgres(liveName)} ALLOW_CONNECTIONS false`;
      await postgres`
        SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname = ${liveName} AND pid <> pg_backend_pid()`;
      await postgres`ALTER DATABASE ${postgres(liveName)} RENAME TO ${postgres(failedName)}`;
      await postgres`ALTER DATABASE ${postgres(previousName)} RENAME TO ${postgres(liveName)}`;
      await postgres`ALTER DATABASE ${postgres(liveName)} ALLOW_CONNECTIONS true`;
      await postgres`DROP DATABASE IF EXISTS ${postgres(failedName)} WITH (FORCE)`;
    } finally {
      await postgres.end({ timeout: 5 });
    }

    for (const folder of swappedFolders) {
      const live = path.join(context.dataDir, folder);

      // eslint-disable-next-line no-await-in-loop -- a handful of folders, in order.
      await rm(live, { recursive: true, force: true });

      if (existsSync(path.join(previous, folder))) {
        // eslint-disable-next-line no-await-in-loop -- as above.
        await rename(path.join(previous, folder), live);
      }
    }

    for (const key of replacedKeys) {
      // eslint-disable-next-line no-await-in-loop -- two files.
      await (key.before === null
        ? rm(key.file, { force: true })
        : writeFile(key.file, `${key.before}\n`, { mode: 0o600 }));
    }

    await context.supervisor.start([...RESTORED_SERVICES].reverse());
    await context.managedContainers.resume();
  };

  try {
    // 1. Fetch, open and check.
    context.progress('downloading', 5);

    const session = await openLocation(
      targetOf(request.location, context.secretsKey),
      context.open,
    );

    try {
      const source = await session.read(request.archiveName);

      context.progress('verifying', 15);
      await extractArchive({
        source,
        destination: extracted,
        /**
         * The key an archive needs: this installation's, or the one uploaded.
         *
         * @param keyId - The key's id.
         * @returns The key, or null.
         */
        keyFor: (keyId): Buffer | null =>
          keyId === context.key.keyId
            ? context.key.key
            : request.uploadedKey?.keyId === keyId
              ? Buffer.from(request.uploadedKey.key, 'hex')
              : null,
        signal: context.signal,
      });
    } finally {
      await session.close();
    }

    const manifest = await readManifest(extracted);
    const dump = path.join(extracted, DATABASE_ENTRY);
    const checker = connectAdmin(context.adminUrl);

    try {
      const facts = await databaseFacts(checker);

      if (
        manifest.schema.version !== facts.schema.version ||
        manifest.schema.latestHash !== facts.schema.latestHash
      ) {
        throw new Error(
          'This archive was made by a different build of NebulaHome, with another database schema',
        );
      }

      if (!(await canInstallTimescale(checker, manifest.database.timescaledbVersion))) {
        throw new Error(
          `This server cannot install TimescaleDB ${manifest.database.timescaledbVersion ?? ''}, which the archive was made with`,
        );
      }
    } finally {
      await checker.end({ timeout: 5 });
    }

    if (!existsSync(dump)) {
      throw new Error('The archive holds no database');
    }

    // 2. The way back.
    if (request.takeSafetyBackup) {
      context.progress('safety_backup', 20);

      const safety = await context.safetyBackup();

      if (safety.status === 'failure' || safety.status === 'cancelled') {
        throw new Error(
          `The backup of what is here now failed, so nothing was restored: ${safety.error ?? ''}`,
        );
      }
    }

    // 3. From here the database is about to change under api.
    context.progress('restoring_database', 35);

    // 4. Into a new database.
    const postgres = connectAdmin(context.adminUrl, 'postgres');

    try {
      const [live] = await postgres<{ encoding: string; collate: string; ctype: string }[]>`
        SELECT pg_encoding_to_char(encoding) AS encoding, datcollate AS collate, datctype AS ctype
        FROM pg_database WHERE datname = ${liveName}`;

      await postgres`DROP DATABASE IF EXISTS ${postgres(freshName)} WITH (FORCE)`;
      await postgres.unsafe(
        `CREATE DATABASE "${freshName}" TEMPLATE template0 ENCODING '${live?.encoding ?? 'UTF8'}' LC_COLLATE '${live?.collate ?? 'C.UTF-8'}' LC_CTYPE '${live?.ctype ?? 'C.UTF-8'}'`,
      );

      for (const role of manifest.database.roles) {
        if (/^nebula_[a-z_]+$/u.test(role)) {
          // eslint-disable-next-line no-await-in-loop -- a handful of roles.
          await postgres.unsafe(
            `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN CREATE ROLE "${role}" NOLOGIN; END IF; END $$`,
          );
        }
      }
    } finally {
      await postgres.end({ timeout: 5 });
    }

    const prepare = connectAdmin(context.adminUrl, freshName);

    try {
      await (manifest.database.timescaledbVersion === null
        ? prepare`CREATE EXTENSION IF NOT EXISTS timescaledb`
        : prepare.unsafe(
            `CREATE EXTENSION IF NOT EXISTS timescaledb VERSION '${manifest.database.timescaledbVersion.replaceAll("'", '')}'`,
          ));
      await prepare`SELECT timescaledb_pre_restore()`;
    } finally {
      await prepare.end({ timeout: 5 });
    }

    let restoredItems = 0;

    await restoreDatabase(
      { binDir: context.pgBinDir },
      {
        url: context.adminUrl,
        database: freshName,
        input: dump,
        signal: context.signal,
        /**
         * Counts what `pg_restore` has done, for the progress.
         *
         * @param line - A line it wrote.
         */
        onLine: (line): void => {
          if (
            line.startsWith('pg_restore: creating') ||
            line.startsWith('pg_restore: processing')
          ) {
            restoredItems += 1;
            context.progress('restoring_database', Math.min(70, 35 + restoredItems / 20));
          }
        },
      },
    );

    // 5. What belongs to this machine, into the restored database.
    context.progress('reconciling', 72);

    const live = connectAdmin(context.adminUrl);
    const fresh = connectAdmin(context.adminUrl, freshName);

    try {
      await fresh`SELECT timescaledb_post_restore()`;
      await fresh`ANALYZE`;
      await reconcile(live, fresh, manifest.createdAt);
    } finally {
      await live.end({ timeout: 5 });
      await fresh.end({ timeout: 5 });
    }

    // 6. The switch.
    context.progress('switching', 80);
    await context.managedContainers.suspend();
    await context.supervisor.stop(RESTORED_SERVICES);
    isSwitched = true;
    switchedAt = context.now();

    const swap = connectAdmin(context.adminUrl, 'postgres');

    try {
      await swap`ALTER DATABASE ${swap(liveName)} ALLOW_CONNECTIONS false`;
      await swap`
        SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname IN (${liveName}, ${freshName}) AND pid <> pg_backend_pid()`;
      await swap`ALTER DATABASE ${swap(liveName)} RENAME TO ${swap(previousName)}`;
      await swap`ALTER DATABASE ${swap(freshName)} RENAME TO ${swap(liveName)}`;
    } finally {
      await swap.end({ timeout: 5 });
    }

    const workers = connectAdmin(context.adminUrl);

    try {
      await workers`SELECT _timescaledb_functions.start_background_workers()`;
    } finally {
      await workers.end({ timeout: 5 });
    }

    for (const section of FILE_SECTIONS) {
      const incoming = path.join(extracted, FILES_ENTRY, section.path);

      if (!existsSync(incoming)) {
        // The archive has none of it: what is here stays - the packages of an archive without them.
        continue;
      }

      const live = path.join(context.dataDir, section.path);
      // eslint-disable-next-line no-await-in-loop -- a handful of folders, in order.
      const owner = await stat(existsSync(live) ? live : path.dirname(live));

      // eslint-disable-next-line no-await-in-loop -- as above.
      await mkdir(path.dirname(path.join(previous, section.path)), { recursive: true });

      if (existsSync(live)) {
        // eslint-disable-next-line no-await-in-loop -- as above.
        await rename(live, path.join(previous, section.path));
      }

      swappedFolders.push(section.path);
      // eslint-disable-next-line no-await-in-loop -- as above.
      await rename(incoming, live);

      if (!section.keepsOwners) {
        // eslint-disable-next-line no-await-in-loop -- as above.
        await chownTree(live, owner.uid, owner.gid).catch(() => undefined);
      }
    }

    // The keys the restored database's secrets are sealed with.
    let keyMessage: string | null = null;

    for (const [name, value] of [
      ['secretsKey', manifest.instanceKeys.secretsKey],
      ['totpKey', manifest.instanceKeys.totpKey],
    ] as const) {
      const file = path.join(context.secretsDir, KEY_FILES[name]);
      // eslint-disable-next-line no-await-in-loop -- two files.
      const before = await readKey(file);
      const running = context.currentKeys[name];

      if (value === null || value === before) {
        continue;
      }

      if (running !== null && before !== null && running !== before) {
        keyMessage =
          'The environment sets the instance keys itself: remove NEBULA_SECRETS_KEY and API_TOTP_ENCRYPTION_KEY from it, or the restored credentials cannot be opened';
      }

      replacedKeys.push({ file, before });
      // eslint-disable-next-line no-await-in-loop -- two files.
      await writeFile(file, `${value}\n`, { mode: 0o600 });
    }

    if (request.uploadedKey !== null && request.uploadedKey.keyId !== context.key.keyId) {
      await writeKeyFile(context.secretsDir, request.uploadedKey);
      await context.adoptKey(request.uploadedKey);
    }

    // 7. Back.
    context.progress('starting_services', 90);
    await context.supervisor.start([...RESTORED_SERVICES].reverse());
    await context.managedContainers.resume();

    if (!(await waitForApi(context.apiUrl, 120_000))) {
      context.logger.error('The services did not come back after the restore: rolling back');

      try {
        await rollBack();
      } catch (error: unknown) {
        context.logger.fatal({ err: error }, 'The rollback failed');

        return {
          outcome: 'manual',
          message: `The restore failed and so did putting things back. The previous database is kept as ${previousName}. ${messageOf(error)}`,
          switchedAt,
        };
      }

      return {
        outcome: 'rolled_back',
        message:
          'The services did not start with the restored data, so everything was put back as it was',
        switchedAt: null,
      };
    }

    context.progress('finishing', 97);

    const cleanup = connectAdmin(context.adminUrl, 'postgres');

    try {
      await cleanup`DROP DATABASE IF EXISTS ${cleanup(previousName)} WITH (FORCE)`;
    } catch (error: unknown) {
      context.logger.warn(
        { err: error, database: previousName },
        'The previous database was not dropped',
      );
    } finally {
      await cleanup.end({ timeout: 5 });
    }

    return { outcome: 'restored', message: keyMessage, switchedAt };
  } catch (error: unknown) {
    context.logger.error({ err: error }, 'The restore failed');

    if (isSwitched) {
      try {
        await rollBack();

        return {
          outcome: 'rolled_back',
          message: `The restore failed after the switch, and everything was put back: ${messageOf(error)}`,
          switchedAt: null,
        };
      } catch (rollbackError: unknown) {
        return {
          outcome: 'manual',
          message: `The restore failed and so did putting things back. The previous database is kept as ${previousName}. ${messageOf(rollbackError)}`,
          switchedAt,
        };
      }
    }

    const cleanup = connectAdmin(context.adminUrl, 'postgres');

    await cleanup`DROP DATABASE IF EXISTS ${cleanup(freshName)} WITH (FORCE)`
      .catch(() => undefined)
      .finally(() => cleanup.end({ timeout: 5 }));

    return { outcome: 'failed', message: messageOf(error), switchedAt: null };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/**
 * Records how a restore ended, in whichever database is live now.
 *
 * @param db - The service's connection, which follows the live database by name.
 * @param runId - The run.
 * @param result - How it ended.
 * @param at - When.
 */
export async function recordRestore(
  db: Database,
  runId: string,
  result: RestoreOutcome,
  at: Date,
): Promise<void> {
  await finishRun(
    db,
    runId,
    {
      status: result.outcome === 'restored' ? 'success' : 'failure',
      error: result.outcome === 'restored' ? result.message : (result.message ?? result.outcome),
    },
    at,
  );
}
