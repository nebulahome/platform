/**
 * The dashboards: the pages of cards assigned to the person signed in, one open at a time.
 *
 * `/dashboards` opens the one last looked at in this browser, or the first; `/dashboards/:id`
 * shows that one. The page only shows: dashboards are made, laid out and assigned under
 * Configuration › Dashboards by whoever manages them, and a layout saved there is what everyone
 * it is assigned to sees the next time this page reads. Someone who manages dashboards finds a
 * button here that leads there.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';

import type { DashboardView } from '@nebulahome/contracts';
import { AppIcon, Button } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { DASHBOARD_QUERY_KEYS, fetchDashboards } from '@/dashboard/api';
import { toMessage } from '@/lib/error-message';
import { DashboardGrid } from '@/routes/dashboard/dashboard-grid';
import { DashboardTabs } from '@/routes/dashboard/dashboard-tabs';
import { useDashboardData } from '@/routes/dashboard/use-dashboard-data';

/** Where this browser remembers the dashboard last looked at. */
const LAST_DASHBOARD_KEY = 'nebula.dashboard';

/** Where dashboards are made and laid out. */
export const DASHBOARDS_CONFIGURATION_PATH = '/configuration/dashboards';

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
  const canManage = useSession((state) => state.can('dashboard:manage'));

  const dashboards = useQuery({
    queryKey: DASHBOARD_QUERY_KEYS.dashboards,
    /**
     * Reads the dashboards assigned to this person.
     *
     * @param context - What TanStack Query provides, including the cancellation signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns Their dashboards.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchDashboards(signal),
  });

  const list = dashboards.data ?? [];
  const current = list.find((dashboard) => dashboard.id === dashboardId);
  const manageLink = canManage ? (
    <Button
      variant="ghost"
      size="compact"
      onClick={() => {
        void navigate(DASHBOARDS_CONFIGURATION_PATH);
      }}
    >
      <AppIcon id="pencil" size={14} />
      Manage dashboards
    </Button>
  ) : undefined;

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
      <Frame tools={manageLink}>
        <PageMessage>
          {canManage
            ? 'No dashboard is assigned to you yet. Make one, or assign one to yourself, under Configuration › Dashboards.'
            : 'No dashboard is assigned to you yet. Whoever manages the dashboards of this house can assign you one.'}
        </PageMessage>
      </Frame>
    );
  }

  return (
    <OpenDashboard key={current.id} dashboard={current} dashboards={list} tools={manageLink} />
  );
}

/** What an open dashboard needs. */
type OpenDashboardProps = {
  readonly dashboard: DashboardView;
  readonly dashboards: readonly DashboardView[];

  /** What sits on the right of the top bar. */
  readonly tools: ReactNode;
};

/**
 * Renders one dashboard.
 *
 * @param props - See {@link OpenDashboardProps}.
 * @returns The page.
 */
function OpenDashboard(props: OpenDashboardProps) {
  const { dashboard, dashboards, tools } = props;
  const data = useDashboardData(dashboard.layout);

  useEffect(() => {
    rememberDashboard(dashboard.id);
  }, [dashboard.id]);

  return (
    <Frame
      heading={
        <>
          <h1 className="sr-only">{dashboard.name}</h1>
          <DashboardTabs dashboards={dashboards} currentId={dashboard.id} />
        </>
      }
      tools={tools}
    >
      {dashboard.layout.cards.length === 0 ? (
        <PageMessage>Nothing on {dashboard.name} yet.</PageMessage>
      ) : (
        <DashboardGrid layout={dashboard.layout} data={data} editor={null} />
      )}
    </Frame>
  );
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
export function Frame(props: FrameProps) {
  const { heading, tools, children } = props;

  return (
    <div className="flex min-h-0 min-w-0 grow flex-col">
      <header className="flex min-h-17 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-6 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          {heading ?? <h1 className="text-headline-sm font-semibold tracking-tight">Dashboards</h1>}
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
export function PageMessage(props: PageMessageProps) {
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
