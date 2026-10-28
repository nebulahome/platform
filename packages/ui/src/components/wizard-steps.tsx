/**
 * The compact numbered steps of a dialog: "1 Image — 2 Settings".
 *
 * Done steps show a check in a filled `primary` circle; the current one is `primary` with its name
 * at weight 500; those ahead are `foreground-subtle` outlines. Two to four steps: more than that
 * belongs on a page, not in a dialog.
 *
 * `inline` sets each name beside its circle, a 28px rule joining one to the next, small enough for
 * a dialog's header. `stacked` is the brokers' wizards: the steps spread across the dialog's width
 * under its header, each circle above its name, centred, a rule between the circles, and a step
 * done ticked in `success`.
 */
import { useTranslation } from 'react-i18next';

import { cn } from '../lib/cn.js';

import { AppIcon } from './app-icon.js';

/** What the steps need. */
export type WizardStepsProps = {
  /** The steps' names, in order. */
  readonly steps: readonly string[];

  /** The current one, from 0. */
  readonly current: number;

  /** Names beside the circles, or under them across the width; inline when not said. */
  readonly layout?: 'inline' | 'stacked';

  /** Anything extra for the outer element. */
  readonly className?: string;
};

/**
 * One step's circle: a check once done, its number otherwise.
 *
 * @param props - Where the step stands.
 * @param props.index - The step, from 0.
 * @param props.isDone - Whether it is behind.
 * @param props.isLit - Whether it is done or the current one.
 * @param props.isStacked - Across the dialog: a step done is ticked in `success` there.
 * @returns The circle.
 */
function StepCircle(props: {
  readonly index: number;
  readonly isDone: boolean;
  readonly isLit: boolean;
  readonly isStacked?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-mono-caption',
        props.isStacked === true && props.isDone
          ? 'border-success/45 bg-success/14 text-success'
          : props.isLit
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border-strong bg-surface text-foreground-subtle',
      )}
    >
      {props.isDone ? <AppIcon id="check" size={12} strokeWidth={2.5} /> : props.index + 1}
    </span>
  );
}

/**
 * Renders the steps.
 *
 * @param props - See {@link WizardStepsProps}.
 * @returns The steps, as an ordered list.
 */
export function WizardSteps(props: WizardStepsProps) {
  const { t } = useTranslation();
  const { steps, current, layout = 'inline', className } = props;
  const isStacked = layout === 'stacked';

  return (
    <ol
      aria-label={t('ui.wizardSteps.label', 'Steps')}
      className={cn(
        'flex shrink-0',
        isStacked ? 'w-full items-start' : 'items-center gap-2.5',
        className,
      )}
    >
      {steps.map((step, index) => {
        const isDone = index < current;
        const isCurrent = index === current;
        const name = (
          <span
            className={cn(
              'text-ui-sm',
              isStacked && 'text-center',
              isCurrent ? 'font-medium text-foreground' : 'text-foreground-subtle',
            )}
          >
            {step}
            {isDone ? <span className="sr-only">{t('ui.wizardSteps.done', ', done')}</span> : null}
          </span>
        );

        if (isStacked) {
          // The first and last steps sit at the edges; a rule stretches between each two circles.
          return [
            index === 0 ? null : (
              <li
                key={`${step}-rule`}
                role="presentation"
                className={cn(
                  'mt-3 h-px min-w-4 flex-1',
                  index <= current ? 'bg-success/45' : 'bg-border-strong',
                )}
              />
            ),
            <li
              key={step}
              aria-current={isCurrent ? 'step' : undefined}
              className="-mx-3 flex shrink-0 flex-col items-center gap-2 px-0"
            >
              <StepCircle index={index} isDone={isDone} isLit={isDone || isCurrent} isStacked />
              {name}
            </li>,
          ];
        }

        return (
          <li
            key={step}
            aria-current={isCurrent ? 'step' : undefined}
            className="flex items-center gap-2.5"
          >
            {index === 0 ? null : <span aria-hidden="true" className="h-px w-7 bg-border-strong" />}
            <StepCircle index={index} isDone={isDone} isLit={isDone || isCurrent} />
            {name}
          </li>
        );
      })}
    </ol>
  );
}
