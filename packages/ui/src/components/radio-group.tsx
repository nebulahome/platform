/**
 * One choice of a few, each with a line saying what it means: how a list is sorted, what an alias
 * reads when a source is missing.
 *
 * Native radios, visually hidden, under a 16px ring drawn by the theme: the inputs keep the
 * keyboard and the group's arrow keys. The whole row is the control; the dot inside the ring is
 * its picture, so it is hidden from a screen reader.
 *
 * Two looks: lines, one under the other, and cards - a bordered card a choice, lit when chosen -
 * for a choice that weighs more, such as which times of a repeating event a change is for. A line
 * may carry a control at its end (a repeat that ends On a date, After a number of times): it sits
 * beside the row's label, not inside it, so pressing it never presses the radio.
 */
import { useId, type ReactNode } from 'react';

import { cn } from '../lib/cn.js';

/** One choice. */
export type RadioOption<TValue extends string> = {
  /** What choosing it stores. */
  readonly value: TValue;

  /** What it says. */
  readonly label: ReactNode;

  /** A line under it: what it means. */
  readonly note?: ReactNode;

  /** A control at the end of the row, which belongs with the choice: a day, a count. */
  readonly trail?: ReactNode;
};

/** What the group needs. */
export type RadioGroupProps<TValue extends string> = {
  /** What is being chosen, read out with the group. */
  readonly label: string;

  /** Whether the label is drawn or only announced. */
  readonly isLabelHidden?: boolean;

  /** The choices, in order. */
  readonly options: readonly RadioOption<TValue>[];

  /** The one chosen. */
  readonly value: TValue;

  /** Called with the one chosen. */
  readonly onChange: (value: TValue) => void;

  /** Lines, one under the other (the default), or a card a choice. */
  readonly look?: 'lines' | 'cards';

  /** Anything extra for the outer element. */
  readonly className?: string;
};

/**
 * Renders the group.
 *
 * @param props - See {@link RadioGroupProps}.
 * @returns The group.
 */
export function RadioGroup<TValue extends string>(props: RadioGroupProps<TValue>) {
  const { label, isLabelHidden = false, options, value, onChange, look = 'lines' } = props;
  const name = useId();
  const isCards = look === 'cards';

  return (
    <fieldset className={cn('flex flex-col', isCards ? 'gap-2.5' : 'gap-1', props.className)}>
      <legend
        className={cn(
          'mb-1.5 font-mono text-label text-foreground-subtle uppercase',
          isLabelHidden ? 'sr-only' : undefined,
        )}
      >
        {label}
      </legend>
      {options.map((option) => {
        const isChosen = option.value === value;
        const row = (
          <label
            key={option.value}
            className={cn(
              'flex cursor-pointer items-start text-ui',
              isCards
                ? 'gap-3 rounded-inner border px-4 py-3.5 transition-colors'
                : 'gap-2.5 rounded-field px-1 py-1.5',
              isCards &&
                (isChosen
                  ? 'border-primary/60 bg-primary/7'
                  : 'border-border bg-well hover:border-border-strong'),
              option.trail === undefined ? undefined : 'min-w-0 grow',
            )}
          >
            <input
              type="radio"
              name={name}
              className="peer sr-only"
              checked={isChosen}
              onChange={() => {
                onChange(option.value);
              }}
            />
            <span
              aria-hidden="true"
              className={cn(
                'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors',
                'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary',
                isChosen ? 'border-primary' : 'border-border-strong',
              )}
            >
              {isChosen ? <span className="size-2 rounded-full bg-primary" /> : null}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className={cn('text-foreground', isCards && 'font-medium')}>
                {option.label}
              </span>
              {option.note === undefined ? null : (
                <span
                  className={cn('text-foreground-subtle', isCards ? 'text-caption' : 'text-ui-sm')}
                >
                  {option.note}
                </span>
              )}
            </span>
          </label>
        );

        return option.trail === undefined ? (
          row
        ) : (
          <div key={option.value} className="flex items-center gap-3">
            {row}
            <div className="shrink-0">{option.trail}</div>
          </div>
        );
      })}
    </fieldset>
  );
}
