/**
 * The first-run progress indicator: a constellation (design/components/SetupSteps).
 *
 * Each step is a star, lit as it is passed, and the line between two stars fills with `primary`
 * once the first is done. Done is a filled star with a check; the current one a white core in a
 * `primary` ring with a soft halo; one skipped a hollow star with a dash; one still to do a hollow
 * star, joined to the next by a dotted line. Names sit under the stars, an optional step saying
 * so beneath its name.
 *
 * Wide, the steps spread across the top of the card with their names; in a narrow window they
 * close up into a row of stars beside one mono line, `STEP 2 OF 7 · HOME`. Progress is never told
 * by colour alone - a check, a ring, a dash - and the whole is a `nav` saying where the person is.
 */
import { useTranslation } from 'react-i18next';

import { cn } from '../lib/cn.js';

import { AppIcon } from './app-icon.js';

/** One step. */
export type SetupStep = {
  /** Its name under the star: Account, Home. */
  readonly name: string;

  /** Whether it may be skipped, which it says under its name. */
  readonly isOptional?: boolean;
};

/** What the steps need. */
export type SetupStepsProps = {
  readonly steps: readonly SetupStep[];

  /** The current one, from 0. */
  readonly current: number;

  /** The ones passed without being done. */
  readonly skipped?: readonly number[];

  /** Anything extra for the outer element. */
  readonly className?: string;
};

/** Where a step stands. */
type StepState = 'done' | 'current' | 'skipped' | 'todo';

/**
 * Where one step stands.
 *
 * @param index - The step.
 * @param current - The current one.
 * @param skipped - Those passed without being done.
 * @returns Its state.
 */
function stateOf(index: number, current: number, skipped: readonly number[]): StepState {
  if (index === current) {
    return 'current';
  }

  if (index > current) {
    return 'todo';
  }

  return skipped.includes(index) ? 'skipped' : 'done';
}

/** What a star needs. */
type StarProps = {
  readonly state: StepState;

  /** Smaller, for the compact row. */
  readonly isSmall?: boolean;
};

/**
 * Renders one star.
 *
 * @param props - See {@link StarProps}.
 * @returns The star.
 */
function Star(props: StarProps) {
  const { state, isSmall = false } = props;

  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative flex shrink-0 items-center justify-center rounded-full',
        isSmall ? 'size-4' : 'size-4.5',
        state === 'done' && 'bg-primary text-primary-foreground',
        state === 'current' &&
          'bg-canvas shadow-[0_0_0_2px_var(--color-primary),0_0_0_7px_color-mix(in_srgb,var(--color-primary)_22%,transparent)]',
        state === 'skipped' && 'border-[1.5px] border-foreground-muted bg-canvas',
        state === 'todo' && 'border-[1.5px] border-foreground-subtle bg-canvas',
      )}
    >
      {state === 'done' ? <AppIcon id="check" size={isSmall ? 10 : 11} /> : null}
      {state === 'current' ? (
        <span className={cn('rounded-full bg-foreground', isSmall ? 'size-1.5' : 'size-2')} />
      ) : null}
      {state === 'skipped' ? (
        <span className="h-[1.5px] w-2 rounded-pill bg-foreground-muted" />
      ) : null}
    </span>
  );
}

/**
 * Renders the line between two stars: filled once the first is passed, dotted before.
 *
 * @param props - Whether it is passed.
 * @param props.isPassed - Whether the step before it is done or skipped.
 * @returns The line.
 */
function Link(props: { readonly isPassed: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'h-0 grow',
        props.isPassed
          ? 'border-t-2 border-primary'
          : 'border-t-2 border-dotted border-border-strong',
      )}
    />
  );
}

/**
 * Renders the steps.
 *
 * @param props - See {@link SetupStepsProps}.
 * @returns The constellation.
 */
export function SetupSteps(props: SetupStepsProps) {
  const { t } = useTranslation();
  const { steps, current, skipped = [], className } = props;
  const now = steps[current];
  const position = t('ui.setupSteps.position', 'Step {{step}} of {{count}}', {
    step: current + 1,
    count: steps.length,
  });
  const label = now === undefined ? position : `${position}: ${now.name}`;

  return (
    <nav aria-label={label} className={cn('w-full', className)}>
      {/* Wide: every star with its name, spread evenly. */}
      <ol className="hidden items-start sm:flex">
        {steps.map((step, index) => {
          const state = stateOf(index, current, skipped);

          return (
            <li
              key={step.name}
              aria-current={state === 'current' ? 'step' : undefined}
              className="relative flex flex-1 flex-col items-center gap-2"
            >
              <span className="flex w-full items-center">
                {index === 0 ? <span className="grow" /> : <Link isPassed={index <= current} />}
                <Star state={state} />
                {index === steps.length - 1 ? (
                  <span className="grow" />
                ) : (
                  <Link isPassed={index < current} />
                )}
              </span>
              <span className="flex flex-col items-center gap-0.5 text-center">
                <span
                  className={cn(
                    'text-ui-sm',
                    state === 'current' && 'font-medium text-foreground',
                    (state === 'done' || state === 'skipped') && 'text-foreground-muted',
                    state === 'todo' && 'text-foreground-subtle',
                  )}
                >
                  {step.name}
                </span>
                {step.isOptional === true ? (
                  <span className="text-label text-foreground-subtle">
                    {t('ui.setupSteps.optional', 'optional')}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>

      {/* Narrow: the stars close up, and one line says where. */}
      <div className="flex items-center gap-4 sm:hidden">
        <ol className="flex items-center">
          {steps.map((step, index) => (
            <li key={step.name} className="flex items-center">
              {index === 0 ? null : (
                <span className="flex w-4">
                  <Link isPassed={index <= current} />
                </span>
              )}
              <Star state={stateOf(index, current, skipped)} isSmall />
            </li>
          ))}
        </ol>
        <span
          aria-hidden="true"
          className="font-mono text-label tracking-[0.14em] text-primary uppercase"
        >
          {now === undefined ? position : `${position} · ${now.name}`}
        </span>
      </div>
    </nav>
  );
}
