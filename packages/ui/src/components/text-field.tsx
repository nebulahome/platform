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
  const { label, isLabelHidden = false, error, hint, size, className, ...rest } = props;

  return (
    <FieldShell label={label} isLabelHidden={isLabelHidden} hint={hint} error={error}>
      {(ids) => (
        <input
          id={ids.id}
          aria-invalid={ids.isInvalid}
          aria-describedby={ids.describedBy}
          className={cn(controlFace({ size, isInvalid: ids.isInvalid }), className)}
          {...rest}
        />
      )}
    </FieldShell>
  );
}
