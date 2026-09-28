/**
 * What a backup is doing, as the one bar the progress card draws.
 *
 * The backup service works in phases - it prepares, dumps the database, packs and encrypts the
 * files with it, writes the archive to every location, and prunes the old ones - and the card
 * shows them as four steps a person can follow along one bar: preparing, the database, the
 * files, and the copy to the locations, a quarter each. Only the copy says how far it is, in
 * bytes; the others are a stretch of the bar that pulses until the next one starts. Pure, so how
 * far the bar reaches when is tested without the page.
 */
import type { BackupPhase, BackupRunView } from '@nebula-home/contracts';

/** The steps the bar is made of, in order. */
export const BACKUP_STEPS = ['prepare', 'database', 'files', 'copy'] as const;

/** One step of the bar. */
export type BackupStep = (typeof BACKUP_STEPS)[number];

/** Which step each phase of a backup is. */
const STEP_OF: Partial<Readonly<Record<BackupPhase, BackupStep>>> = {
  preparing: 'prepare',
  dumping: 'database',
  packing: 'files',
  uploading: 'copy',
  pruning: 'copy',
};

/** How much of its step pruning stands for: the copies are written, the old ones go. */
const PRUNING_SHARE = 0.9;

/** How far a backup has got, along the bar. */
export type BackupProgress = {
  /** The step it is at, or stopped at. */
  readonly step: BackupStep;

  /** That step's place, from 0. */
  readonly index: number;

  /** How much of the bar is done, from 0 to 100. */
  readonly percent: number;

  /** Where the step at hand ends on the bar: the stretch that pulses while it works. */
  readonly stepEnd: number;
};

/**
 * How far a backup is while it is in a phase, or where it stood once it ended.
 *
 * @param phase - The phase it is in, or ended in.
 * @param ending - How it ended, once it did.
 * @param bytes - How much of the archive is written, and of how much, while it is copied.
 * @param bytes.done - Written so far.
 * @param bytes.total - The whole archive, when known.
 * @returns The step and how much of the bar is done.
 */
export function progressOf(
  phase: BackupPhase,
  ending: BackupRunView['status'] | null,
  bytes: { readonly done: number; readonly total: number | null },
): BackupProgress {
  const share = 100 / BACKUP_STEPS.length;

  if (ending === 'success' || ending === 'partial') {
    return { step: 'copy', index: BACKUP_STEPS.length - 1, percent: 100, stepEnd: 100 };
  }

  const step = STEP_OF[phase] ?? 'prepare';
  const index = BACKUP_STEPS.indexOf(step);
  const within =
    phase === 'pruning'
      ? PRUNING_SHARE
      : phase === 'uploading' && bytes.total !== null && bytes.total > 0
        ? Math.min(1, bytes.done / bytes.total)
        : 0;

  return {
    step,
    index,
    percent: Math.round((index + within) * share),
    stepEnd: Math.round((index + 1) * share),
  };
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
