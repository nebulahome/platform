/**
 * What a backup is doing, as the steps the progress card draws.
 *
 * The backup service works in phases - it prepares, dumps the database, packs and encrypts the
 * files with it, writes the archive to every location, and prunes the old ones - and the card
 * shows them as four steps a person can follow: preparing, the database, the files, and the copy
 * to the locations. Pure, so which step lights when is tested without the page.
 */
import type { BackupPhase, BackupRunView } from '@nebula-home/contracts';

/** The steps the card shows, in order. */
export const BACKUP_STEPS = ['prepare', 'database', 'files', 'copy'] as const;

/** One step the card shows. */
export type BackupStep = (typeof BACKUP_STEPS)[number];

/** Where a step stands. */
export type StepState = 'done' | 'current' | 'waiting' | 'failed';

/** Which step each phase of a backup is. */
const STEP_OF: Partial<Readonly<Record<BackupPhase, BackupStep>>> = {
  preparing: 'prepare',
  dumping: 'database',
  packing: 'files',
  uploading: 'copy',
  pruning: 'copy',
};

/**
 * Where each step stands while a backup is in a phase, or once it ended.
 *
 * @param phase - The phase it is in; null once it ended.
 * @param ending - How it ended, once it did.
 * @returns One state per step, in {@link BACKUP_STEPS}' order.
 */
export function stepStates(
  phase: BackupPhase | null,
  ending: BackupRunView['status'] | null,
): StepState[] {
  if (ending === 'success' || ending === 'partial') {
    return BACKUP_STEPS.map(() => 'done');
  }

  const current = BACKUP_STEPS.indexOf(phase === null ? 'copy' : (STEP_OF[phase] ?? 'prepare'));
  const isFailed = ending !== null && ending !== 'running';

  return BACKUP_STEPS.map((step, index) =>
    index < current ? 'done' : index === current ? (isFailed ? 'failed' : 'current') : 'waiting',
  );
}

/** What the card says a run came to. */
export type RunEnding = {
  readonly status: BackupRunView['status'];

  /** Why it did not end well, when it did not. */
  readonly error: string | null;
};

/**
 * How a run the card was following ended, once the runs say so.
 *
 * @param runs - The latest runs.
 * @param runId - The run.
 * @returns How it ended, or null while the runs do not yet say it ended.
 */
export function endingOf(runs: readonly BackupRunView[], runId: string): RunEnding | null {
  const run = runs.find((each) => each.id === runId);

  if (run === undefined || run.status === 'running') {
    return null;
  }

  const failed = run.destinations.find((each) => each.error !== null);

  return {
    status: run.status,
    error: run.error ?? (failed === undefined ? null : `${failed.name}: ${failed.error ?? ''}`),
  };
}
