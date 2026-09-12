/**
 * The label, the hint and the error that every field carries.
 *
 * Three fields had written this out for themselves - the text input, the password input and the
 * dropdown - which meant three copies of the `aria-describedby` assembly, and three chances for
 * one of them to forget that a hint and an error have to be joined rather than to replace each
 * other. A field that announces only its error stops telling a screen reader what the field was
 * asking for, which is exactly when a person needs to hear it.
 *
 * The control is a function rather than a child element: it needs the generated ids, and handing
 * them down through a render argument is the honest way to do that. Cloning a child to inject
 * props would work until somebody wraps the control in anything.
 */
import { useId, type ReactNode } from 'react';

import { cn } from '../lib/cn.js';

/** What the shell hands to the control it wraps. */
export type FieldIds = {
  /** The id the control must carry, so the label points at it. */
  readonly id: string;

  /** The id of the label element, for a control that names itself with `aria-labelledby`. */
  readonly labelId: string;

  /** Everything describing the control, already joined. `undefined` when there is nothing. */
  readonly describedBy: string | undefined;

  /** Whether the control should report itself invalid. */
  readonly isInvalid: boolean;
};

/** What the shell needs. */
export type FieldShellProps = {
  /** What the field is for. Always rendered, never replaced by a placeholder. */
  readonly label: string;

  /**
   * Whether the label is drawn or only announced.
   *
   * For a field whose purpose is already obvious from what sits beside it - a search box under a
   * heading that says Search. It is never simply removed: a control with no accessible name is
   * unusable to anyone who cannot see the column it is in.
   */
  readonly isLabelHidden?: boolean;

  /** A line under the field explaining what it is for, or what it costs. */
  readonly hint?: ReactNode;

  /** What is wrong with the current value, when something is. */
  readonly error?: string | undefined;

  /** Anything extra for the outer element. */
  readonly className?: string;

  /** The control, given the ids it has to carry. */
  readonly children: (ids: FieldIds) => ReactNode;
};

/**
 * Renders a field's label, control, hint and error.
 *
 * `relative` on the wrapper is load-bearing beyond positioning: a hidden label is
 * `position: absolute`, and without a positioned ancestor its containing block is the whole
 * document - so it escapes the clipping of whatever panel it sits in and stretches the page.
 * Fifteen of those on one screen gave the settings section a second scrollbar that nothing
 * appeared to own.
 *
 * @param props - See {@link FieldShellProps}.
 * @returns The field.
 */
export function FieldShell(props: FieldShellProps) {
  const { label, isLabelHidden = false, hint, error, className, children } = props;

  const id = useId();
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  // Joined rather than replaced: a field with both a hint and an error has to announce both, and
  // the hint is the half that says what the field wanted.
  const describedBy = [hint === undefined ? null : hintId, error === undefined ? null : errorId]
    .filter((entry): entry is string => entry !== null)
    .join(' ');

  return (
    <div className={cn('relative flex flex-col gap-2', className)}>
      <label
        id={labelId}
        htmlFor={id}
        className={cn(
          'text-caption font-medium text-foreground-muted',
          isLabelHidden ? 'sr-only' : undefined,
        )}
      >
        {label}
      </label>

      {children({
        id,
        labelId,
        describedBy: describedBy === '' ? undefined : describedBy,
        isInvalid: error !== undefined,
      })}

      {hint === undefined ? null : (
        <span id={hintId} className="text-caption text-foreground-subtle">
          {hint}
        </span>
      )}

      {error === undefined ? null : (
        <span id={errorId} role="alert" className="text-caption text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
