/**
 * Moving between the four things a library holds.
 *
 * They are one section seen four ways, not four destinations, and the rail already said which
 * section you are in. What the header has to answer is the next question — which of the four —
 * and a switch in the title answers it in one press instead of a trip back to the rail.
 *
 * Links rather than a segmented control, even though it wears the same shape. Each view has its
 * own address: it can be bookmarked, opened in a second tab, and reached by the back button. A
 * radio group would have looked identical and thrown all of that away.
 *
 * Packages are deliberately not here. A package is the unit that ships and is supervised, and
 * the four below are the house itself — which is the same reason they sit apart in the rail.
 */
import { NavLink } from 'react-router';

import { cn } from '@nebula-home/ui';

/** The four views, in the order they read. */
const VIEWS = [
  { to: '/automations', label: 'Automations' },
  { to: '/scenes', label: 'Scenes' },
  { to: '/devices', label: 'Devices' },
  { to: '/aliases', label: 'Aliases' },
] as const;

/**
 * Renders the library switch.
 *
 * @returns The switch.
 */
export function LibraryTabs() {
  return (
    <nav
      aria-label="Library"
      className="flex shrink-0 items-center gap-1 rounded-full border border-border-soft face-sunk p-1"
    >
      {VIEWS.map((view) => (
        <NavLink
          key={view.to}
          to={view.to}
          end
          className={({ isActive }) =>
            cn(
              'press flex h-7 items-center rounded-full px-3.5 text-ui transition-colors',
              isActive
                ? 'face-pill font-medium text-foreground'
                : 'text-foreground-muted hover:text-foreground',
            )
          }
        >
          {view.label}
        </NavLink>
      ))}
    </nav>
  );
}
