/**
 * A password field that says what it wants while you type.
 *
 * The requirements are listed under the field and each one goes from grey to green as it is
 * satisfied, rather than waiting for a submit to say what was wrong. Somebody who has typed
 * eleven characters can see that they are one short, which is the whole difference between a
 * form that helps and a form that judges.
 *
 * The list is not announced live. It changes on every keystroke, and a screen reader repeating
 * the requirements after each letter is unusable; it is attached with `aria-describedby`
 * instead, so it is read once when the field is entered and can be revisited at will. Each row
 * carries its verdict as text as well as colour, because a green tick and a grey dot are the
 * same shape to anyone who cannot tell them apart.
 *
 * Nothing here is a security boundary. The API checks the password again, and it is the only one
 * whose answer counts.
 */
import { useId, useState } from 'react';

import { cn } from '@nebula-home/ui';

import { CheckIcon } from '@/components/icons';
import { passwordRules } from '@/lib/password-rules';

/** What the field needs. */
export type PasswordFieldProps = {
  /** The label, always visible. */
  readonly label: string;

  /** What has been typed. */
  readonly value: string;

  /** Called with the new value. */
  readonly onChange: (value: string) => void;

  /** What the browser should offer to fill. */
  readonly autoComplete?: 'current-password' | 'new-password';

  /** Whether to list the requirements. Off for a password being *checked* rather than chosen. */
  readonly hasRules?: boolean;

  /** What is wrong with it, when the server has said so. */
  readonly error?: string | undefined;

  /** Whether it must be filled in. */
  readonly required?: boolean;
};

/**
 * Renders a password field.
 *
 * @param props - See {@link PasswordFieldProps}.
 * @returns The field.
 */
export function PasswordField(props: PasswordFieldProps) {
  const {
    label,
    value,
    onChange,
    autoComplete = 'new-password',
    hasRules = true,
    error,
    required = false,
  } = props;

  const id = useId();
  const rulesId = `${id}-rules`;
  const errorId = `${id}-error`;
  const [isRevealed, setRevealed] = useState(false);

  const rules = passwordRules(value).filter((rule) => rule.isShownWhenMet || !rule.isMet);
  const describedBy = [hasRules ? rulesId : null, error === undefined ? null : errorId]
    .filter((entry): entry is string => entry !== null)
    .join(' ');

  return (
    // `relative` because the reveal button is positioned against it - and because a hidden label
    // or an `sr-only` verdict below is `position: absolute`, and without a positioned ancestor
    // its containing block is the whole document.
    <div className="relative flex flex-col gap-2">
      <label htmlFor={id} className="text-xs font-medium text-foreground-muted">
        {label}
      </label>

      <div className="relative">
        <input
          id={id}
          type={isRevealed ? 'text' : 'password'}
          value={value}
          autoComplete={autoComplete}
          required={required}
          aria-invalid={error !== undefined}
          aria-describedby={describedBy === '' ? undefined : describedBy}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          className={cn(
            'h-11 w-full rounded-field border bg-canvas pr-16 pl-3.5 text-sm text-foreground',
            'placeholder:text-foreground-disabled',
            'focus-visible:ring-3 focus-visible:ring-primary/25 focus-visible:outline-none',
            error === undefined
              ? 'border-border focus-visible:border-primary'
              : 'border-danger focus-visible:ring-danger/25',
          )}
        />

        <button
          type="button"
          // Named by what pressing it does, not by the current state: "Hide" on a hidden
          // password is the kind of label that makes people press it to find out.
          aria-label={isRevealed ? 'Hide the password' : 'Show the password'}
          onClick={() => {
            setRevealed(!isRevealed);
          }}
          className="absolute inset-y-0 right-0 px-3.5 text-[11.5px] font-medium text-foreground-subtle transition-colors hover:text-foreground-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {isRevealed ? 'Hide' : 'Show'}
        </button>
      </div>

      {hasRules ? (
        <ul id={rulesId} className="flex flex-col gap-1">
          {rules.map((rule) => (
            <li
              key={rule.label}
              className={cn(
                'flex items-center gap-1.5 text-[11.5px]',
                rule.isMet ? 'text-success' : 'text-foreground-subtle',
              )}
            >
              {rule.isMet ? (
                <CheckIcon width="12" height="12" />
              ) : (
                <span aria-hidden="true" className="flex size-3 items-center justify-center">
                  <span className="size-1 rounded-full bg-current" />
                </span>
              )}

              <span>{rule.label}</span>
              <span className="sr-only">{rule.isMet ? ' — met' : ' — not met yet'}</span>
            </li>
          ))}

          <li className="text-[11.5px] text-foreground-subtle">
            No other rules: no upper case, no digit, no symbol. Length is the only thing that costs
            an attacker anything.
          </li>
        </ul>
      ) : null}

      {error === undefined ? null : (
        <span id={errorId} role="alert" className="text-[11.5px] text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
