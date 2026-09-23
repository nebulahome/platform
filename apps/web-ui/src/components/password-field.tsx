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
 * It stays in the application rather than moving into the design system with the other fields,
 * because it knows the password rules. Those are a product decision about what a safe password
 * is, not a shape, and a design system that carries them starts having opinions about the
 * product.
 *
 * Nothing here is a security boundary. The API checks the password again, and it is the only one
 * whose answer counts.
 */
import { useState, type ReactNode } from 'react';

import { cn, controlFace, FieldShell, IconButton } from '@nebula-home/ui';

import { CheckIcon, EyeIcon, EyeOffIcon } from '@/components/icons';
import { passwordRules } from '@/lib/password-rules';

/** What the field needs. */
export type PasswordFieldProps = {
  /** The label, always visible. */
  readonly label: string;

  /** What has been typed. */
  readonly value: string;

  /** Called with the new value. */
  readonly onChange: (value: string) => void;

  /**
   * What the browser should offer to fill.
   *
   * `off` for a secret that is not an account's password - a device's access code, an API key -
   * so that the browser does not take the field before it for the username of a sign-up form.
   */
  readonly autoComplete?: 'current-password' | 'new-password' | 'off';

  /** The name the field is submitted under, and what a browser's heuristics see it as. */
  readonly name?: string;

  /** Whether to list the requirements. Off for a password being *checked* rather than chosen. */
  readonly hasRules?: boolean;

  /** What is wrong with it, when the server has said so. */
  readonly error?: string | undefined;

  /** Whether it must be filled in. */
  readonly required?: boolean;

  /** Shown in the empty field, for a password that is kept and need not be typed again. */
  readonly placeholder?: string | undefined;

  /** A line under the control when there are no rules to list. */
  readonly hint?: ReactNode | undefined;

  /** How tall the control is. Large by default, which is what a sign-in form wants. */
  readonly size?: 'compact' | 'medium' | 'large';
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
    name,
    hasRules = true,
    error,
    required = false,
    placeholder,
    hint,
    size = 'large',
  } = props;

  const [isRevealed, setRevealed] = useState(false);
  const rules = passwordRules(value).filter((rule) => rule.isShownWhenMet || !rule.isMet);

  return (
    <FieldShell
      label={label}
      error={error}
      hint={
        hasRules ? (
          <ul className="flex flex-col gap-1">
            {rules.map((rule) => (
              <li
                key={rule.label}
                className={cn(
                  'flex items-center gap-1.5',
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
          </ul>
        ) : (
          hint
        )
      }
    >
      {(ids) => (
        <div className="relative">
          <input
            id={ids.id}
            name={name}
            type={isRevealed ? 'text' : 'password'}
            value={value}
            autoComplete={autoComplete}
            required={required}
            placeholder={placeholder}
            aria-invalid={ids.isInvalid}
            aria-describedby={ids.describedBy}
            onChange={(event) => {
              onChange(event.target.value);
            }}
            className={cn(controlFace({ size, isInvalid: ids.isInvalid }), 'pr-11')}
          />

          {/* A glyph rather than the words Show and Hide. The words changed width as they
              swapped, which nudged the right edge of the field on every press, and they had to be
              kept clear of a password long enough to reach them. The label is still there for
              anyone who cannot see the glyph - it is what an icon button is named by. */}
          <IconButton
            label={isRevealed ? 'Hide the password' : 'Show the password'}
            aria-pressed={isRevealed}
            size="small"
            onClick={() => {
              setRevealed(!isRevealed);
            }}
            className="absolute top-1/2 right-2 -translate-y-1/2"
          >
            {isRevealed ? (
              <EyeOffIcon width="16" height="16" />
            ) : (
              <EyeIcon width="16" height="16" />
            )}
          </IconButton>
        </div>
      )}
    </FieldShell>
  );
}
