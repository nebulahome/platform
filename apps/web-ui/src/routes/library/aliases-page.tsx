/**
 * Derived entities: readings the house computes rather than measures.
 *
 * An alias has a name in words and an address underneath it. The name is how somebody finds it;
 * the address is what an automation or the API refers to, which is why renaming one never breaks
 * anything pointing at it — and why both are on the row.
 *
 * The formula is shown as it was written. It is the whole content of an alias, and a page that
 * hid it behind a row that has to be opened would be a page of names.
 *
 * Read-only: alias writes wait on the alias engine, which owns the dependency graph and the
 * cycle detection that stops one alias from reading another that reads it back (API.md §10).
 */
import { useQuery } from '@tanstack/react-query';

import { Badge, Panel, PanelRow } from '@nebula-home/ui';

import { relativeTime } from '@/lib/format-time';
import { fetchAliases, LIBRARY_QUERY_KEYS } from '@/library/api';
import { LibraryPage } from '@/routes/library/library-page';

/**
 * Renders the aliases page.
 *
 * @returns The page.
 */
export function AliasesPage() {
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

  const items = aliases.data ?? [];

  return (
    <LibraryPage
      title="Aliases"
      summary="An entity computed from others. The name is how you find it; the address underneath is what automations refer to, so renaming one breaks nothing."
      noun="alias"
      count={aliases.isPending ? undefined : items.length}
      isPending={aliases.isPending}
      error={aliases.error}
      isEmpty={items.length === 0}
      emptyMessage="No aliases yet. Writing one waits on the alias engine, which owns cycle detection."
    >
      <Panel title="Derived">
        {items.map((alias) => (
          <PanelRow
            key={alias.id}
            title={
              <span className="flex items-center gap-2.5">
                <span>{alias.name}</span>
                {alias.isEnabled ? null : <Badge tone="neutral">Off</Badge>}
                {alias.lastError === null ? null : <Badge tone="danger">Failing</Badge>}
              </span>
            }
            note={
              <span className="flex flex-col gap-1">
                <span className="font-mono">{alias.entityId}</span>
                <span className="font-mono text-foreground-subtle">{alias.expression}</span>

                {alias.lastError === null ? null : (
                  <span className="text-danger">{alias.lastError}</span>
                )}
              </span>
            }
            control={
              <span className="flex items-center gap-2.5">
                <Badge tone="neutral" size="small">
                  {alias.capability}
                </Badge>
                <span className="hidden text-caption text-foreground-subtle tabular sm:inline">
                  {alias.lastEvaluatedAt === null
                    ? 'never read'
                    : relativeTime(alias.lastEvaluatedAt)}
                </span>
              </span>
            }
          />
        ))}
      </Panel>
    </LibraryPage>
  );
}
