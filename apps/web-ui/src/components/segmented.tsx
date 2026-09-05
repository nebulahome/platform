/**
 * A small, fixed set of choices, shown all at once.
 *
 * A segmented control rather than a dropdown wherever the options are few and short: the whole
 * choice is legible without opening anything, which is what makes a settings page scannable.
 * Past about four options it stops fitting, and a `SelectField` is the right control instead.
 *
 * It is a radio group, not a row of buttons. That is what makes the arrow keys move between the
 * options and the whole group a single tab stop, and it is what a screen reader announces as a
 * choice rather than as three unrelated controls.
 */
import { useId } from 'react';

import { cn } from '@nebula-home/ui';

/** One option. */
export type SegmentedOption<TValue extends string> = {
  /** What it is worth. */
  readonly value: TValue;

  /** What it is called. */
  readonly label: string;
};

/** What the control needs. */
export type SegmentedProps<TValue extends string> = {
  /** What the group is for, announced to a screen reader. */
  readonly label: string;

  /** The options, in the order they should read. */
  readonly options: readonly SegmentedOption<TValue>[];

  /** Which one is chosen. */
  readonly value: TValue;

  /** Called with the new choice. */
  readonly onChange: (value: TValue) => void;

  /** Whether the choice can be made at all. */
  readonly disabled?: boolean;
};

/**
 * Renders a segmented control.
 *
 * @param props - See {@link SegmentedProps}.
 * @returns The control.
 */
export function Segmented<TValue extends string>(props: SegmentedProps<TValue>) {
  const { label, options, value, onChange, disabled = false } = props;
  const name = useId();

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex shrink-0 items-center gap-1 rounded-full border border-border bg-groove p-1"
    >
      {options.map((option) => (
        <label
          key={option.value}
          className={cn(
            'flex h-[30px] cursor-pointer items-center rounded-full px-3.5 text-[13px] transition-colors',
            'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary',
            option.value === value
              ? 'bg-control font-medium text-foreground shadow-sm'
              : 'text-foreground-muted hover:text-foreground',
            disabled ? 'cursor-not-allowed opacity-60' : '',
          )}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            disabled={disabled}
            onChange={() => {
              onChange(option.value);
            }}
            className="sr-only"
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
