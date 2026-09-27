/**
 * Backups, as `api` serves them: the locations it keeps in the database, and everything else it
 * asks the `backup` service for over the bus.
 *
 * A location's password is sealed before it is written and never leaves again: a view says only
 * whether there is one, and a change that leaves it out keeps the stored one - the pattern of
 * every stored credential (DATABASE.md 11).
 */
import { and, desc, eq, sql } from 'drizzle-orm';

import type { BusClient } from '@nebula-home/bus';
import {
  type BACKUP_METHODS,
  BACKUP_SERVICE,
  ConflictError,
  DeviceUnavailableError,
  NotFoundError,
  ValidationError,
  backupAcknowledgementSchema,
  backupArchiveListSchema,
  backupBrowseResultSchema,
  backupKeyReplySchema,
  backupLocationTestResultSchema,
  backupRunStartedSchema,
  backupStatusSchema,
  backupTargetViewSchema,
  busSubjects,
  localPathProblem,
  type BackupLocationCreate,
  type BackupLocationUpdate,
  type BackupLocationView,
  type BackupRunView,
  type BackupTargetInput,
  type BackupTargetView,
  type JsonObject,
} from '@nebula-home/contracts';
import { isSealed, schema, sealSecrets, type Database } from '@nebula-home/db';

const { backupLocations, backupRuns, auditLog } = schema.system;
const { users } = schema.auth;

/** How long a request that only reads or starts something may take. */
const QUICK_TIMEOUT_MS = 10_000;

/** How long trying a location, or listing every location's archives, may take. */
const SLOW_TIMEOUT_MS = 60_000;

/** What asking the backup service needs. */
export type BackupBusContext = {
  readonly bus: BusClient | undefined;
  readonly traceId: string;
};

/**
 * Asks the backup service one of its methods.
 *
 * @param context - The bus and the trace id.
 * @param method - The method.
 * @param payload - The request.
 * @param reply - The reply's schema.
 * @param timeoutMs - How long it may take.
 * @returns The reply.
 * @throws {DeviceUnavailableError} When the bus is away or `backup` does not answer.
 */
export async function askBackup<TReply>(
  context: BackupBusContext,
  method: (typeof BACKUP_METHODS)[keyof typeof BACKUP_METHODS],
  payload: unknown,
  reply: { parse: (value: unknown) => TReply } & Parameters<BusClient['request']>[2],
  timeoutMs = QUICK_TIMEOUT_MS,
): Promise<TReply> {
  if (context.bus === undefined) {
    throw new DeviceUnavailableError('The message bus is not reachable', {
      details: { dependency: 'bus' },
    });
  }

  return (await context.bus.request(busSubjects.service(BACKUP_SERVICE, method), payload, reply, {
    traceId: context.traceId,
    timeoutMs,
  })) as TReply;
}

/** The schemas of the replies, for {@link askBackup}. */
export const BACKUP_REPLIES = {
  status: backupStatusSchema,
  acknowledgement: backupAcknowledgementSchema,
  started: backupRunStartedSchema,
  test: backupLocationTestResultSchema,
  browse: backupBrowseResultSchema,
  archives: backupArchiveListSchema,
  key: backupKeyReplySchema,
} as const;

export { QUICK_TIMEOUT_MS, SLOW_TIMEOUT_MS };

/**
 * A stored target as it is shown: the password replaced by whether there is one.
 *
 * @param kind - The location's kind.
 * @param config - Its stored settings.
 * @returns The view.
 */
function targetView(kind: string, config: JsonObject): BackupTargetView {
  if (kind === 'system') {
    return { kind: 'system' };
  }

  const { password, ...rest } = config;
  const hasPassword = isSealed(password) || (typeof password === 'string' && password !== '');

  return backupTargetViewSchema.parse(
    kind === 'smb' || kind === 'ftp' ? { ...rest, kind, hasPassword } : { ...rest, kind },
  );
}

/**
 * A location row as the interface sees it.
 *
 * @param row - The row.
 * @returns The view.
 */
function locationView(row: typeof backupLocations.$inferSelect): BackupLocationView {
  return {
    id: row.id,
    name: row.name,
    target: targetView(row.kind, row.config as JsonObject),
    isEnabled: row.isEnabled,
    retention: {
      mode: row.retentionMode as 'count' | 'days',
      value: row.retentionValue,
    },
    lastResult: row.lastResult as 'success' | 'failure' | null,
    lastError: row.lastError,
    lastSuccessAt: row.lastSuccessAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Lists the locations, the system one first.
 *
 * @param db - The database.
 * @returns The locations.
 */
export async function listBackupLocations(db: Database): Promise<BackupLocationView[]> {
  const rows = await db
    .select()
    .from(backupLocations)
    .orderBy(sql`${backupLocations.kind} <> 'system'`, backupLocations.createdAt);

  return rows.map(locationView);
}

/**
 * Checks a target, and turns it into what is stored: the kind apart, the password sealed.
 *
 * @param target - The target as typed.
 * @param dataDir - The data directory, which no local location may be inside.
 * @param secretsKey - The sealing key.
 * @param kept - The stored settings a password left out is kept from, on a change.
 * @returns The settings to store.
 * @throws {ValidationError} When a local folder is one that cannot hold backups.
 */
function storedConfig(
  target: BackupTargetInput,
  dataDir: string,
  secretsKey: Buffer,
  kept: JsonObject | null,
): JsonObject {
  if (target.kind === 'local') {
    const problem = localPathProblem(target.path, dataDir);

    if (problem !== null) {
      throw new ValidationError(problem, {
        details: { issues: [{ path: 'target.path', message: problem }] },
      });
    }
  }

  const { kind, ...settings } = target;
  const config: JsonObject = JSON.parse(JSON.stringify(settings)) as JsonObject;

  if (kind === 'smb' || kind === 'ftp') {
    if (target.password === undefined || target.password === '') {
      delete config['password'];

      // Left out on a change: the stored one stays, as it is.
      if (kept?.['password'] !== undefined) {
        config['password'] = kept['password'];
      }
    }
  }

  return sealSecrets(config, ['password'], secretsKey);
}

/**
 * Adds a location.
 *
 * @param db - The database.
 * @param input - The location.
 * @param options - The sealing key, the data directory and who adds it.
 * @param options.secretsKey - The sealing key.
 * @param options.dataDir - The data directory.
 * @param options.userId - Who adds it.
 * @returns The location.
 */
export async function createBackupLocation(
  db: Database,
  input: BackupLocationCreate,
  options: { readonly secretsKey: Buffer; readonly dataDir: string; readonly userId: string },
): Promise<BackupLocationView> {
  const [row] = await db
    .insert(backupLocations)
    .values({
      name: input.name,
      kind: input.target.kind,
      config: storedConfig(input.target, options.dataDir, options.secretsKey, null),
      isEnabled: input.isEnabled,
      retentionMode: input.retention.mode,
      retentionValue: input.retention.value,
      createdBy: options.userId,
    })
    .returning();

  if (row === undefined) {
    throw new Error('The location was not stored');
  }

  return locationView(row);
}

/**
 * Changes a location. The system location takes only whether it is on and what it keeps.
 *
 * @param db - The database.
 * @param id - The location.
 * @param change - What changes.
 * @param options - The sealing key and the data directory.
 * @param options.secretsKey - The sealing key.
 * @param options.dataDir - The data directory.
 * @returns The location.
 * @throws {NotFoundError} When there is no such location.
 * @throws {ValidationError} When the system location is given a name or a target.
 */
export async function updateBackupLocation(
  db: Database,
  id: string,
  change: BackupLocationUpdate,
  options: { readonly secretsKey: Buffer; readonly dataDir: string },
): Promise<BackupLocationView> {
  const [stored] = await db.select().from(backupLocations).where(eq(backupLocations.id, id));

  if (stored === undefined) {
    throw new NotFoundError('No such backup location');
  }

  if (stored.kind === 'system' && (change.name !== undefined || change.target !== undefined)) {
    throw new ValidationError('The system location keeps its name and its folder');
  }

  const kept = change.target?.kind === stored.kind ? (stored.config as JsonObject) : null;
  const [row] = await db
    .update(backupLocations)
    .set({
      ...(change.name === undefined ? {} : { name: change.name }),
      ...(change.target === undefined
        ? {}
        : {
            kind: change.target.kind,
            config: storedConfig(change.target, options.dataDir, options.secretsKey, kept),
          }),
      ...(change.isEnabled === undefined ? {} : { isEnabled: change.isEnabled }),
      ...(change.retention === undefined
        ? {}
        : { retentionMode: change.retention.mode, retentionValue: change.retention.value }),
    })
    .where(eq(backupLocations.id, id))
    .returning();

  if (row === undefined) {
    throw new NotFoundError('No such backup location');
  }

  return locationView(row);
}

/**
 * Removes a location. The archives in it are left where they are.
 *
 * @param db - The database.
 * @param id - The location.
 * @returns The removed location's name.
 * @throws {NotFoundError} When there is no such location.
 * @throws {ConflictError} When it is the system location.
 */
export async function deleteBackupLocation(db: Database, id: string): Promise<string> {
  const [stored] = await db.select().from(backupLocations).where(eq(backupLocations.id, id));

  if (stored === undefined) {
    throw new NotFoundError('No such backup location');
  }

  if (stored.kind === 'system') {
    throw new ConflictError('The system location cannot be removed; it can be turned off', {
      details: { reason: 'system-location' },
    });
  }

  await db.delete(backupLocations).where(eq(backupLocations.id, id));

  return stored.name;
}

/**
 * A stored location's password, still sealed, for trying it again without typing it.
 *
 * @param db - The database.
 * @param id - The location.
 * @returns Whether it exists.
 */
export async function backupLocationExists(db: Database, id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: backupLocations.id })
    .from(backupLocations)
    .where(eq(backupLocations.id, id));

  return row !== undefined;
}

/**
 * The latest runs, newest first.
 *
 * @param db - The database.
 * @param limit - How many.
 * @returns The runs.
 */
export async function listBackupRuns(db: Database, limit: number): Promise<BackupRunView[]> {
  const rows = await db
    .select({ run: backupRuns, username: users.username })
    .from(backupRuns)
    .leftJoin(users, eq(users.id, backupRuns.requestedBy))
    .orderBy(desc(backupRuns.startedAt), desc(backupRuns.id))
    .limit(limit);

  return rows.map(({ run, username }) => ({
    id: run.id,
    kind: run.kind as BackupRunView['kind'],
    trigger: run.trigger as BackupRunView['trigger'],
    status: run.status as BackupRunView['status'],
    sections: run.sections as BackupRunView['sections'],
    archiveName: run.archiveName,
    archiveBytes: run.archiveBytes,
    destinations: run.destinations as BackupRunView['destinations'],
    error: run.error,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    requestedBy:
      run.requestedBy === null || username === null ? null : { id: run.requestedBy, username },
  }));
}

/**
 * When the backup key with this id was last downloaded, from the audit trail.
 *
 * @param db - The database.
 * @param keyId - The key's id.
 * @returns The moment, or null for never.
 */
export async function keyDownloadedAt(db: Database, keyId: string): Promise<Date | null> {
  const [row] = await db
    .select({ time: auditLog.time })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.action, 'backup.key_download'),
        eq(auditLog.result, 'success'),
        sql`${auditLog.details}->>'keyId' = ${keyId}`,
      ),
    )
    .orderBy(desc(auditLog.time))
    .limit(1);

  return row?.time ?? null;
}

/**
 * When the last successful restore finished: access tokens issued before it are not accepted.
 *
 * @param db - The database.
 * @returns The moment, or null when nothing was ever restored.
 */
export async function lastRestoreAt(db: Database): Promise<Date | null> {
  const [row] = await db
    .select({ finishedAt: backupRuns.finishedAt })
    .from(backupRuns)
    .where(and(eq(backupRuns.kind, 'restore'), eq(backupRuns.status, 'success')))
    .orderBy(desc(backupRuns.finishedAt))
    .limit(1);

  return row?.finishedAt ?? null;
}
