/**
 * Making, duplicating and editing a custom role (boards N-Settings-Role-Duplicate,
 * N-Settings-Role-Icon), and deleting one.
 *
 * New role, Duplicate and Edit details share one dialog. Making a role starts from another - its
 * permissions are copied, and changed afterwards on the roles page - so "Start from" is there only
 * when making one. The name is the shared icon-and-name field, whose icon button opens the icon
 * picker; under it the description, and a preview of the row as it will read.
 *
 * Deleting a role that people hold asks where they go: `users.role_id` cannot point at nothing.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type SubmitEventHandler } from 'react';
import { useTranslation } from 'react-i18next';

import type { IconView, RoleView } from '@nebulahome/contracts';
import { AppIcon, Button, CatalogueIcon, Modal, SelectField, TextField } from '@nebulahome/ui';

import { toMessage } from '@/lib/error-message';
import { PERMISSION_COUNT } from '@/lib/permission-labels';
import { roleDescription, roleName } from '@/lib/role-names';
import { useCatalogueIcons } from '@/routes/library/device-icon';
import { NameIconField } from '@/routes/library/name-icon-field';
import { RoleChip, RoleKindTag } from '@/routes/settings/role-parts';
import { SETTINGS_QUERY_KEYS, createRole, deleteRole, updateRole } from '@/settings/api';

/** What the dialog is for: a new role from another, or a custom role's details. */
export type RoleDialogMode =
  | { readonly kind: 'new'; readonly from: RoleView }
  | { readonly kind: 'edit'; readonly role: RoleView };

/** The icon a new role starts with. */
const DEFAULT_ICON = 'house';

/**
 * How many permissions a role holds, as the roles page counts them.
 *
 * @param role - The role.
 * @returns The count.
 */
function permissionCount(role: RoleView): number {
  return role.key === 'owner'
    ? PERMISSION_COUNT
    : role.permissions.filter((grant) => grant.scope === '*').length;
}

/** What the dialog needs. */
export type RoleDialogProps = {
  /** What it is for; null keeps it shut. */
  readonly mode: RoleDialogMode | null;

  /** Every role, for Start from. */
  readonly roles: readonly RoleView[];

  /** Called on Cancel. */
  readonly onClose: () => void;

  /** Called with the role once it is made or saved. */
  readonly onSaved: (role: RoleView) => void;
};

/**
 * Renders the role dialog, fresh for each opening.
 *
 * @param props - See {@link RoleDialogProps}.
 * @returns The dialog.
 */
export function RoleDialog(props: RoleDialogProps) {
  const { mode } = props;

  if (mode === null) {
    return null;
  }

  return (
    <RoleForm
      key={mode.kind === 'edit' ? mode.role.id : `new-${mode.from.id}`}
      {...props}
      mode={mode}
    />
  );
}

/**
 * The dialog, for a mode that is there.
 *
 * @param props - See {@link RoleDialogProps}.
 * @returns The dialog.
 */
function RoleForm(props: RoleDialogProps & { readonly mode: RoleDialogMode }) {
  const { t } = useTranslation();
  const { mode, roles, onClose, onSaved } = props;
  const queryClient = useQueryClient();
  const editing = mode.kind === 'edit' ? mode.role : undefined;

  const [from, setFrom] = useState(mode.kind === 'new' ? mode.from.key : '');
  const [name, setName] = useState(editing?.name ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [icon, setIcon] = useState<string | null>(
    editing === undefined ? DEFAULT_ICON : editing.icon,
  );
  const [picked, setPicked] = useState<IconView | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isTried, setTried] = useState(false);

  const read = useCatalogueIcons([icon, ...roles.map((role) => role.icon)]);
  const shown = picked?.id === icon ? picked : icon === null ? undefined : read.get(icon);
  const source = roles.find((role) => role.key === from);

  const save = useMutation({
    /**
     * Makes the role, or saves its details.
     *
     * @returns The role.
     */
    mutationFn: async (): Promise<RoleView> =>
      editing === undefined
        ? createRole({
            name: name.trim(),
            description: description.trim(),
            from,
            ...(icon === null ? {} : { icon }),
          })
        : updateRole(editing.id, { name: name.trim(), description: description.trim(), icon }),

    /**
     * Reads the roles again and hands the role back.
     *
     * @param role - The role as it now stands.
     */
    onSuccess: async (role: RoleView): Promise<void> => {
      await queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEYS.roles });
      onSaved(role);
    },

    /**
     * Says why, keeping what was typed.
     *
     * @param cause - Whatever was thrown.
     */
    onError: (cause: unknown): void => {
      setError(toMessage(cause));
    },
  });

  /**
   * Checks the name and sends the form.
   *
   * @param event - The submit event, whose default navigation is prevented.
   */
  const onSubmit: SubmitEventHandler<HTMLFormElement> = (event): void => {
    event.preventDefault();
    setTried(true);
    setError(undefined);

    if (name.trim() !== '') {
      save.mutate();
    }
  };

  const nameError =
    isTried && name.trim() === ''
      ? t('settings.roles.nameNeeded', 'A role needs a name.')
      : undefined;

  return (
    <Modal
      isOpen
      onClose={onClose}
      layout="card"
      size="form"
      lead={
        <span className="flex size-10 shrink-0 items-center justify-center rounded-tile bg-primary/14 text-primary">
          <AppIcon id={editing === undefined ? 'copy' : 'pencil'} size={18} />
        </span>
      }
      title={
        editing === undefined
          ? t('settings.roles.newFrom', 'New role from {{name}}', {
              name: roleName(source?.key ?? from, source?.name),
            })
          : t('settings.roles.editTitle', 'Edit {{name}}', { name: editing.name })
      }
      description={t('settings.roles.dialogNote', 'Custom roles can be edited and deleted.')}
      footer={
        <>
          <span />
          <span className="flex items-center gap-2">
            <Button variant="bare" onClick={onClose}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button type="submit" form="role-form" isBusy={save.isPending}>
              <AppIcon id="check" size={16} />
              {editing === undefined
                ? t('settings.roles.create', 'Create role')
                : t('common.save', 'Save')}
            </Button>
          </span>
        </>
      }
    >
      <form id="role-form" className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
        {editing === undefined ? (
          <SelectField
            label={t('settings.roles.startFrom', 'Start from')}
            value={from}
            options={roles.map((role) => {
              const view = role.icon === null ? undefined : read.get(role.icon);

              return {
                value: role.key,
                label: t('settings.roles.startFromOption', '{{name}} · {{count}} permissions', {
                  name: roleName(role.key, role.name),
                  count: permissionCount(role),
                }),
                ...(view === undefined
                  ? {}
                  : {
                      leading: (
                        <CatalogueIcon
                          node={view.node}
                          frame={view.frame}
                          size={15}
                          className="text-foreground-muted"
                        />
                      ),
                    }),
              };
            })}
            hint={t(
              'settings.roles.startFromHint',
              'Its permissions are copied; you change them after.',
            )}
            onChange={setFrom}
          />
        ) : null}

        <NameIconField
          label={t('settings.roles.name', 'Name')}
          value={name}
          onChange={setName}
          icon={icon}
          onIconChange={(view) => {
            setPicked(view);
            setIcon(view.id);
          }}
          hint={t('settings.roles.nameHint', 'The icon button opens the icon picker.')}
          error={nameError}
          required
        />

        <TextField
          label={t('settings.roles.description', 'Description')}
          size="large"
          value={description}
          maxLength={200}
          hint={t('settings.roles.descriptionHint', 'One line under the name.')}
          onChange={(event) => {
            setDescription(event.target.value);
          }}
        />

        <div className="flex items-center gap-3 rounded-card border border-border bg-surface px-4 py-3.5 shadow-edge">
          <RoleChip icon={shown} isLit />
          <span className="flex min-w-0 grow flex-col gap-0.75">
            <span className="flex flex-wrap items-center gap-2 text-title font-medium text-foreground">
              {name.trim() === '' ? t('settings.roles.untitled', 'New role') : name.trim()}
              <RoleKindTag isBuiltin={false} />
            </span>
            <span className="truncate text-ui-sm text-foreground-subtle">
              {description.trim() === ''
                ? source === undefined
                  ? ''
                  : roleDescription(source.key, source.description)
                : description.trim()}
            </span>
          </span>
          <span className="font-mono text-label text-foreground-subtle uppercase">
            {t('settings.roles.preview', 'Preview')}
          </span>
        </div>

        {error === undefined ? null : (
          <span role="alert" className="text-ui text-danger">
            {error}
          </span>
        )}
      </form>
    </Modal>
  );
}

/** What the delete confirmation needs. */
export type RoleDeleteDialogProps = {
  /** The role; null keeps the dialog shut. */
  readonly role: RoleView | null;

  /** Every role, for where its people go. */
  readonly roles: readonly RoleView[];

  /** Called once it is closed or done. */
  readonly onClose: () => void;
};

/**
 * Renders the confirmation for deleting a custom role.
 *
 * @param props - See {@link RoleDeleteDialogProps}.
 * @returns The dialog.
 */
export function RoleDeleteDialog(props: RoleDeleteDialogProps) {
  const { role } = props;

  return role === null ? null : <DeleteForm key={role.id} {...props} role={role} />;
}

/**
 * The confirmation, for a role that is there.
 *
 * @param props - See {@link RoleDeleteDialogProps}.
 * @returns The dialog.
 */
function DeleteForm(props: RoleDeleteDialogProps & { readonly role: RoleView }) {
  const { t } = useTranslation();
  const { role, roles, onClose } = props;
  const queryClient = useQueryClient();
  const others = roles.filter((each) => each.id !== role.id && each.key !== 'owner');
  const [moveTo, setMoveTo] = useState(
    (others.find((each) => each.key === 'member') ?? others[0])?.key ?? '',
  );
  const [error, setError] = useState<string | undefined>(undefined);

  const remove = useMutation({
    /**
     * Deletes the role, moving its people first.
     */
    mutationFn: async (): Promise<void> => {
      await deleteRole(role.id, role.userCount > 0 ? moveTo : undefined);
    },

    /**
     * Reads the roles and the people again, and closes.
     */
    onSuccess: async (): Promise<void> => {
      await queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEYS.roles });
      await queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEYS.users });
      onClose();
    },

    /**
     * Says why.
     *
     * @param cause - Whatever was thrown.
     */
    onError: (cause: unknown): void => {
      setError(toMessage(cause));
    },
  });

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="small"
      title={t('settings.roles.deleteTitle', 'Delete {{name}}?', { name: role.name })}
      description={
        role.userCount === 0
          ? t('settings.roles.deleteNobody', 'Nobody holds it. It goes, with its permissions.')
          : t('settings.roles.deleteSomebody', {
              count: role.userCount,
              defaultValue_one: '{{count}} person holds it and moves to the role you choose.',
              defaultValue_other: '{{count}} people hold it and move to the role you choose.',
            })
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.keepIt', 'Keep it')}
          </Button>
          <Button
            variant="danger"
            isBusy={remove.isPending}
            disabled={role.userCount > 0 && moveTo === ''}
            onClick={() => {
              setError(undefined);
              remove.mutate();
            }}
          >
            {t('common.delete', 'Delete')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {role.userCount === 0 ? null : (
          <SelectField
            label={t('settings.roles.moveTo', 'Move them to')}
            value={moveTo}
            options={others.map((each) => ({
              value: each.key,
              label: roleName(each.key, each.name),
            }))}
            onChange={setMoveTo}
          />
        )}
        {error === undefined ? null : (
          <span role="alert" className="text-ui text-danger">
            {error}
          </span>
        )}
      </div>
    </Modal>
  );
}
