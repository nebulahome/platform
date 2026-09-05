/**
 * Who you are, and the two things about it you can change.
 *
 * Rows rather than a panel of their own: they sit with the second factor under one Account
 * heading, because from where a person stands their name, their password and their authenticator
 * are three facts about the same thing. They were three separate boxes and reading them meant
 * deciding, three times, whether the next box was still about you.
 *
 * Editing the profile and changing the password stay separate acts behind separate dialogs, and
 * that is the API's shape as much as this page's: `PATCH /users/:userId` has no password field
 * at all, because changing a credential is not the same kind of event as correcting a name and
 * belongs in the audit trail as itself.
 *
 * The current password is asked for even though you are already signed in. An access token left
 * open on a shared machine should not be enough to take the account over permanently.
 */
import { useState, type SubmitEventHandler } from 'react';

import { Button, TextField } from '@nebula-home/ui';

import { useSession } from '@/auth/session-store';
import { Avatar } from '@/components/avatar';
import { Badge } from '@/components/badge';
import { Modal } from '@/components/modal';
import { PanelRow } from '@/components/panel';
import { PasswordField } from '@/components/password-field';
import { toMessage } from '@/lib/error-message';
import { isPasswordAcceptable } from '@/lib/password-rules';
import { AvatarPicker } from '@/routes/settings/avatar-picker';
import { changePassword, updateUser } from '@/settings/api';

/** Which dialog is open, if any. */
type OpenDialog = 'profile' | 'password' | null;

/**
 * Renders the identity and password rows, and the dialogs behind them.
 *
 * @returns The rows.
 */
export function ProfileRows() {
  const user = useSession((state) => state.user);
  const refreshUser = useSession((state) => state.refreshUser);
  const [open, setOpen] = useState<OpenDialog>(null);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [isBusy, setBusy] = useState(false);
  const [note, setNote] = useState<string | undefined>(undefined);

  if (user === undefined) {
    return null;
  }

  /**
   * Closes whichever dialog is open and forgets what was typed into it.
   */
  const close = (): void => {
    setOpen(null);
    setError(undefined);
    setCurrentPassword('');
    setNewPassword('');
  };

  /**
   * Saves the profile.
   *
   * @param event - The submit event, whose default navigation is prevented.
   */
  const onSubmitProfile: SubmitEventHandler<HTMLFormElement> = (event): void => {
    event.preventDefault();
    setError(undefined);
    setBusy(true);

    void (async (): Promise<void> => {
      try {
        // An empty email field means "leave it alone", not "clear it". Clearing an address is a
        // deliberate act and this form has no way to express it, so it must not do it by
        // accident to anyone who opens the dialog and presses save.
        await updateUser(user.id, { displayName, ...(email === '' ? {} : { email }) });
        await refreshUser();
        close();
        setNote('Profile updated.');
      } catch (cause: unknown) {
        setError(toMessage(cause));
      } finally {
        setBusy(false);
      }
    })();
  };

  /**
   * Changes the password.
   *
   * @param event - The submit event, whose default navigation is prevented.
   */
  const onSubmitPassword: SubmitEventHandler<HTMLFormElement> = (event): void => {
    event.preventDefault();
    setError(undefined);
    setBusy(true);

    void (async (): Promise<void> => {
      try {
        await changePassword(currentPassword, newPassword);
        close();
        setNote('Password changed. Your other sessions are still signed in.');
      } catch (cause: unknown) {
        setError(toMessage(cause));
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <>
      <PanelRow
        title={
          <span className="flex items-center gap-3">
            <Avatar
              displayName={user.displayName}
              avatarUrl={user.avatarUrl}
              size="medium"
              isAccented
            />
            <span className="flex flex-col gap-1">
              <span className="flex items-center gap-2.5">
                <span className="text-base font-medium">{user.displayName}</span>
                <Badge tone="accent">
                  <span className="capitalize">{user.role}</span>
                </Badge>
              </span>
              <span className="font-mono text-[13px] font-normal text-foreground-muted">
                {user.username}
              </span>
            </span>
          </span>
        }
        control={
          <Button
            variant="ghost"
            className="h-8 px-3 text-[13px]"
            onClick={() => {
              setDisplayName(user.displayName);
              setEmail('');
              setError(undefined);
              setNote(undefined);
              setOpen('profile');
            }}
          >
            Edit profile
          </Button>
        }
      />

      <PanelRow
        title="Password"
        note={note === undefined ? 'At least twelve characters, and no other rules.' : undefined}
        control={
          <Button
            variant="ghost"
            className="h-8 px-3 text-[13px]"
            onClick={() => {
              setError(undefined);
              setNote(undefined);
              setOpen('password');
            }}
          >
            Change password
          </Button>
        }
      >
        {note === undefined ? null : (
          <p role="status" className="text-[13px] text-success">
            {note}
          </p>
        )}
      </PanelRow>

      <Modal
        isOpen={open === 'profile'}
        onClose={close}
        title="Edit profile"
        description="Your username cannot be changed; it is what the audit trail records."
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" form="profile-form" isBusy={isBusy}>
              Save
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-5">
          <AvatarPicker
            userId={user.id}
            displayName={user.displayName}
            avatarUrl={user.avatarUrl}
            onChanged={refreshUser}
          />

          <form
            id="profile-form"
            className="flex flex-col gap-4"
            onSubmit={onSubmitProfile}
            noValidate
          >
            <TextField
              label="Display name"
              value={displayName}
              onChange={(event) => {
                setDisplayName(event.target.value);
              }}
              required
            />

            <TextField
              label="Email"
              type="email"
              value={email}
              hint="Optional, and used for nothing but recognising you. Leave it blank to keep what is there."
              onChange={(event) => {
                setEmail(event.target.value);
              }}
            />

            {error === undefined ? null : (
              <span role="alert" className="text-[13px] text-danger">
                {error}
              </span>
            )}
          </form>
        </div>
      </Modal>

      <Modal
        isOpen={open === 'password'}
        onClose={close}
        title="Change password"
        description="Length is the only axis that costs an attacker anything, so length is the only thing asked for."
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="password-form"
              isBusy={isBusy}
              disabled={!isPasswordAcceptable(newPassword)}
            >
              Change it
            </Button>
          </>
        }
      >
        <form
          id="password-form"
          className="flex flex-col gap-4"
          onSubmit={onSubmitPassword}
          noValidate
        >
          <PasswordField
            label="Current password"
            autoComplete="current-password"
            hasRules={false}
            value={currentPassword}
            onChange={setCurrentPassword}
            required
          />

          <PasswordField
            label="New password"
            autoComplete="new-password"
            value={newPassword}
            onChange={setNewPassword}
            required
          />

          {error === undefined ? null : (
            <span role="alert" className="text-[13px] text-danger">
              {error}
            </span>
          )}
        </form>
      </Modal>
    </>
  );
}
