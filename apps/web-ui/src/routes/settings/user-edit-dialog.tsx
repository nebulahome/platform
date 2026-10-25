/**
 * Editing somebody's account (board N-Settings-User-Edit), from People › Users and from the
 * people of a role in People › Roles - the same dialog from both, so a pencil means one thing.
 *
 * The display name, the role (with what it allows), and whether they may sign in; the username is
 * shown fixed, because the audit trail records it. Delete account sits at the foot, behind a
 * confirmation. A person cannot change their own role or refuse their own sign-in here: the API
 * refuses it too, and this keeps an owner from locking themselves out with one click.
 *
 * Changing anything needs `user:manage`; the callers only offer the pencil to whoever has it.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type SubmitEventHandler } from 'react';
import { useTranslation } from 'react-i18next';

import type { UserView } from '@nebulahome/contracts';
import { AppIcon, Button, Modal, Pill, Segmented, SelectField, TextField } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { Avatar } from '@/components/avatar';
import { toMessage } from '@/lib/error-message';
import { relativeTime } from '@/lib/format-time';
import { roleDescription, roleName } from '@/lib/role-names';
import { AvatarPicker } from '@/routes/settings/avatar-picker';
import { SETTINGS_QUERY_KEYS, deleteUser, fetchRoles, updateUser } from '@/settings/api';

/** What the dialog needs. */
export type UserEditDialogProps = {
  /** Whose account; null keeps the dialog shut. */
  readonly user: UserView | null;

  /** Called once it is closed, saved or deleted. */
  readonly onClose: () => void;
};

/**
 * Renders the dialog for one account. Keyed on the account by the caller's `user`, so each opening
 * starts from what the account holds.
 *
 * @param props - See {@link UserEditDialogProps}.
 * @returns The dialog.
 */
export function UserEditDialog(props: UserEditDialogProps) {
  const { user, onClose } = props;

  return user === null ? null : <EditForm key={user.id} user={user} onClose={onClose} />;
}

/**
 * The dialog itself, for an account that is there.
 *
 * @param props - The account and how to close.
 * @param props.user - Whose account.
 * @param props.onClose - Called once it is closed.
 * @returns The dialog, and its delete confirmation.
 */
function EditForm(props: { readonly user: UserView; readonly onClose: () => void }) {
  const { t } = useTranslation();
  const { user, onClose } = props;
  const selfId = useSession((state) => state.user?.id);
  const queryClient = useQueryClient();
  const isSelf = user.id === selfId;

  const [displayName, setDisplayName] = useState(user.displayName);
  const [role, setRole] = useState(user.role);
  const [isActive, setActive] = useState(user.isActive);
  const [isDeleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const roles = useQuery({
    queryKey: SETTINGS_QUERY_KEYS.roles,

    /**
     * Reads the roles, for the picker.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the request when the dialog goes away.
     * @returns Every role.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchRoles(signal),
  });
  const chosen = (roles.data ?? []).find((entry) => entry.key === role);

  const change = useMutation({
    /**
     * Runs the save or the deletion.
     *
     * @param run - The call to make.
     */
    mutationFn: async (run: () => Promise<unknown>): Promise<void> => {
      await run();
    },

    /**
     * Reloads the people and the roles' counts, and closes.
     */
    onSuccess: async (): Promise<void> => {
      await queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEYS.users });
      await queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEYS.roles });
      onClose();
    },

    /**
     * Reports the refusal without closing, so what was typed is not lost.
     *
     * @param cause - Whatever was thrown.
     */
    onError: (cause: unknown): void => {
      setError(toMessage(cause));
    },
  });

  /**
   * Saves the change.
   *
   * @param event - The submit event, whose default navigation is prevented.
   */
  const onSave: SubmitEventHandler<HTMLFormElement> = (event): void => {
    event.preventDefault();
    setError(undefined);
    change.mutate(async () => updateUser(user.id, { displayName, role, isActive }));
  };

  return (
    <>
      <Modal
        isOpen={!isDeleting}
        onClose={onClose}
        layout="card"
        size="form"
        lead={<Avatar displayName={user.displayName} avatarUrl={user.avatarUrl} />}
        title={t('settings.people.editTitle', 'Edit {{name}}', { name: user.displayName })}
        description={`${roleName(user.role, (roles.data ?? []).find((entry) => entry.key === user.role)?.name)} · ${
          user.lastLoginAt === null
            ? t('settings.people.neverSignedIn', 'never signed in')
            : t('settings.people.lastSeenWhen', 'last seen {{when}}', {
                when: relativeTime(user.lastLoginAt),
              })
        }`}
        footer={
          <>
            {isSelf ? (
              <span />
            ) : (
              <Button
                variant="danger"
                onClick={() => {
                  setError(undefined);
                  setDeleting(true);
                }}
              >
                <AppIcon id="trash-2" size={16} />
                {t('settings.people.deleteAccount', 'Delete account')}
              </Button>
            )}
            <span className="flex items-center gap-2">
              <Button variant="bare" onClick={onClose}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button type="submit" form="user-edit-form" isBusy={change.isPending}>
                {t('common.save', 'Save')}
              </Button>
            </span>
          </>
        }
      >
        <div className="flex flex-col gap-5">
          <AvatarPicker
            userId={user.id}
            displayName={user.displayName}
            avatarUrl={user.avatarUrl}
            onChanged={async () =>
              queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEYS.users })
            }
          />

          <form id="user-edit-form" className="flex flex-col gap-5" onSubmit={onSave} noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label={t('settings.profile.displayName', 'Display name')}
                value={displayName}
                onChange={(event) => {
                  setDisplayName(event.target.value);
                }}
                required
              />
              <TextField
                label={t('settings.people.username', 'Username')}
                value={user.username}
                readOnly
                hint={t('settings.people.usernameFixed', 'Fixed once the account exists.')}
              />
            </div>

            <SelectField
              label={t('settings.people.role', 'Role')}
              value={role}
              disabled={isSelf}
              options={(roles.data ?? []).map((entry) => ({
                value: entry.key,
                label: roleName(entry.key, entry.name),
              }))}
              hint={
                isSelf
                  ? t(
                      'settings.people.ownRole',
                      'Your own role is not yours to change; another administrator can.',
                    )
                  : chosen === undefined
                    ? undefined
                    : roleDescription(chosen.key, chosen.description)
              }
              onChange={setRole}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <span className="text-caption font-medium text-foreground-muted">
                  {t('settings.people.signIn', 'Sign-in')}
                </span>
                <Segmented
                  label={t('settings.people.signIn', 'Sign-in')}
                  isFilled
                  disabled={isSelf}
                  value={isActive ? 'active' : 'disabled'}
                  options={[
                    { value: 'active', label: t('settings.people.allowed', 'Allowed') },
                    { value: 'disabled', label: t('settings.people.refused', 'Refused') },
                  ]}
                  onChange={(next) => {
                    setActive(next === 'active');
                  }}
                />
                <span className="text-caption text-foreground-subtle">
                  {t('settings.people.refusedNote', 'Refused keeps the account, without sign-in.')}
                </span>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-caption font-medium text-foreground-muted">
                  {t('settings.people.twoFactorTitle', 'Two-factor')}
                </span>
                <span className="flex h-control-field items-center rounded-field border border-border-strong bg-surface-raised px-3">
                  <Pill
                    tone={user.isTwoFactorEnabled ? 'success' : 'neutral'}
                    className="border-transparent bg-transparent px-0"
                  >
                    {user.isTwoFactorEnabled
                      ? t('settings.people.twoFactorOn', 'On')
                      : t('settings.people.twoFactorOff', 'Off')}
                  </Pill>
                </span>
                <span className="text-caption text-foreground-subtle">
                  {t(
                    'settings.people.twoFactorNote',
                    'Each person sets it up from their own account.',
                  )}
                </span>
              </div>
            </div>

            {error === undefined ? null : (
              <span role="alert" className="text-ui text-danger">
                {error}
              </span>
            )}
          </form>
        </div>
      </Modal>

      <Modal
        isOpen={isDeleting}
        onClose={() => {
          setDeleting(false);
        }}
        size="small"
        title={t('settings.people.deleteTitle', 'Delete this account?')}
        description={t(
          'settings.people.deleteNote',
          'Their sessions end immediately. The audit trail keeps their name, because a record that forgets who did something is not one.',
        )}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setDeleting(false);
              }}
            >
              {t('common.keepIt', 'Keep it')}
            </Button>
            <Button
              variant="danger"
              isBusy={change.isPending}
              onClick={() => {
                change.mutate(async () => deleteUser(user.id));
              }}
            >
              {t('common.delete', 'Delete')}
            </Button>
          </>
        }
      >
        {error === undefined ? (
          <p className="font-mono text-ui text-foreground-muted">@{user.username}</p>
        ) : (
          <span role="alert" className="text-ui text-danger">
            {error}
          </span>
        )}
      </Modal>
    </>
  );
}
