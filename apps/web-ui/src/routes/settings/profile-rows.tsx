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
import { useTranslation } from 'react-i18next';

import { Badge, Button, Modal, PanelRow, TextField } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { Avatar } from '@/components/avatar';
import { PasswordField } from '@/components/password-field';
import { toMessage } from '@/lib/error-message';
import { isPasswordAcceptable } from '@/lib/password-rules';
import { roleName } from '@/lib/role-names';
import { AvatarPicker } from '@/routes/settings/avatar-picker';
import { changePassword, updateUser } from '@/settings/api';

/** Which dialog is open, if any. */
type OpenDialog = 'profile' | 'password' | null;

/**
 * A confirmation, and which row earned it.
 *
 * The row is part of the value rather than a second piece of state beside it. Two separate
 * `useState` calls can disagree - and they did: one note and two rows meant the profile's
 * confirmation was drawn under the password, because that is where the only note lived.
 */
type Note = {
  /** Where it belongs. */
  readonly row: 'profile' | 'password';

  /** What happened. */
  readonly text: string;
};

/** What the rows need. */
type ProfileRowsProps = {
  /** Which row: who you are, under Profile, or the password, under Security. */
  readonly part: 'profile' | 'password';
};

/**
 * Renders the identity row or the password row, and the dialog behind it.
 *
 * @param props - See {@link ProfileRowsProps}.
 * @returns The row.
 */
export function ProfileRows(props: ProfileRowsProps) {
  const { t } = useTranslation();
  const { part } = props;
  const user = useSession((state) => state.user);
  const refreshUser = useSession((state) => state.refreshUser);
  const [open, setOpen] = useState<OpenDialog>(null);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [isBusy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | undefined>(undefined);

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
        setNote({ row: 'profile', text: t('settings.profile.updated', 'Profile updated.') });
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
        setNote({
          row: 'password',
          text: t(
            'settings.password.changed',
            'Password changed. Your other sessions are still signed in.',
          ),
        });
      } catch (cause: unknown) {
        setError(toMessage(cause));
      } finally {
        setBusy(false);
      }
    })();
  };

  return part === 'profile' ? (
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
                <span className="text-subhead font-medium">{user.displayName}</span>
                <Badge tone="accent">{roleName(user.role)}</Badge>
              </span>
              <span className="font-mono text-ui font-normal text-foreground-muted">
                {user.username}
              </span>
            </span>
          </span>
        }
        control={
          <Button
            variant="ghost"
            size="compact"
            onClick={() => {
              setDisplayName(user.displayName);
              setEmail('');
              setError(undefined);
              setNote(undefined);
              setOpen('profile');
            }}
          >
            {t('settings.profile.edit', 'Edit profile')}
          </Button>
        }
      >
        {note?.row === 'profile' ? <Confirmation>{note.text}</Confirmation> : null}
      </PanelRow>

      <Modal
        isOpen={open === 'profile'}
        onClose={close}
        title={t('settings.profile.edit', 'Edit profile')}
        description={t(
          'settings.profile.editNote',
          'Your username cannot be changed; it is what the audit trail records.',
        )}
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button type="submit" form="profile-form" isBusy={isBusy}>
              {t('common.save', 'Save')}
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
              label={t('settings.profile.displayName', 'Display name')}
              value={displayName}
              onChange={(event) => {
                setDisplayName(event.target.value);
              }}
              required
            />

            <TextField
              label={t('settings.profile.email', 'Email')}
              type="email"
              value={email}
              hint={t(
                'settings.profile.emailHint',
                'Optional, and used for nothing but recognising you. Leave it blank to keep what is there.',
              )}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
            />

            {error === undefined ? null : (
              <span role="alert" className="text-ui text-danger">
                {error}
              </span>
            )}
          </form>
        </div>
      </Modal>
    </>
  ) : (
    <>
      <PanelRow
        title={t('settings.password.title', 'Password')}
        // The row's own note stays whatever else has happened: it says what a password has to be,
        // which is still true after one was changed. A confirmation is an extra line, not a
        // replacement for the explanation the row exists to give.
        note={t('settings.password.note', 'At least twelve characters, and no other rules.')}
        control={
          <Button
            variant="ghost"
            size="compact"
            onClick={() => {
              setError(undefined);
              setNote(undefined);
              setOpen('password');
            }}
          >
            {t('settings.password.change', 'Change password')}
          </Button>
        }
      >
        {note?.row === 'password' ? <Confirmation>{note.text}</Confirmation> : null}
      </PanelRow>

      <Modal
        isOpen={open === 'password'}
        onClose={close}
        title={t('settings.password.change', 'Change password')}
        description={t(
          'settings.password.changeNote',
          'Length is the only axis that costs an attacker anything, so length is the only thing asked for.',
        )}
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              type="submit"
              form="password-form"
              isBusy={isBusy}
              disabled={!isPasswordAcceptable(newPassword)}
            >
              {t('settings.password.changeIt', 'Change it')}
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
            label={t('settings.password.current', 'Current password')}
            autoComplete="current-password"
            hasRules={false}
            value={currentPassword}
            onChange={setCurrentPassword}
            required
          />

          <PasswordField
            label={t('settings.password.new', 'New password')}
            autoComplete="new-password"
            value={newPassword}
            onChange={setNewPassword}
            required
          />

          {error === undefined ? null : (
            <span role="alert" className="text-ui text-danger">
              {error}
            </span>
          )}
        </form>
      </Modal>
    </>
  );
}

/** What a confirmation needs. */
type ConfirmationProps = {
  /** What happened. */
  readonly children: string;
};

/**
 * The line a row shows after its own action succeeded.
 *
 * `role="status"` rather than `role="alert"`: nothing has gone wrong, and an assertive
 * announcement would interrupt whatever a screen reader was in the middle of saying to report
 * good news.
 *
 * @param props - See {@link ConfirmationProps}.
 * @returns The line.
 */
function Confirmation(props: ConfirmationProps) {
  const { children } = props;

  return (
    <p role="status" className="text-ui text-success">
      {children}
    </p>
  );
}
