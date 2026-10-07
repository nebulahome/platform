/**
 * One choice of a few, each with a line saying what it means: how a list is sorted, what an alias
 * reads when a source is missing.
 *
 * Native radios, visually hidden, under a 16px ring drawn by the theme: the inputs keep the
 * keyboard and the group's arrow keys. The whole row is the control; the dot inside the ring is
 * its picture, so it is hidden from a screen reader.
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
  const { label, isLabelHidden = false, options, value, onChange, className } = props;
  const name = useId();

  return (
    <fieldset className={cn('flex flex-col gap-1', className)}>
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

        return (
          <label
            key={option.value}
            className="flex cursor-pointer items-start gap-2.5 rounded-field px-1 py-1.5 text-ui"
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
              <span className="text-foreground">{option.label}</span>
              {option.note === undefined ? null : (
                <span className="text-ui-sm text-foreground-subtle">{option.note}</span>
              )}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
