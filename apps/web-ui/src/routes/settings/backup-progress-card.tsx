/**
 * The backup in progress, at the top of the backups page: what it is doing, as four steps -
 * preparing, the database, the files, the copy to the locations - the current one pulsing, so
 * the page says that something is happening and how far along it is, a scheduled backup as much
 * as one started by hand.
 *
 * When it ends the card says so - every step lit, "Completed" - and a moment later fades into the
 * list of runs below, where it stays. One that did not succeed stays until it is closed, with
 * why.
 */
import { AppIcon, Button, cn } from '@nebula-home/ui';

import { BACKUP_STEPS, stepStates, type BackupStep, type StepState } from '@/backup/progress';
import type { ShownRun } from '@/backup/use-backup-progress';
import { formatBytes } from '@/lib/format-bytes';
import { relativeTime } from '@/lib/format-time';
import { PHASE_NAMES } from '@/routes/settings/backup-text';

/** What the card needs. */
export type BackupProgressCardProps = {
  readonly run: ShownRun;

  /** Whether the backups take the history, and the packages: what the steps say they hold. */
  readonly hasHistory: boolean;
  readonly hasPackages: boolean;

  /** How many locations the archive is written to. */
  readonly locationCount: number;

  /** Closes the card. */
  readonly onDismiss: () => void;
};

/** The colour of a step's bar. */
const BAR_CLASSES: Readonly<Record<StepState, string>> = {
  done: 'bg-primary',
  current: 'bg-primary animate-pulse',
  waiting: 'bg-surface-raised',
  failed: 'bg-danger',
};

/**
 * What a step is called, and what it holds.
 *
 * @param step - The step.
 * @param props - What the backups take.
 * @returns The step's name and its line.
 */
function wordsOf(
  step: BackupStep,
  props: Pick<BackupProgressCardProps, 'hasHistory' | 'hasPackages' | 'locationCount'>,
): { readonly title: string; readonly note: string } {
  switch (step) {
    case 'prepare': {
      return { title: 'Preparing', note: 'Room and locations' };
    }

    case 'database': {
      return {
        title: 'Database',
        note: props.hasHistory ? 'Configuration and history' : 'Configuration',
      };
    }

    case 'files': {
      return {
        title: 'Files',
        note: props.hasPackages ? 'Configuration and packages' : 'Configuration',
      };
    }

    case 'copy': {
      return {
        title: 'Copy',
        note:
          props.locationCount === 1
            ? 'To 1 location'
            : `To ${String(props.locationCount)} locations`,
      };
    }
  }
}

/**
 * Renders the card.
 *
 * @param props - See {@link BackupProgressCardProps}.
 * @returns The card.
 */
export function BackupProgressCard(props: BackupProgressCardProps) {
  const { run, onDismiss } = props;
  const ending = run.ending;
  const states = stepStates(run.phase, ending?.status ?? null);
  const isSucceeded = ending?.status === 'success';
  const isEnded = ending !== null;
  const title =
    ending === null
      ? 'Backing up'
      : isSucceeded
        ? 'Completed'
        : ending.status === 'partial'
          ? 'Partly done'
          : ending.status === 'cancelled'
            ? 'Stopped'
            : 'The backup failed';
  const detail =
    ending === null
      ? `${PHASE_NAMES[run.phase]}${
          run.phase === 'uploading' && run.bytesTotal !== null && run.bytesTotal > 0
            ? ` · ${formatBytes(run.bytesDone)} of ${formatBytes(run.bytesTotal)}`
            : ''
        } · started ${relativeTime(run.startedAt)}`
      : isSucceeded
        ? 'Every step is done: the archive is in its locations, and in the runs below.'
        : (ending.error ?? 'It did not finish.');

  return (
    <section
      role="status"
      aria-live="polite"
      aria-busy={!isEnded}
      className={cn(
        'flex flex-col gap-4 rounded-panel border border-border face-card p-5 transition-opacity duration-500',
        run.isLeaving ? 'opacity-0' : 'opacity-100',
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-tile',
            isSucceeded
              ? 'bg-success/13 text-success'
              : isEnded
                ? 'bg-danger/13 text-danger'
                : 'bg-primary/13 text-primary',
          )}
        >
          <AppIcon
            id={isSucceeded ? 'check' : isEnded ? 'triangle-alert' : 'upload'}
            size={17}
            className={isEnded ? undefined : 'animate-pulse'}
          />
        </span>
        <div className="flex min-w-0 grow flex-col gap-0.5">
          <h3 className="text-title font-semibold text-foreground">{title}</h3>
          <p
            className={cn(
              'text-ui break-words',
              isEnded && !isSucceeded ? 'text-danger' : 'text-foreground-muted',
            )}
          >
            {detail}
          </p>
        </div>
        {isEnded && !isSucceeded ? (
          <Button variant="ghost" size="compact" onClick={onDismiss}>
            Close
          </Button>
        ) : null}
      </div>

      <ol className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-4">
        {BACKUP_STEPS.map((step, index) => {
          const state = states[index] ?? 'waiting';
          const words = wordsOf(step, props);

          return (
            <li key={step} className="flex min-w-0 flex-col gap-2">
              <span
                aria-hidden="true"
                className={cn(
                  'block h-1.5 rounded-full',
                  isSucceeded ? 'bg-success' : BAR_CLASSES[state],
                )}
              />
              <span className="flex min-w-0 flex-col">
                <span
                  className={cn(
                    'text-ui font-medium',
                    state === 'waiting' ? 'text-foreground-subtle' : 'text-foreground',
                  )}
                >
                  {words.title}
                  <span className="sr-only">
                    {state === 'done'
                      ? ', done'
                      : state === 'current'
                        ? ', in progress'
                        : state === 'failed'
                          ? ', failed'
                          : ', waiting'}
                  </span>
                </span>
                <span className="truncate text-caption text-foreground-subtle">{words.note}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
