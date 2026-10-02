/**
 * Backups: their state, where they are written, the runs, the key, and restoring one.
 *
 * Seeing them needs `settings:read` and changing them `settings:write`, as for every other system
 * setting. Two things need more: downloading the backup key and restoring an archive need
 * `backup:restore` - the owner's alone by default - and the password typed again, and only on a
 * signed-in session, never with a personal access token. The key opens every archive: password
 * hashes, stored credentials, everything; and a restore replaces the users themselves.
 *
 * The work is the `backup` service's; these routes are its gateway (ARCHITECTURE.md 4).
 */
import { z } from 'zod';

import { resolveDataLayout } from '@nebulahome/config';
import {
  AuthenticationError,
  BACKUP_METHODS,
  ValidationError,
  backupArchiveListSchema,
  backupBrowseRequestSchema,
  backupBrowseResultSchema,
  backupKeyFileSchema,
  backupKeyRequestSchema,
  backupLocationCreateSchema,
  backupLocationListSchema,
  backupLocationTestResultSchema,
  backupLocationTestSchema,
  backupLocationUpdateSchema,
  backupLocationViewSchema,
  backupRestoreRequestSchema,
  backupRunListSchema,
  backupRunStartedSchema,
  backupStatusViewSchema,
  maintenanceStateSchema,
  type BackupKeyFile,
  type BackupStatusView,
  type Identity,
} from '@nebulahome/contracts';
import { openSecret, sealSecret } from '@nebulahome/db';

import { verifyPassword } from '../auth/password.js';
import { requirePermission } from '../auth/permissions.js';
import { findUserById } from '../auth/repository.js';
import type { ApiContext } from '../context.js';
import { definePublicRoute, defineRoute, type RouteEnvironment } from '../http/route.js';
import {
  askBackup,
  BACKUP_REPLIES,
  backupLocationExists,
  createBackupLocation,
  deleteBackupLocation,
  keyDownloadedAt,
  listBackupLocations,
  listBackupRuns,
  SLOW_TIMEOUT_MS,
  updateBackupLocation,
} from '../services/backup.js';

/** Which location a request is about. */
const locationParamsSchema = z.object({ locationId: z.uuid() });

/** Which run a request is about. */
const runParamsSchema = z.object({ runId: z.uuid() });

/** How many runs to list. */
const runsQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });

/**
 * Checks that whoever asks is who they say, again: their password, on a signed-in session.
 *
 * @param context - The service's collaborators.
 * @param identity - Who is asking.
 * @param password - What they typed.
 * @throws {AuthenticationError} With a personal access token, which is never enough for this.
 * @throws {ValidationError} When the password is not theirs.
 */
async function confirmPassword(
  context: ApiContext,
  identity: Identity,
  password: string,
): Promise<void> {
  if (identity.credential !== 'session') {
    throw new AuthenticationError('This needs a signed-in session, not an access token');
  }

  const user = await findUserById(context.db, identity.userId);

  if (user === undefined || !(await verifyPassword(user.passwordHash, password))) {
    throw new ValidationError('The password is not correct', {
      details: { issues: [{ path: 'password', message: 'The password is not correct' }] },
    });
  }
}

/**
 * Registers the backup routes.
 *
 * @param environment - Where routes are defined.
 * @param context - The service's collaborators.
 */
export function registerBackupRoutes(environment: RouteEnvironment, context: ApiContext): void {
  const dataDir = resolveDataLayout(context.config).root;

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/backup',
      summary: 'Read the state of backups: schedule, estimates, the run in progress, the key',
      tag: 'Backup',
      permission: 'settings:read',
      response: backupStatusViewSchema,
    },

    /**
     * Asks the backup service how things stand, and adds when its key was downloaded.
     *
     * @param route - Who is asking.
     * @returns The state.
     */
    async (route): Promise<BackupStatusView> => {
      requirePermission(route.identity, 'settings:read');

      const status = await askBackup(
        { bus: context.bus, traceId: route.request.traceId },
        BACKUP_METHODS.status,
        {},
        BACKUP_REPLIES.status,
      );

      return {
        ...status,
        key: { ...status.key, downloadedAt: await keyDownloadedAt(context.db, status.key.keyId) },
      };
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/backup/locations',
      summary: 'List where backups are written',
      tag: 'Backup',
      permission: 'settings:read',
      response: backupLocationListSchema,
    },

    /**
     * Lists the locations.
     *
     * @param route - Who is asking.
     * @returns The locations, the system one first, passwords never included.
     */
    async (route) => {
      requirePermission(route.identity, 'settings:read');

      return { items: await listBackupLocations(context.db) };
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/backup/locations',
      summary: 'Add a place backups are written to',
      tag: 'Backup',
      permission: 'settings:write',
      body: backupLocationCreateSchema,
      response: backupLocationViewSchema,
    },

    /**
     * Adds a location, its password sealed.
     *
     * @param route - The location and who adds it.
     * @returns The location.
     */
    async (route) => {
      requirePermission(route.identity, 'settings:write');

      const location = await createBackupLocation(context.db, route.body, {
        secretsKey: context.secretsKey,
        dataDir,
        userId: route.identity.userId,
      });

      await context.audit.record({
        action: 'backup_location.create',
        resourceType: 'backup_location',
        resourceId: location.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { name: location.name, kind: location.target.kind },
      });

      return location;
    },
  );

  defineRoute(
    environment,
    {
      method: 'PATCH',
      url: '/backup/locations/:locationId',
      summary: 'Change a place backups are written to',
      tag: 'Backup',
      permission: 'settings:write',
      params: locationParamsSchema,
      body: backupLocationUpdateSchema,
      response: backupLocationViewSchema,
    },

    /**
     * Changes a location; a password left out stays as it was.
     *
     * @param route - The change and who makes it.
     * @returns The location.
     */
    async (route) => {
      requirePermission(route.identity, 'settings:write');

      const location = await updateBackupLocation(context.db, route.params.locationId, route.body, {
        secretsKey: context.secretsKey,
        dataDir,
      });

      await context.audit.record({
        action: 'backup_location.update',
        resourceType: 'backup_location',
        resourceId: location.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { fields: Object.keys(route.body) },
      });

      return location;
    },
  );

  defineRoute(
    environment,
    {
      method: 'DELETE',
      url: '/backup/locations/:locationId',
      summary: 'Stop writing backups to a place; the archives there stay',
      tag: 'Backup',
      permission: 'settings:write',
      params: locationParamsSchema,
      successStatus: 204,
    },

    /**
     * Removes a location.
     *
     * @param route - Which, and who removes it.
     */
    async (route): Promise<void> => {
      requirePermission(route.identity, 'settings:write');

      const name = await deleteBackupLocation(context.db, route.params.locationId);

      await context.audit.record({
        action: 'backup_location.delete',
        resourceType: 'backup_location',
        resourceId: route.params.locationId,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { name },
      });
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/backup/locations/test',
      summary: 'Try a place backups would be written to: connect, write, remove',
      tag: 'Backup',
      permission: 'settings:write',
      body: backupLocationTestSchema,
      response: backupLocationTestResultSchema,
      successStatus: 200,
    },

    /**
     * Asks the backup service to try a location.
     *
     * @param route - The location as typed, and who asks.
     * @returns What was found.
     */
    async (route) => {
      requirePermission(route.identity, 'settings:write');

      if (
        route.body.locationId !== undefined &&
        !(await backupLocationExists(context.db, route.body.locationId))
      ) {
        throw new ValidationError('No such backup location');
      }

      return askBackup(
        { bus: context.bus, traceId: route.request.traceId },
        BACKUP_METHODS.testLocation,
        route.body,
        BACKUP_REPLIES.test,
        SLOW_TIMEOUT_MS,
      );
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/backup/browse',
      summary: 'List the folders of a folder on the machine, to pick where backups go',
      tag: 'Backup',
      permission: 'settings:write',
      body: backupBrowseRequestSchema,
      response: backupBrowseResultSchema,
      successStatus: 200,
    },

    /**
     * Asks the backup service - which writes there - for a folder's folders.
     *
     * @param route - The folder, and who asks.
     * @returns Its folders.
     */
    async (route) => {
      requirePermission(route.identity, 'settings:write');

      return askBackup(
        { bus: context.bus, traceId: route.request.traceId },
        BACKUP_METHODS.browse,
        route.body,
        BACKUP_REPLIES.browse,
      );
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/backup/archives',
      summary: 'List the archives in every enabled location',
      tag: 'Backup',
      permission: 'settings:read',
      response: backupArchiveListSchema,
    },

    /**
     * Asks the backup service for every location's archives.
     *
     * @param route - Who is asking.
     * @returns The archives, newest first, and the locations that could not be read.
     */
    async (route) => {
      requirePermission(route.identity, 'settings:read');

      return askBackup(
        { bus: context.bus, traceId: route.request.traceId },
        BACKUP_METHODS.archives,
        {},
        BACKUP_REPLIES.archives,
        SLOW_TIMEOUT_MS,
      );
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/backup/runs',
      summary: 'List the latest backups and restores',
      tag: 'Backup',
      permission: 'settings:read',
      query: runsQuerySchema,
      response: backupRunListSchema,
    },

    /**
     * Lists the latest runs.
     *
     * @param route - How many, and who asks.
     * @returns The runs, newest first.
     */
    async (route) => {
      requirePermission(route.identity, 'settings:read');

      return { items: await listBackupRuns(context.db, route.query.limit) };
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/backup/runs',
      summary: 'Take a backup now',
      tag: 'Backup',
      permission: 'settings:write',
      response: backupRunStartedSchema,
      successStatus: 202,
    },

    /**
     * Starts a backup; it goes on after the answer.
     *
     * @param route - Who asks.
     * @returns The run's id.
     */
    async (route) => {
      requirePermission(route.identity, 'settings:write');

      const started = await askBackup(
        { bus: context.bus, traceId: route.request.traceId },
        BACKUP_METHODS.run,
        { requestedBy: { id: route.identity.userId, username: route.identity.username } },
        BACKUP_REPLIES.started,
      );

      await context.audit.record({
        action: 'backup.run',
        resourceType: 'backup_run',
        resourceId: started.runId,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
      });

      return started;
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/backup/runs/:runId/cancel',
      summary: 'Stop the backup in progress',
      tag: 'Backup',
      permission: 'settings:write',
      params: runParamsSchema,
      successStatus: 204,
    },

    /**
     * Cancels the run in progress.
     *
     * @param route - Which, and who asks.
     */
    async (route): Promise<void> => {
      requirePermission(route.identity, 'settings:write');

      await askBackup(
        { bus: context.bus, traceId: route.request.traceId },
        BACKUP_METHODS.cancel,
        { runId: route.params.runId },
        BACKUP_REPLIES.acknowledgement,
      );
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/backup/key',
      summary: 'Download the backup key, with the password typed again',
      tag: 'Backup',
      permission: 'backup:restore',
      body: backupKeyRequestSchema,
      response: backupKeyFileSchema,
      successStatus: 200,
    },

    /**
     * Hands over the key file, once the password is confirmed.
     *
     * @param route - The password, and who asks.
     * @returns The key file.
     */
    async (route): Promise<BackupKeyFile> => {
      requirePermission(route.identity, 'backup:restore');

      try {
        await confirmPassword(context, route.identity, route.body.password);
      } catch (error: unknown) {
        await context.audit.record({
          action: 'backup.key_download',
          resourceType: 'backup_key',
          result: 'failure',
          identity: route.identity,
          ipAddress: route.request.ip,
          traceId: route.request.traceId,
        });

        throw error;
      }

      const reply = await askBackup(
        { bus: context.bus, traceId: route.request.traceId },
        BACKUP_METHODS.key,
        {},
        BACKUP_REPLIES.key,
      );
      const file = backupKeyFileSchema.parse(
        JSON.parse(openSecret({ $sealed: reply.sealed }, context.secretsKey)),
      );

      await context.audit.record({
        action: 'backup.key_download',
        resourceType: 'backup_key',
        resourceId: file.keyId,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { keyId: file.keyId },
      });

      void route.reply
        .header('cache-control', 'no-store')
        .header(
          'content-disposition',
          `attachment; filename="nebulahome-backup-key-${file.keyId.slice(0, 8)}.json"`,
        );

      return file;
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/backup/restores',
      summary: 'Restore the installation from an archive, with the password typed again',
      tag: 'Backup',
      permission: 'backup:restore',
      body: backupRestoreRequestSchema,
      response: backupRunStartedSchema,
      successStatus: 202,
    },

    /**
     * Starts a restore; it goes on after the answer, and the installation answers 503 while it
     * swaps the data.
     *
     * @param route - The archive, the password, the key file if needed, and who asks.
     * @returns The run's id.
     */
    async (route) => {
      requirePermission(route.identity, 'backup:restore');
      await confirmPassword(context, route.identity, route.body.password);

      let sealedKeyFile: string | undefined;

      if (route.body.keyFile !== undefined) {
        let parsed: unknown;

        try {
          parsed = JSON.parse(route.body.keyFile);
        } catch {
          parsed = null;
        }

        const file = backupKeyFileSchema.safeParse(parsed);

        if (!file.success) {
          throw new ValidationError('That is not a NebulaHome backup key file', {
            details: { issues: [{ path: 'keyFile', message: 'Not a backup key file' }] },
          });
        }

        // Sealed before it crosses the bus, as the key leaves it.
        sealedKeyFile = sealSecret(JSON.stringify(file.data), context.secretsKey).$sealed;
      }

      const started = await askBackup(
        { bus: context.bus, traceId: route.request.traceId },
        BACKUP_METHODS.restore,
        {
          locationId: route.body.locationId,
          archiveName: route.body.archiveName,
          ...(sealedKeyFile === undefined ? {} : { sealedKeyFile }),
          takeSafetyBackup: route.body.takeSafetyBackup,
          requestedBy: { id: route.identity.userId, username: route.identity.username },
        },
        BACKUP_REPLIES.started,
      );

      await context.audit.record({
        action: 'backup.restore',
        resourceType: 'backup_run',
        resourceId: started.runId,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { archive: route.body.archiveName, safetyBackup: route.body.takeSafetyBackup },
      });

      return started;
    },
  );

  definePublicRoute(
    environment,
    {
      method: 'GET',
      url: '/system/maintenance',
      summary: 'Whether the installation is being restored, for the screen that waits on it',
      tag: 'System',
      response: maintenanceStateSchema,
    },

    /**
     * Says the maintenance state. Public: during a restore nobody is signed in to anything.
     *
     * @returns The state.
     */
    async () => Promise.resolve(context.maintenance.state),
  );
}
