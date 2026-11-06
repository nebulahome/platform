/**
 * Whether a round of updates may skip its backup (docs/releases-and-updates.md 4): the last one
 * made its archive, finished less than five minutes ago and took every part a backup takes now.
 */
import type { BackupSection } from '@nebulahome/contracts';

/** How recent a backup is recent enough. */
export const RECENT_BACKUP_MS = 5 * 60_000;

/** The last backup, as the backup service reports it. */
export type LastBackup = {
  readonly status: string;
  readonly finishedAt: Date | null;
  readonly sections: readonly BackupSection[];
};

/**
 * Says whether a backup that ended so made its archive: every location took it, or some did
 * (`partial`) - a location that is down does not hold back the updates.
 *
 * @param status - How it ended.
 * @returns True when there is an archive to go back to.
 */
export function isBackupSucceeded(status: string): boolean {
  return status === 'success' || status === 'partial';
}

/**
 * Says whether the last backup is enough to update without another.
 *
 * @param last - The last backup, or null for none.
 * @param wanted - The parts a backup takes now.
 * @param now - The time.
 * @returns True when the round may skip its backup.
 */
export function isRecentBackupEnough(
  last: LastBackup | null,
  wanted: readonly BackupSection[],
  now: Date,
): boolean {
  if (last === null || !isBackupSucceeded(last.status) || last.finishedAt === null) {
    return false;
  }

  const age = now.getTime() - last.finishedAt.getTime();

  return (
    age >= 0 && age < RECENT_BACKUP_MS && wanted.every((section) => last.sections.includes(section))
  );
}
