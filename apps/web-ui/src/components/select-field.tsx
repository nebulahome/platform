/**
 * A dropdown.
 *
 * A native `<select>` under the styling, deliberately. A listbox built out of divs has to
 * reimplement keyboard navigation, typeahead, the mobile picker and the way a screen reader
 * announces a closed choice, and the reimplementation is worse every time. What is styled here
 * is the box; the popup stays the operating system's.
 *
 * The label can be hidden but never absent: several of these sit in a row whose title already
 * says what they are, and repeating it above the box would be noise on screen and silence for
 * anyone who cannot see the row.
 */
import { useId, type SelectHTMLAttributes } from 'react';

import { cn } from '@nebula-home/ui';

/** One option. */
export type SelectOption = {
  /** What it is worth. */
  readonly value: string;

  /** What it is called. */
  readonly label: string;
};

/** What the field accepts, on top of the native attributes. */
export type SelectFieldProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'children'> & {
  /** What the field is for. */
  readonly label: string;

  /** Whether the label is drawn, or only announced. */
  readonly isLabelHidden?: boolean;

  /** The options, in the order they should read. */
  readonly options: readonly SelectOption[];

  /** What is wrong with the current value, when something is. */
  readonly error?: string | undefined;
};

/**
 * Renders a dropdown.
 *
 * @param props - See {@link SelectFieldProps}.
 * @returns The field.
 */
export function SelectField(props: SelectFieldProps) {
  const { label, isLabelHidden = false, options, error, className, ...rest } = props;
  const id = useId();
  const errorId = `${id}-error`;

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={id}
        className={cn(
          'text-xs font-medium text-foreground-muted',
          isLabelHidden ? 'sr-only' : undefined,
        )}
      >
        {label}
      </label>

      <select
        id={id}
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : errorId}
        className={cn(
          'h-9 rounded-field border bg-surface-raised px-3 text-[13.5px] text-foreground',
          'focus-visible:ring-3 focus-visible:ring-primary/25 focus-visible:outline-none',
          error === undefined
            ? 'border-border focus-visible:border-primary'
            : 'border-danger focus-visible:ring-danger/25',
          className,
        )}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {error === undefined ? null : (
        <span id={errorId} role="alert" className="text-[11.5px] text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
