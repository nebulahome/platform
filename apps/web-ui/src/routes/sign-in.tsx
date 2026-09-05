/* eslint-disable jsx-a11y/no-autofocus -- This screen exists to be typed into: one field
   above the fold and nothing else to do on the page. Focusing it saves everyone a
   keystroke, and a screen reader announces the label as focus lands, which is the harm
   the rule guards against. */
/**
 * The sign-in screen.
 *
 * One decision worth naming: the failure message is whatever the API said, and the API says the
 * same thing for a wrong username and a wrong password on purpose. The interface must not be
 * more helpful than that - "no such user" here would undo the enumeration defence the server
 * went to some trouble to build.
 */
import { useState, type SubmitEventHandler } from 'react';

import { Button, TextField } from '@nebula-home/ui';

import { useSession } from '@/auth/session-store';
import { isApiError } from '@/lib/api-error';
import { AuthLayout } from '@/routes/auth-layout';

/**
 * Turns a caught failure into a line a person can read.
 *
 * @param error - Whatever was thrown.
 * @returns The message to show.
 */
export function toMessage(error: unknown): string {
  if (isApiError(error)) {
    return error.code === 'NETWORK'
      ? 'Nebula is not responding. Check that the server is running.'
      : error.message;
  }

  return 'Something went wrong. Try again.';
}

/**
 * Renders the sign-in form.
 *
 * @returns The page.
 */
export function SignIn() {
  const signInWithPassword = useSession((state) => state.signInWithPassword);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [isBusy, setBusy] = useState(false);

  /**
   * Sends the credentials.
   *
   * @param event - The submit event, whose default navigation is prevented.
   */
  const onSubmit: SubmitEventHandler<HTMLFormElement> = (event): void => {
    event.preventDefault();
    setError(undefined);
    setBusy(true);

    void (async (): Promise<void> => {
      try {
        // The store decides what happens next: either it is now signed in, or it is holding a
        // challenge and the router will show the code screen. Nothing to do here either way.
        await signInWithPassword(username, password);
      } catch (cause: unknown) {
        setError(toMessage(cause));
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <AuthLayout title="Sign in" subtitle="Welcome back to your home.">
      <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
        <TextField
          label="Username"
          name="username"
          autoComplete="username"
          autoFocus
          required
          value={username}
          onChange={(event) => {
            setUsername(event.target.value);
          }}
        />

        <TextField
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
          error={error}
        />

        <Button type="submit" size="large" isBusy={isBusy}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
