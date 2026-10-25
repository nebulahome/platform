/**
 * People › Roles (boards N-Settings-Roles, N-Settings-Role-Custom): what each role allows, and who
 * holds it.
 *
 * One stack of rows, each opening in place. A built-in role (Owner, Admin, Member, Guest, Service)
 * is read-only - what `guest` means is the platform's answer, the same in every house - so its
 * permissions are shown and not offered: pointing at one shows a lock, and Duplicate starts a
 * custom role from it. A custom role's permissions are buttons: pressing one gives or takes it
 * away at once, and each group has Select all and Clear. Edit details and Delete open dialogs.
 *
 * The pencil beside each person opens the same Edit dialog as People › Users.
 *
 * Changing a role needs `role:manage`; nobody grants a permission they do not hold, which the API
 * enforces and this page mirrors by leaving those rows still. A change reaches people at their
 * next token refresh, within a quarter of an hour.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { IconView, RoleView, UserView } from '@nebulahome/contracts';
import { AppIcon, Button, IconButton, cn, toast } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { Avatar } from '@/components/avatar';
import { text } from '@/i18n/messages';
import { toMessage } from '@/lib/error-message';
import { relativeTime } from '@/lib/format-time';
import { PERMISSION_COUNT, PERMISSION_GROUPS, permissionLabel } from '@/lib/permission-labels';
import { roleDescription, roleName } from '@/lib/role-names';
import { useCatalogueIcons } from '@/routes/library/device-icon';
import { RoleDeleteDialog, RoleDialog, type RoleDialogMode } from '@/routes/settings/role-dialog';
import { RoleChip, RoleKindTag } from '@/routes/settings/role-parts';
import { SettingsPage, SettingsSection } from '@/routes/settings/settings-ui';
import { UserEditDialog } from '@/routes/settings/user-edit-dialog';
import { SETTINGS_QUERY_KEYS, fetchRoles, fetchUsers, updateRole } from '@/settings/api';

/** How many faces a row shows before it says "+N". */
const FACES = 3;

/**
 * The keys a role grants everywhere, the only grants this page shows or changes.
 *
 * @param role - The role.
 * @returns Its keys.
 */
function heldKeys(role: RoleView): Set<string> {
  return new Set(role.permissions.filter((grant) => grant.scope === '*').map((grant) => grant.key));
}

/** What one role row needs. */
type RoleRowProps = {
  readonly role: RoleView;
  readonly icon: IconView | undefined;
  readonly people: readonly UserView[];
  readonly isOpen: boolean;
  readonly isFirst: boolean;
  readonly canManage: boolean;
  readonly canEditPeople: boolean;
  readonly onToggle: () => void;
  readonly onDuplicate: () => void;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
  readonly onEditPerson: (person: UserView) => void;
};

/**
 * One role: its row, and what it opens into.
 *
 * @param props - See {@link RoleRowProps}.
 * @returns The row.
 */
function RoleRow(props: RoleRowProps) {
  const { t } = useTranslation();
  const { role, icon, people, isOpen, isFirst, canManage, canEditPeople } = props;
  const can = useSession((state) => state.can);
  const queryClient = useQueryClient();
  const held = heldKeys(role);
  const isOwner = role.key === 'owner';
  const heldCount = isOwner ? PERMISSION_COUNT : held.size;
  const isEditable = !role.isBuiltin && canManage;

  const change = useMutation({
    /**
     * Sends the role's whole new set of permissions.
     *
     * @param keys - The set.
     * @returns The role as it now stands.
     */
    mutationFn: async (keys: readonly string[]) => updateRole(role.id, { permissions: [...keys] }),

    /**
     * Shows the change before the server answers, so a press feels like a press.
     *
     * @param keys - The set.
     * @returns The roles as they were, to put back on a refusal.
     */
    onMutate: async (keys: readonly string[]) => {
      await queryClient.cancelQueries({ queryKey: SETTINGS_QUERY_KEYS.roles });

      const before = queryClient.getQueryData<RoleView[]>(SETTINGS_QUERY_KEYS.roles);

      queryClient.setQueryData<RoleView[]>(SETTINGS_QUERY_KEYS.roles, (roles) =>
        roles?.map((each) =>
          each.id === role.id
            ? {
                ...each,
                permissions: keys.map((key) => ({ key, scope: '*', effect: 'allow' as const })),
              }
            : each,
        ),
      );

      return { before };
    },

    /**
     * Puts the roles back, and says why.
     *
     * @param cause - Whatever was thrown.
     * @param refused - The set that was refused.
     * @param context - What was there before.
     */
    onError: (cause: unknown, refused, context) => {
      queryClient.setQueryData(SETTINGS_QUERY_KEYS.roles, context?.before);
      toast.error({
        title: t('settings.roles.changeFailed', 'Couldn’t change the role'),
        message: toMessage(cause),
      });
    },

    /**
     * Reads the roles again, whatever happened.
     */
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEYS.roles });
    },
  });

  /**
   * Gives or takes away some permissions.
   *
   * @param keys - Which.
   * @param isGiven - Whether the role should hold them.
   */
  const set = (keys: readonly string[], isGiven: boolean): void => {
    const next = new Set(held);

    for (const key of keys) {
      if (isGiven) {
        next.add(key);
      } else {
        next.delete(key);
      }
    }

    change.mutate([...next]);
  };

  return (
    <div className={cn(!isFirst && 'border-t border-border')}>
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={props.onToggle}
        className="group flex w-full flex-wrap items-center gap-x-5 gap-y-3 px-4.5 py-4 text-left transition-colors duration-150 hover:bg-surface-raised/30"
      >
        <span className="flex min-w-0 flex-[1_1_260px] items-center gap-3">
          <RoleChip icon={icon} isLit={isOpen} />
          <span className="flex min-w-0 flex-col gap-0.75">
            <span className="flex flex-wrap items-center gap-2 text-title font-medium text-foreground">
              {roleName(role.key, role.name)}
              <RoleKindTag isBuiltin={role.isBuiltin} />
            </span>
            <span className="truncate text-ui-sm text-foreground-subtle">
              {roleDescription(role.key, role.description)}
            </span>
          </span>
        </span>

        <span className="flex flex-[0_0_150px] flex-col gap-1.5">
          <span className="text-caption text-foreground-subtle tabular">
            <span className="font-mono text-foreground">{heldCount}</span>
            {` ${t('settings.roles.ofPermissions', 'of {{count}} permissions', {
              count: PERMISSION_COUNT,
            })}`}
          </span>
          <span className="h-1 overflow-hidden rounded-pill bg-surface-high">
            <span
              className={cn(
                'block h-full rounded-pill transition-[width,background-color] duration-300',
                isOpen ? 'bg-primary' : 'bg-foreground-muted',
              )}
              /* eslint-disable-next-line react/forbid-dom-props -- the bar's width is the share of permissions held. */
              style={{ width: `${String((heldCount / PERMISSION_COUNT) * 100)}%` }}
            />
          </span>
        </span>

        <span className="flex flex-[0_0_150px] items-center gap-2.5">
          {people.length === 0 ? (
            <span className="text-ui-sm text-foreground-subtle">
              {t('settings.roles.nobody', 'Nobody')}
            </span>
          ) : (
            <>
              <span className="flex items-center">
                {people.slice(0, FACES).map((person, index) => (
                  <Avatar
                    key={person.id}
                    displayName={person.displayName}
                    avatarUrl={person.avatarUrl}
                    isAccented={role.key === 'owner'}
                    className={cn('size-7 text-label ring-2 ring-surface', index > 0 && '-ml-2')}
                  />
                ))}
                {people.length > FACES ? (
                  <span className="-ml-2 flex size-7 items-center justify-center rounded-full bg-surface-high font-mono text-label text-foreground-muted ring-2 ring-surface">
                    +{people.length - FACES}
                  </span>
                ) : null}
              </span>
              <span className="text-ui-sm whitespace-nowrap text-foreground-muted">
                {t('settings.roles.people', {
                  count: people.length,
                  defaultValue_one: '{{count}} person',
                  defaultValue_other: '{{count}} people',
                })}
              </span>
            </>
          )}
        </span>

        <AppIcon
          id="chevron-right"
          size={16}
          className={cn(
            'ml-auto shrink-0 transition-[transform,color] duration-200',
            isOpen
              ? 'rotate-90 text-primary'
              : 'text-foreground-subtle group-hover:text-foreground-muted',
          )}
        />
      </button>

      <div
        className={cn(
          'grid transition-[grid-template-rows,opacity] duration-250 ease-out',
          isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
        inert={!isOpen}
      >
        <div className="overflow-hidden">
          <div className="flex flex-col gap-4.5 bg-surface-raised/25 pt-1 pr-4.5 pb-5 pl-4.5 sm:pl-16.5">
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5 rounded-tile border border-border bg-surface px-3.5 py-3">
              <AppIcon
                id={role.isBuiltin ? 'lock' : 'pencil'}
                size={15}
                className="text-foreground-subtle"
              />
              <span className="flex-[1_1_240px] text-ui-sm text-foreground-muted">
                {role.isBuiltin
                  ? t(
                      'settings.roles.builtInNote',
                      'Built in, so its permissions can’t be changed. Duplicate it to start a custom role.',
                    )
                  : t(
                      'settings.roles.customNote',
                      'Custom role. Click a permission to give it or take it away; changes apply at once.',
                    )}
              </span>
              {canManage ? (
                <span className="flex gap-2">
                  {role.isBuiltin ? (
                    <Button variant="ghost" size="compact" onClick={props.onDuplicate}>
                      <AppIcon id="copy" size={14} />
                      {t('settings.roles.duplicate', 'Duplicate')}
                    </Button>
                  ) : (
                    <>
                      <Button variant="ghost" size="compact" onClick={props.onEdit}>
                        <AppIcon id="pencil" size={14} />
                        {t('settings.roles.editDetails', 'Edit details')}
                      </Button>
                      <Button
                        variant="danger"
                        size="compact"
                        className="bg-danger-soft"
                        onClick={props.onDelete}
                      >
                        <AppIcon id="trash-2" size={14} />
                        {t('common.delete', 'Delete')}
                      </Button>
                    </>
                  )}
                </span>
              ) : null}
            </div>

            {people.length === 0 ? null : (
              <div className="flex flex-col">
                <h4 className="pt-1 pb-2 font-mono text-label text-foreground-subtle uppercase">
                  {t('settings.roles.peopleCount', 'People · {{count}}', { count: people.length })}
                </h4>
                {people.map((person, index) => (
                  <div
                    key={person.id}
                    className={cn(
                      'flex items-center gap-3 py-3',
                      index > 0 && 'border-t border-border',
                    )}
                  >
                    <Avatar
                      displayName={person.displayName}
                      avatarUrl={person.avatarUrl}
                      isAccented={role.key === 'owner'}
                    />
                    <span className="flex min-w-0 grow flex-col gap-0.5">
                      <span className="truncate text-ui text-foreground">{person.displayName}</span>
                      <span className="truncate text-caption text-foreground-subtle">
                        @{person.username} ·{' '}
                        {person.lastLoginAt === null
                          ? t('settings.people.neverSignedIn', 'never signed in')
                          : relativeTime(person.lastLoginAt)}
                      </span>
                    </span>
                    {canEditPeople ? (
                      <IconButton
                        variant="raised"
                        label={t('settings.people.editPerson', 'Edit {{name}}', {
                          name: person.displayName,
                        })}
                        onClick={() => {
                          props.onEditPerson(person);
                        }}
                      >
                        <AppIcon id="pencil" size={14} />
                      </IconButton>
                    ) : null}
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-col">
              <h4 className="pt-1 pb-2 font-mono text-label text-foreground-subtle uppercase">
                {t('settings.roles.permissionsCount', 'Permissions · {{held}} of {{count}}', {
                  held: heldCount,
                  count: PERMISSION_COUNT,
                })}
              </h4>

              {PERMISSION_GROUPS.map((group) => {
                const inGroup = group.keys.filter((key) => isOwner || held.has(key)).length;

                return (
                  <div key={group.id} className="flex flex-col pt-2.5">
                    <div className="flex items-center justify-between gap-3 pt-1 pb-2">
                      <span className="font-mono text-label whitespace-nowrap text-foreground-subtle uppercase">
                        {text(group.label)}
                      </span>
                      <span className="flex items-center gap-3">
                        {isEditable ? (
                          <>
                            <button
                              type="button"
                              disabled={inGroup === group.keys.length}
                              className="text-caption text-primary transition-colors hover:text-primary-hover disabled:cursor-default disabled:text-foreground-disabled"
                              onClick={() => {
                                set(
                                  group.keys.filter((key) => can(key)),
                                  true,
                                );
                              }}
                            >
                              {t('settings.roles.selectAll', 'Select all')}
                            </button>
                            <button
                              type="button"
                              disabled={inGroup === 0}
                              className="text-caption text-primary transition-colors hover:text-primary-hover disabled:cursor-default disabled:text-foreground-disabled"
                              onClick={() => {
                                set(group.keys, false);
                              }}
                            >
                              {t('settings.roles.clear', 'Clear')}
                            </button>
                          </>
                        ) : null}
                        <span className="font-mono text-caption text-foreground-subtle tabular">
                          {t('settings.roles.xOfY', '{{held}} of {{count}}', {
                            held: inGroup,
                            count: group.keys.length,
                          })}
                        </span>
                      </span>
                    </div>

                    {group.keys.map((key, index) => (
                      <PermissionRow
                        key={key}
                        permission={key}
                        isHeld={isOwner || held.has(key)}
                        isFirst={index === 0}
                        isEditable={isEditable && can(key)}
                        lockedNote={
                          role.isBuiltin
                            ? t(
                                'settings.roles.lockedBuiltIn',
                                'Built in: duplicate the role to change it',
                              )
                            : canManage
                              ? t(
                                  'settings.roles.lockedNotHeld',
                                  'Only someone who holds this permission can give it',
                                )
                              : t(
                                  'settings.roles.lockedNoRight',
                                  'Changing roles needs role:manage',
                                )
                        }
                        onToggle={() => {
                          set([key], !held.has(key));
                        }}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** What one permission row needs. */
type PermissionRowProps = {
  readonly permission: string;
  readonly isHeld: boolean;
  readonly isFirst: boolean;
  readonly isEditable: boolean;

  /** Why it cannot be pressed, shown on hover. */
  readonly lockedNote: string;

  readonly onToggle: () => void;
};

/**
 * One permission: a tick or a dash, its name and its key. A button on a custom role; on a
 * built-in one it stays still and, pointed at, swaps its mark for a lock.
 *
 * @param props - See {@link PermissionRowProps}.
 * @returns The row.
 */
function PermissionRow(props: PermissionRowProps) {
  const { permission, isHeld, isFirst, isEditable, lockedNote, onToggle } = props;
  const mark = (
    <span className="relative flex size-4 shrink-0 items-center justify-center">
      <AppIcon
        id={isHeld ? 'check' : 'minus'}
        size={15}
        className={cn(
          'transition-[opacity,transform,color] duration-200',
          isHeld ? 'scale-100 text-success' : 'text-border-strong',
          isEditable
            ? 'group-hover/perm:scale-110 group-active/perm:scale-90'
            : 'group-hover/perm:scale-75 group-hover/perm:opacity-0',
          isEditable && !isHeld && 'group-hover/perm:text-foreground-subtle',
        )}
      />
      {isEditable ? null : (
        <AppIcon
          id="lock"
          size={12}
          className="absolute scale-75 text-foreground-subtle opacity-0 transition-[opacity,transform] duration-200 group-hover/perm:scale-100 group-hover/perm:opacity-100"
        />
      )}
    </span>
  );
  const rowClass = cn(
    'group/perm -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-chip px-2 py-2.25 text-left text-ui transition-colors duration-150',
    !isFirst && 'border-t border-border',
    isHeld ? 'text-foreground' : 'text-foreground-subtle',
  );
  const words = (
    <>
      <span className="grow">{permissionLabel(permission)}</span>
      <span translate="no" className="font-mono text-caption text-foreground-subtle">
        {permission}
      </span>
    </>
  );

  return isEditable ? (
    <button
      type="button"
      aria-pressed={isHeld}
      onClick={onToggle}
      className={cn(rowClass, 'cursor-pointer hover:bg-surface-raised/60 hover:text-foreground')}
    >
      {mark}
      {words}
    </button>
  ) : (
    <div
      aria-disabled="true"
      title={lockedNote}
      className={cn(rowClass, 'cursor-not-allowed hover:bg-surface-raised/30')}
    >
      {mark}
      {words}
    </div>
  );
}

/**
 * Renders People › Roles.
 *
 * @returns The page.
 */
export function RolesPanel() {
  const { t } = useTranslation();
  const can = useSession((state) => state.can);
  const canManage = can('role:manage');
  const canEditPeople = can('user:manage');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [dialog, setDialog] = useState<RoleDialogMode | null>(null);
  const [deleting, setDeleting] = useState<RoleView | null>(null);
  const [editingPerson, setEditingPerson] = useState<UserView | null>(null);

  const roles = useQuery({
    queryKey: SETTINGS_QUERY_KEYS.roles,

    /**
     * Reads the roles.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the request when the component goes away.
     * @returns Every role and what it grants.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchRoles(signal),
  });
  const users = useQuery({
    queryKey: SETTINGS_QUERY_KEYS.users,

    /**
     * Reads the people, to show who holds each role.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the request when the component goes away.
     * @returns Every living account.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchUsers(signal),
  });
  const list = roles.data ?? [];
  const icons = useCatalogueIcons(list.map((role) => role.icon));
  const people = [...(users.data ?? [])].sort((left, right) =>
    left.displayName.localeCompare(right.displayName),
  );

  return (
    <SettingsPage path="/settings/people/roles">
      <SettingsSection
        isBare
        label={t('settings.roles.count', 'Roles · {{count}}', { count: list.length })}
        action={
          canManage ? (
            <Button
              disabled={list.length === 0}
              onClick={() => {
                const member = list.find((role) => role.key === 'member') ?? list[0];

                if (member !== undefined) {
                  setDialog({ kind: 'new', from: member });
                }
              }}
            >
              <AppIcon id="plus" size={16} />
              {t('settings.roles.new', 'New role')}
            </Button>
          ) : undefined
        }
      >
        <div className="overflow-hidden rounded-card border border-border bg-surface shadow-edge">
          {roles.isPending ? (
            <p className="px-4.5 py-4 text-ui text-foreground-subtle">
              {t('settings.roles.reading', 'Reading the roles…')}
            </p>
          ) : null}

          {roles.isError ? (
            <p role="alert" className="px-4.5 py-4 text-ui text-danger">
              {toMessage(roles.error)}
            </p>
          ) : null}

          {list.map((role, index) => (
            <RoleRow
              key={role.id}
              role={role}
              icon={role.icon === null ? undefined : icons.get(role.icon)}
              people={people.filter((person) => person.role === role.key)}
              isOpen={openKey === role.key}
              isFirst={index === 0}
              canManage={canManage}
              canEditPeople={canEditPeople}
              onToggle={() => {
                setOpenKey(openKey === role.key ? null : role.key);
              }}
              onDuplicate={() => {
                setDialog({ kind: 'new', from: role });
              }}
              onEdit={() => {
                setDialog({ kind: 'edit', role });
              }}
              onDelete={() => {
                setDeleting(role);
              }}
              onEditPerson={setEditingPerson}
            />
          ))}
        </div>
      </SettingsSection>

      <RoleDialog
        mode={dialog}
        roles={list}
        onClose={() => {
          setDialog(null);
        }}
        onSaved={(role) => {
          setDialog(null);
          setOpenKey(role.key);
        }}
      />

      <RoleDeleteDialog
        role={deleting}
        roles={list}
        onClose={() => {
          setDeleting(null);
        }}
      />

      <UserEditDialog
        user={editingPerson}
        onClose={() => {
          setEditingPerson(null);
        }}
      />
    </SettingsPage>
  );
}
