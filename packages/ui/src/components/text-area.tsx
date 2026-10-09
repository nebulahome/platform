/**
 * A labelled text area: the text field for a sentence or two, a description.
 *
 * The same label, hint and error as a text field (see {@link FieldShell}), and the same face, a
 * few lines tall and growing with what is typed up to a limit; past it, it scrolls.
 */
import type { TextareaHTMLAttributes, ReactNode } from 'react';

import { cn } from '../lib/cn.js';
import { controlFace } from '../lib/control-face.js';

import { FieldShell } from './field-shell.js';

/** What a text area accepts, on top of the native attributes. */
export type TextAreaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> & {
  /** The label, always present. */
  readonly label: string;

  /** Whether the label is drawn or only announced. */
  readonly isLabelHidden?: boolean;

  /** What is wrong with the current value, when something is. */
  readonly error?: string | undefined;

  /** A line under the field explaining what it is for. */
  readonly hint?: ReactNode;
};

/**
 * Renders a labelled text area.
 *
 * @param props - See {@link TextAreaProps}.
 * @returns The field.
 */
export function TextArea(props: TextAreaProps) {
  const { label, isLabelHidden = false, error, hint, className, rows = 3, ...rest } = props;

  return (
    <FieldShell label={label} isLabelHidden={isLabelHidden} hint={hint} error={error}>
      {(ids) => (
        <textarea
          id={ids.id}
          rows={rows}
          aria-invalid={ids.isInvalid}
          aria-describedby={ids.describedBy}
          className={cn(
            controlFace({ isInvalid: ids.isInvalid }),
            'field-sizing-content h-auto max-h-48 min-h-19 resize-none py-2.5',
            className,
          )}
          {...rest}
        />
      )}
    </FieldShell>
  );
}
