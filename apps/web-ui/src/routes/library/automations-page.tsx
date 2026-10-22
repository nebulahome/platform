/**
 * Every rule the house follows (board N-Automations).
 *
 * A table sorted by Name or Last run, a page at a time, the page and its size in the address
 * beside the search and the filter. Turning one on or off writes from the row; deleting one asks
 * first. The last run of each comes with the list, and the live channel keeps it current as runs
 * start and end.
 *
 * A house with no automations yet is shown what one is for and where to start, in the middle of
 * the page.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import type { AutomationView } from '@nebulahome/contracts';
import { AppIcon, Button, EmptyState, Modal, TableFooter, toast } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { SortHeader } from '@/components/sort-header';
import type { BlockNames } from '@/lib/block-summary';
import { DOCS_LINKS } from '@/lib/docs-links';
import { toMessage } from '@/lib/error-message';
import { useListState } from '@/lib/use-list-state';
import { usePaging } from '@/lib/use-paging';
import {
  createAutomation,
  deleteAutomation,
  fetchAutomations,
  fetchScenes,
  LIBRARY_QUERY_KEYS,
  updateAutomation,
} from '@/library/api';
import { draftFrom, toCreate } from '@/library/automation-draft';
import {
  AUTOMATION_FILTER_CODEC,
  isAutomationNarrowing,
  matchesAutomationFilter,
  OPEN_AUTOMATION_FILTER,
} from '@/library/automation-filters';
import { AutomationFilterButton } from '@/routes/library/automation-filter';
import { AUTOMATION_COLUMNS, AutomationRow } from '@/routes/library/automation-row';
import { useEntityDirectory } from '@/routes/library/entity-picker/use-entity-directory';
import { LibraryImportFlow, type ImportResult } from '@/routes/library/library-import-flow';
import { LibraryPage } from '@/routes/library/library-page';
import { NoMatches } from '@/routes/library/no-matches';
import { SearchField } from '@/routes/library/search-field';

/**
 * Renders the automations page.
 *
 * @returns The page.
 */
export function AutomationsPage() {
  const { t } = useTranslation();

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const can = useSession((state) => state.can);
  const canWrite = can('automation:write');
  const [filter, setFilter] = useListState(AUTOMATION_FILTER_CODEC);
  const [deleting, setDeleting] = useState<AutomationView | null>(null);

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
  const scenes = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.scenes,
    /**
     * Reads the scenes, to name them in the chains.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request.
     * @returns The scenes.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchScenes(signal),
  });
  const directory = useEntityDirectory(false);

  const names = useMemo<BlockNames>(() => {
    const entityNames = new Map(
      directory.entities.map((entity) => [String(entity.entityId), entity.name]),
    );
    const sceneNames = new Map((scenes.data ?? []).map((scene) => [scene.key, scene.name]));
    const automationNames = new Map((automations.data ?? []).map((one) => [one.key, one.name]));

    return {
      /**
       * An entity's name.
       *
       * @param entityId - The address.
       * @returns Its name, or undefined.
       */
      entity: (entityId) => entityNames.get(entityId),
      /**
       * A scene's name.
       *
       * @param sceneKey - The key.
       * @returns Its name, or undefined.
       */
      scene: (sceneKey) => sceneNames.get(sceneKey),
      /**
       * An automation's name.
       *
       * @param automationKey - The key.
       * @returns Its name, or undefined.
       */
      automation: (automationKey) => automationNames.get(automationKey),
    };
  }, [automations.data, directory.entities, scenes.data]);

  const write = useMutation({
    /**
     * Sends one change.
     *
     * @param change - What the row asked for.
     */
    mutationFn: async (change: Change): Promise<void> => {
      const key = [...LIBRARY_QUERY_KEYS.automations, change.id];

      // The editor reads the automation under its own key, and opens on whatever that holds:
      // left alone, it would open on the switch as it was before this flip.
      if (change.kind === 'toggle') {
        queryClient.setQueryData(
          key,
          await updateAutomation(change.id, { isEnabled: change.isEnabled }),
        );
      } else {
        await deleteAutomation(change.id);
        queryClient.removeQueries({ queryKey: key, exact: true });
      }
    },

    /**
     * Says what was done.
     *
     * @param result - Nothing.
     * @param change - What the row asked for.
     */
    onSuccess: (result, change) => {
      const name = automations.data?.find((automation) => automation.id === change.id)?.name ?? '';

      toast.success({
        title:
          change.kind === 'delete'
            ? t('library.automations.removed', '{{name}} removed', { name })
            : change.isEnabled
              ? t('library.automations.turnedOn', '{{name}} turned on', { name })
              : t('library.automations.turnedOff', '{{name}} turned off', { name }),
      });
    },

    /**
     * Says why the change did not happen.
     *
     * @param error - What went wrong.
     * @param change - What the row asked for.
     */
    onError: (error, change) => {
      toast.error({
        title:
          change.kind === 'delete'
            ? t('library.automations.notRemoved', 'The automation was not removed')
            : t('library.automations.notChanged', 'The automation was not changed'),
        message: toMessage(error),
      });
    },

    /** Clears the row's spinner and reads the collection back, whether it worked or not. */
    onSettled: async () => {
      setBusyId(null);
      setDeleting(null);

      // Refetched rather than patched in place. The server answers with the row as it now
      // stands, and what the engine touches - its last run - is the engine's to decide.
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
  const paging = usePaging('automations', SORTS, shown.length);
  const rows = paging.rows(
    [...shown].sort((left, right) => {
      const byName = left.name.localeCompare(right.name);
      const order =
        paging.sort === 'run'
          ? (right.lastRun?.time.getTime() ?? 0) - (left.lastRun?.time.getTime() ?? 0) || byName
          : byName;

      return paging.direction === 'asc' ? order : -order;
    }),
  );

  const newButton = canWrite ? (
    <Button
      onClick={() => {
        void navigate('/automations/new');
      }}
    >
      <AppIcon id="plus" size={15} />
      {t('library.automations.newAutomation', 'New automation')}
    </Button>
  ) : undefined;

  /**
   * Creates every automation a file brought in, one after another, and says how it went.
   *
   * @param result - What the import produced.
   */
  const importAll = async (result: ImportResult): Promise<void> => {
    if (result.kind !== 'automations') {
      return;
    }

    const failed: string[] = [];

    for (const item of result.items) {
      const body = toCreate(draftFrom(item));

      try {
        if (!body.ok) {
          throw new Error(body.problems.join(' '));
        }

        // eslint-disable-next-line no-await-in-loop -- one at a time, so a big file does not flood the API and the order holds
        await createAutomation(body.body);
      } catch (error: unknown) {
        failed.push(`${item.name}: ${toMessage(error)}`);
      }
    }

    await queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.automations });

    const imported = result.items.length - failed.length;

    if (failed.length === 0) {
      toast.success({
        title: t('library.automations.imported', {
          count: imported,
          defaultValue_one: '1 automation imported',
          defaultValue_other: '{{count}} automations imported',
        }),
      });
    } else {
      toast.warning({
        title: t('library.automations.importedSome', '{{imported}} of {{total}} imported', {
          imported: String(imported),
          total: String(result.items.length),
        }),
        message: failed.slice(0, 3).join(' · '),
      });
    }
  };

  const actions = canWrite ? (
    <span className="flex items-center gap-2">
      <LibraryImportFlow
        kind="automations"
        takenKeys={items.map((automation) => automation.key)}
        onImport={importAll}
      >
        {(choose) => (
          <Button variant="ghost" onClick={choose}>
            <AppIcon id="upload" size={15} />
            {t('library.automations.import', 'Import')}
          </Button>
        )}
      </LibraryImportFlow>
      {newButton}
    </span>
  ) : undefined;

  return (
    <LibraryPage
      title={t('library.automations.automations', 'Automations')}
      counted={(count) =>
        t('library.automations.count', {
          count,
          defaultValue_one: '{{count}} automation',
          defaultValue_other: '{{count}} automations',
        })
      }
      count={automations.isPending ? undefined : items.length}
      shownCount={shown.length}
      summary={[`${String(items.filter((automation) => automation.isEnabled).length)} enabled`]}
      tools={
        <>
          <SearchField
            placeholder={t('library.automations.search', 'Search')}
            value={filter.search}
            onChange={(search) => {
              setFilter({ ...filter, search });
            }}
          />
          <AutomationFilterButton filter={filter} onChange={setFilter} />
        </>
      }
      action={actions}
      isPending={automations.isPending}
      error={automations.error}
      isEmpty={items.length === 0}
      empty={
        <EmptyState
          icon={<AppIcon id="zap" size={28} />}
          title={t('library.automations.createYourFirstAutomation', 'Create your first automation')}
          description={t(
            'library.automations.automationLetsTheHouse',
            'An automation lets the house act on its own: choose what wakes it, the checks it makes first, and the steps it then takes - lights at sunset, the heating off when a window opens.',
          )}
          action={newButton}
          learnMoreHref={DOCS_LINKS.automations}
        />
      }
    >
      <div className="rounded-panel border border-border bg-surface">
        <div
          className={`${AUTOMATION_COLUMNS} border-b border-border px-5 py-3 font-mono text-label text-foreground-subtle uppercase`}
        >
          <SortHeader
            label={t('library.automations.name', 'Name')}
            isSorted={paging.sort === 'name'}
            direction={paging.direction}
            onSort={() => {
              paging.toggleSort('name');
            }}
            className="justify-self-start"
          />
          <span className="hidden md:block">{t('library.automations.mode', 'Mode')}</span>
          <span>{t('library.automations.enabled', 'Enabled')}</span>
          <SortHeader
            label={t('library.automations.lastRun', 'Last run')}
            isSorted={paging.sort === 'run'}
            direction={paging.direction}
            onSort={() => {
              paging.toggleSort('run');
            }}
            className="hidden justify-self-start md:inline-flex"
          />
          <span />
        </div>

        {shown.length === 0 ? (
          <div className="p-4">
            <NoMatches
              query={filter.search}
              onClear={
                isAutomationNarrowing(filter)
                  ? () => {
                      setFilter(OPEN_AUTOMATION_FILTER);
                    }
                  : undefined
              }
            />
          </div>
        ) : (
          <ul>
            {rows.map((automation) => (
              <AutomationRow
                key={automation.id}
                automation={automation}
                names={names}
                canWrite={canWrite}
                isBusy={busyId === automation.id}
                onEdit={() => {
                  void navigate(`/automations/${automation.id}`);
                }}
                onToggle={(isEnabled) => {
                  apply({ kind: 'toggle', id: automation.id, isEnabled });
                }}
                onDelete={() => {
                  setDeleting(automation);
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

      <Modal
        isOpen={deleting !== null}
        size="small"
        title={
          deleting === null
            ? t('library.automations.deleteThisAutomation', 'Delete this automation?')
            : t('library.automations.deleteName', 'Delete {{name}}?', { name: deleting.name })
        }
        description={t(
          'library.automations.itStopsRunningAt',
          'It stops running at once. Its past runs stay in the history until they expire.',
        )}
        onClose={() => {
          setDeleting(null);
        }}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setDeleting(null);
              }}
            >
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              variant="danger"
              isBusy={write.isPending}
              onClick={() => {
                if (deleting !== null) {
                  apply({ kind: 'delete', id: deleting.id });
                }
              }}
            >
              {t('common.delete', 'Delete')}
            </Button>
          </>
        }
      >
        {null}
      </Modal>
    </LibraryPage>
  );
}

/** The columns the table sorts by; the first is the order it opens in. */
const SORTS = ['name', 'run'] as const;

/** One thing a row can ask for. */
type Change =
  | { readonly kind: 'toggle'; readonly id: string; readonly isEnabled: boolean }
  | { readonly kind: 'delete'; readonly id: string };
