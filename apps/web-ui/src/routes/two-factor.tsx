/* eslint-disable jsx-a11y/no-autofocus -- This screen exists to be typed into: one field
   above the fold and nothing else to do on the page. Focusing it saves everyone a
   keystroke, and a screen reader announces the label as focus lands, which is the harm
   the rule guards against. */
/**
 * The second-factor screen.
 *
 * Six boxes rather than one input, because the shape of the control tells you what is expected
 * of it before you read anything. They are backed by a single hidden-in-plain-sight input: six
 * real inputs means six focus targets, six paste handlers and six places for the caret to be
 * wrong, and every one of those is a bug an authenticator app will find.
 *
 * The same field takes a recovery code. The API decides which one it was by matching, and a
 * person who has lost their phone should not have to find a different screen to say so.
 */
import { useRef, useState, type SubmitEventHandler } from 'react';

import { Button } from '@nebula-home/ui';

import { useSession } from '@/auth/session-store';
import { toMessage } from '@/lib/error-message';

/** How many digits a one-time code has. */
const CODE_LENGTH = 6;

/**
 * Renders the code form.
 *
 * @returns The page.
 */
export function TwoFactorForm() {
  const submitCode = useSession((state) => state.submitCode);
  const inputRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [isBusy, setBusy] = useState(false);
  const isRecoveryCode = code.includes('-');

  /**
   * Sends the code.
   *
   * @param event - The submit event, whose default navigation is prevented.
   */
  const onSubmit: SubmitEventHandler<HTMLFormElement> = (event): void => {
    event.preventDefault();
    setError(undefined);
    setBusy(true);

    void (async (): Promise<void> => {
      try {
        await submitCode(code);
      } catch (cause: unknown) {
        setError(toMessage(cause));
        setCode('');
        inputRef.current?.focus();
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
      <div className="flex flex-col gap-2">
        <span className="text-caption font-medium text-foreground-muted">Code</span>

        {/*
         * The boxes are decoration over one input, wrapped in a label so that clicking them
         * focuses it natively. A div with a click handler would need a keyboard handler, a
         * role and a tab stop to be equivalent, and would still be worse: the label is what a
         * screen reader already understands.
         */}
        <label htmlFor="code" className="relative block">
          <input
            id="code"
            ref={inputRef}
            name="one-time-code"
            inputMode={isRecoveryCode ? 'text' : 'numeric'}
            autoComplete="one-time-code"
            autoFocus
            maxLength={32}
            value={code}
            aria-invalid={error !== undefined}
            aria-describedby={error === undefined ? undefined : 'code-error'}
            onChange={(event) => {
              setCode(event.target.value.trim());
            }}
            className={
              isRecoveryCode
                ? 'h-12 w-full rounded-field border border-border bg-canvas px-3.5 text-center font-mono text-subhead tracking-code text-foreground focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/25 focus-visible:outline-none'
                : 'absolute inset-0 h-full w-full cursor-default opacity-0'
            }
          />

          {isRecoveryCode ? null : (
            <div aria-hidden="true" className="flex gap-2">
              {[...Array.from({ length: CODE_LENGTH }).keys()].map((index) => {
                const character = code[index] ?? '';
                const isNext = index === code.length;

                return (
                  <span
                    key={index}
                    className={`flex h-12 flex-1 items-center justify-center rounded-field border bg-canvas font-mono text-head ${
                      error !== undefined
                        ? 'border-danger'
                        : isNext
                          ? 'border-primary ring-3 ring-primary/25'
                          : 'border-border'
                    }`}
                  >
                    {character === '' && isNext ? (
                      <span className="h-5 w-px animate-pulse bg-primary" />
                    ) : (
                      character
                    )}
                  </span>
                );
              })}
            </div>
          )}
        </label>

        {error === undefined ? null : (
          <span id="code-error" role="alert" className="text-caption text-danger">
            {error}
          </span>
        )}
      </div>

      <Button
        type="submit"
        size="large"
        isBusy={isBusy}
        disabled={!isRecoveryCode && code.length < CODE_LENGTH}
      >
        Verify
      </Button>
    </form>
  );
}

/**
 * The way out of the code screen.
 *
 * Rendered under the card rather than inside it, because it is not part of finishing this
 * sign-in - it is the way to abandon it. Signing out clears the challenge, which is what takes
 * the interface back to the password screen.
 *
 * @returns The escape hatch.
 */
export function TwoFactorFooter() {
  const signOutOfFlow = useSession((state) => state.signOut);

  return (
    <button
      type="button"
      className="underline underline-offset-2 hover:text-foreground-muted"
      onClick={() => {
        void signOutOfFlow();
      }}
    >
      Sign in as someone else
    </button>
  );
}
