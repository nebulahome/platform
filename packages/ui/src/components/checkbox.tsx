/**
 * A box ticked on a form that is saved, or confirmed, later - where a switch is an action that
 * happens now.
 *
 * A native checkbox, visually hidden, under an 18px box drawn by the theme: the input keeps the
 * keyboard, the label and the form behaviour, and the box is only its picture. Ticked, the box is
 * `primary` with a check; the check changes the shape, so colour is not the only carrier.
 *
 * A box over a group whose members are partly ticked is `mixed`: filled, with a dash. A filter's
 * box can carry a count on the right - what ticking it would show.
 */
import type { ReactNode } from 'react';

import { cn } from '../lib/cn.js';

import { AppIcon } from './app-icon.js';

/** What a checkbox needs. */
export type CheckboxProps = {
  /** What ticking it says. Always words, beside the box. */
  readonly label: ReactNode;

  /** A line under the label: what it costs or means. */
  readonly note?: ReactNode;

  /** Whether it is ticked. */
  readonly isChecked: boolean;

  /** Whether it stands for a group partly ticked: drawn with a dash, read as mixed. */
  readonly isMixed?: boolean;

  /** On the right, in mono: how many it would show. */
  readonly count?: ReactNode;

  /** Called with what it should become. */
  readonly onChange: (isChecked: boolean) => void;

  /** Whether it can be changed at all. */
  readonly disabled?: boolean;

  /** Anything extra for the outer element. */
  readonly className?: string;
};

/**
 * Renders a checkbox with its label.
 *
 * @param props - See {@link CheckboxProps}.
 * @returns The labelled box.
 */
export function Checkbox(props: CheckboxProps) {
  const {
    label,
    note,
    isChecked,
    isMixed = false,
    count,
    onChange,
    disabled = false,
    className,
  } = props;
  const isFilled = isChecked || isMixed;

  return (
    <label
      className={cn(
        'flex items-start gap-2.5 text-ui',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        className,
      )}
    >
      <input
        type="checkbox"
        className="peer sr-only"
        checked={isChecked}
        ref={(input) => {
          if (input !== null) {
            input.indeterminate = isMixed;
          }
        }}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
      {/* The width in brackets: Tailwind 4 makes no class of `border-1.5`, and an empty box with no
          edge was simply not there. */}
      <span
        aria-hidden="true"
        className={cn(
          'mt-px flex size-4.5 shrink-0 items-center justify-center rounded-check border-[1.5px] transition-colors',
          'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary',
          isFilled
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border-strong bg-transparent',
        )}
      >
        {isMixed ? (
          <AppIcon id="minus" size={12} strokeWidth={2.5} />
        ) : isChecked ? (
          <AppIcon id="check" size={12} strokeWidth={2.5} />
        ) : null}
      </span>
      <span className="flex min-w-0 grow flex-col gap-0.5">
        <span className="text-foreground">{label}</span>
        {note === undefined ? null : (
          <span className="text-ui-sm text-foreground-subtle">{note}</span>
        )}
      </span>
      {count === undefined ? null : (
        <span className="shrink-0 font-mono text-mono-ui text-foreground-subtle tabular">
          {count}
        </span>
      )}
    </label>
  );
}
