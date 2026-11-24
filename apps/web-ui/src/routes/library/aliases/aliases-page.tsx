/**
 * The aliases: grouped by the type each behaves as, with the device it sits on, its value now and
 * whether it is enabled, sorted by any column within each type. A filter by health, type, area and
 * device; a search carrying New alias; Import and Export of a whole file.
 *
 * A row's menu opens, duplicates, renames, exports, disables or deletes it. On a phone the rows
 * are cards, with no switch and no menu: the alias's own page has both.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';

import { ALIAS_HEALTHS, type AliasHealth, type AliasListItem } from '@nebulahome/contracts';
import {
  AppIcon,
  Button,
  Checkbox,
  cn,
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
import { defineMessage, type Message, text } from '@/i18n/messages';
import { DOCS_LINKS } from '@/lib/docs-links';
import { toMessage } from '@/lib/error-message';
import { signalled } from '@/lib/signalled';
import { useListState } from '@/lib/use-list-state';
import { usePaging } from '@/lib/use-paging';
import {
  ALIAS_LIST_CODEC,
  ALIAS_SORTS,
  aliasFacetCount,
  type AliasLine,
  type AliasSort,
  groupAliases,
  hasProblem,
  HEALTH_LABELS,
  HEALTH_TONE,
  matchesAliasList,
  OPEN_ALIAS_LIST_FILTER,
  sortAliasLines,
  type AliasDeviceKind,
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
import { Facet, facetChoices, FilterSheet, type FacetOption } from '@/routes/library/filter-sheet';
import { LibraryPage } from '@/routes/library/library-page';
import { NoMatches } from '@/routes/library/no-matches';
import { SearchField } from '@/routes/library/search-field';
import { useAreas } from '@/routes/library/use-areas';

/** The columns, shared by the header and every row. */
const COLUMNS =
  'grid grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1fr)_76px_40px] items-center gap-4';

/** The dot of each health in the Status facet, in the tone the list draws it in. */
const HEALTH_DOTS: Readonly<Record<AliasHealth, string>> = {
  ok: 'bg-success',
  failing: 'bg-danger',
  unavailable: 'bg-warning',
  off: 'bg-foreground-subtle',
};

/** What each choice of Device is called, in the sheet. */
const DEVICE_LABELS: Readonly<Record<AliasDeviceKind, Message>> = {
  any: defineMessage('library.aliases.anyDevice', 'Any'),
  virtual: defineMessage('library.aliases.virtualDevices', 'Virtual'),
  existing: defineMessage('library.aliases.existingDevices', 'Existing'),
};

/** The choices the loaded aliases give the dropdowns. */
type AliasChoices = {
  /** The types they behave as, in the types' order. */
  readonly types: readonly FacetOption[];

  /** The areas they are in, by key, in the house's order. */
  readonly areas: readonly FacetOption[];
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
function ValueCell(props: { readonly line: AliasLine }) {
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
    queryFn: signalled(fetchAliases),
  });
  const entities = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.entities,
    queryFn: signalled(fetchEntities),
  });

  const items = aliases.data ?? [];
  const entityById = new Map(
    (entities.data ?? []).map((entity) => [entity.entityId as string, entity]),
  );
  const lines: AliasLine[] = items.map((item) => {
    const entity = entityById.get(item.entityId);
    const reading =
      entity === undefined ? NO_READING : readingOf(entity, readings[item.entityId]).text;
    const value = item.health === 'ok' ? reading : text(HEALTH_LABELS[item.health]);

    return { item, value };
  });
  const shown = lines.filter((line) => matchesAliasList(line.item, filter));
  const paging = usePaging('aliases', ALIAS_SORTS, shown.length);
  const ordered = groupAliases(
    sortAliasLines(shown, paging.sort, paging.direction).map((line) => ({
      ...line,
      behavesAs: line.item.behavesAs,
    })),
  ).flatMap((group) => group.items);
  const groups = groupAliases(paging.rows(ordered));
  const choices: AliasChoices = {
    types: groupAliases(items).map(({ type }) => ({ value: type.id, label: typeLabel(type) })),
    areas: areas
      .filter((area) => items.some((item) => item.area?.key === area.key))
      .map((area) => ({ value: area.key, label: area.name })),
  };

  /** Unsets every facet, keeping what was typed. */
  const clearFacets = (): void => {
    setFilter({ ...OPEN_ALIAS_LIST_FILTER, search: filter.search });
  };

  /**
   * Ticks or unticks one health.
   *
   * @param health - The health.
   * @param isChecked - Whether it is now ticked.
   */
  const toggleHealth = (health: AliasHealth, isChecked: boolean): void => {
    setFilter({
      ...filter,
      statuses: isChecked
        ? ALIAS_HEALTHS.filter((each) => each === health || filter.statuses.includes(each))
        : filter.statuses.filter((each) => each !== health),
    });
  };

  /**
   * A heading that sorts the table, in its header cell.
   *
   * @param column - The column it sorts by.
   * @param label - The heading.
   * @returns The cell.
   */
  const sortCell = (column: AliasSort, label: string): ReactNode => {
    return <SortHeader paging={paging} column={column} label={label} />;
  };

  /** Opens New alias. */
  const openNew = (): void => {
    setDialog({ at: 'new' });
  };

  const newButton = canWrite ? (
    <Button size="compact" className="shrink-0" onClick={openNew}>
      <AppIcon id="plus" size={14} />
      {/* A phone keeps the room for the search it sits in: the plus alone, named to a reader. */}
      <span className="max-sm:sr-only">{t('library.aliases.newAlias', 'New alias')}</span>
    </Button>
  ) : undefined;

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
              <FilterSheet
                label={t('library.aliases.narrow', 'Narrow the aliases')}
                count={aliasFacetCount(filter)}
                onClear={clearFacets}
              >
                <Facet
                  title={t('library.aliases.status', 'Status')}
                  aside={
                    filter.statuses.length === 0
                      ? undefined
                      : t('library.aliases.selected', {
                          count: filter.statuses.length,
                          defaultValue_one: '{{count}} selected',
                          defaultValue_other: '{{count}} selected',
                        })
                  }
                >
                  <div className="flex flex-col gap-3">
                    {ALIAS_HEALTHS.map((health) => {
                      const count = items.filter((item) => item.health === health).length;

                      return (
                        <Checkbox
                          key={health}
                          // A health no alias has stays offered, quieter: the list may yet have one.
                          className={cn(count === 0 && 'opacity-45')}
                          label={
                            <span className="flex items-center gap-2">
                              <span
                                aria-hidden="true"
                                className={cn('size-1.5 rounded-full', HEALTH_DOTS[health])}
                              />
                              {text(HEALTH_LABELS[health])}
                            </span>
                          }
                          count={count}
                          isChecked={filter.statuses.includes(health)}
                          onChange={(isChecked) => {
                            toggleHealth(health, isChecked);
                          }}
                        />
                      );
                    })}
                  </div>
                </Facet>

                {choices.types.length < 2 && choices.areas.length < 2 ? null : (
                  // Type and Area side by side: two facets sharing one line, half a gutter between.
                  <div className="grid auto-cols-fr grid-flow-col border-t border-border">
                    {choices.types.length < 2 ? null : (
                      <Facet
                        title={t('library.aliases.type', 'Type')}
                        className={cn('border-t-0', choices.areas.length >= 2 && 'pr-1.5')}
                      >
                        <SelectField
                          label={t('library.aliases.type', 'Type')}
                          isLabelHidden
                          size="compact"
                          options={facetChoices(
                            choices.types,
                            filter.type,
                            t('library.aliases.anyType', 'Any type'),
                            true,
                          )}
                          value={filter.type}
                          onChange={(type) => {
                            setFilter({ ...filter, type });
                          }}
                        />
                      </Facet>
                    )}
                    {choices.areas.length < 2 ? null : (
                      <Facet
                        title={t('library.aliases.area', 'Area')}
                        className={cn('border-t-0', choices.types.length >= 2 && 'pl-1.5')}
                      >
                        <SelectField
                          label={t('library.aliases.area', 'Area')}
                          isLabelHidden
                          size="compact"
                          options={facetChoices(
                            choices.areas,
                            filter.area,
                            t('library.aliases.anyArea', 'Any area'),
                            true,
                          )}
                          value={filter.area}
                          onChange={(area) => {
                            setFilter({ ...filter, area });
                          }}
                        />
                      </Facet>
                    )}
                  </div>
                )}

                <Facet title={t('library.aliases.device', 'Device')}>
                  <Segmented
                    label={t('library.aliases.device', 'Device')}
                    size="compact"
                    isFilled
                    options={(['any', 'virtual', 'existing'] as const).map((value) => ({
                      value,
                      label: text(DEVICE_LABELS[value]),
                    }))}
                    value={filter.device}
                    onChange={(device) => {
                      setFilter({ ...filter, device });
                    }}
                  />
                </Facet>
              </FilterSheet>
              <SearchField
                placeholder={t('library.aliases.search', 'Search')}
                value={filter.search}
                // On a phone the pill takes what the page's margins, the Filter and the menu leave.
                className={
                  newButton === undefined ? '' : 'w-[min(24rem,calc(100vw-12rem))] lg:w-96'
                }
                action={newButton}
                onChange={(search) => {
                  setFilter({ ...filter, search });
                }}
              />
            </>
          )
        }
        action={
          <span className="flex items-center gap-2">
            {/* With no list there is no search to carry New alias: it stands alone. */}
            {items.length === 0 ? newButton : null}
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
                {sortCell('name', t('library.aliases.name', 'Name'))}
                {sortCell('device', t('library.aliases.device', 'Device'))}
                {sortCell('now', t('library.aliases.now', 'Now'))}
                {sortCell('enabled', t('library.aliases.enabled', 'Enabled'))}
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
