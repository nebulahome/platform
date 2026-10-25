/**
 * People › Users (board N-Settings-Users): everyone with an account, as cards.
 *
 * Reading the list needs `user:read` and changing anything needs `user:manage`, so the table is
 * shown to more people than the buttons are. That split is the API's, restated here: an
 * administrator can see who has an account without being able to change what they may do.
 *
 * A person cannot change their own role or deactivate themselves from this table, and the check
 * is not a courtesy - it is the last rung of a ladder nobody should be able to climb. The API
 * refuses it too; what this prevents is an owner locking themselves out with one click and no
 * warning.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type SubmitEventHandler } from 'react';
import { useTranslation } from 'react-i18next';

import type { UserView } from '@nebulahome/contracts';
import {
  AppIcon,
  Badge,
  Button,
  IconButton,
  Modal,
  Segmented,
  SelectField,
  TextField,
  cn,
} from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { Avatar } from '@/components/avatar';
import { PasswordField } from '@/components/password-field';
import { toMessage } from '@/lib/error-message';
import { isPasswordAcceptable } from '@/lib/password-rules';
import { roleName } from '@/lib/role-names';
import { matchesQuery } from '@/lib/search-text';
import { useListState } from '@/lib/use-list-state';
import { OPEN_PEOPLE_FILTER, PEOPLE_FILTER_CODEC } from '@/library/list-filters';
import { Facet, facetChoices, FilterSheet } from '@/routes/library/filter-sheet';
import { NoMatches } from '@/routes/library/no-matches';
import { SearchField } from '@/routes/library/search-field';
import { SettingsPage } from '@/routes/settings/settings-ui';
import { UserEditDialog } from '@/routes/settings/user-edit-dialog';
import { SETTINGS_QUERY_KEYS, createUser, fetchRoles, fetchUsers } from '@/settings/api';

/** The tone each built-in role is shown in. Anything else is neutral. */
const ROLE_TONES: Readonly<Record<string, 'accent' | 'success' | 'neutral'>> = {
  owner: 'accent',
};

/** Which dialog is open, if any. */
type OpenDialog =
  /** Nothing. */
  | { readonly kind: 'none' }

  /** Making a new account. */
  | { readonly kind: 'invite' }

  /** Changing an existing one. */
  | { readonly kind: 'edit'; readonly user: UserView };

/**
 * Renders the people panel.
 *
 * @returns The panel.
 */
export function PeoplePanel() {
  const { t } = useTranslation();
  const can = useSession((state) => state.can);
  const queryClient = useQueryClient();
  const canManage = can('user:manage');

  const [dialog, setDialog] = useState<OpenDialog>({ kind: 'none' });
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('member');
  const [filter, setFilter] = useListState(PEOPLE_FILTER_CODEC);
  const [error, setError] = useState<string | undefined>(undefined);

  const users = useQuery({
    queryKey: SETTINGS_QUERY_KEYS.users,

    /**
     * Reads everyone with an account.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the request when the component goes away.
     * @returns Every living account.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchUsers(signal),
  });

  const roles = useQuery({
    queryKey: SETTINGS_QUERY_KEYS.roles,

    /**
     * Reads the roles, for the picker.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the request when the component goes away.
     * @returns Every role.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchRoles(signal),
  });

  /**
   * Closes the dialog and forgets what was typed into it.
   */
  const close = (): void => {
    setDialog({ kind: 'none' });
    setUsername('');
    setDisplayName('');
    setPassword('');
    setError(undefined);
  };

  const changes = useMutation({
    /**
     * Runs whichever change the open dialog describes.
     *
     * @param run - The call to make.
     */
    mutationFn: async (run: () => Promise<unknown>): Promise<void> => {
      await run();
    },

    /**
     * Reloads the list and closes the dialog.
     */
    onSuccess: async (): Promise<void> => {
      await queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEYS.users });
      await queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEYS.roles });
      close();
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
   * Creates an account.
   *
   * @param event - The submit event, whose default navigation is prevented.
   */
  const onInvite: SubmitEventHandler<HTMLFormElement> = (event): void => {
    event.preventDefault();
    setError(undefined);
    changes.mutate(async () =>
      createUser({
        username,
        displayName,
        password,
        role,

        // No language: they follow the house's until they choose their own.
        locale: null,
        timezone: 'UTC',

        // The password typed here is chosen by whoever is doing the inviting, so the person it
        // belongs to has to replace it before it means anything.
        mustChangePassword: true,
      }),
    );
  };

  // By the name people see, which is how the rows read; the API answers by username.
  const people = [...(users.data ?? [])].sort((left, right) =>
    left.displayName.localeCompare(right.displayName),
  );
  const shown = people.filter(
    (person) =>
      (filter.role === '' || person.role === filter.role) &&
      (filter.status === 'any' || (filter.status === 'active') === person.isActive) &&
      matchesQuery([person.displayName, person.username, person.email, person.role], filter.search),
  );
  const roleOptions = facetChoices(
    (roles.data ?? []).map((entry) => ({
      value: entry.key,
      label: roleName(entry.key, entry.name),
    })),
    filter.role,
    t('settings.people.anyRole', 'Any role'),
  );
  const roleNames = new Map((roles.data ?? []).map((entry) => [entry.key, entry.name]));
  const roleChoices = (roles.data ?? []).map((entry) => ({
    value: entry.key,
    label: roleName(entry.key, entry.name),
  }));

  return (
    <SettingsPage path="/settings/people/users">
      <div className="flex flex-wrap items-center gap-2">
        <SearchField
          label={t('settings.people.searchLabel', 'Search users')}
          placeholder={t('settings.people.searchUsers', 'Search users')}
          className="w-65"
          value={filter.search}
          onChange={(search) => {
            setFilter({ ...filter, search });
          }}
        />
        <FilterSheet
          label={t('settings.people.narrow', 'Narrow the people')}
          count={Number(filter.role !== '') + Number(filter.status !== 'any')}
          onClear={() => {
            setFilter({ ...filter, role: '', status: 'any' });
          }}
        >
          <Facet title={t('settings.people.role', 'Role')}>
            <SelectField
              label={t('settings.people.role', 'Role')}
              isLabelHidden
              size="compact"
              options={roleOptions}
              value={filter.role}
              onChange={(value) => {
                setFilter({ ...filter, role: value });
              }}
            />
          </Facet>
          <Facet title={t('settings.people.account', 'Account')}>
            <Segmented
              label={t('settings.people.account', 'Account')}
              size="compact"
              className="self-start"
              options={[
                { value: 'any', label: t('common.any', 'Any') },
                { value: 'active', label: t('settings.people.active', 'Active') },
                { value: 'disabled', label: t('settings.people.disabled', 'Disabled') },
              ]}
              value={filter.status}
              onChange={(status) => {
                setFilter({ ...filter, status });
              }}
            />
          </Facet>
        </FilterSheet>
        <span className="grow" />
        {canManage ? (
          <Button
            onClick={() => {
              setError(undefined);
              setRole('member');
              setDialog({ kind: 'invite' });
            }}
          >
            <AppIcon id="user-plus" size={16} />
            {t('settings.people.inviteUser', 'Invite a user')}
          </Button>
        ) : null}
      </div>

      {users.isPending ? (
        <p className="text-ui text-foreground-subtle">
          {t('settings.people.reading', 'Reading the accounts…')}
        </p>
      ) : null}

      {users.isError ? (
        <p role="alert" className="text-ui text-danger">
          {toMessage(users.error)}
        </p>
      ) : null}

      {!users.isPending && people.length > 0 && shown.length === 0 ? (
        <NoMatches
          query={filter.search}
          onClear={() => {
            setFilter(OPEN_PEOPLE_FILTER);
          }}
        />
      ) : null}

      <ul
        aria-label={t('settings.people.list', 'People')}
        className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3.5"
      >
        {shown.map((person) => (
          <li
            key={person.id}
            className={cn(
              'flex min-w-0 flex-col gap-3.5 rounded-card border border-border bg-surface px-4.5 py-4 shadow-edge transition-colors duration-150 hover:border-border-strong',
              !person.isActive && 'opacity-70',
            )}
          >
            <div className="flex min-w-0 items-center gap-3">
              <Avatar
                displayName={person.displayName}
                avatarUrl={person.avatarUrl}
                isAccented={person.role === 'owner'}
              />
              <span className="flex min-w-0 grow flex-col gap-0.75">
                <span className="truncate text-ui font-medium text-foreground">
                  {person.displayName}
                </span>
                <span className="truncate text-ui-sm text-foreground-subtle">
                  @{person.username}
                  {person.isActive ? '' : ` · ${t('settings.people.disabledLower', 'disabled')}`}
                </span>
              </span>
              {canManage ? (
                <IconButton
                  label={t('settings.people.editPerson', 'Edit {{name}}', {
                    name: person.displayName,
                  })}
                  onClick={() => {
                    setDialog({ kind: 'edit', user: person });
                  }}
                >
                  <AppIcon id="pencil" size={15} />
                </IconButton>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <Badge tone={ROLE_TONES[person.role] ?? 'neutral'}>
                {roleName(person.role, roleNames.get(person.role))}
              </Badge>
              <span className="grow" />
              <span
                title={
                  person.isTwoFactorEnabled
                    ? t('settings.people.twoFactorOnTitle', 'Two-factor on')
                    : t('settings.people.twoFactorOffTitle', 'Two-factor off')
                }
                className={cn(
                  'inline-flex h-6 items-center gap-1.5 rounded-pill px-2 text-caption font-medium',
                  person.isTwoFactorEnabled
                    ? 'bg-success-soft text-success'
                    : 'bg-surface-raised text-foreground-subtle',
                )}
              >
                <AppIcon id={person.isTwoFactorEnabled ? 'shield-check' : 'shield-off'} size={13} />
                {t('settings.people.twoFactor', '2FA')}
              </span>
            </div>
          </li>
        ))}
      </ul>

      <Modal
        isOpen={dialog.kind === 'invite'}
        onClose={close}
        title={t('settings.people.inviteTitle', 'Invite someone')}
        description={t(
          'settings.people.inviteNote',
          'They sign in with the password you set here, and have to replace it the first time.',
        )}
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              type="submit"
              form="invite-form"
              isBusy={changes.isPending}
              disabled={!isPasswordAcceptable(password)}
            >
              {t('settings.people.createAccount', 'Create account')}
            </Button>
          </>
        }
      >
        <form id="invite-form" className="flex flex-col gap-4" onSubmit={onInvite} noValidate>
          <TextField
            label={t('settings.people.username', 'Username')}
            value={username}
            hint={t(
              'firstRun.account.usernameHint',
              'Lower case letters, digits, dot, dash and underscore.',
            )}
            onChange={(event) => {
              setUsername(event.target.value);
            }}
            required
          />

          <TextField
            label={t('settings.profile.displayName', 'Display name')}
            value={displayName}
            onChange={(event) => {
              setDisplayName(event.target.value);
            }}
            required
          />

          <PasswordField
            label={t('settings.people.firstPassword', 'First password')}
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
            required
          />

          <SelectField
            label={t('settings.people.role', 'Role')}
            value={role}
            options={roleChoices}
            onChange={setRole}
          />

          {error === undefined ? null : (
            <span role="alert" className="text-ui text-danger">
              {error}
            </span>
          )}
        </form>
      </Modal>

      <UserEditDialog user={dialog.kind === 'edit' ? dialog.user : null} onClose={close} />
    </SettingsPage>
  );
}
