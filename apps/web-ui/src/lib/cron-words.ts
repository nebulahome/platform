/**
 * A schedule written in cron, said in words, with when it next comes round.
 *
 * `0 *\/2 * * 1-5` is what the engine reads and "Every 2 hours, Monday through Friday" is what a
 * person checks it against. The words are cronstrue's; the next runs are croner's - the parser the
 * engine schedules with - in the house's own time zone, so what the editor promises is what
 * happens.
 */
import { Cron } from 'croner';
import cronstrue from 'cronstrue';

/**
 * A cron expression in words.
 *
 * @param expression - Five fields, or six with seconds first.
 * @returns The words, or null when it is not a schedule cronstrue can read.
 */
export function cronWords(expression: string): string | null {
  const trimmed = expression.trim();

  if (trimmed === '') {
    return null;
  }

  try {
    return cronstrue.toString(trimmed, {
      use24HourTimeFormat: true,
      verbose: false,
      throwExceptionOnParseError: true,
    });
  } catch {
    return null;
  }
}

/**
 * When a schedule next comes round.
 *
 * @param expression - The cron expression.
 * @param timeZone - The house's zone.
 * @param count - How many runs.
 * @param after - From when; now unless said.
 * @returns The next runs, or null when the schedule cannot be read.
 */
export function nextCronRuns(
  expression: string,
  timeZone: string,
  count: number,
  after: Date = new Date(),
): Date[] | null {
  try {
    return new Cron(expression.trim(), { timezone: timeZone, paused: true }).nextRuns(count, after);
  } catch {
    return null;
  }
}

/**
 * A moment on the house's clock, as a schedule's next run reads: "Thu 16:00".
 *
 * @param moment - The moment.
 * @param timeZone - The house's zone.
 * @returns The words.
 */
export function shortMoment(moment: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(moment);
}
