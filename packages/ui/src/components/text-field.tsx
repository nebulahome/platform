/**
 * A labelled text input.
 *
 * The label is always rendered and always tied to the input by id, never replaced by a
 * placeholder. A placeholder disappears the moment someone types, which is exactly when a person
 * filling a form most wants to check what the field was asking for - and a screen reader gets
 * nothing from it at all.
 *
 * An error, when there is one, is announced: the message carries `role="alert"` and the input
 * points at it with `aria-describedby`, so a failed sign-in is heard as well as seen.
 */
import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

import { cn } from '../lib/cn.js';

/** What a field accepts, on top of the native input attributes. */
export type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & {
  /** The label, always visible. */
  readonly label: string;

  /** What is wrong with the current value, when something is. */
  readonly error?: string | undefined;

  /** A line under the field explaining what it is for. */
  readonly hint?: ReactNode;
};

/**
 * Renders a labelled input.
 *
 * @param props - See {@link TextFieldProps}.
 * @returns The field.
 */
export function TextField(props: TextFieldProps) {
  const { label, error, hint, className, ...rest } = props;
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error === undefined ? null : errorId, hint === undefined ? null : hintId]
    .filter((value): value is string => value !== null)
    .join(' ');

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-xs font-medium text-foreground-muted">
        {label}
      </label>

      <input
        id={id}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        className={cn(
          'h-11 rounded-[10px] border bg-canvas px-3.5 text-sm text-foreground',
          'placeholder:text-foreground-disabled',
          'focus-visible:ring-3 focus-visible:ring-primary/25 focus-visible:outline-none',
          error === undefined
            ? 'border-border focus-visible:border-primary'
            : 'border-danger focus-visible:ring-danger/25',
          className,
        )}
        {...rest}
      />

      {hint === undefined ? null : (
        <span id={hintId} className="text-[11.5px] leading-relaxed text-foreground-subtle">
          {hint}
        </span>
      )}

      {error === undefined ? null : (
        <span id={errorId} role="alert" className="text-[11.5px] text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
