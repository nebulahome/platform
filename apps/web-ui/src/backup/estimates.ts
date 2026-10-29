/**
 * What a location's retention comes to, before anything has been kept: how many archives, how
 * many days back, and how much room.
 *
 * Worked out from the schedule - how many backups a week - and the size an archive is expected to
 * be: the last one's, or the parts' estimates added up before there is one. An estimate, and said
 * to be one on the page.
 */
import type {
  BackupFrequency,
  BackupRetention,
  BackupSections,
  BackupStatusView,
} from '@nebulahome/contracts';

import { translate } from '@/i18n/messages';
import { formatBytes } from '@/lib/format-bytes';

/**
 * How many backups a week a frequency takes.
 *
 * @param frequency - The frequency.
 * @returns The count.
 */
export function runsPerWeek(frequency: BackupFrequency): number {
  switch (frequency.mode) {
    case 'daily':
      return 7;
    case 'weekly':
      return 1;
    case 'custom':
      return Math.max(1, frequency.days.length);
  }
}

/**
 * How many archives a location ends up keeping.
 *
 * @param retention - What it keeps.
 * @param frequency - How often backups run.
 * @returns The count, at least one.
 */
export function archivesKept(retention: BackupRetention, frequency: BackupFrequency): number {
  if (retention.mode === 'count') {
    return retention.value;
  }

  return Math.max(1, Math.ceil((retention.value * runsPerWeek(frequency)) / 7));
}

/**
 * How many days back a location's archives reach.
 *
 * @param retention - What it keeps.
 * @param frequency - How often backups run.
 * @returns The days.
 */
export function daysCovered(retention: BackupRetention, frequency: BackupFrequency): number {
  if (retention.mode === 'days') {
    return retention.value;
  }

  return Math.round((retention.value * 7) / runsPerWeek(frequency));
}

/**
 * How large an archive is expected to be.
 *
 * @param status - The backups' state.
 * @param sections - Which optional parts are taken.
 * @returns The bytes, or null when nothing is known yet.
 */
export function expectedArchiveBytes(
  status: BackupStatusView | undefined,
  sections: BackupSections,
): number | null {
  const estimates = status?.estimates;

  if (estimates == null) {
    return status?.lastBackup?.archiveBytes ?? null;
  }

  return (
    estimates.configuration +
    (sections.history ? estimates.history : 0) +
    (sections.packages ? estimates.packages : 0) +
    (sections.containers ? estimates.containers : 0)
  );
}

/**
 * Says what a retention comes to, in one line.
 *
 * @param retention - What the location keeps.
 * @param frequency - How often backups run.
 * @param archiveBytes - How large an archive is expected to be.
 * @returns "7 backups, about a week back, ≈ 2.1 GB".
 */
export function retentionSummary(
  retention: BackupRetention,
  frequency: BackupFrequency,
  archiveBytes: number | null,
): string {
  const kept = archivesKept(retention, frequency);
  const days = daysCovered(retention, frequency);
  const reach =
    days <= 1
      ? translate('backup.reach.day', 'a day back')
      : days === 7
        ? translate('backup.reach.week', 'a week back')
        : translate('backup.reach.days', '{{count}} days back', { count: days });
  const backups = translate('backup.kept', {
    count: kept,
    defaultValue_one: '≈ {{count}} backup',
    defaultValue_other: '≈ {{count}} backups',
  });

  return archiveBytes === null
    ? translate('backup.retention', '{{backups}}, {{reach}}', { backups, reach })
    : translate('backup.retentionSized', '{{backups}}, {{reach}}, ≈ {{size}}', {
        backups,
        reach,
        size: formatBytes(archiveBytes * kept),
      });
}
