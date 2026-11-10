/**
 * The small dialogs of the aliases: Rename, Delete (with what stops working) and Import (a file of
 * one alias or many: which to bring, which replace an alias of the same key, and what to read
 * instead of the entities this house does not have).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import {
  aliasPartsReads,
  readAliasFile,
  type AliasCustomField,
  type AliasFile,
  type AliasUsedBy,
} from '@nebulahome/contracts';
import {
  AppIcon,
  Button,
  Checkbox,
  Modal,
  Pill,
  TextField,
  toast,
  type UiIconId,
} from '@nebulahome/ui';

import { defineMessage, text, type Message } from '@/i18n/messages';
import { toMessage } from '@/lib/error-message';
import { codeEntityReads, typeLabel, typeOf } from '@/library/alias-model';
import {
  deleteAlias,
  fetchAlias,
  fetchAliases,
  importAliases,
  LIBRARY_QUERY_KEYS,
  updateAlias,
} from '@/library/api';
import { useInstalledPackages } from '@/packages/use-packages';
import { AliasMark } from '@/routes/library/aliases/alias-new-dialog';
import { EntityField } from '@/routes/library/entity-field';
import { useEntityDirectory } from '@/routes/library/entity-picker/use-entity-directory';

/** An alias a dialog acts on. */
export type AliasRef = { readonly id: string; readonly name: string };

/**
 * Renames an alias.
 *
 * @param props - The alias, or null when shut, and how to put it away.
 * @param props.alias - The alias.
 * @param props.onClose - Puts it away.
 * @returns The dialog.
 */
export function RenameAliasDialog(props: {
  readonly alias: AliasRef | null;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation();
  const { alias, onClose } = props;
  const queryClient = useQueryClient();
  const [name, setName] = useState(alias?.name ?? '');
  const rename = useMutation({
    /**
     * Saves the name.
     *
     * @returns The alias.
     */
    mutationFn: async () => updateAlias(alias?.id ?? '', { name: name.trim() }),

    /** Reads the aliases again and puts the dialog away. */
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.aliases });
      onClose();
    },

    /**
     * Says why it was not renamed.
     *
     * @param error - What the server answered.
     */
    onError: (error) => {
      toast.error({
        title: t('library.aliases.notRenamed', 'Not renamed'),
        message: toMessage(error),
      });
    },
  });

  return (
    <Modal
      isOpen={alias !== null}
      size="medium"
      layout="card"
      lead={<AliasMark />}
      title={t('library.aliases.rename', 'Rename')}
      description={alias?.name}
      onClose={onClose}
      footer={
        <>
          <span />
          <span className="flex items-center gap-2">
            <Button variant="bare" onClick={onClose}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              isBusy={rename.isPending}
              disabled={name.trim() === ''}
              onClick={() => {
                rename.mutate();
              }}
            >
              <AppIcon id="check" size={15} />
              {t('common.save', 'Save')}
            </Button>
          </span>
        </>
      }
    >
      <TextField
        label={t('library.aliases.name', 'Name')}
        value={name}
        onChange={(event) => {
          setName(event.target.value);
        }}
      />
    </Modal>
  );
}

/** Each kind of user, as the Delete dialog and the Used by fold list them. */
export const USE_KINDS: readonly {
  readonly kind: keyof AliasUsedBy;
  readonly icon: UiIconId;
  readonly label: Message;
}[] = [
  {
    kind: 'automations',
    icon: 'zap',
    label: defineMessage('library.aliasUses.automations', 'Automations'),
  },
  { kind: 'scenes', icon: 'layers', label: defineMessage('library.aliasUses.scenes', 'Scenes') },
  {
    kind: 'dashboards',
    icon: 'layout-dashboard',
    label: defineMessage('library.aliasUses.dashboards', 'Dashboards'),
  },
  { kind: 'aliases', icon: 'sigma', label: defineMessage('library.aliasUses.aliases', 'Aliases') },
];

/**
 * The users of an alias, a row per kind: its icon, "Automations · 4" and the names.
 *
 * @param props - What uses it.
 * @param props.usedBy - The users.
 * @returns The rows, or nothing when nothing uses it.
 */
export function UseRows(props: { readonly usedBy: AliasUsedBy }) {
  return (
    <>
      {USE_KINDS.filter(({ kind }) => props.usedBy[kind].length > 0).map(
        ({ kind, icon, label }) => (
          <li
            key={kind}
            className="flex items-center gap-3 border-t border-border px-3.5 py-2.5 first:border-t-0"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-surface-raised text-foreground-muted">
              <AppIcon id={icon} size={13} />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-ui-sm">
                {text(label)} · {props.usedBy[kind].length}
              </span>
              <span className="truncate text-caption text-foreground-subtle">
                {props.usedBy[kind].map((user) => user.name).join(', ')}
              </span>
            </span>
          </li>
        ),
      )}
    </>
  );
}

/**
 * How many things use an alias.
 *
 * @param usedBy - The users.
 * @returns The count.
 */
export function usedByCount(usedBy: AliasUsedBy): number {
  return USE_KINDS.reduce((sum, { kind }) => sum + usedBy[kind].length, 0);
}

/**
 * Deletes an alias, saying first what stops working.
 *
 * @param props - The alias, or null when shut; where to go after.
 * @param props.alias - The alias.
 * @param props.onClose - Puts it away.
 * @param props.isOnItsPage - Whether to go back to the list once it is gone.
 * @returns The dialog.
 */
export function DeleteAliasDialog(props: {
  readonly alias: AliasRef | null;
  readonly onClose: () => void;
  readonly isOnItsPage?: boolean;
}) {
  const { t } = useTranslation();
  const { alias, onClose, isOnItsPage = false } = props;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const detail = useQuery({
    queryKey: [...LIBRARY_QUERY_KEYS.aliases, alias?.id ?? ''],
    /**
     * Reads what uses the alias.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the read.
     * @returns The alias whole.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchAlias(alias?.id ?? '', signal),
    enabled: alias !== null,
  });
  const remove = useMutation({
    /**
     * Deletes it.
     *
     * @returns What used it.
     */
    mutationFn: async () => deleteAlias(alias?.id ?? ''),

    /** Reads the aliases again, and leaves its page. */
    onSuccess: async () => {
      onClose();

      if (isOnItsPage) {
        await navigate('/aliases', { replace: true });
      }

      queryClient.removeQueries({ queryKey: [...LIBRARY_QUERY_KEYS.aliases, alias?.id ?? ''] });
      await queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.aliases });
      toast.success({
        title: t('library.aliases.deleted', '{{name}} deleted', { name: alias?.name }),
      });
    },

    /**
     * Says why it was not deleted.
     *
     * @param error - What the server answered.
     */
    onError: (error) => {
      toast.error({
        title: t('library.aliases.notDeleted', 'Not deleted'),
        message: toMessage(error),
      });
    },
  });
  const usedBy = detail.data?.usedBy;
  const count = usedBy === undefined ? 0 : usedByCount(usedBy);

  return (
    <Modal
      isOpen={alias !== null}
      size="medium"
      layout="card"
      lead={<AliasMark tone="danger" />}
      title={t('library.aliases.deleteName', 'Delete {{name}}', { name: alias?.name })}
      description={t('library.aliases.deleteNote', 'History included · no undo')}
      onClose={onClose}
      footer={
        <>
          <span />
          <span className="flex items-center gap-2">
            <Button variant="bare" onClick={onClose}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              variant="danger"
              isBusy={remove.isPending}
              onClick={() => {
                remove.mutate();
              }}
            >
              <AppIcon id="trash-2" size={15} />
              {t('common.delete', 'Delete')}
            </Button>
          </span>
        </>
      }
    >
      {usedBy === undefined || count === 0 ? (
        <p className="text-ui-sm text-foreground-muted">
          {detail.isPending
            ? t('library.detail.reading', 'Reading…')
            : t('library.aliases.nothingUsesIt', 'Nothing uses it.')}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <span className="text-ui-sm text-foreground-muted">
            {t(
              'library.aliases.stopsWorking',
              'Stops working until pointed elsewhere · {{count}}',
              {
                count,
              },
            )}
          </span>
          <ul className="flex flex-col rounded-card border border-border">
            <UseRows usedBy={usedBy} />
          </ul>
        </div>
      )}
    </Modal>
  );
}

/** A file being imported, read. */
type Picked = { readonly name: string; readonly file: AliasFile };

/**
 * Imports aliases from a file.
 *
 * @param props - Whether it is open, and how to put it away.
 * @param props.isOpen - Whether it shows.
 * @param props.onClose - Puts it away.
 * @returns The dialog.
 */
export function ImportAliasesDialog(props: {
  readonly isOpen: boolean;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation();
  const { isOpen, onClose } = props;
  const queryClient = useQueryClient();
  const { packages } = useInstalledPackages();
  const { entities } = useEntityDirectory(false);
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [picks, setPicks] = useState<ReadonlySet<string>>(new Set());
  const [replacements, setReplacements] = useState<Readonly<Record<string, string>>>({});
  const existing = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.aliases,
    /**
     * Reads the aliases, to say which an import replaces.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the read.
     * @returns The aliases.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchAliases(signal),
    enabled: isOpen,
  });
  const keys = new Set((existing.data ?? []).map((item) => item.entityId.split('.')[1]));
  const known = new Set(entities.map((entity) => entity.entityId as string));

  /**
   * A custom type's fields, from the installed packages.
   *
   * @param packageId - The package.
   * @param type - Its entity type.
   * @returns The fields, or undefined when it is not installed.
   */
  const customFieldsOf = (
    packageId: string,
    type: string,
  ): readonly AliasCustomField[] | undefined =>
    packages.find((each) => each.id === packageId)?.entityTypes.find((each) => each.id === type)
      ?.state;

  /**
   * Reads a file's text.
   *
   * @param file - The file chosen or dropped.
   */
  const read = async (file: File): Promise<void> => {
    const result = readAliasFile(await file.text(), customFieldsOf);

    if (result.ok) {
      setPicked({ name: file.name, file: result.file });
      setPicks(new Set(result.file.aliases.map((entry) => entry.key)));
      setReplacements({});
      setProblems([]);
    } else {
      setPicked(null);
      setProblems(
        result.problems.map((problem) =>
          problem.path === '' ? problem.message : `${problem.path}: ${problem.message}`,
        ),
      );
    }
  };

  /**
   * Takes a dropped file.
   *
   * @param event - The drop.
   */
  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const [file] = event.dataTransfer.files;

    if (file !== undefined) {
      void read(file);
    }
  };

  const entries = picked?.file.aliases ?? [];
  const missing = entries
    .filter((entry) => picks.has(entry.key))
    .flatMap((entry) => {
      const code = entry.code.join('\n');
      const reads = new Set([
        ...aliasPartsReads(entry.parts),
        ...codeEntityReads(code, Object.keys(entry.parts)),
      ]);

      return [...reads].filter((id) => !known.has(id)).map((id) => ({ id, alias: entry.name }));
    });

  const run = useMutation({
    /**
     * Imports the picked aliases.
     *
     * @returns What was created and replaced.
     */
    mutationFn: async () =>
      importAliases({
        file: picked?.file ?? { format: 'nebula-home/aliases', version: 1, aliases: [] },
        picks: [...picks],
        replacements: Object.fromEntries(
          Object.entries(replacements).filter(([, value]) => value !== ''),
        ),
      }),

    /**
     * Says what came in and puts the dialog away.
     *
     * @param result - What was created and replaced.
     */
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.aliases });
      toast.success({
        title: t('library.aliases.imported', {
          count: result.created.length + result.replaced.length,
          defaultValue_one: '{{count}} alias imported',
          defaultValue_other: '{{count}} aliases imported',
        }),
      });
      setPicked(null);
      onClose();
    },

    /**
     * Says why they did not come in.
     *
     * @param error - What the server answered.
     */
    onError: (error) => {
      toast.error({
        title: t('library.aliases.notImported', 'Not imported'),
        message: toMessage(error),
      });
    },
  });

  return (
    <Modal
      isOpen={isOpen}
      size="picker"
      layout="sections"
      lead={<AliasMark />}
      title={t('library.aliases.importAliases', 'Import aliases')}
      description={t(
        'library.aliases.importNote',
        'nebula-home/aliases · one file, one alias or many',
      )}
      closeLabel={t('common.close', 'Close')}
      onClose={onClose}
      footer={
        <>
          <span />
          <span className="flex items-center gap-2">
            <Button variant="bare" onClick={onClose}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              isBusy={run.isPending}
              disabled={picks.size === 0}
              onClick={() => {
                run.mutate();
              }}
            >
              <AppIcon id="download" size={15} />
              {t('library.aliases.importCount', {
                count: picks.size,
                defaultValue_one: 'Import {{count}} alias',
                defaultValue_other: 'Import {{count}} aliases',
              })}
            </Button>
          </span>
        </>
      }
    >
      <div className="flex flex-col gap-4 px-6 py-5">
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(event) => {
            const [file] = event.target.files ?? [];

            if (file !== undefined) {
              void read(file);
            }

            event.target.value = '';
          }}
        />
        {}
        <div
          className="flex flex-wrap items-center justify-center gap-2 rounded-inner border border-dashed border-border-strong px-4 py-3 text-ui-sm text-foreground-muted"
          onDragOver={(event) => {
            event.preventDefault();
          }}
          onDrop={onDrop}
        >
          <AppIcon id="file" size={15} className="text-primary" />
          {picked === null
            ? t('library.aliases.dropFile', 'Drop an aliases file here')
            : t('library.aliases.fileDropped', '{{name}} · {{count}} aliases', {
                name: picked.name,
                count: entries.length,
              })}
          <Button
            variant="bare"
            size="compact"
            onClick={() => {
              input.current?.click();
            }}
          >
            {picked === null
              ? t('library.aliases.chooseFile', 'Choose a file')
              : t('library.aliases.anotherFile', 'Another file')}
          </Button>
        </div>
        {problems.length === 0 ? null : (
          <ul className="flex flex-col gap-1 rounded-card border border-danger/40 px-3.5 py-2.5 text-caption text-danger">
            {problems.slice(0, 6).map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
        {entries.length === 0 ? null : (
          <div className="flex flex-col gap-2">
            <span className="text-ui-sm text-foreground-muted">
              {t('library.aliases.foundPicked', 'Found {{found}} · {{picked}} picked', {
                found: entries.length,
                picked: picks.size,
              })}
            </span>
            <ul className="flex flex-col rounded-card border border-border">
              {entries.map((entry) => (
                <li
                  key={entry.key}
                  className="flex items-center gap-3 border-t border-border px-3.5 py-2.5 first:border-t-0"
                >
                  <Checkbox
                    label={
                      <span className="sr-only">
                        {t('library.aliases.importName', 'Import {{name}}', { name: entry.name })}
                      </span>
                    }
                    isChecked={picks.has(entry.key)}
                    onChange={(isChecked) => {
                      const next = new Set(picks);

                      if (isChecked) {
                        next.add(entry.key);
                      } else {
                        next.delete(entry.key);
                      }

                      setPicks(next);
                    }}
                  />
                  <span className="flex min-w-0 grow flex-col">
                    <span className="truncate text-ui-sm text-foreground">{entry.name}</span>
                    <span className="truncate text-caption text-foreground-subtle">
                      {typeLabel(typeOf(entry.behavesAs))} ·{' '}
                      {entry.device === 'aliases'
                        ? t('library.aliases.aliasesDevice', 'Aliases')
                        : 'virtual' in entry.device
                          ? entry.device.virtual
                          : entry.device.device}
                    </span>
                  </span>
                  {keys.has(entry.key) ? (
                    <Pill tone="warning">
                      {t('library.aliases.replacesExisting', 'Replaces existing')}
                    </Pill>
                  ) : (
                    <Pill tone="success">{t('library.aliases.new', 'New')}</Pill>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {missing.length === 0 ? null : (
          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-1.5 text-ui-sm text-foreground-muted">
              <AppIcon id="triangle-alert" size={13} className="text-warning" />
              {t('library.aliases.missingHere', 'Missing in this house · {{count}}', {
                count: missing.length,
              })}
            </span>
            <ul className="flex flex-col rounded-card border border-border">
              {missing.map(({ id, alias }) => (
                <li
                  key={`${alias}:${id}`}
                  className="grid grid-cols-[minmax(0,1fr)_16px_minmax(0,1fr)] items-center gap-3 border-t border-border px-3.5 py-2.5 first:border-t-0"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate font-mono text-mono-caption text-foreground-muted">
                      {id}
                    </span>
                    <span className="truncate text-caption text-foreground-subtle">{alias}</span>
                  </span>
                  <AppIcon id="arrow-right" size={14} className="text-foreground-subtle" />
                  <EntityField
                    label={t('library.aliases.replacementFor', 'Replacement for {{id}}', { id })}
                    isLabelHidden
                    size="compact"
                    isOptional
                    value={replacements[id] ?? ''}
                    onChange={(value) => {
                      setReplacements({ ...replacements, [id]: value });
                    }}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
