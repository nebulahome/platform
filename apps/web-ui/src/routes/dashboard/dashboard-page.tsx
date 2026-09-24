/**
 * The dashboards: a person's own pages of cards, one open at a time.
 *
 * `/dashboards` opens the one last looked at in this browser, or the first; a person with none is
 * offered to make one. `/dashboards/:id` shows that one.
 *
 * **Editing** works on a copy of the layout (see `dashboard-draft.ts`): the grid unlocks, cards can
 * be dragged, resized, added and removed, and the inspector opens beside the grid for the card
 * chosen. Done saves the whole layout in one request; Cancel throws the copy away. The copy
 * survives leaving the page, and closing the tab asks first. A window too narrow for four columns
 * shows the page in two, and editing waits for a wider one.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';

import {
  dashboardLayoutSchema,
  type DashboardCard,
  type DashboardLayout,
  type DashboardView,
} from '@nebula-home/contracts';
import { AppIcon, Badge, Button, IconButton } from '@nebula-home/ui';

import { DASHBOARD_QUERY_KEYS, fetchDashboards, updateDashboard } from '@/dashboard/api';
import { addCard, findCard, removeCard } from '@/dashboard/dashboard-layout';
import { toMessage } from '@/lib/error-message';
import { AddCardDialog } from '@/routes/dashboard/add-card-dialog';
import { CardInspector } from '@/routes/dashboard/card-inspector';
import { DashboardDialog, type DashboardDialogTarget } from '@/routes/dashboard/dashboard-dialog';
import { isDraftDirty, useDashboardDraft } from '@/routes/dashboard/dashboard-draft';
import { DashboardGrid } from '@/routes/dashboard/dashboard-grid';
import { DashboardTabs } from '@/routes/dashboard/dashboard-tabs';
import { useDashboardData } from '@/routes/dashboard/use-dashboard-data';

/** Where this browser remembers the dashboard last looked at. */
const LAST_DASHBOARD_KEY = 'nebula.dashboard';

/**
 * Reads the dashboard last looked at in this browser.
 *
 * @returns Its id, or null.
 */
function lastDashboard(): string | null {
  try {
    return localStorage.getItem(LAST_DASHBOARD_KEY);
  } catch {
    return null;
  }
}

/**
 * Remembers the dashboard looked at, for the next visit to `/dashboards`.
 *
 * @param dashboardId - Its id.
 */
function rememberDashboard(dashboardId: string): void {
  try {
    localStorage.setItem(LAST_DASHBOARD_KEY, dashboardId);
  } catch {
    // A browser that keeps nothing opens the first dashboard next time, which is fine.
  }
}

/**
 * Renders the page.
 *
 * @returns The page.
 */
export function DashboardPage() {
  const { dashboardId } = useParams();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<DashboardDialogTarget | null>(null);

  const dashboards = useQuery({
    queryKey: DASHBOARD_QUERY_KEYS.dashboards,
    /**
     * Reads the person's dashboards.
     *
     * @param context - What TanStack Query provides, including the cancellation signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns Their dashboards.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchDashboards(signal),
  });

  const list = dashboards.data ?? [];
  const current = list.find((dashboard) => dashboard.id === dashboardId);

  // What this house has, for the preview of a file about to be imported.
  const house = useDashboardData(undefined);

  const dialogs = (
    <DashboardDialog
      key={dialog === null ? 'shut' : dialog.mode === 'edit' ? dialog.dashboard.id : 'new'}
      target={dialog}
      onClose={() => {
        setDialog(null);
      }}
      hasEntity={(entityId) => house.entityById.has(entityId)}
      hasScene={(sceneId) => house.sceneById.has(sceneId)}
      onSaved={(saved) => {
        setDialog(null);
        void navigate(`/dashboards/${saved.id}`);
      }}
      onDeleted={() => {
        setDialog(null);
        void navigate('/dashboards', { replace: true });
      }}
    />
  );

  if (dashboards.isPending || dashboards.error !== null) {
    return (
      <Frame>
        <PageMessage>
          {dashboards.error === null ? 'Reading…' : toMessage(dashboards.error)}
        </PageMessage>
      </Frame>
    );
  }

  if (dashboardId === undefined || current === undefined) {
    const remembered = lastDashboard();
    const next = list.find((dashboard) => dashboard.id === remembered) ?? list[0];

    if (next !== undefined) {
      return <Navigate to={`/dashboards/${next.id}`} replace />;
    }

    return (
      <Frame>
        <PageMessage
          action={
            <Button
              onClick={() => {
                setDialog({ mode: 'create' });
              }}
            >
              <AppIcon id="plus" size={15} />
              New dashboard
            </Button>
          }
        >
          No dashboard yet. A dashboard is your own page of cards - lights, sensors, scenes, a clock
          - arranged the way you want them. Nobody else sees it.
        </PageMessage>
        {dialogs}
      </Frame>
    );
  }

  return (
    <OpenDashboard
      key={current.id}
      dashboard={current}
      dashboards={list}
      onNew={() => {
        setDialog({ mode: 'create' });
      }}
      onSettings={() => {
        setDialog({ mode: 'edit', dashboard: current });
      }}
      dialogs={dialogs}
    />
  );
}

/** What an open dashboard needs. */
type OpenDashboardProps = {
  readonly dashboard: DashboardView;
  readonly dashboards: readonly DashboardView[];
  readonly onNew: () => void;
  readonly onSettings: () => void;

  /** The dashboard dialog, drawn with the page. */
  readonly dialogs: ReactNode;
};

/**
 * Renders one dashboard, and its editor when it is being edited.
 *
 * @param props - See {@link OpenDashboardProps}.
 * @returns The page.
 */
function OpenDashboard(props: OpenDashboardProps) {
  const { dashboard, dashboards, onNew, onSettings, dialogs } = props;
  const queryClient = useQueryClient();
  const draft = useDashboardDraft();
  const isEditing = draft.dashboardId === dashboard.id && draft.layout !== null;
  const layout: DashboardLayout = isEditing ? draft.layout : dashboard.layout;
  const data = useDashboardData(layout);
  const [isAdding, setAdding] = useState(false);
  const [isNarrow, setNarrow] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const isDirty = isEditing && isDraftDirty(draft);
  const scenes = [...data.sceneById.values()];

  useEffect(() => {
    rememberDashboard(dashboard.id);
  }, [dashboard.id]);

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

  const save = useMutation({
    /**
     * Saves the whole layout.
     *
     * @param next - The layout.
     * @returns The dashboard as it now stands.
     */
    mutationFn: async (next: DashboardLayout): Promise<DashboardView> =>
      updateDashboard(dashboard.id, { layout: next }),

    /**
     * Puts the saved dashboard in the list and stops editing.
     *
     * @param saved - The dashboard.
     */
    onSuccess: (saved) => {
      queryClient.setQueryData<DashboardView[]>(DASHBOARD_QUERY_KEYS.dashboards, (old) =>
        old?.map((one) => (one.id === saved.id ? saved : one)),
      );
      draft.end();
      setProblem(null);
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

      return;
    }

    const checked = dashboardLayoutSchema.safeParse(draft.layout);

    if (!checked.success) {
      const first = checked.error.issues[0];

      setProblem(
        first?.path.includes('title') === true
          ? 'Every group needs a name.'
          : `This layout cannot be saved: ${first?.message ?? 'it does not read'}.`,
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

  return (
    <Frame
      heading={
        <>
          <h1 className="sr-only">{dashboard.name}</h1>
          <DashboardTabs
            dashboards={dashboards}
            currentId={dashboard.id}
            isLocked={isEditing}
            onNew={onNew}
          />
          {isEditing ? (
            <Badge tone="accent" size="small">
              Editing layout
            </Badge>
          ) : null}
        </>
      }
      tools={
        isEditing ? (
          <>
            {problem === null ? null : (
              <p
                role="alert"
                className="max-w-sm truncate text-caption text-danger"
                title={problem}
              >
                {problem}
              </p>
            )}
            <Button
              variant="ghost"
              size="compact"
              onClick={() => {
                setAdding(true);
              }}
            >
              <AppIcon id="plus" size={14} />
              Add card
            </Button>
            <Button
              variant="ghost"
              size="compact"
              disabled={save.isPending}
              onClick={() => {
                setProblem(null);
                draft.end();
              }}
            >
              Cancel
            </Button>
            <Button size="compact" isBusy={save.isPending} onClick={done}>
              Done
            </Button>
          </>
        ) : (
          <>
            <IconButton
              variant="raised"
              label={`${dashboard.name}: name, file, remove`}
              onClick={onSettings}
            >
              <AppIcon id="settings" size={15} />
            </IconButton>
            <Button
              variant="ghost"
              size="compact"
              disabled={isNarrow}
              title={isNarrow ? 'Widen the window to edit the layout' : undefined}
              onClick={() => {
                draft.begin(dashboard.id, dashboard.layout);
              }}
            >
              <AppIcon id="pencil" size={14} />
              Edit layout
            </Button>
            <Button
              size="compact"
              disabled={isNarrow}
              title={isNarrow ? 'Widen the window to edit the layout' : undefined}
              onClick={() => {
                draft.begin(dashboard.id, dashboard.layout);
                setAdding(true);
              }}
            >
              <AppIcon id="plus" size={14} />
              Add card
            </Button>
          </>
        )
      }
    >
      <div className="flex items-start gap-6">
        <div className="flex min-w-0 grow flex-col gap-4">
          {layout.cards.length === 0 && !isEditing ? (
            <PageMessage
              action={
                <Button
                  disabled={isNarrow}
                  onClick={() => {
                    draft.begin(dashboard.id, dashboard.layout);
                    setAdding(true);
                  }}
                >
                  <AppIcon id="plus" size={15} />
                  Add a card
                </Button>
              }
            >
              Nothing on {dashboard.name} yet.
            </PageMessage>
          ) : (
            <DashboardGrid
              layout={layout}
              data={data}
              onNarrowChange={setNarrow}
              editor={
                isEditing
                  ? {
                      selectedId: draft.selectedId,
                      onSelect: draft.select,
                      onChange: draft.change,
                      onRemove: remove,
                    }
                  : null
              }
            />
          )}

          {isEditing ? (
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
              Add a card
              <span className="text-caption font-normal text-foreground-subtle">
                {groupName === null ? 'on the page' : `into ${groupName}`}
              </span>
            </button>
          ) : null}
        </div>

        {isEditing && draft.selectedId !== null ? (
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

      <AddCardDialog
        isOpen={isAdding && isEditing}
        onClose={() => {
          setAdding(false);
        }}
        groupName={groupName}
        scenes={scenes}
        onAdd={add}
      />
      {dialogs}
    </Frame>
  );
}

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

/** What the frame needs. */
type FrameProps = {
  /** What sits on the left of the top bar. */
  readonly heading?: ReactNode;

  /** What sits on its right. */
  readonly tools?: ReactNode;

  readonly children: ReactNode;
};

/**
 * Renders the page's top bar and its scrolling body.
 *
 * @param props - See {@link FrameProps}.
 * @returns The frame.
 */
function Frame(props: FrameProps) {
  const { heading, tools, children } = props;

  return (
    <div className="flex min-h-0 min-w-0 grow flex-col">
      <header className="flex min-h-17 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-6 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          {heading ?? <h1 className="text-head font-semibold tracking-tight">Dashboards</h1>}
        </div>
        {tools === undefined ? null : (
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">{tools}</div>
        )}
      </header>
      <div className="min-h-0 grow overflow-y-auto p-6">
        <div className="mx-auto max-w-6xl">{children}</div>
      </div>
    </div>
  );
}

/** What a message in place of the grid needs. */
type PageMessageProps = {
  readonly children: ReactNode;

  /** What the person can do about it. */
  readonly action?: ReactNode;
};

/**
 * Renders what the page says where the grid would be: still reading, nothing yet, or a failure.
 *
 * @param props - See {@link PageMessageProps}.
 * @returns The message.
 */
function PageMessage(props: PageMessageProps) {
  const { children, action } = props;

  return (
    <div
      role="status"
      className="flex flex-col items-center gap-4 rounded-panel border border-dashed border-border-strong px-6 py-10 text-center"
    >
      <p className="mx-auto max-w-md text-ui text-foreground-muted">{children}</p>
      {action}
    </div>
  );
}
