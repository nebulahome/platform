/**
 * The pills along the top that switch between a person's dashboards, and the one that adds one.
 *
 * The same pill track the library's tabs are drawn in, so moving between dashboards feels like
 * moving between views anywhere else. While a layout is being edited the other dashboards cannot
 * be opened - the edit belongs to the one on screen - so the pills are drawn but do not lead away.
 */
import { NavLink } from 'react-router';

import type { DashboardView } from '@nebula-home/contracts';
import { AppIcon, cn, IconButton } from '@nebula-home/ui';

/** What the tabs need. */
export type DashboardTabsProps = {
  readonly dashboards: readonly DashboardView[];

  /** The dashboard on screen. */
  readonly currentId: string;

  /** Whether a layout is being edited, which holds the tabs still. */
  readonly isLocked: boolean;

  /** Starts a new dashboard. */
  readonly onNew: () => void;
};

/**
 * Renders the tabs.
 *
 * @param props - See {@link DashboardTabsProps}.
 * @returns The tabs.
 */
export function DashboardTabs(props: DashboardTabsProps) {
  const { dashboards, currentId, isLocked, onNew } = props;

  return (
    <div className="flex min-w-0 items-center gap-2">
      <nav
        aria-label="Dashboards"
        className="flex min-w-0 items-center gap-1 overflow-x-auto rounded-full border border-border-soft face-sunk p-1"
      >
        {dashboards.map((dashboard) => {
          /**
           * The pill's classes.
           *
           * @param isActive - Whether it is the dashboard on screen.
           * @returns The classes.
           */
          const classes = (isActive: boolean): string =>
            cn(
              'press flex h-7 shrink-0 items-center rounded-full px-3.5 text-ui whitespace-nowrap transition-colors',
              isActive
                ? 'face-pill font-medium text-foreground'
                : 'text-foreground-muted hover:text-foreground',
            );

          return isLocked ? (
            <span
              key={dashboard.id}
              aria-current={dashboard.id === currentId ? 'page' : undefined}
              aria-disabled={dashboard.id === currentId ? undefined : true}
              className={cn(
                classes(dashboard.id === currentId),
                dashboard.id === currentId ? undefined : 'cursor-not-allowed opacity-60',
              )}
            >
              {dashboard.name}
            </span>
          ) : (
            <NavLink
              key={dashboard.id}
              to={`/dashboards/${dashboard.id}`}
              className={({ isActive }) => classes(isActive)}
            >
              {dashboard.name}
            </NavLink>
          );
        })}
      </nav>
      {isLocked ? null : (
        <IconButton
          variant="bare"
          size="medium"
          label="New dashboard"
          className="rounded-full border border-dashed border-border-strong"
          onClick={onNew}
        >
          <AppIcon id="plus" size={15} />
        </IconButton>
      )}
    </div>
  );
}
