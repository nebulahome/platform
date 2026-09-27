/**
 * Following a backup from the moment it starts until a few seconds after it ended.
 *
 * The service's status names the run in progress while it runs, and nothing once it ended; how
 * it ended is in the runs. So the run is remembered while it is in progress, its ending read from
 * the runs once they have it, and the card shown until then - and for a few seconds more when it
 * succeeded, fading out, or until the owner closes it when it did not. While the card shows the
 * run, the list of runs leaves it out, so it moves from one to the other rather than being in
 * both.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import type { BackupPhase, BackupRunView, BackupStatusView } from '@nebula-home/contracts';

import { BACKUP_QUERY_KEYS } from '@/backup/api';
import { endingOf, type RunEnding } from '@/backup/progress';

/** How long a finished backup's card stays, in milliseconds. */
const SHOWN_AFTER_MS = 4000;

/** How long it takes to fade, in milliseconds: the last part of the time it stays. */
const FADE_MS = 500;

/** How often the runs are read while the ending is awaited, in milliseconds. */
const AWAIT_MS = 2000;

/** The run being followed. */
type Followed = {
  readonly runId: string;
  readonly phase: BackupPhase;
  readonly startedAt: Date;
  readonly bytesDone: number;
  readonly bytesTotal: number | null;
};

/** The run the card shows. */
export type ShownRun = Followed & {
  /** How it ended; null while it runs. */
  readonly ending: RunEnding | null;

  /** Whether it is fading out. */
  readonly isLeaving: boolean;
};

/**
 * Follows the backup in progress.
 *
 * @param active - The run in progress, as the status names it.
 * @param runs - The latest runs, once read.
 * @returns The run to show, if any, and a way to close it.
 */
export function useBackupProgress(
  active: BackupStatusView['active'] | undefined,
  runs: readonly BackupRunView[] | undefined,
): { readonly shown: ShownRun | null; readonly dismiss: () => void } {
  const queryClient = useQueryClient();
  const [followed, setFollowed] = useState<Followed | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);

  // Taken in as the status changes, while rendering: React's way of keeping what a prop was.
  if (
    active?.kind === 'backup' &&
    (followed?.runId !== active.runId ||
      followed.phase !== active.phase ||
      followed.bytesDone !== active.bytesDone)
  ) {
    setFollowed({
      runId: active.runId,
      phase: active.phase,
      startedAt: active.startedAt,
      bytesDone: active.bytesDone,
      bytesTotal: active.bytesTotal,
    });
  }

  const runId = followed?.runId ?? null;
  const ending = runId === null ? null : endingOf(runs ?? [], runId);
  const isRunning = runId !== null && active?.runId === runId;
  const isAwaited = runId !== null && ending === null && !isRunning && dismissed !== runId;
  const isSucceeded = ending?.status === 'success';

  // The status no longer names it, and the runs do not yet say how it ended: read them again.
  useEffect(() => {
    if (!isAwaited) {
      return undefined;
    }

    const timer = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: BACKUP_QUERY_KEYS.runs });
    }, AWAIT_MS);

    void queryClient.invalidateQueries({ queryKey: BACKUP_QUERY_KEYS.runs });

    return (): void => {
      clearInterval(timer);
    };
  }, [isAwaited, queryClient]);

  // A backup that succeeded says so for a moment, then fades into the list of runs.
  useEffect(() => {
    if (!isSucceeded || runId === null) {
      return undefined;
    }

    const fade = setTimeout(() => {
      setLeaving(runId);
    }, SHOWN_AFTER_MS - FADE_MS);
    const gone = setTimeout(() => {
      setDismissed(runId);
    }, SHOWN_AFTER_MS);

    return (): void => {
      clearTimeout(fade);
      clearTimeout(gone);
    };
  }, [isSucceeded, runId]);

  return {
    shown:
      followed === null || dismissed === followed.runId
        ? null
        : { ...followed, ending, isLeaving: leaving === followed.runId },

    /** Closes the card. */
    dismiss: (): void => {
      if (runId !== null) {
        setDismissed(runId);
      }
    },
  };
}
