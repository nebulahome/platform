/**
 * The aliases: grouped by the type each behaves as, with the device it sits on, its value now and
 * whether it is enabled. All or only those with a problem; a search; a filter by type, device and
 * area; Import and Export of a whole file; New alias.
 *
 * A row's menu opens, duplicates, renames, exports, disables or deletes it. On a phone the rows
 * are cards, with no switch and no menu: the alias's own page has both.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';

import type { AliasListItem } from '@nebulahome/contracts';
import {
  AppIcon,
  Button,
  EmptyState,
  OverflowMenu,
  Segmented,
  SelectField,
  StatusDot,
  Switch,
  TableFooter,
  toast,
  type UiIconId,
} from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { SortHeader } from '@/components/sort-header';
import { DOCS_LINKS } from '@/lib/docs-links';
import { toMessage } from '@/lib/error-message';
import { useListState } from '@/lib/use-list-state';
import { usePaging } from '@/lib/use-paging';
import {
  ALIAS_LIST_CODEC,
  aliasFacetCount,
  groupAliases,
  hasProblem,
  HEALTH_TONE,
  matchesAliasFacets,
  matchesAliasList,
  OPEN_ALIAS_LIST_FILTER,
  typeLabel,
  typePlural,
  uiIcon,
} from '@/library/alias-model';
import {
  duplicateAlias,
  exportAliases,
  fetchAliases,
  fetchEntities,
  LIBRARY_QUERY_KEYS,
  updateAlias,
} from '@/library/api';
import { NO_READING, readingOf } from '@/library/entity-reading';
import { saveJsonFile } from '@/library/library-file';
import { useLive } from '@/live/live-store';
import {
  DeleteAliasDialog,
  ImportAliasesDialog,
  RenameAliasDialog,
  type AliasRef,
} from '@/routes/library/aliases/alias-dialogs';
import { NewAliasDialog } from '@/routes/library/aliases/alias-new-dialog';
import { devicePath } from '@/routes/library/device/device-path';
import { Facet, FilterSheet } from '@/routes/library/filter-sheet';
import { LibraryPage } from '@/routes/library/library-page';
import { NoMatches } from '@/routes/library/no-matches';
import { SearchField } from '@/routes/library/search-field';
import { useAreas } from '@/routes/library/use-areas';

/** The columns, shared by the header and every row. */
const COLUMNS =
  'grid grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1fr)_76px_40px] items-center gap-4';

/** The one sort: by name, within each type. */
const SORTS = ['name'] as const;

/** What a row shows besides the alias: its value now. */
type Line = {
  readonly item: AliasListItem;
  readonly value: string;
};

/**
 * What can be done to an alias from a row or its page.
 *
 * @returns The actions.
 */
export function useAliasActions() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const enable = useMutation({
    /**
     * Turns an alias on or off.
     *
     * @param variables - Which, and how.
     * @param variables.id - The alias.
     * @param variables.isEnabled - On or off.
     * @returns The alias.
     */
    mutationFn: async (variables: { readonly id: string; readonly isEnabled: boolean }) =>
      updateAlias(variables.id, { isEnabled: variables.isEnabled }),

    /** Reads the aliases again. */
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.aliases });
    },

    /**
     * Says why it did not change.
     *
     * @param error - What the server answered.
     */
    onError: (error) => {
      toast.error({
        title: t('library.aliases.notChanged', 'Not changed'),
        message: toMessage(error),
      });
    },
  });

  const duplicate = useMutation({
    /**
     * Copies an alias.
     *
     * @param alias - Which.
     * @returns The copy.
     */
    mutationFn: async (alias: AliasRef) =>
      duplicateAlias(
        alias.id,
        t('library.aliases.copyName', '{{name}} (copy)', { name: alias.name }),
      ),

    /**
     * Opens the copy.
     *
     * @param view - The copy.
     */
    onSuccess: async (view) => {
      await queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.aliases });
      await navigate(`/aliases/${view.id}`);
    },

    /**
     * Says why it was not copied.
     *
     * @param error - What the server answered.
     */
    onError: (error) => {
      toast.error({
        title: t('library.aliases.notCopied', 'Not copied'),
        message: toMessage(error),
      });
    },
  });

  return {
    /**
     * Turns an alias on or off.
     *
     * @param id - The alias.
     * @param isEnabled - On or off.
     */
    setEnabled: (id: string, isEnabled: boolean): void => {
      enable.mutate({ id, isEnabled });
    },

    /**
     * Copies an alias and opens the copy.
     *
     * @param alias - Which.
     */
    duplicate: (alias: AliasRef): void => {
      duplicate.mutate(alias);
    },

    /**
     * Saves aliases as one file.
     *
     * @param ids - Which; every alias when empty.
     * @param fileName - The file's name.
     */
    exportFile: (ids: readonly string[], fileName: string): void => {
      exportAliases(ids).then(
        (file) => {
          saveJsonFile(file, fileName);
        },
        (error: unknown) => {
          toast.error({
            title: t('library.aliases.notExported', 'Not exported'),
            message: toMessage(error),
          });
        },
      );
    },
  };
}

/**
 * The value cell: the health's dot and the value now.
 *
 * @param props - The alias and its value.
 * @param props.line - The row.
 * @returns The cell.
 */
function ValueCell(props: { readonly line: Line }) {
  const { item, value } = props.line;

  return (
    <span className="flex min-w-0 items-center gap-2">
      <StatusDot isBare tone={HEALTH_TONE[item.health]} title={value} />
      <span
        className={`truncate text-ui-sm tabular ${
          item.health === 'failing'
            ? 'text-danger'
            : item.health === 'unavailable'
              ? 'text-warning'
              : 'text-foreground-muted'
        }`}
      >
        {value}
      </span>
    </span>
  );
}

/**
 * The line under a name: what is wrong, or where it is.
 *
 * @param props - The alias.
 * @param props.item - The alias.
 * @param props.fallback - What to say when there is nothing wrong and no area.
 * @returns The line.
 */
function SubLine(props: { readonly item: AliasListItem; readonly fallback?: string }) {
  const { item, fallback = '' } = props;

  if (hasProblem(item)) {
    return (
      <span
        className={`flex min-w-0 items-center gap-1 text-caption ${
          item.health === 'failing' ? 'text-danger' : 'text-warning'
        }`}
      >
        <AppIcon id="triangle-alert" size={12} className="shrink-0" />
        <span className="truncate">{item.problem ?? item.health}</span>
      </span>
    );
  }

  return (
    <span className="truncate text-caption text-foreground-subtle">
      {item.area?.name ?? fallback}
    </span>
  );
}

/**
 * The device cell: a real device by name, linked; a virtual one as Aliases or its name.
 *
 * @param props - The alias.
 * @param props.item - The alias.
 * @returns The cell.
 */
function DeviceCell(props: { readonly item: AliasListItem }) {
  const { t } = useTranslation();
  const { device } = props.item;

  if (!device.isVirtual) {
    return (
      <Link
        to={devicePath(device.id)}
        className="flex min-w-0 items-center gap-2 text-ui-sm text-foreground hover:text-primary"
      >
        <AppIcon id="cpu" size={14} className="shrink-0 text-foreground-subtle" />
        <span className="truncate">{device.name}</span>
      </Link>
    );
  }

  return (
    <span className="flex min-w-0 items-center gap-2 text-ui-sm text-foreground-muted">
      <AppIcon id="layers" size={14} className="shrink-0 text-foreground-subtle" />
      <span className="truncate">
        {device.isShared ? t('library.aliases.aliasesDevice', 'Aliases') : device.name}
      </span>
    </span>
  );
}

/**
 * The aliases page.
 *
 * @param props - Whether it opens with New alias.
 * @param props.isCreating - Opened at `/aliases/new`.
 * @returns The page.
 */
export function AliasesPage(props: { readonly isCreating?: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const readings = useLive((state) => state.readings);
  const canWrite = useSession((state) => state.can('alias:write'));
  const [filter, setFilter] = useListState(ALIAS_LIST_CODEC);
  const { areas } = useAreas();
  const actions = useAliasActions();
  const [dialog, setDialog] = useState<
    | { readonly at: 'none' | 'new' | 'import' }
    | { readonly at: 'rename' | 'delete'; readonly alias: AliasRef }
  >({ at: props.isCreating === true ? 'new' : 'none' });

  const aliases = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.aliases,
    /**
     * Reads every alias.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the read.
     * @returns The aliases.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchAliases(signal),
  });
  const entities = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.entities,
    /**
     * Reads every entity, for each alias's value now.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the read.
     * @returns The entities.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchEntities(signal),
  });

  const items = aliases.data ?? [];
  const entityById = new Map(
    (entities.data ?? []).map((entity) => [entity.entityId as string, entity]),
  );
  const lines: Line[] = items.map((item) => {
    const entity = entityById.get(item.entityId);
    const reading =
      entity === undefined ? NO_READING : readingOf(entity, readings[item.entityId]).text;
    const value =
      item.health === 'failing'
        ? t('library.aliases.failing', 'Failing')
        : item.health === 'unavailable'
          ? t('library.aliases.unavailable', 'Unavailable')
          : item.health === 'off'
            ? t('common.off', 'Off')
            : reading;

    return { item, value };
  });
  const faceted = lines.filter((line) => matchesAliasFacets(line.item, filter));
  const shown = lines.filter((line) => matchesAliasList(line.item, filter));
  const problems = faceted.filter((line) => hasProblem(line.item)).length;
  const paging = usePaging('aliases', SORTS, shown.length);
  const ordered = groupAliases(
    shown.map((line) => ({ ...line, behavesAs: line.item.behavesAs, name: line.item.name })),
  ).flatMap((group) => group.items);
  const page = paging.rows(paging.direction === 'asc' ? ordered : ordered.toReversed());
  const groups = groupAliases(page);
  const usedTypes = groupAliases(items).map((group) => group.type);
  const usedAreas = areas.filter((area) => items.some((item) => item.area?.key === area.key));

  /** Opens New alias. */
  const openNew = (): void => {
    setDialog({ at: 'new' });
  };

  /** Puts any dialog away, leaving `/aliases/new` for the list. */
  const close = (): void => {
    setDialog({ at: 'none' });

    if (props.isCreating === true) {
      void navigate('/aliases', { replace: true });
    }
  };

  /**
   * A row's menu.
   *
   * @param item - The alias.
   * @returns The menu.
   */
  const menuOf = (item: AliasListItem) => (
    <OverflowMenu
      label={t('library.aliases.moreFor', 'More for {{name}}', { name: item.name })}
      items={[
        {
          label: t('library.aliases.open', 'Open'),
          icon: 'external-link',
          /** Open. */
          onSelect: () => {
            void navigate(`/aliases/${item.id}`);
          },
        },
        ...(canWrite
          ? [
              {
                label: t('library.aliases.duplicate', 'Duplicate'),
                icon: 'copy' as UiIconId,
                /** Duplicate. */
                onSelect: () => {
                  actions.duplicate(item);
                },
              },
              {
                label: t('library.aliases.rename', 'Rename'),
                icon: 'pencil' as UiIconId,
                /** Rename. */
                onSelect: () => {
                  setDialog({ at: 'rename', alias: item });
                },
              },
            ]
          : []),
        {
          label: t('library.aliases.exportFile', 'Export as a file'),
          icon: 'upload',
          /** Export as a file. */
          onSelect: () => {
            actions.exportFile([item.id], `${item.entityId.split('.')[1] ?? 'alias'}.aliases.json`);
          },
        },
        ...(canWrite
          ? [
              {
                label: item.isEnabled
                  ? t('library.aliases.disable', 'Disable')
                  : t('library.aliases.enable', 'Enable'),
                icon: 'power-off' as UiIconId,
                /** Turns it on or off. */
                onSelect: () => {
                  actions.setEnabled(item.id, !item.isEnabled);
                },
              },
              {
                label: t('common.delete', 'Delete'),
                icon: 'trash-2' as UiIconId,
                tone: 'danger' as const,
                /** Delete. */
                onSelect: () => {
                  setDialog({ at: 'delete', alias: item });
                },
              },
            ]
          : []),
      ]}
    />
  );

  return (
    <>
      <LibraryPage
        title={t('library.aliases.aliases', 'Aliases')}
        counted={(count) =>
          t('library.aliases.count', {
            count,
            defaultValue_one: '{{count}} alias',
            defaultValue_other: '{{count}} aliases',
          })
        }
        count={aliases.isPending ? undefined : items.length}
        shownCount={shown.length}
        summary={[]}
        tools={
          items.length === 0 ? undefined : (
            <>
              <Segmented
                label={t('library.aliases.show', 'Show')}
                size="compact"
                options={[
                  {
                    value: 'all',
                    label: t('library.aliases.showAll', 'All · {{count}}', {
                      count: faceted.length,
                    }),
                  },
                  {
                    value: 'problems',
                    label: t('library.aliases.showProblems', 'Problems · {{count}}', {
                      count: problems,
                    }),
                  },
                ]}
                value={filter.show}
                onChange={(show) => {
                  setFilter({ ...filter, show });
                }}
              />
              <SearchField
                placeholder={t('library.aliases.search', 'Search')}
                value={filter.search}
                onChange={(search) => {
                  setFilter({ ...filter, search });
                }}
              />
              <FilterSheet
                label={t('library.aliases.narrow', 'Narrow the aliases')}
                count={aliasFacetCount(filter)}
                onClear={() => {
                  setFilter({
                    ...OPEN_ALIAS_LIST_FILTER,
                    show: filter.show,
                    search: filter.search,
                  });
                }}
                summary={t('library.aliases.count', {
                  count: shown.length,
                  defaultValue_one: '{{count}} alias',
                  defaultValue_other: '{{count}} aliases',
                })}
              >
                <Facet title={t('library.aliases.type', 'Type')}>
                  <SelectField
                    label={t('library.aliases.type', 'Type')}
                    isLabelHidden
                    size="compact"
                    options={[
                      { value: '', label: t('library.aliases.anyType', 'Any type') },
                      ...usedTypes.map((type) => ({ value: type.id, label: typeLabel(type) })),
                    ]}
                    value={filter.type}
                    onChange={(type) => {
                      setFilter({ ...filter, type });
                    }}
                  />
                </Facet>
                <Facet title={t('library.aliases.device', 'Device')}>
                  <Segmented
                    label={t('library.aliases.device', 'Device')}
                    size="compact"
                    className="self-start"
                    options={[
                      { value: 'any', label: t('library.aliases.anyDevice', 'Any') },
                      { value: 'virtual', label: t('library.aliases.virtualDevices', 'Virtual') },
                      {
                        value: 'existing',
                        label: t('library.aliases.existingDevices', 'Existing'),
                      },
                    ]}
                    value={filter.device}
                    onChange={(device) => {
                      setFilter({ ...filter, device });
                    }}
                  />
                </Facet>
                <Facet title={t('library.aliases.area', 'Area')}>
                  <SelectField
                    label={t('library.aliases.area', 'Area')}
                    isLabelHidden
                    size="compact"
                    options={[
                      { value: '', label: t('library.aliases.anyArea', 'Any area') },
                      ...usedAreas.map((area) => ({ value: area.key, label: area.name })),
                    ]}
                    value={filter.area}
                    onChange={(area) => {
                      setFilter({ ...filter, area });
                    }}
                  />
                </Facet>
              </FilterSheet>
            </>
          )
        }
        action={
          <span className="flex items-center gap-2">
            <OverflowMenu
              label={t('library.aliases.importExport', 'Import and export')}
              items={[
                ...(canWrite
                  ? [
                      {
                        label: t('library.aliases.importFileMenu', 'Import a file…'),
                        icon: 'download' as UiIconId,
                        /** Import a file. */
                        onSelect: () => {
                          setDialog({ at: 'import' });
                        },
                      },
                    ]
                  : []),
                {
                  label: t('library.aliases.exportAll', 'Export all as one file'),
                  icon: 'upload',
                  disabled: items.length === 0,
                  /** Export all as one file. */
                  onSelect: () => {
                    actions.exportFile([], 'aliases.json');
                  },
                },
              ]}
            />
            {canWrite ? (
              <Button className="hidden md:inline-flex" onClick={openNew}>
                <AppIcon id="plus" size={15} />
                {t('library.aliases.newAlias', 'New alias')}
              </Button>
            ) : null}
          </span>
        }
        isPending={aliases.isPending}
        error={aliases.error}
        isEmpty={items.length === 0}
        empty={
          <EmptyState
            icon={<AppIcon id="sigma" size={32} />}
            title={t('library.aliases.noAliases', 'No aliases')}
            description={t(
              'library.aliases.emptyNote',
              'Entities the house makes: a sensor worked out from others, one light for many, a thermostat of its own.',
            )}
            action={
              canWrite ? (
                <span className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setDialog({ at: 'import' });
                    }}
                  >
                    <AppIcon id="download" size={15} />
                    {t('library.aliases.importFile', 'Import a file')}
                  </Button>
                  <Button onClick={openNew}>
                    <AppIcon id="plus" size={15} />
                    {t('library.aliases.newAlias', 'New alias')}
                  </Button>
                </span>
              ) : undefined
            }
            learnMoreHref={DOCS_LINKS.aliases}
          />
        }
      >
        {shown.length === 0 ? (
          <NoMatches
            query={filter.search}
            onClear={() => {
              setFilter(OPEN_ALIAS_LIST_FILTER);
            }}
          />
        ) : (
          <>
            <div className="hidden rounded-panel border border-border bg-surface md:block">
              <div
                className={`${COLUMNS} border-b border-border px-5 py-3 font-mono text-label text-foreground-subtle uppercase`}
              >
                <SortHeader
                  label={t('library.aliases.name', 'Name')}
                  isSorted
                  direction={paging.direction}
                  onSort={() => {
                    paging.toggleSort('name');
                  }}
                  className="justify-self-start"
                />
                <span>{t('library.aliases.device', 'Device')}</span>
                <span>{t('library.aliases.now', 'Now')}</span>
                <span>{t('library.aliases.enabled', 'Enabled')}</span>
                <span />
              </div>
              <ul>
                {groups.map(({ type, items: rows }, index) => (
                  <li key={type.id}>
                    <div
                      className={`flex items-center gap-2 bg-canvas/40 px-5 py-2 ${index === 0 ? '' : 'border-t border-border'}`}
                    >
                      <AppIcon
                        id={uiIcon(type.icon)}
                        size={14}
                        className="text-foreground-subtle"
                      />
                      <span className="text-ui-sm font-medium text-foreground-muted">
                        {typePlural(type)}
                      </span>
                      <span className="text-caption text-foreground-subtle">{rows.length}</span>
                    </div>
                    <ul>
                      {rows.map((line) => (
                        <li
                          key={line.item.id}
                          className={`${COLUMNS} border-t border-border px-5 py-3`}
                        >
                          <span className="flex min-w-0 flex-col gap-0.5">
                            <Link
                              to={`/aliases/${line.item.id}`}
                              className="truncate text-ui font-medium text-foreground transition-colors hover:text-primary"
                            >
                              {line.item.name}
                            </Link>
                            <SubLine item={line.item} />
                          </span>
                          <DeviceCell item={line.item} />
                          <ValueCell line={line} />
                          <span>
                            <Switch
                              label={t('library.aliases.nameEnabled', '{{name}} enabled', {
                                name: line.item.name,
                              })}
                              isOn={line.item.isEnabled}
                              disabled={!canWrite}
                              onChange={(isEnabled) => {
                                actions.setEnabled(line.item.id, isEnabled);
                              }}
                            />
                          </span>
                          <span className="justify-self-end">{menuOf(line.item)}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
              <TableFooter
                page={paging.page}
                size={paging.size}
                total={shown.length}
                onPage={paging.setPage}
                onSize={paging.setSize}
              />
            </div>

            <div className="flex flex-col gap-3 md:hidden">
              {groups.map(({ type, items: rows }) => (
                <div key={type.id} className="flex flex-col">
                  <span className="flex items-center gap-2 px-1 pt-2 pb-1.5">
                    <AppIcon id={uiIcon(type.icon)} size={13} className="text-foreground-subtle" />
                    <span className="text-caption font-medium text-foreground-muted">
                      {typePlural(type)}
                    </span>
                    <span className="text-caption text-foreground-subtle">{rows.length}</span>
                  </span>
                  <div className="overflow-hidden rounded-panel border border-border bg-surface">
                    {rows.map((line) => (
                      <Link
                        key={line.item.id}
                        to={`/aliases/${line.item.id}`}
                        className="flex items-center gap-3 border-b border-border px-3.5 py-3 last:border-b-0"
                      >
                        <span className="flex min-w-0 grow flex-col gap-0.5">
                          <span className="truncate text-ui-sm font-medium">{line.item.name}</span>
                          <SubLine
                            item={line.item}
                            fallback={
                              line.item.device.isShared
                                ? t('library.aliases.aliasesDevice', 'Aliases')
                                : line.item.device.name
                            }
                          />
                        </span>
                        <ValueCell line={line} />
                        <AppIcon
                          id="chevron-right"
                          size={14}
                          className="shrink-0 text-foreground-subtle"
                        />
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
              {canWrite ? (
                <div className="sticky bottom-4 flex justify-end">
                  <Button onClick={openNew}>
                    <AppIcon id="plus" size={15} />
                    {t('library.aliases.newAlias', 'New alias')}
                  </Button>
                </div>
              ) : null}
            </div>
          </>
        )}
      </LibraryPage>

      <NewAliasDialog
        isOpen={dialog.at === 'new'}
        onClose={close}
        onImport={() => {
          setDialog({ at: 'import' });
        }}
      />
      <ImportAliasesDialog isOpen={dialog.at === 'import'} onClose={close} />
      <RenameAliasDialog
        key={dialog.at === 'rename' ? dialog.alias.id : 'rename'}
        alias={dialog.at === 'rename' ? dialog.alias : null}
        onClose={close}
      />
      <DeleteAliasDialog alias={dialog.at === 'delete' ? dialog.alias : null} onClose={close} />
    </>
  );
}
