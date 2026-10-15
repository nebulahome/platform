/**
 * The backup in progress, at the top of the backups page: what it is doing, on one bar - four
 * steps along it, preparing, the database, the files, the copy to the locations - the stretch of
 * the step at hand pulsing, so the page says that something is happening and how far along it is,
 * a scheduled backup as much as one started by hand. Under the bar, which step it is and what it
 * holds.
 *
 * When it ends the card says so - the bar full, "Completed" - and a moment later fades into the
 * list of runs below, where it stays. One that did not succeed stays until it is closed, with
 * why, its bar red from where it stopped.
 */
import { useTranslation } from 'react-i18next';

import { AppIcon, Button, cn } from '@nebulahome/ui';

import { BACKUP_STEPS, progressOf, type BackupStep } from '@/backup/progress';
import type { ShownRun } from '@/backup/use-backup-progress';
import { translate } from '@/i18n/messages';
import { formatBytes } from '@/lib/format-bytes';
import { relativeTime } from '@/lib/format-time';
import { phaseName } from '@/routes/settings/backup-text';

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
      return {
        title: translate('backup.steps.prepare', 'Preparing'),
        note: translate('backup.steps.prepareNote', 'Room and locations'),
      };
    }

    case 'database': {
      return {
        title: translate('backup.steps.database', 'Database'),
        note: props.hasHistory
          ? translate('backup.steps.withHistory', 'Configuration and history')
          : translate('backup.sections.configuration', 'Configuration'),
      };
    }

    case 'files': {
      return {
        title: translate('backup.steps.files', 'Files'),
        note: props.hasPackages
          ? translate('backup.steps.withPackages', 'Configuration and packages')
          : translate('backup.sections.configuration', 'Configuration'),
      };
    }

    case 'copy': {
      return {
        title: translate('backup.steps.copy', 'Copy'),
        note: translate('backup.steps.copyNote', {
          count: props.locationCount,
          defaultValue_one: 'To {{count}} location',
          defaultValue_other: 'To {{count}} locations',
        }),
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
  const { t } = useTranslation();
  const { run, onDismiss } = props;
  const ending = run.ending;
  const progress = progressOf(run.phase, ending?.status ?? null, {
    done: run.bytesDone,
    total: run.bytesTotal,
  });
  const words = wordsOf(progress.step, props);
  const isSucceeded = ending?.status === 'success';
  const isEnded = ending !== null;
  const isFailed = isEnded && !isSucceeded && ending.status !== 'partial';
  const title =
    ending === null
      ? t('backup.progress.running', 'Backing up')
      : isSucceeded
        ? t('backup.progress.completed', 'Completed')
        : ending.status === 'partial'
          ? t('backup.outcomes.partial', 'Partly done')
          : ending.status === 'cancelled'
            ? t('backup.progress.stopped', 'Stopped')
            : t('backup.progress.failed', 'The backup failed');
  const detail =
    ending === null
      ? `${phaseName(run.phase)}${
          run.phase === 'uploading' && run.bytesTotal !== null && run.bytesTotal > 0
            ? ` · ${t('system.usedOf', '{{used}} of {{total}}', {
                used: formatBytes(run.bytesDone),
                total: formatBytes(run.bytesTotal),
              })}`
            : ''
        } · ${t('backup.started', 'started {{when}}', { when: relativeTime(run.startedAt) })}`
      : isSucceeded
        ? t(
            'backup.progress.doneNote',
            'Every step is done: the archive is in its locations, and in the runs below.',
          )
        : (ending.error ?? t('backup.progress.unfinished', 'It did not finish.'));

  return (
    <section
      role="status"
      aria-live="polite"
      aria-busy={!isEnded}
      className={cn(
        'flex flex-col gap-4 rounded-panel border border-border bg-surface p-5 transition-opacity duration-500',
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
          <h3 className="text-title font-medium text-foreground">{title}</h3>
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
            {t('common.close', 'Close')}
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <div
          role="progressbar"
          aria-label={t('backup.progress.label', 'How far the backup is')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.percent}
          className="relative h-2 overflow-hidden rounded-full bg-surface-raised"
        >
          <span
            aria-hidden="true"
            className={cn(
              'absolute inset-y-0 left-0 rounded-full transition-[width] duration-500',
              isSucceeded ? 'bg-success' : 'bg-primary',
            )}
            /* eslint-disable-next-line react/forbid-dom-props -- the width is the value itself. */
            style={{ width: `${String(progress.percent)}%` }}
          />
          {isEnded && !isFailed ? null : (
            <span
              aria-hidden="true"
              className={cn(
                'absolute inset-y-0 rounded-full transition-[left,width] duration-500',
                isFailed ? 'bg-danger' : 'animate-pulse bg-primary/40',
              )}
              /* eslint-disable-next-line react/forbid-dom-props -- where the step lies is the value. */
              style={{
                left: `${String(progress.percent)}%`,
                width: `${String(progress.stepEnd - progress.percent)}%`,
              }}
            />
          )}
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <p className="min-w-0 truncate text-caption text-foreground-subtle">
            <span className="font-medium text-foreground">
              {isSucceeded
                ? t('backup.progress.allSteps', 'All {{count}} steps', {
                    count: BACKUP_STEPS.length,
                  })
                : `${t('firstRun.stepOf', 'Step {{step}} of {{count}}', {
                    step: progress.index + 1,
                    count: BACKUP_STEPS.length,
                  })} · ${words.title}`}
            </span>
            {isSucceeded ? null : ` · ${words.note}`}
          </p>
          <span className="shrink-0 font-mono text-caption text-foreground-muted tabular-nums">
            {String(progress.percent)}%
          </span>
        </div>
      </div>
    </section>
  );
}
