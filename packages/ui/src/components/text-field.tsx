/**
 * A labelled text input.
 *
 * The label is always rendered and always tied to the input by id, never replaced by a
 * placeholder. A placeholder disappears the moment someone types, which is exactly when a person
 * filling a form most wants to check what the field was asking for - and a screen reader gets
 * nothing from it at all.
 *
 * The label, the hint and the error come from {@link FieldShell}, and the input's own shape from
 * {@link controlFace}: this file is the input and nothing else, which is why there is so little
 * of it.
 */
import type { InputHTMLAttributes, ReactNode } from 'react';

import { cn } from '../lib/cn.js';
import { controlFace, type ControlFaceVariants } from '../lib/control-face.js';

import { FieldShell } from './field-shell.js';

/** What a field accepts, on top of the native input attributes. */
export type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'size'> &
  Pick<ControlFaceVariants, 'size'> & {
    /** The label, always present. */
    readonly label: string;

    /** Whether the label is drawn or only announced. See {@link FieldShell}. */
    readonly isLabelHidden?: boolean;

    /** What is wrong with the current value, when something is. */
    readonly error?: string | undefined;

    /** What the current value costs, when it is allowed but not advised. See {@link FieldShell}. */
    readonly warning?: string | undefined;

    /** A line under the field explaining what it is for. */
    readonly hint?: ReactNode;

    /** A word at the right of the box, inside it: the unit of what is typed - `seconds`. */
    readonly trail?: string;
  };

/**
 * Renders a labelled input.
 *
 * @param props - See {@link TextFieldProps}.
 * @returns The field.
 */
export function TextField(props: TextFieldProps) {
  const {
    label,
    isLabelHidden = false,
    error,
    warning,
    hint,
    size,
    className,
    trail,
    ...rest
  } = props;

  return (
    <FieldShell
      label={label}
      isLabelHidden={isLabelHidden}
      hint={hint}
      warning={warning}
      error={error}
    >
      {(ids) => {
        const input = (
          <input
            id={ids.id}
            aria-invalid={ids.isInvalid}
            aria-describedby={ids.describedBy}
            className={cn(
              controlFace({ size, isInvalid: ids.isInvalid }),
              trail !== undefined && 'pr-20',
              className,
            )}
            {...rest}
          />
        );

        return trail === undefined ? (
          input
        ) : (
          <span className="relative flex">
            {input}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-caption text-foreground-subtle"
            >
              {trail}
            </span>
          </span>
        );
      }}
    </FieldShell>
  );
}
