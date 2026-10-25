/**
 * The Last runs card beside the editor: how the latest runs went, and each one's trace.
 *
 * The answer to "why did it not fire" and "what did it do" is one click away: a run opens into its
 * steps - the trigger that woke it, each check with what it saw, each action with what it did or
 * why it failed - named the way the blocks are. Kept fresh by the live channel, which says when a
 * run starts and ends.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { AutomationRun, TraceStep } from '@nebulahome/contracts';
import { AppIcon, cn, Panel, StatusDot } from '@nebulahome/ui';

import { translate } from '@/i18n/messages';
import { formatDuration } from '@/lib/duration';
import { absoluteTime, runMoment } from '@/lib/format-time';
import { runOutcome } from '@/lib/run-outcome';
import { fetchAutomationRuns, LIBRARY_QUERY_KEYS } from '@/library/api';
import { useEditorHouse } from '@/routes/library/automation/editor-house';
import { labelForKind } from '@/routes/library/editor-choices';

/** How many runs the card shows. */
const SHOWN = 5;

/** What the card needs. */
export type LastRunsProps = {
  readonly automationId: string;
};

/**
 * Renders the Last runs card.
 *
 * @param props - See {@link LastRunsProps}.
 * @returns The card.
 */
export function LastRuns(props: LastRunsProps) {
  const { t } = useTranslation();

  const { automationId } = props;
  const runs = useQuery({
    queryKey: [...LIBRARY_QUERY_KEYS.automationRuns, automationId],
    /**
     * Reads the latest runs.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request.
     * @returns The runs.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) =>
      fetchAutomationRuns(automationId, SHOWN, signal),
  });

  return (
    <Panel title={t('automation.lastRuns.lastRuns', 'Last runs')}>
      <div className="flex flex-col border-t border-border">
        {runs.isPending ? (
          <p className="px-5.5 py-4 text-ui-sm text-foreground-subtle">
            {t('automation.lastRuns.reading', 'Reading…')}
          </p>
        ) : runs.data === undefined || runs.data.items.length === 0 ? (
          <p className="px-5.5 py-4 text-ui-sm text-foreground-subtle">
            {t(
              'automation.lastRuns.notRunYetIt',
              'Not run yet. It runs when one of its triggers fires, or from Run now.',
            )}
          </p>
        ) : (
          <ul className="flex flex-col">
            {runs.data.items.map((run) => (
              <RunRow key={run.id} run={run} />
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

/**
 * One run, which opens into its trace.
 *
 * @param props - The run.
 * @param props.run - The run.
 * @returns The row.
 */
function RunRow(props: { readonly run: AutomationRun }) {
  const { run } = props;
  const [isOpen, setOpen] = useState(false);
  const outcome = runOutcome(run.result);

  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        aria-expanded={isOpen}
        title={absoluteTime(run.time)}
        onClick={() => {
          setOpen((open) => !open);
        }}
        className="flex w-full items-center gap-2.5 px-5.5 py-3 text-left transition-colors hover:bg-surface-raised focus-visible:bg-surface-raised focus-visible:outline-none"
      >
        <StatusDot isBare tone={outcome.tone} title={outcome.word} />
        <span className="flex min-w-0 grow flex-col">
          <span
            className={cn(
              'text-ui-sm',
              outcome.tone === 'danger' ? 'text-danger' : 'text-foreground',
            )}
          >
            {outcome.word} {runMoment(run.time)}
          </span>
          <span className="truncate text-caption text-foreground-subtle">
            {run.error ?? triggerLine(run)}
          </span>
        </span>
        <span className="shrink-0 font-mono text-mono-caption text-foreground-subtle">
          {run.durationMs === null ? '' : formatDuration(run.durationMs)}
        </span>
        <AppIcon
          id={isOpen ? 'chevron-down' : 'chevron-right'}
          size={13}
          className="shrink-0 text-foreground-subtle"
        />
      </button>
      {isOpen ? <Trace steps={run.trace} /> : null}
    </li>
  );
}

/**
 * What woke a run, in a line.
 *
 * @param run - The run.
 * @returns The line.
 */
function triggerLine(run: AutomationRun): string {
  switch (run.trigger.kind) {
    case 'manual': {
      return translate('automation.lastRuns.runByHand', 'Run by hand');
    }
    case 'automation': {
      return translate(
        'automation.lastRuns.startedByAnotherAutomation',
        'Started by another automation',
      );
    }
    case 'time': {
      return translate('automation.lastRuns.itsTimeCame', 'Its time came');
    }
    case 'quiet': {
      return translate('automation.lastRuns.quietTimeCame', 'The quietest time came');
    }
    case 'webhook': {
      return translate('automation.lastRuns.itsWebhookWasCalled', 'Its webhook was called');
    }
    default: {
      return translate('automation.lastRuns.entityChanged', 'An entity changed');
    }
  }
}

/** The colour of a step's mark. */
const STEP_TONE: Readonly<Record<TraceStep['result'], string>> = {
  ok: 'text-success',
  true: 'text-success',
  false: 'text-warning',
  failed: 'text-danger',
  timeout: 'text-warning',
  cancelled: 'text-foreground-subtle',
  skipped: 'text-foreground-subtle',
  partial: 'text-warning',
};

/**
 * A run's steps, as a timeline.
 *
 * @param props - The steps.
 * @param props.steps - The trace.
 * @returns The timeline.
 */
function Trace(props: { readonly steps: readonly TraceStep[] }) {
  const { t } = useTranslation();

  const { steps } = props;
  const house = useEditorHouse();

  if (steps.length === 0) {
    return (
      <p className="px-5.5 pb-3 text-caption text-foreground-subtle">
        {t('automation.lastRuns.noStepsRecorded', 'No steps recorded.')}
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-1.5 px-5.5 pb-3.5">
      {steps.map((step, index) => {
        const name = step.entityId === undefined ? undefined : house.names.entity(step.entityId);

        return (
          <li
            key={`${step.path}-${String(index)}`}
            className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2"
          >
            <span
              aria-hidden="true"
              className={cn('mt-1.5 size-1.5 rounded-full bg-current', STEP_TONE[step.result])}
            />
            <span className="flex min-w-0 flex-col">
              <span className="text-caption text-foreground">
                <span className="font-mono text-mono-caption text-foreground-subtle uppercase">
                  {step.kind === 'trigger'
                    ? t('automation.lastRuns.when', 'When')
                    : step.kind === 'condition'
                      ? t('automation.lastRuns.if', 'If')
                      : t('automation.lastRuns.then', 'Then')}
                </span>{' '}
                {labelForKind(
                  step.kind === 'trigger'
                    ? 'trigger'
                    : step.kind === 'condition'
                      ? 'condition'
                      : 'action',
                  step.type,
                )}
                {name === undefined ? '' : ` · ${name}`}
                <span className="text-foreground-subtle"> · {step.result}</span>
              </span>
              {step.detail === undefined && step.error === undefined ? null : (
                <span
                  className={cn(
                    'text-caption break-words',
                    step.error === undefined ? 'text-foreground-subtle' : 'text-danger',
                  )}
                >
                  {step.error ?? step.detail}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
