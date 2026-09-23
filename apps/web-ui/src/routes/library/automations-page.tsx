/**
 * Every rule the house follows.
 *
 * Search and filter sit in the header the way they do on aliases. Turning one on or off and
 * deleting one both go to the API from the row; Edit opens the editor. Creating one goes to
 * `/automations/new`.
 *
 * **Nothing runs these yet.** The engine is ARCHITECTURE.md §6.1 and is not built, so an
 * automation saved here waits rather than fires. The page says so once, at the top, rather than
 * on every row: it is a fact about the platform, not about any one rule.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { Button, TextField } from '@nebula-home/ui';

import {
  deleteAutomation,
  fetchAutomations,
  LIBRARY_QUERY_KEYS,
  updateAutomation,
} from '@/library/api';
import {
  matchesAutomationFilter,
  OPEN_AUTOMATION_FILTER,
  type AutomationFilter,
} from '@/library/automation-filters';
import { AutomationFilterButton } from '@/routes/library/automation-filter';
import { AUTOMATION_COLUMNS, AutomationRow } from '@/routes/library/automation-row';
import { LibraryPage } from '@/routes/library/library-page';

/**
 * Renders the automations page.
 *
 * @returns The page.
 */
export function AutomationsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<AutomationFilter>(OPEN_AUTOMATION_FILTER);

  // Which row is writing, rather than a single flag: two rows toggled quickly must each show
  // their own progress, and a shared boolean would put the spinner on both.
  const [busyId, setBusyId] = useState<string | null>(null);

  const automations = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.automations,
    /**
     * Reads every automation.
     *
     * @param context - What TanStack Query provides, including the cancellation signal.
     * @param context.signal - Cancels the request when the component goes away.
     * @returns Every rule the house follows.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchAutomations(signal),
  });

  const write = useMutation({
    /**
     * Sends one change.
     *
     * @param change - What the row asked for.
     */
    mutationFn: async (change: Change): Promise<void> => {
      if (change.kind === 'toggle') {
        await updateAutomation(change.id, { isEnabled: change.isEnabled });
      } else {
        await deleteAutomation(change.id);
      }
    },

    /** Clears the row's spinner and reads the collection back, whether it worked or not. */
    onSettled: async () => {
      setBusyId(null);

      // Refetched rather than patched in place. The server answers with the row as it now
      // stands, and `updatedAt` and anything a future engine touches are its to decide.
      await queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.automations });
    },
  });

  /**
   * Sends one change, remembering which row it belongs to.
   *
   * @param change - What to do.
   */
  const apply = (change: Change): void => {
    setBusyId(change.id);
    write.mutate(change);
  };

  const items = automations.data ?? [];
  const shown = items.filter((automation) => matchesAutomationFilter(automation, filter));

  return (
    <LibraryPage
      title="Automations"
      summary="Each one is a rule: when this happens, if these hold, do this. Saved here and audited — the engine that runs them is not built yet, so a rule waits rather than fires."
      noun="automation"
      count={automations.isPending ? undefined : items.length}
      tools={
        <>
          <TextField
            label="Search"
            isLabelHidden
            size="compact"
            type="search"
            placeholder="Search automations…"
            className="w-44 lg:w-72"
            value={filter.search}
            onChange={(event) => {
              setFilter({ ...filter, search: event.target.value });
            }}
          />
          <AutomationFilterButton filter={filter} onChange={setFilter} />
        </>
      }
      action={
        <Button
          size="compact"
          onClick={() => {
            void navigate('/automations/new');
          }}
        >
          New automation
        </Button>
      }
      isPending={automations.isPending}
      error={automations.error ?? write.error}
      isEmpty={items.length === 0}
      emptyMessage="No automations yet. Press New automation to write the first one."
    >
      <div className="flex flex-wrap items-center justify-end gap-2.5 text-caption text-foreground-subtle tabular">
        <span>
          {shown.length === items.length ? '' : `${String(shown.length)} of `}
          {items.length} automation{items.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="rounded-panel border border-border face-card">
        <div
          className={`${AUTOMATION_COLUMNS} border-b border-border-soft px-4 py-2.5 text-label text-foreground-subtle uppercase`}
          aria-hidden="true"
        >
          <span>Name</span>
          <span className="hidden md:block">Chain</span>
          <span className="hidden md:block">Mode</span>
          <span className="hidden md:block">Last run</span>
          <span className="hidden md:block">Status</span>
          <span />
        </div>

        {shown.length === 0 ? (
          <p className="px-4 py-3.5 text-ui text-foreground-muted">
            Nothing matches. Clear the search or widen the filters.
          </p>
        ) : (
          <ul>
            {shown.map((automation) => (
              <AutomationRow
                key={automation.id}
                automation={automation}
                isBusy={busyId === automation.id}
                onEdit={() => {
                  void navigate(`/automations/${automation.id}`);
                }}
                onToggle={(isEnabled) => {
                  apply({ kind: 'toggle', id: automation.id, isEnabled });
                }}
                onDelete={() => {
                  apply({ kind: 'delete', id: automation.id });
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </LibraryPage>
  );
}

/** One thing a row can ask for. */
type Change =
  | { readonly kind: 'toggle'; readonly id: string; readonly isEnabled: boolean }
  | { readonly kind: 'delete'; readonly id: string };
