/**
 * Who you are, and the two things you can change about it here.
 *
 * Editing the profile and changing the password are separate acts behind separate dialogs, and
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
import { Badge } from '@/components/badge';
import { Modal } from '@/components/modal';
import { toMessage } from '@/lib/error-message';
import { toInitials } from '@/lib/initials';
import { changePassword, updateUser } from '@/settings/api';

/** Which dialog is open, if any. */
type OpenDialog = 'profile' | 'password' | null;

/** The floor the API enforces, restated so the form can say so before it is submitted. */
const PASSWORD_MINIMUM = 12;

/**
 * Renders the profile card and its two dialogs.
 *
 * @returns The card.
 */
export function ProfilePanel() {
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
   * Opens the profile dialog with the current values already in it.
   */
  const openProfile = (): void => {
    setDisplayName(user.displayName);
    setEmail('');
    setError(undefined);
    setNote(undefined);
    setOpen('profile');
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
        await updateUser(user.id, {
          displayName,
          ...(email === '' ? {} : { email }),
        });
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
      <section className="flex items-center gap-4 rounded-panel border border-border bg-surface p-4">
        <span className="flex size-[52px] shrink-0 items-center justify-center rounded-full bg-primary text-lg font-medium text-primary-foreground">
          {toInitials(user.displayName)}
        </span>

        <div className="flex min-w-0 grow flex-col gap-1">
          <div className="flex items-center gap-2.5">
            <span className="truncate text-base font-medium">{user.displayName}</span>
            <Badge tone="accent">
              <span className="capitalize">{user.role}</span>
            </Badge>
          </div>
          <span className="truncate font-mono text-[13px] text-foreground-muted">
            {user.username}
          </span>
        </div>

        <div className="flex shrink-0 gap-2">
          <Button variant="ghost" className="h-8 px-3 text-[13px]" onClick={openProfile}>
            Edit profile
          </Button>
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
        </div>
      </section>

      {note === undefined ? null : (
        <p role="status" className="text-[13px] text-success">
          {note}
        </p>
      )}

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
      </Modal>

      <Modal
        isOpen={open === 'password'}
        onClose={close}
        title="Change password"
        description="At least twelve characters, and no other rules. Length is the only axis that costs an attacker anything."
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="password-form"
              isBusy={isBusy}
              disabled={newPassword.length < PASSWORD_MINIMUM}
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
          <TextField
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => {
              setCurrentPassword(event.target.value);
            }}
            required
          />

          <TextField
            label="New password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => {
              setNewPassword(event.target.value);
            }}
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
