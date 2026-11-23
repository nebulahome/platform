/**
 * A few choices as chips, any number of them on at once: the states a condition accepts, the
 * months a time fires in.
 *
 * The weekday picker's look, for any list short enough to read at a glance. Each chip is a
 * checkbox hidden behind its label, so the keyboard and a screen reader get the control they
 * expect. A chip may lead with a mark of its own (a calendar model's token), and the chips may
 * hold one choice at most: pressing another moves it, pressing the one on lets it go.
 */
import type { ReactNode } from 'react';

import { AppIcon, cn } from '@nebulahome/ui';

/** One chip. */
export type ChipChoice = {
  readonly value: string;
  readonly label: string;

  /** A mark before the label: a model's token. */
  readonly leading?: ReactNode;
};

/** What the chips need. */
export type ChoiceChipsProps = {
  /** What the group is, to a screen reader. */
  readonly label: string;

  /** The chips, in order. */
  readonly options: readonly ChipChoice[];

  /** The ones on. */
  readonly value: readonly string[];

  /** Called with the ones on now, in the chips' order. */
  readonly onChange: (value: string[]) => void;

  readonly className?: string;

  /** Whether a chosen chip shows a tick, as the board's rooms do. */
  readonly hasCheck?: boolean;

  /** Whether one chip at most is on: an event's model. */
  readonly isSingle?: boolean;
};

/**
 * Renders the chips.
 *
 * @param props - See {@link ChoiceChipsProps}.
 * @returns The chips.
 */
export function ChoiceChips(props: ChoiceChipsProps) {
  const { label, options, value, onChange, className, hasCheck = false, isSingle = false } = props;

  return (
    <div role="group" aria-label={label} className={cn('flex flex-wrap gap-1.5', className)}>
      {options.map((option) => {
        const isChosen = value.includes(option.value);

        return (
          <label
            key={option.value}
            className={cn(
              'press flex h-control-sm cursor-pointer items-center rounded-chip border px-3 text-ui',
              option.leading !== undefined && 'gap-1.75 pl-1.25',
              // Chosen reads in the colour of the lane it sits in (N-Blocks-*), the accent elsewhere.
              isChosen
                ? 'border-[color-mix(in_srgb,var(--lane,var(--color-primary))_60%,transparent)] bg-[color-mix(in_srgb,var(--lane,var(--color-primary))_14%,transparent)] text-foreground'
                : 'border-border-strong text-foreground-muted hover:text-foreground',
            )}
          >
            <input
              type="checkbox"
              checked={isChosen}
              className="sr-only"
              onChange={() => {
                onChange(
                  isSingle
                    ? isChosen
                      ? []
                      : [option.value]
                    : options
                        .map((one) => one.value)
                        .filter((one) => (one === option.value ? !isChosen : value.includes(one))),
                );
              }}
            />
            {hasCheck && isChosen ? <AppIcon id="check" size={12} className="mr-1.5" /> : null}
            {option.leading}
            {option.label}
          </label>
        );
      })}
    </div>
  );
}
