/**
 * Derived entities and stored helpers: a table of names, addresses, readings and standing.
 *
 * Search and filter sit in the header the way they do on devices. Formula, sources and debounce
 * live only in the editor — the table is what you scan, not what you rewrite.
 */
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import type { AliasView } from '@nebula-home/contracts';
import { Badge, Button } from '@nebula-home/ui';

import { useSession } from '@/auth/session-store';
import { useListState } from '@/lib/use-list-state';
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
 * Name and address take the flexible room; reading, status and Edit stay fixed so a long
 * formula never shoved the action off the edge of a narrow window — the formula is not here.
 */
export const ALIAS_COLUMNS =
  'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 ' +
  'md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_88px_minmax(0,0.9fr)_minmax(0,1fr)_52px]';

/**
 * Renders the aliases page.
 *
 * @returns The page.
 */
export function AliasesPage() {
  const readings = useLive((state) => state.readings);
  const liveStatus = useLive((state) => state.status);
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

  const domainOptions = [...new Set(items.map((alias) => alias.domain))].map((domain) => ({
    value: domain,
    label: domain,
  }));

  return (
    <LibraryPage
      title="Aliases"
      noun="alias"
      plural="aliases"
      count={aliases.isPending ? undefined : items.length}
      shownCount={shown.length}
      tools={
        <>
          <SearchField
            placeholder="Search aliases, sources…"
            value={filter.search}
            onChange={(search) => {
              setFilter({ ...filter, search });
            }}
          />
          <AliasFilterButton filter={filter} domains={domainOptions} onChange={setFilter} />
        </>
      }
      action={
        canWrite ? (
          <Button
            size="compact"
            onClick={() => {
              void navigate('/aliases/new');
            }}
          >
            New alias
          </Button>
        ) : undefined
      }
      isPending={aliases.isPending || entities.isPending}
      error={aliases.error ?? entities.error}
      isEmpty={items.length === 0}
      emptyMessage="No aliases yet. Create a calculated reading or a stored helper."
    >
      <div className="flex flex-wrap items-center justify-end gap-2.5 text-caption text-foreground-subtle tabular">
        {liveStatus === 'live' ? (
          <Badge tone="success" size="small">
            Live
          </Badge>
        ) : (
          <Badge tone="neutral" size="small">
            {liveStatus === 'connecting' ? 'Connecting' : 'Not live'}
          </Badge>
        )}
      </div>

      <div className="overflow-hidden rounded-panel border border-border face-card">
        <div
          className={`${ALIAS_COLUMNS} border-b border-border-soft px-4 py-2.5 text-label text-foreground-subtle uppercase`}
          aria-hidden="true"
        >
          <span>Name</span>
          <span className="hidden md:block">Alias id</span>
          <span className="hidden md:block">Domain</span>
          <span className="hidden md:block">Reading</span>
          <span className="hidden md:block">Status</span>
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
            {shown.map((line) => (
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
  const { alias, readingText, isAvailable, canEdit, onEdit } = props;

  return (
    <li className="border-b border-border-soft last:border-b-0">
      <div className={`${ALIAS_COLUMNS} px-4 py-3`}>
        <span className="min-w-0 truncate text-ui font-medium text-foreground">{alias.name}</span>
        <span className="hidden min-w-0 truncate font-mono text-caption text-foreground-subtle md:block">
          {alias.entityId}
        </span>
        <span className="hidden text-ui text-foreground-muted md:block">{alias.domain}</span>
        <span
          className="hidden truncate text-ui text-foreground tabular md:block"
          title={readingText}
        >
          {readingText}
        </span>
        <span className="hidden flex-wrap items-center gap-1.5 md:flex">
          <Badge tone={alias.isEnabled ? 'success' : 'neutral'} size="small">
            {alias.isEnabled ? 'Enabled' : 'Off'}
          </Badge>
          {alias.lastError === null ? null : (
            <Badge tone="danger" size="small">
              Failing
            </Badge>
          )}
          {isAvailable ? null : (
            <Badge tone="warning" size="small">
              Unavailable
            </Badge>
          )}
        </span>
        <span className="flex justify-end">
          {canEdit ? (
            <Button variant="ghost" size="compact" onClick={onEdit}>
              Edit
            </Button>
          ) : null}
        </span>
      </div>

      {/* Narrow windows: address and standing under the name, since the grid collapses. */}
      <div className="flex flex-col gap-1 px-4 pb-3 md:hidden">
        <span className="font-mono text-caption text-foreground-subtle">{alias.entityId}</span>
        <span className="text-caption text-foreground-muted">
          {alias.domain} · {readingText}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge tone={alias.isEnabled ? 'success' : 'neutral'} size="small">
            {alias.isEnabled ? 'Enabled' : 'Off'}
          </Badge>
          {alias.lastError === null ? null : (
            <Badge tone="danger" size="small">
              Failing
            </Badge>
          )}
          {isAvailable ? null : (
            <Badge tone="warning" size="small">
              Unavailable
            </Badge>
          )}
        </span>
      </div>
    </li>
  );
}
