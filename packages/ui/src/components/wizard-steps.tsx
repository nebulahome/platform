/**
 * The compact numbered steps in a dialog's header: "1 Image — 2 Settings".
 *
 * Done steps show a check in a filled `primary` circle; the current one is `primary` with its name
 * at weight 500; those ahead are `foreground-subtle` outlines. A 28px rule joins each to the next.
 * Two to four steps: more than that belongs on a page, not in a dialog.
 */
import { cn } from '../lib/cn.js';

import { AppIcon } from './app-icon.js';

/** What the steps need. */
export type WizardStepsProps = {
  /** The steps' names, in order. */
  readonly steps: readonly string[];

  /** The current one, from 0. */
  readonly current: number;

  /** Anything extra for the outer element. */
  readonly className?: string;
};

/**
 * Renders the steps.
 *
 * @param props - See {@link WizardStepsProps}.
 * @returns The steps, as an ordered list.
 */
export function WizardSteps(props: WizardStepsProps) {
  const { steps, current, className } = props;

  return (
    <ol aria-label="Steps" className={cn('flex shrink-0 items-center gap-2.5', className)}>
      {steps.map((step, index) => {
        const isDone = index < current;
        const isCurrent = index === current;

        return (
          <li
            key={step}
            aria-current={isCurrent ? 'step' : undefined}
            className="flex items-center gap-2.5"
          >
            {index === 0 ? null : <span aria-hidden="true" className="h-px w-7 bg-border-strong" />}
            <span
              aria-hidden="true"
              className={cn(
                'flex size-6 items-center justify-center rounded-full border font-mono text-mono-caption',
                isDone || isCurrent
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border-strong text-foreground-subtle',
              )}
            >
              {isDone ? <AppIcon id="check" size={12} strokeWidth={2.5} /> : index + 1}
            </span>
            <span
              className={cn(
                'text-ui-sm',
                isCurrent ? 'font-medium text-foreground' : 'text-foreground-subtle',
              )}
            >
              {step}
              {isDone ? <span className="sr-only">, done</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
