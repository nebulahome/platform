/**
 * The backup endpoints, as the Backup page calls them.
 */
import { z } from 'zod';

import {
  backupArchiveListSchema,
  backupBrowseResultSchema,
  backupKeyFileSchema,
  backupLocationListSchema,
  backupLocationTestResultSchema,
  backupLocationViewSchema,
  backupRunListSchema,
  backupRunStartedSchema,
  backupStatusViewSchema,
  maintenanceStateSchema,
  type BackupArchive,
  type BackupBrowseResult,
  type BackupKeyFile,
  type BackupLocationCreate,
  type BackupLocationTest,
  type BackupLocationTestResult,
  type BackupLocationUpdate,
  type BackupLocationView,
  type BackupRunView,
  type BackupStatusView,
  type MaintenanceState,
} from '@nebulahome/contracts';

import { apiRequest } from '@/lib/api-client';

/** The keys the Backup page caches under. */
export const BACKUP_QUERY_KEYS = {
  status: ['backup', 'status'] as const,
  locations: ['backup', 'locations'] as const,
  runs: ['backup', 'runs'] as const,
  archives: ['backup', 'archives'] as const,
} as const;

/**
 * Reads the backups' state.
 *
 * @param signal - Cancels the request.
 * @returns The schedule, the estimates, the run in progress and the key.
 */
export async function fetchBackupStatus(signal?: AbortSignal): Promise<BackupStatusView> {
  return apiRequest('/backup', backupStatusViewSchema, signal === undefined ? {} : { signal });
}

/**
 * Lists where backups are written.
 *
 * @param signal - Cancels the request.
 * @returns The locations, the system one first.
 */
export async function fetchBackupLocations(signal?: AbortSignal): Promise<BackupLocationView[]> {
  return (
    await apiRequest(
      '/backup/locations',
      backupLocationListSchema,
      signal === undefined ? {} : { signal },
    )
  ).items;
}

/**
 * Adds a location.
 *
 * @param location - The location.
 * @returns It, as stored.
 */
export async function createBackupLocation(
  location: BackupLocationCreate,
): Promise<BackupLocationView> {
  return apiRequest('/backup/locations', backupLocationViewSchema, {
    method: 'POST',
    body: location,
  });
}

/**
 * Changes a location.
 *
 * @param id - Which.
 * @param change - What changes; a password left out stays.
 * @returns It, as stored.
 */
export async function updateBackupLocation(
  id: string,
  change: BackupLocationUpdate,
): Promise<BackupLocationView> {
  return apiRequest(`/backup/locations/${id}`, backupLocationViewSchema, {
    method: 'PATCH',
    body: change,
  });
}

/**
 * Removes a location; its archives stay where they are.
 *
 * @param id - Which.
 */
export async function deleteBackupLocation(id: string): Promise<void> {
  await apiRequest(`/backup/locations/${id}`, z.undefined(), { method: 'DELETE' });
}

/**
 * Tries a location.
 *
 * @param test - The target as typed, and the saved location it belongs to.
 * @returns What was found.
 */
export async function testBackupLocation(
  test: BackupLocationTest,
): Promise<BackupLocationTestResult> {
  return apiRequest('/backup/locations/test', backupLocationTestResultSchema, {
    method: 'POST',
    body: test,
  });
}

/**
 * Lists a folder's folders on the machine.
 *
 * @param path - The folder; the top when absent.
 * @returns Its folders.
 */
export async function browseFolders(path?: string): Promise<BackupBrowseResult> {
  return apiRequest('/backup/browse', backupBrowseResultSchema, {
    method: 'POST',
    body: path === undefined ? {} : { path },
  });
}

/**
 * Lists the archives in every enabled location.
 *
 * @param signal - Cancels the request.
 * @returns The archives, and the locations that could not be read.
 */
export async function fetchBackupArchives(signal?: AbortSignal): Promise<{
  items: BackupArchive[];
  problems: { locationId: string; name: string; message: string }[];
}> {
  return apiRequest(
    '/backup/archives',
    backupArchiveListSchema,
    signal === undefined ? {} : { signal },
  );
}

/**
 * Lists the latest runs.
 *
 * @param signal - Cancels the request.
 * @returns The runs, newest first.
 */
export async function fetchBackupRuns(signal?: AbortSignal): Promise<BackupRunView[]> {
  return (
    await apiRequest(
      '/backup/runs?limit=10',
      backupRunListSchema,
      signal === undefined ? {} : { signal },
    )
  ).items;
}

/**
 * Takes a backup now.
 *
 * @returns The run's id.
 */
export async function startBackup(): Promise<string> {
  return (await apiRequest('/backup/runs', backupRunStartedSchema, { method: 'POST' })).runId;
}

/**
 * Stops the backup in progress.
 *
 * @param runId - Which.
 */
export async function cancelBackup(runId: string): Promise<void> {
  await apiRequest(`/backup/runs/${runId}/cancel`, z.undefined(), { method: 'POST' });
}

/**
 * Downloads the backup key.
 *
 * @param password - The password, again.
 * @returns The key file.
 */
export async function downloadBackupKey(password: string): Promise<BackupKeyFile> {
  return apiRequest('/backup/key', backupKeyFileSchema, { method: 'POST', body: { password } });
}

/**
 * Starts restoring an archive.
 *
 * @param request - Which archive, the password, the key file when it needs another key, and
 * whether to back up first.
 * @param request.locationId - The location it is in.
 * @param request.archiveName - Its name.
 * @param request.password - The password, again.
 * @param request.keyFile - The key file's text.
 * @param request.takeSafetyBackup - Whether to back up what is here now, first.
 * @returns The run's id.
 */
export async function startRestore(request: {
  readonly locationId: string;
  readonly archiveName: string;
  readonly password: string;
  readonly keyFile?: string;
  readonly takeSafetyBackup: boolean;
}): Promise<string> {
  return (
    await apiRequest('/backup/restores', backupRunStartedSchema, { method: 'POST', body: request })
  ).runId;
}

/**
 * Reads the maintenance state, without a credential: during a restore nobody is signed in.
 *
 * @param signal - Cancels the request.
 * @returns The state.
 */
export async function fetchMaintenance(signal?: AbortSignal): Promise<MaintenanceState> {
  return apiRequest('/system/maintenance', maintenanceStateSchema, {
    isAuthenticated: false,
    ...(signal === undefined ? {} : { signal }),
  });
}
