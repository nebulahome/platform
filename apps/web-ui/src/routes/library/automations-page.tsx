/**
 * Every rule the house follows.
 *
 * The list reads and writes: turning one on or off and deleting one both go to the API, which is
 * new — `POST`, `PATCH` and `DELETE /automations` exist as of this release. Creating one from
 * here does not, because an automation is a document rather than a name, and a form that can
 * write a trigger, a set of conditions and a list of actions is an editor rather than a dialog.
 * That is the next thing to build; until it is, `POST /automations` is reachable by anything
 * that speaks the API.
 *
 * **Nothing runs these yet.** The engine is ARCHITECTURE.md §6.1 and is not built, so an
 * automation saved here waits rather than fires. The page says so once, at the top, rather than
 * on every row: it is a fact about the platform, not about any one rule.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { Button, Panel } from '@nebula-home/ui';

import {
  deleteAutomation,
  fetchAutomations,
  LIBRARY_QUERY_KEYS,
  updateAutomation,
} from '@/library/api';
import { AutomationRow } from '@/routes/library/automation-row';
import { LibraryPage } from '@/routes/library/library-page';

/**
 * Renders the automations page.
 *
 * @returns The page.
 */
export function AutomationsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

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

  return (
    <LibraryPage
      title="Automations"
      summary="Each one is a rule: when this happens, if these hold, do this. Saved here and audited — the engine that runs them is not built yet, so a rule waits rather than fires."
      noun="automation"
      count={automations.isPending ? undefined : items.length}
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
      <Panel title="Rules">
        {items.map((automation) => (
          <AutomationRow
            key={automation.id}
            automation={automation}
            isBusy={busyId === automation.id}
            onToggle={(isEnabled) => {
              apply({ kind: 'toggle', id: automation.id, isEnabled });
            }}
            onDelete={() => {
              apply({ kind: 'delete', id: automation.id });
            }}
          />
        ))}
      </Panel>
    </LibraryPage>
  );
}

/** One thing a row can ask for. */
type Change =
  | { readonly kind: 'toggle'; readonly id: string; readonly isEnabled: boolean }
  | { readonly kind: 'delete'; readonly id: string };
