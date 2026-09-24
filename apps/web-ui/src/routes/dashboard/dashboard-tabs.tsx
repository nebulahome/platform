/**
 * The pills along the top that switch between the dashboards assigned to a person.
 *
 * The same pill track the library's tabs are drawn in, so moving between dashboards feels like
 * moving between views anywhere else. There is nothing to add here: dashboards are made under
 * Configuration › Dashboards.
 */
import { NavLink } from 'react-router';

import type { DashboardView } from '@nebula-home/contracts';
import { cn } from '@nebula-home/ui';

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
    <nav
      aria-label="Dashboards"
      className="flex min-w-0 items-center gap-1 overflow-x-auto rounded-full border border-border-soft face-sunk p-1"
    >
      {dashboards.map((dashboard) => (
        <NavLink
          key={dashboard.id}
          to={`/dashboards/${dashboard.id}`}
          className={({ isActive }) =>
            cn(
              'press flex h-7 shrink-0 items-center rounded-full px-3.5 text-ui whitespace-nowrap transition-colors',
              isActive || isCurrent(dashboard.id)
                ? 'face-pill font-medium text-foreground'
                : 'text-foreground-muted hover:text-foreground',
            )
          }
        >
          {dashboard.name}
        </NavLink>
      ))}
    </nav>
  );
}
