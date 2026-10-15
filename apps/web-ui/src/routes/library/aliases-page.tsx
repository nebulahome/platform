/**
 * Derived entities and stored helpers: a table of names, what each is, what it reads now, and
 * what it is worked out from.
 *
 * As the board draws it: the name with its address under it, its kind, its value, how many sources
 * it reads, and a menu; a search shows as a chip that says how many of how many it found, with
 * Clear; the table a page at a time. Formula, sources and debounce live only in the editor - the
 * table is what you scan, not what you rewrite.
 */
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';

import type { AliasView } from '@nebulahome/contracts';
import {
  AppIcon,
  Button,
  EmptyState,
  FilterChips,
  OverflowMenu,
  Pill,
  TableFooter,
} from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { SortHeader } from '@/components/sort-header';
import { DOCS_LINKS } from '@/lib/docs-links';
import { useListState } from '@/lib/use-list-state';
import { usePaging } from '@/lib/use-paging';
import {
  ALIAS_FILTER_CODEC,
  byAliasName,
  isAliasNarrowing,
  matchesAliasFilter,
  OPEN_ALIAS_FILTER,
} from '@/library/alias-filters';
import { fetchAliases, fetchEntities, LIBRARY_QUERY_KEYS } from '@/library/api';
import { NO_READING, readingOf } from '@/library/entity-reading';
import { useLive } from '@/live/live-store';
import { AliasFilterButton } from '@/routes/library/alias-filter';
import { LibraryPage } from '@/routes/library/library-page';
import { NoMatches } from '@/routes/library/no-matches';
import { SearchField } from '@/routes/library/search-field';

/**
 * The column widths, shared by the header and every row so they line up.
 *
 * The name and its address take the flexible room; kind, value, sources and the menu stay fixed.
 */
export const ALIAS_COLUMNS =
  'grid grid-cols-[minmax(0,1fr)_auto_36px] items-center gap-4 ' +
  'md:grid-cols-[minmax(0,1fr)_104px_minmax(0,0.8fr)_80px_36px]';

/** The columns the table sorts by; the first is the order it opens in. */
const SORTS = ['name', 'kind'] as const;

/**
 * Renders the aliases page.
 *
 * @returns The page.
 */
export function AliasesPage() {
  const { t } = useTranslation();

  const readings = useLive((state) => state.readings);
  const can = useSession((state) => state.can);
  const canWrite = can('alias:write');
  const navigate = useNavigate();
  const [filter, setFilter] = useListState(ALIAS_FILTER_CODEC);

  const aliases = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.aliases,
    /**
     * Reads every derived entity.
     *
     * @param context - What TanStack Query provides, including the cancellation signal.
     * @param context.signal - Cancels the request when the component goes away.
     * @returns Every alias.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchAliases(signal),
  });

  const entities = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.entities,
    /**
     * Reads every entity, so a row can show the alias's current reading.
     *
     * @param context - What TanStack Query provides, including the cancellation signal.
     * @param context.signal - Cancels the request when the component goes away.
     * @returns Every entity.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchEntities(signal),
  });

  const items = byAliasName(aliases.data ?? []);
  const entityById = new Map((entities.data ?? []).map((entity) => [entity.entityId, entity]));

  const lines = items.map((alias) => {
    const entity = entityById.get(alias.entityId);
    // An alias whose entity is missing reads nothing at all, which is what unavailable means.
    const reading =
      entity === undefined
        ? { text: NO_READING, isAvailable: false }
        : readingOf(entity, readings[alias.entityId]);

    return { alias, reading };
  });

  const shown = lines.filter((line) =>
    matchesAliasFilter(line.alias, filter, line.reading.isAvailable),
  );
  const paging = usePaging('aliases', SORTS, shown.length);
  const rows = paging.rows(
    [...shown].sort((left, right) => {
      const byName = left.alias.name.localeCompare(right.alias.name);
      const order =
        paging.sort === 'kind' ? left.alias.kind.localeCompare(right.alias.kind) || byName : byName;

      return paging.direction === 'asc' ? order : -order;
    }),
  );

  const domainOptions = [...new Set(items.map((alias) => alias.domain))].map((domain) => ({
    value: domain,
    label: domain,
  }));
  const search = filter.search.trim();

  return (
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
      summary={[
        `${String(items.filter((alias) => alias.kind === 'calculated').length)} calculated`,
        `${String(items.filter((alias) => alias.kind === 'stored').length)} stored`,
      ]}
      tools={
        <>
          <SearchField
            placeholder={t('library.aliases.searchAliasesSources', 'Search aliases, sources…')}
            value={filter.search}
            onChange={(next) => {
              setFilter({ ...filter, search: next });
            }}
          />
          <AliasFilterButton filter={filter} domains={domainOptions} onChange={setFilter} />
        </>
      }
      action={
        canWrite ? (
          <Button
            onClick={() => {
              void navigate('/aliases/new');
            }}
          >
            <AppIcon id="plus" size={15} />
            {t('library.aliases.newAlias', 'New alias')}
          </Button>
        ) : undefined
      }
      filters={
        search === '' ? undefined : (
          <FilterChips
            filters={[
              {
                id: 'search',
                key: 'Search',
                value: search,
                /** Clears the search. */
                onRemove: () => {
                  setFilter({ ...filter, search: '' });
                },
              },
            ]}
            summary={t('library.shownOfTotal', '{{shown}} of {{total}}', {
              shown: shown.length,
              total: items.length,
            })}
            onClearAll={() => {
              setFilter(OPEN_ALIAS_FILTER);
            }}
          />
        )
      }
      isPending={aliases.isPending || entities.isPending}
      error={aliases.error ?? entities.error}
      isEmpty={items.length === 0}
      empty={
        <EmptyState
          icon={<AppIcon id="sigma" size={28} />}
          title={t('library.aliases.createYourFirstAlias', 'Create your first alias')}
          description={t(
            'library.aliases.aliasIsAnEntity',
            'An alias is an entity you define: a reading worked out from others, like the average temperature of the house, or a helper - a switch, a number - that automations set and read.',
          )}
          action={
            canWrite ? (
              <Button
                onClick={() => {
                  void navigate('/aliases/new');
                }}
              >
                <AppIcon id="plus" size={15} />
                {t('library.aliases.newAlias', 'New alias')}
              </Button>
            ) : undefined
          }
          learnMoreHref={DOCS_LINKS.aliases}
        />
      }
    >
      <div className="overflow-hidden rounded-card border border-border bg-surface">
        <div
          className={`${ALIAS_COLUMNS} border-b border-border px-5 py-3 font-mono text-label text-foreground-subtle uppercase`}
        >
          <SortHeader
            label={t('library.aliases.name', 'Name')}
            isSorted={paging.sort === 'name'}
            direction={paging.direction}
            onSort={() => {
              paging.toggleSort('name');
            }}
            className="justify-self-start"
          />
          <SortHeader
            label={t('library.aliases.kind', 'Kind')}
            isSorted={paging.sort === 'kind'}
            direction={paging.direction}
            onSort={() => {
              paging.toggleSort('kind');
            }}
            className="hidden justify-self-start md:inline-flex"
          />
          <span>{t('library.aliases.value', 'Value')}</span>
          <span className="hidden md:block">{t('library.aliases.sources', 'Sources')}</span>
          <span />
        </div>

        {shown.length === 0 ? (
          <div className="p-4">
            <NoMatches
              query={filter.search}
              onClear={
                isAliasNarrowing(filter)
                  ? () => {
                      setFilter(OPEN_ALIAS_FILTER);
                    }
                  : undefined
              }
            />
          </div>
        ) : (
          <ul>
            {rows.map((line) => (
              <AliasRow
                key={line.alias.id}
                alias={line.alias}
                readingText={line.reading.text}
                isAvailable={line.reading.isAvailable}
                canEdit={canWrite}
                onEdit={() => {
                  void navigate(`/aliases/${line.alias.id}`);
                }}
              />
            ))}
          </ul>
        )}

        <TableFooter
          page={paging.page}
          size={paging.size}
          total={shown.length}
          onPage={paging.setPage}
          onSize={paging.setSize}
        />
      </div>
    </LibraryPage>
  );
}

/** What one row needs. */
type AliasRowProps = {
  readonly alias: AliasView;
  readonly readingText: string;
  readonly isAvailable: boolean;
  readonly canEdit: boolean;
  readonly onEdit: () => void;
};

/**
 * Renders one alias in the table.
 *
 * @param props - See {@link AliasRowProps}.
 * @returns The row.
 */
function AliasRow(props: AliasRowProps) {
  const { t } = useTranslation();

  const { alias, readingText, isAvailable, canEdit, onEdit } = props;
  const sources = alias.kind === 'calculated' ? alias.sources.length : null;

  return (
    <li className={`${ALIAS_COLUMNS} border-t border-border px-5 py-3 first:border-t-0`}>
      <span className="flex min-w-0 flex-col gap-0.5">
        <Link
          to={`/aliases/${alias.id}`}
          className="truncate text-ui font-medium text-foreground transition-colors hover:text-primary"
        >
          {alias.name}
        </Link>
        <span className="truncate font-mono text-mono-caption text-foreground-subtle">
          {alias.entityId}
        </span>
      </span>
      <span className="hidden md:block">
        <Pill tone={alias.kind === 'calculated' ? 'accent' : 'neutral'}>
          {alias.kind === 'calculated'
            ? t('library.aliases.calculated', 'Calculated')
            : t('library.aliases.stored', 'Stored')}
        </Pill>
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span
          className="truncate font-mono text-mono-ui text-foreground tabular"
          title={readingText}
        >
          {readingText}
        </span>
        {alias.isEnabled && alias.lastError === null && isAvailable ? null : (
          <span className="flex flex-wrap gap-x-2 text-caption">
            {alias.isEnabled ? null : (
              <span className="text-foreground-subtle">{t('common.off', 'Off')}</span>
            )}
            {alias.lastError === null ? null : (
              <span className="text-danger">{t('library.aliases.failing', 'Failing')}</span>
            )}
            {isAvailable ? null : (
              <span className="text-warning">
                {t('library.aliases.unavailable', 'Unavailable')}
              </span>
            )}
          </span>
        )}
      </span>
      <span className="hidden font-mono text-mono-ui text-foreground-muted tabular md:block">
        {sources ?? '—'}
      </span>
      {canEdit ? (
        <OverflowMenu
          label={t('library.aliases.moreForName', 'More for {{name}}', { name: alias.name })}
          items={[{ label: t('common.edit', 'Edit'), icon: 'pencil', onSelect: onEdit }]}
        />
      ) : (
        <span />
      )}
    </li>
  );
}
