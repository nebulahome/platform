/**
 * When backups run: the settings, as the cron pattern the scheduler runs on.
 *
 * The time comes from the schedule - fixed, or the quietest learned - and the days from the
 * frequency: every day, one day a week, or the days the owner picked. The pattern is read in the
 * schedule's own time zone, so three in the morning stays three in the morning across a change
 * of summer time.
 */
import type { BackupFrequency, DayOfWeek } from '@nebula-home/contracts';

/** Each day as cron numbers it: Sunday is 0. */
const CRON_DAY: Readonly<Record<DayOfWeek, number>> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/**
 * The days a frequency runs on.
 *
 * @param frequency - The frequency.
 * @returns The days, or null for every day.
 */
export function daysOf(frequency: BackupFrequency): readonly DayOfWeek[] | null {
  switch (frequency.mode) {
    case 'daily':
      return null;
    case 'weekly':
      return [frequency.day];
    case 'custom':
      return frequency.days;
  }
}

/**
 * The cron pattern for a time of day on the frequency's days.
 *
 * @param frequency - Which days.
 * @param time - `HH:MM`.
 * @returns A five-field pattern: minute, hour, any day of the month, any month, the days.
 */
export function cronPatternFor(frequency: BackupFrequency, time: string): string {
  const [hours = '0', minutes = '0'] = time.split(':');
  const days = daysOf(frequency);
  const dayField =
    days === null
      ? '*'
      : [...new Set(days.map((day) => CRON_DAY[day]))].sort((a, b) => a - b).join(',');

  return `${String(Number(minutes))} ${String(Number(hours))} * * ${dayField}`;
}

/**
 * Whether a backup that should have run while the service was down is still owed.
 *
 * @param previousOccurrence - The last time the schedule came round, or null for never.
 * @param lastStartedAt - When the last backup of any kind started, or null for never.
 * @returns True when nothing started since the schedule last came round.
 */
export function isBackupOwed(previousOccurrence: Date | null, lastStartedAt: Date | null): boolean {
  if (previousOccurrence === null) {
    return false;
  }

  return lastStartedAt === null || lastStartedAt.getTime() < previousOccurrence.getTime();
}
