/**
 * The pills along the top that switch between the dashboards assigned to a person.
 *
 * The same pill track the library's tabs are drawn in, so moving between dashboards feels like
 * moving between views anywhere else. There is nothing to add here: dashboards are made under
 * Configuration › Dashboards.
 */
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';

import type { DashboardView } from '@nebulahome/contracts';
import { cn } from '@nebulahome/ui';

/** What the tabs need. */
export type DashboardTabsProps = {
  readonly dashboards: readonly DashboardView[];

  /** The dashboard on screen. */
  readonly currentId: string;
};

/**
 * Renders the tabs.
 *
 * @param props - See {@link DashboardTabsProps}.
 * @returns The tabs.
 */
export function DashboardTabs(props: DashboardTabsProps) {
  const { t } = useTranslation();

  const { dashboards, currentId } = props;
  /**
   * Whether a pill is the dashboard on screen: the address decides which is lit, and the id
   * covers the moment a remembered dashboard is being redirected to.
   *
   * @param dashboardId - The pill's dashboard.
   * @returns True for the one on screen.
   */
  const isCurrent = (dashboardId: string): boolean => dashboardId === currentId;

  return (
    // Room above and below the pills, and no vertical scroll at all: a pressed pill sinks a pixel,
    // and in a strip exactly its height that pixel was enough to grow a scrollbar beside it.
    <nav
      aria-label={t('dashboard.dashboardTabs.dashboards', 'Dashboards')}
      className="-my-1 flex min-w-0 scrollbar-none items-center gap-1 overflow-x-auto overflow-y-hidden py-1"
    >
      {dashboards.map((dashboard) => (
        <NavLink
          key={dashboard.id}
          to={`/dashboards/${dashboard.id}`}
          className={({ isActive }) =>
            cn(
              'press flex h-8.5 shrink-0 items-center rounded-pill border px-3.5 text-ui whitespace-nowrap transition-colors',
              isActive || isCurrent(dashboard.id)
                ? 'border-border-strong bg-surface-raised font-medium text-foreground'
                : 'border-transparent text-foreground-muted hover:text-foreground',
            )
          }
        >
          {dashboard.name}
        </NavLink>
      ))}
    </nav>
  );
}
