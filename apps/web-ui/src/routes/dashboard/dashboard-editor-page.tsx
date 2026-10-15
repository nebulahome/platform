/**
 * Laying a dashboard out: the grid unlocked, cards dragged, resized, added and removed, and the
 * inspector beside the grid for the card chosen.
 *
 * Reached from Configuration › Dashboards by whoever manages the dashboards, never from the
 * Dashboards page itself, which only shows. Editing works on a copy of the layout (see
 * `dashboard-draft.ts`): Done saves the whole layout in one request - and every person the
 * dashboard is assigned to sees it the next time their page reads - and Cancel throws the copy
 * away; both go back to the list. The copy survives leaving the page, and closing the tab asks
 * first. A window too narrow for four columns cannot edit, and says so.
 *
 * As the board draws it: the rail collapses to give the grid room; a banner says what is being
 * edited and who sees the change - everyone the dashboard is shown to - with Add card, Add group,
 * Cancel and Done beside it; each card shows its size and the way to remove it.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';

import {
  dashboardLayoutSchema,
  type DashboardCard,
  type DashboardLayout,
  type DashboardView,
} from '@nebulahome/contracts';
import { AppIcon, Button, Note } from '@nebulahome/ui';

import {
  DASHBOARD_QUERY_KEYS,
  fetchAssignees,
  fetchManagedDashboards,
  updateDashboard,
} from '@/dashboard/api';
import { addCard, findCard, removeCard } from '@/dashboard/dashboard-layout';
import { containerCard } from '@/dashboard/new-cards';
import { listFormat } from '@/i18n/formatters';
import { toMessage } from '@/lib/error-message';
import { AddCardDialog } from '@/routes/dashboard/add-card-dialog';
import { CardInspector } from '@/routes/dashboard/card-inspector';
import { isDraftDirty, useDashboardDraft } from '@/routes/dashboard/dashboard-draft';
import { DashboardGrid } from '@/routes/dashboard/dashboard-grid';
import { DASHBOARDS_CONFIGURATION_PATH, PageMessage } from '@/routes/dashboard/dashboard-page';
import { useDashboardData } from '@/routes/dashboard/use-dashboard-data';
import { DetailHeader } from '@/routes/library/detail-page';

/**
 * The group new cards go into: the one chosen, or the one holding the card chosen.
 *
 * @param layout - The layout.
 * @param selectedId - The card chosen, if any.
 * @returns The group's id, or null for the page.
 */
function groupInUse(layout: DashboardLayout, selectedId: string | null): string | null {
  if (selectedId === null) {
    return null;
  }

  const found = findCard(layout, selectedId);

  if (found === null) {
    return null;
  }

  return found.card.type === 'container' ? found.card.id : found.parentId;
}

/** What the empty page needs. */
type EmptyPageProps = {
  /** The dashboard's name. */
  readonly name: string;

  /** Opens the card picker. */
  readonly onAddCard: () => void;

  /** Adds a group. */
  readonly onAddGroup: () => void;
};

/**
 * What a dashboard with nothing on it shows while it is edited: the two rows the grid keeps,
 * drawn as the place cards will go, with the two ways to start. It sits where the first card will
 * land rather than under an empty gap, which is where the button used to float.
 *
 * @param props - See {@link EmptyPageProps}.
 * @returns The empty page.
 */
function EmptyPage(props: EmptyPageProps) {
  const { t } = useTranslation();

  const { name, onAddCard, onAddGroup } = props;

  return (
    <div className="flex grow flex-col items-center justify-center gap-4 rounded-panel border border-dashed border-border-strong bg-surface/40 px-6 text-center">
      <span className="flex size-11 items-center justify-center rounded-tile bg-primary/10 text-primary">
        <AppIcon id="layout-grid" size={20} />
      </span>
      <span className="flex flex-col gap-1">
        <span className="text-title font-medium text-foreground">
          {t('dashboard.dashboardEditor.nothingOnNameYet', 'Nothing on {{name}} yet', { name })}
        </span>
        <span className="text-ui-sm text-foreground-muted">
          {t(
            'dashboard.dashboardEditor.addCardsForWhat',
            'Add cards for what you want at hand, or a group to gather them.',
          )}
        </span>
      </span>
      <span className="flex flex-wrap items-center justify-center gap-2.5">
        <Button onClick={onAddCard}>
          <AppIcon id="plus" size={15} />
          {t('dashboard.dashboardEditor.addCard', 'Add card')}
        </Button>
        <Button variant="ghost" onClick={onAddGroup}>
          <AppIcon id="layout-grid" size={15} />
          {t('dashboard.dashboardEditor.addGroup', 'Add group')}
        </Button>
      </span>
    </div>
  );
}

/**
 * Renders the editor for the dashboard in the address.
 *
 * @returns The page.
 */
export function DashboardEditorPage() {
  const { t } = useTranslation();

  const { dashboardId = '' } = useParams();

  const dashboards = useQuery({
    queryKey: DASHBOARD_QUERY_KEYS.managed,
    /**
     * Reads every dashboard, for the one being laid out.
     *
     * @param context - What TanStack Query provides, including the cancellation signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The dashboards.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchManagedDashboards(signal),
  });

  const dashboard = dashboards.data?.find((candidate) => candidate.id === dashboardId);

  if (dashboard === undefined) {
    return (
      <div className="flex min-h-0 grow flex-col">
        <DetailHeader
          crumbs={[
            {
              to: DASHBOARDS_CONFIGURATION_PATH,
              label: t('dashboard.dashboardEditor.dashboards', 'Dashboards'),
            },
          ]}
          title={t('dashboard.dashboardEditor.layout', 'Layout')}
        />
        <div className="p-6">
          <PageMessage>
            {dashboards.isPending
              ? t('dashboard.dashboardEditor.reading', 'Reading…')
              : dashboards.error === null
                ? t(
                    'dashboard.dashboardEditor.thereIsNoDashboard',
                    'There is no dashboard with that id.',
                  )
                : toMessage(dashboards.error)}
          </PageMessage>
        </div>
      </div>
    );
  }

  return <Editor key={dashboard.id} dashboard={dashboard} />;
}

/**
 * The editor itself, once the dashboard is read.
 *
 * @param props - The dashboard.
 * @param props.dashboard - As the server has it.
 * @returns The page.
 */
function Editor(props: { readonly dashboard: DashboardView }) {
  const { t } = useTranslation();

  const { dashboard } = props;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const draft = useDashboardDraft();
  const isEditing = draft.dashboardId === dashboard.id && draft.layout !== null;
  const layout: DashboardLayout = isEditing ? draft.layout : dashboard.layout;
  const data = useDashboardData(layout);
  const [isAdding, setAdding] = useState(false);
  const [isNarrow, setNarrow] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const isDirty = isEditing && isDraftDirty(draft);
  const assignees = useQuery({
    queryKey: DASHBOARD_QUERY_KEYS.assignees,
    staleTime: 60_000,

    /**
     * Reads the people a dashboard can be shown to, for who sees this one.
     *
     * @param context - The abort signal.
     * @param context.signal - Cancels the request.
     * @returns The people.
     */
    queryFn: async ({ signal }) => fetchAssignees(signal),
  });
  const viewers = dashboard.userIds.flatMap((id) => {
    const person = assignees.data?.find((each) => each.id === id);

    return person === undefined ? [] : [person.displayName];
  });
  const scenes = [...data.sceneById.values()];
  const { begin } = draft;
  const hasBegun = useRef(false);

  // A copy left from an earlier visit to this dashboard is picked up where it was left; any other
  // dashboard's is replaced. Once per visit: Done and Cancel end the copy on their way out, and
  // must not find a fresh one begun behind them.
  useEffect(() => {
    if (!hasBegun.current && !isEditing) {
      begin(dashboard.id, dashboard.layout);
    }

    hasBegun.current = true;
  }, [isEditing, begin, dashboard.id, dashboard.layout]);

  // Leaving the tab with an unsaved layout asks first; leaving the page keeps the copy.
  useEffect(() => {
    if (!isDirty) {
      return undefined;
    }

    /**
     * Asks the browser to confirm leaving.
     *
     * @param event - The unload.
     */
    const onLeave = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };

    window.addEventListener('beforeunload', onLeave);

    return (): void => {
      window.removeEventListener('beforeunload', onLeave);
    };
  }, [isDirty]);

  /** Goes back to the list of dashboards. */
  const leave = (): void => {
    void navigate(DASHBOARDS_CONFIGURATION_PATH);
  };

  const save = useMutation({
    /**
     * Saves the whole layout.
     *
     * @param next - The layout.
     * @returns The dashboard as it now stands.
     */
    mutationFn: async (next: DashboardLayout): Promise<DashboardView> =>
      updateDashboard(dashboard.id, { layout: next }),

    /** Reads the lists again, stops editing and goes back to the list. */
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEYS.managed }),
        queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEYS.dashboards }),
      ]);
      draft.end();
      setProblem(null);
      leave();
    },

    /**
     * Says why the layout could not be saved, and keeps editing.
     *
     * @param error - What went wrong.
     */
    onError: (error: unknown) => {
      setProblem(toMessage(error));
    },
  });

  /** Saves the layout, after checking it the way the server will. */
  const done = (): void => {
    if (!isDirty) {
      draft.end();
      leave();

      return;
    }

    const checked = dashboardLayoutSchema.safeParse(draft.layout);

    if (!checked.success) {
      const first = checked.error.issues[0];

      setProblem(
        first?.path.includes('title') === true
          ? t('dashboard.dashboardEditor.everyGroupNeedsA', 'Every group needs a name.')
          : t(
              'dashboard.dashboardEditor.cannotBeSaved',
              'This layout cannot be saved: {{problem}}.',
              {
                problem:
                  first?.message ??
                  t('dashboard.dashboardEditor.itDoesNotRead', 'it does not read'),
              },
            ),
      );

      return;
    }

    save.mutate(draft.layout);
  };

  /**
   * Adds cards where the person is working: the group chosen, the one holding the card chosen,
   * or the page.
   *
   * @param cards - The new cards.
   */
  const add = (cards: readonly DashboardCard[]): void => {
    if (draft.layout === null) {
      return;
    }

    const groupId = groupInUse(draft.layout, draft.selectedId);
    let next = draft.layout;

    for (const card of cards) {
      const into = addCard(next, card, groupId, data.sizesOf);

      next = into === next ? addCard(next, card, null, data.sizesOf) : into;
    }

    draft.change(next);

    const last = cards.at(-1);

    if (last !== undefined && (cards.length === 1 || last.type === 'container')) {
      draft.select(last.id);
    }
  };

  /**
   * Takes a card off the draft.
   *
   * @param cardId - The card.
   */
  const remove = (cardId: string): void => {
    if (draft.layout !== null) {
      draft.change(removeCard(draft.layout, cardId));
    }

    if (draft.selectedId === cardId) {
      draft.select(null);
    }
  };

  const groupId = isEditing ? groupInUse(layout, draft.selectedId) : null;
  const group = groupId === null ? undefined : findCard(layout, groupId)?.card;
  const groupName = group?.type === 'container' ? group.title : null;
  const canEdit = isEditing && !isNarrow;

  return (
    <div className="flex min-h-0 min-w-0 grow flex-col">
      <div className="shrink-0 px-8 pt-6">
        <h1 className="sr-only">
          {t('dashboard.dashboardEditor.editingName', 'Editing {{name}}', { name: dashboard.name })}
        </h1>
        <Note
          tone="accent"
          action={
            <span className="flex flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                size="compact"
                disabled={!canEdit}
                onClick={() => {
                  setAdding(true);
                }}
              >
                <AppIcon id="plus" size={14} />
                {t('dashboard.dashboardEditor.addCard', 'Add card')}
              </Button>
              <Button
                variant="ghost"
                size="compact"
                disabled={!canEdit}
                onClick={() => {
                  add([containerCard(t('dashboard.dashboardEditor.newGroup', 'New group'))]);
                }}
              >
                <AppIcon id="layout-grid" size={14} />
                {t('dashboard.dashboardEditor.addGroup', 'Add group')}
              </Button>
              <Button
                variant="bare"
                size="compact"
                disabled={save.isPending}
                onClick={() => {
                  setProblem(null);
                  draft.end();
                  leave();
                }}
              >
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button size="compact" isBusy={save.isPending} disabled={!isEditing} onClick={done}>
                <AppIcon id="check" size={14} />
                {t('common.done', 'Done')}
              </Button>
            </span>
          }
        >
          <span className="font-medium">
            {t('dashboard.dashboardEditor.editingName2', 'Editing “{{name}}”', {
              name: dashboard.name,
            })}
          </span>
          <span className="text-foreground-muted">
            {' · '}
            {viewers.length === 0
              ? t(
                  'dashboard.dashboardEditor.nobodySeesItYet',
                  'Nobody sees it yet: assign it under Dashboard setup',
                )
              : viewers.length <= 3
                ? t('dashboard.dashboardEditor.viewersSeeTheChange', {
                    count: viewers.length,
                    names: listFormat({ type: 'conjunction' }).format(viewers),
                    defaultValue_one: '{{names}} sees the change',
                    defaultValue_other: '{{names}} see the change',
                  })
                : t(
                    'dashboard.dashboardEditor.everyoneWhoUsesName',
                    'Everyone who uses {{name}} sees the change',
                    { name: dashboard.name },
                  )}
          </span>
          <span className="text-foreground-subtle">
            {t(
              'dashboard.dashboardEditor.dragToMoveDrag',
              '· drag to move, drag a corner to resize',
            )}
          </span>
        </Note>
        {problem === null ? null : (
          <p role="alert" className="mt-2 text-ui-sm text-danger">
            {problem}
          </p>
        )}
      </div>

      <div className="min-h-0 grow overflow-y-auto px-8 pt-5 pb-7">
        <div className="flex items-start gap-6">
          <div className="flex min-w-0 grow flex-col gap-4">
            {isNarrow ? (
              <PageMessage>
                {t(
                  'dashboard.dashboardEditor.widenTheWindowTo',
                  'Widen the window to lay out the dashboard: it takes four columns.',
                )}
              </PageMessage>
            ) : null}

            <DashboardGrid
              layout={layout}
              data={data}
              onNarrowChange={setNarrow}
              emptyState={
                <EmptyPage
                  name={dashboard.name}
                  onAddCard={() => {
                    setAdding(true);
                  }}
                  onAddGroup={() => {
                    add([containerCard(t('dashboard.dashboardEditor.newGroup', 'New group'))]);
                  }}
                />
              }
              editor={
                canEdit
                  ? {
                      selectedId: draft.selectedId,
                      onSelect: draft.select,
                      onChange: draft.change,
                      onRemove: remove,
                    }
                  : null
              }
            />

            {canEdit && layout.cards.length > 0 ? (
              <button
                type="button"
                className="press flex h-16 items-center justify-center gap-3 rounded-panel border border-dashed border-border-strong bg-surface/40 text-ui font-medium text-foreground-muted hover:text-foreground"
                onClick={() => {
                  setAdding(true);
                }}
              >
                <span className="flex size-7 items-center justify-center rounded-chip bg-primary/10 text-primary">
                  <AppIcon id="plus" size={15} />
                </span>
                {t('dashboard.dashboardEditor.addACard', 'Add a card')}
                <span className="text-caption font-normal text-foreground-subtle">
                  {groupName === null
                    ? t('dashboard.dashboardEditor.onThePage', 'on the page')
                    : t('dashboard.dashboardEditor.intoGroupname', 'into {{groupName}}', {
                        groupName,
                      })}
                </span>
              </button>
            ) : null}
          </div>

          {canEdit && draft.selectedId !== null ? (
            <CardInspector
              layout={layout}
              cardId={draft.selectedId}
              data={data}
              scenes={scenes}
              onChange={draft.change}
              onRemove={remove}
              onClose={() => {
                draft.select(null);
              }}
            />
          ) : null}
        </div>
      </div>

      <AddCardDialog
        isOpen={isAdding && canEdit}
        onClose={() => {
          setAdding(false);
        }}
        groupName={groupName}
        scenes={scenes}
        onAdd={add}
      />
    </div>
  );
}
