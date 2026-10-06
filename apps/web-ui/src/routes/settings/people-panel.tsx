/**
 * Everyone with an account.
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

import type { UserView } from '@nebulahome/contracts';
import { Badge, Button, Modal, Panel, Segmented, SelectField, TextField } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { Avatar } from '@/components/avatar';
import { CheckIcon, WarningIcon } from '@/components/icons';
import { PasswordField } from '@/components/password-field';
import { toMessage } from '@/lib/error-message';
import { absoluteTime, relativeTime } from '@/lib/format-time';
import { isPasswordAcceptable } from '@/lib/password-rules';
import { matchesQuery } from '@/lib/search-text';
import { useListState } from '@/lib/use-list-state';
import { OPEN_PEOPLE_FILTER, PEOPLE_FILTER_CODEC } from '@/library/list-filters';
import { Facet, facetChoices, FilterSheet } from '@/routes/library/filter-sheet';
import { NoMatches } from '@/routes/library/no-matches';
import { SearchField } from '@/routes/library/search-field';
import { AvatarPicker } from '@/routes/settings/avatar-picker';
import {
  SETTINGS_QUERY_KEYS,
  createUser,
  deleteUser,
  fetchRoles,
  fetchUsers,
  updateUser,
} from '@/settings/api';

/** The column widths, shared by the header and every row so they line up. */
const COLUMNS = 'grid grid-cols-[1fr_110px_78px_100px_150px] items-center gap-3 px-4';

/** The tone each built-in role is shown in. Anything else is neutral. */
const ROLE_TONES: Readonly<Record<string, 'accent' | 'success' | 'neutral'>> = {
  owner: 'accent',
  admin: 'success',
};

/** Which dialog is open, if any. */
type OpenDialog =
  /** Nothing. */
  | { readonly kind: 'none' }

  /** Making a new account. */
  | { readonly kind: 'invite' }

  /** Changing an existing one. */
  | { readonly kind: 'edit'; readonly user: UserView }

  /** Confirming a deletion. */
  | { readonly kind: 'delete'; readonly user: UserView };

/**
 * Renders the people panel.
 *
 * @returns The panel.
 */
export function PeoplePanel() {
  const can = useSession((state) => state.can);
  const selfId = useSession((state) => state.user?.id);
  const queryClient = useQueryClient();
  const canManage = can('user:manage');

  const [dialog, setDialog] = useState<OpenDialog>({ kind: 'none' });
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('member');
  const [isActive, setActive] = useState(true);
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
        locale: 'en',
        timezone: 'UTC',

        // The password typed here is chosen by whoever is doing the inviting, so the person it
        // belongs to has to replace it before it means anything.
        mustChangePassword: true,
      }),
    );
  };

  /**
   * Saves a change to an account.
   *
   * @param event - The submit event, whose default navigation is prevented.
   */
  const onEdit: SubmitEventHandler<HTMLFormElement> = (event): void => {
    event.preventDefault();
    setError(undefined);

    if (dialog.kind !== 'edit') {
      return;
    }

    const { id } = dialog.user;

    changes.mutate(async () => updateUser(id, { displayName, role, isActive }));
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
    (roles.data ?? []).map((entry) => ({ value: entry.key, label: entry.name })),
    filter.role,
    'Any role',
  );

  return (
    <>
      <Panel
        title="Users and roles"
        action={
          <span className="flex items-center gap-2">
            <SearchField
              placeholder="Search people…"
              className="w-40 lg:w-56"
              value={filter.search}
              onChange={(search) => {
                setFilter({ ...filter, search });
              }}
            />
            <FilterSheet
              label="Narrow the people"
              count={Number(filter.role !== '') + Number(filter.status !== 'any')}
              onClear={() => {
                setFilter({ ...filter, role: '', status: 'any' });
              }}
            >
              <Facet title="Role">
                <SelectField
                  label="Role"
                  isLabelHidden
                  size="compact"
                  options={roleOptions}
                  value={filter.role}
                  onChange={(value) => {
                    setFilter({ ...filter, role: value });
                  }}
                />
              </Facet>
              <Facet title="Account">
                <Segmented
                  label="Account"
                  size="compact"
                  className="self-start"
                  options={[
                    { value: 'any', label: 'Any' },
                    { value: 'active', label: 'Active' },
                    { value: 'disabled', label: 'Disabled' },
                  ]}
                  value={filter.status}
                  onChange={(status) => {
                    setFilter({ ...filter, status });
                  }}
                />
              </Facet>
            </FilterSheet>
            {canManage ? (
              <Button
                size="compact"
                onClick={() => {
                  setError(undefined);
                  setRole('member');
                  setDialog({ kind: 'invite' });
                }}
              >
                Invite person
              </Button>
            ) : null}
          </span>
        }
      >
        <div className={`${COLUMNS} border-b border-border py-2.5`}>
          <span className="font-mono text-label text-foreground-subtle uppercase">Person</span>
          <span className="font-mono text-label text-foreground-subtle uppercase">Role</span>
          <span className="font-mono text-label text-foreground-subtle uppercase">2FA</span>
          <span className="font-mono text-label text-foreground-subtle uppercase">Last seen</span>
          <span />
        </div>

        {users.isPending ? (
          <p className="px-4 py-4 text-ui text-foreground-subtle">Reading the accounts…</p>
        ) : null}

        {users.isError ? (
          <p role="alert" className="px-4 py-4 text-ui text-danger">
            {toMessage(users.error)}
          </p>
        ) : null}

        {!users.isPending && people.length > 0 && shown.length === 0 ? (
          <div className="p-4">
            <NoMatches
              query={filter.search}
              onClear={() => {
                setFilter(OPEN_PEOPLE_FILTER);
              }}
            />
          </div>
        ) : null}

        {shown.map((person) => (
          <div
            key={person.id}
            className={`${COLUMNS} border-b border-border py-2.5 last:border-b-0`}
          >
            <div className="flex min-w-0 items-center gap-3">
              <Avatar displayName={person.displayName} avatarUrl={person.avatarUrl} />
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-ui text-foreground">
                  {person.displayName}
                  {person.isActive ? '' : ' · disabled'}
                </span>
                <span className="truncate font-mono text-caption text-foreground-subtle">
                  {person.email ?? person.username}
                </span>
              </div>
            </div>

            <Badge tone={ROLE_TONES[person.role] ?? 'neutral'}>
              <span className="capitalize">{person.role}</span>
            </Badge>

            {person.isTwoFactorEnabled ? (
              <span className="flex items-center gap-1.5 text-caption text-success">
                <CheckIcon width="13" height="13" />
                On
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-caption text-warning">
                <WarningIcon width="13" height="13" />
                Off
              </span>
            )}

            <span
              className="text-caption text-foreground-subtle"
              title={person.lastLoginAt === null ? undefined : absoluteTime(person.lastLoginAt)}
            >
              {person.lastLoginAt === null ? 'never' : relativeTime(person.lastLoginAt)}
            </span>

            <div className="flex justify-end gap-2">
              {canManage ? (
                <Button
                  variant="ghost"
                  size="compact"
                  onClick={() => {
                    setError(undefined);
                    setDisplayName(person.displayName);
                    setRole(person.role);
                    setActive(person.isActive);
                    setDialog({ kind: 'edit', user: person });
                  }}
                >
                  Edit
                </Button>
              ) : null}

              {canManage && person.id !== selfId ? (
                <Button
                  variant="danger"
                  size="compact"
                  onClick={() => {
                    setError(undefined);
                    setDialog({ kind: 'delete', user: person });
                  }}
                >
                  Delete
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </Panel>

      <Modal
        isOpen={dialog.kind === 'invite'}
        onClose={close}
        title="Invite someone"
        description="They sign in with the password you set here, and have to replace it the first time."
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="invite-form"
              isBusy={changes.isPending}
              disabled={!isPasswordAcceptable(password)}
            >
              Create account
            </Button>
          </>
        }
      >
        <form id="invite-form" className="flex flex-col gap-4" onSubmit={onInvite} noValidate>
          <TextField
            label="Username"
            value={username}
            hint="Lower case letters, digits, dot, dash and underscore."
            onChange={(event) => {
              setUsername(event.target.value);
            }}
            required
          />

          <TextField
            label="Display name"
            value={displayName}
            onChange={(event) => {
              setDisplayName(event.target.value);
            }}
            required
          />

          <PasswordField
            label="First password"
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
            required
          />

          <SelectField
            label="Role"
            value={role}
            options={(roles.data ?? []).map((entry) => ({
              value: entry.key,
              label: entry.name,
            }))}
            onChange={setRole}
          />

          {error === undefined ? null : (
            <span role="alert" className="text-ui text-danger">
              {error}
            </span>
          )}
        </form>
      </Modal>

      <Modal
        isOpen={dialog.kind === 'edit'}
        onClose={close}
        title={dialog.kind === 'edit' ? dialog.user.displayName : 'Edit account'}
        description={
          dialog.kind === 'edit' && dialog.user.id === selfId
            ? 'This is your own account, so its role and whether it is active are not yours to change here.'
            : 'Disabling an account refuses every sign-in without deleting it, or its audit trail.'
        }
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" form="edit-form" isBusy={changes.isPending}>
              Save
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-5">
          {dialog.kind === 'edit' ? (
            <AvatarPicker
              userId={dialog.user.id}
              displayName={dialog.user.displayName}
              avatarUrl={dialog.user.avatarUrl}
              onChanged={async () =>
                queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEYS.users })
              }
            />
          ) : null}

          <form id="edit-form" className="flex flex-col gap-4" onSubmit={onEdit} noValidate>
            <TextField
              label="Display name"
              value={displayName}
              onChange={(event) => {
                setDisplayName(event.target.value);
              }}
              required
            />

            <SelectField
              label="Role"
              value={role}
              disabled={dialog.kind === 'edit' && dialog.user.id === selfId}
              options={(roles.data ?? []).map((entry) => ({
                value: entry.key,
                label: entry.name,
              }))}
              onChange={setRole}
            />

            <SelectField
              label="Sign-in"
              value={isActive ? 'active' : 'disabled'}
              disabled={dialog.kind === 'edit' && dialog.user.id === selfId}
              options={[
                { value: 'active', label: 'Allowed' },
                { value: 'disabled', label: 'Refused' },
              ]}
              onChange={(next) => {
                setActive(next === 'active');
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

      <Modal
        isOpen={dialog.kind === 'delete'}
        onClose={close}
        title="Delete this account?"
        description="Their sessions end immediately. The audit trail keeps their name, because a record that forgets who did something is not one."
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Keep it
            </Button>
            <Button
              variant="danger"
              isBusy={changes.isPending}
              onClick={() => {
                if (dialog.kind === 'delete') {
                  const { id } = dialog.user;

                  changes.mutate(async () => deleteUser(id));
                }
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        {error === undefined ? (
          <p className="text-ui text-foreground-muted">
            {dialog.kind === 'delete' ? dialog.user.username : ''}
          </p>
        ) : (
          <span role="alert" className="text-ui text-danger">
            {error}
          </span>
        )}
      </Modal>
    </>
  );
}
