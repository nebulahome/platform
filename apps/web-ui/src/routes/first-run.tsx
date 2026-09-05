/* eslint-disable jsx-a11y/no-autofocus -- This screen exists to be typed into: one field
   above the fold and nothing else to do on the page. Focusing it saves everyone a
   keystroke, and a screen reader announces the label as focus lands, which is the harm
   the rule guards against. */
/**
 * The first-boot screen.
 *
 * Shown when the installation has no accounts at all, which is the one moment this form can
 * exist: the API closes the endpoint behind it. Nothing here is a default. A shipped
 * administrator password is how appliances end up on the public internet with `admin`/`admin`,
 * and the whole point of this screen is that nobody ever has one to change.
 *
 * The password floor is twelve characters and there are no composition rules, which is the API's
 * rule and not a relaxation of it: length is the axis that costs an attacker anything, and
 * demanding a symbol mostly produces the same word with an exclamation mark after it.
 */
import { useState, type SubmitEventHandler } from 'react';

import { Button, TextField } from '@nebula-home/ui';

import { useSession } from '@/auth/session-store';
import { toMessage } from '@/lib/error-message';

/** The shortest password the API will take. */
const MINIMUM_PASSWORD_LENGTH = 12;

/**
 * Suggests a username from the name someone typed.
 *
 * A convenience, not a constraint: the field stays editable, and the suggestion stops the moment
 * the person edits it themselves.
 *
 * @param displayName - What they typed as their name.
 * @returns A username that satisfies the API's pattern.
 */
export function toUsername(displayName: string): string {
  return displayName
    .toLowerCase()
    .normalize('NFD')
    .replaceAll(/[̀-ͯ]/g, '')
    .replaceAll(/[^a-z0-9._-]+/g, '.')
    .replaceAll(/^[.]+|[.]+$/g, '')
    .slice(0, 64);
}

/**
 * Renders the first-run form.
 *
 * @returns The page.
 */
export function FirstRunForm() {
  const createFirstOwner = useSession((state) => state.createFirstOwner);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [isUsernameEdited, setUsernameEdited] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [isBusy, setBusy] = useState(false);

  const isTooShort = password !== '' && password.length < MINIMUM_PASSWORD_LENGTH;

  /**
   * Creates the account.
   *
   * @param event - The submit event, whose default navigation is prevented.
   */
  const onSubmit: SubmitEventHandler<HTMLFormElement> = (event): void => {
    event.preventDefault();
    setError(undefined);
    setBusy(true);

    void (async (): Promise<void> => {
      try {
        await createFirstOwner({
          username,
          displayName,
          password,

          // The browser knows both of these and the person should not have to be asked. They
          // are editable later in settings, which is where a wrong guess gets corrected.
          locale: globalThis.navigator.language.slice(0, 2),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
      } catch (cause: unknown) {
        setError(toMessage(cause));
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
      <TextField
        label="Your name"
        name="name"
        autoComplete="name"
        autoFocus
        required
        value={displayName}
        onChange={(event) => {
          setDisplayName(event.target.value);

          if (!isUsernameEdited) {
            setUsername(toUsername(event.target.value));
          }
        }}
      />

      <TextField
        label="Username"
        name="username"
        autoComplete="username"
        required
        value={username}
        onChange={(event) => {
          setUsernameEdited(true);
          setUsername(event.target.value);
        }}
        hint="Lower case letters, digits, dot, dash and underscore."
      />

      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        value={password}
        onChange={(event) => {
          setPassword(event.target.value);
        }}
        hint={`At least ${String(MINIMUM_PASSWORD_LENGTH)} characters. Length beats punctuation.`}
        error={isTooShort ? 'A little longer.' : error}
      />

      <Button
        type="submit"
        size="large"
        isBusy={isBusy}
        disabled={
          displayName === '' || username === '' || password.length < MINIMUM_PASSWORD_LENGTH
        }
      >
        Create my account
      </Button>
    </form>
  );
}
