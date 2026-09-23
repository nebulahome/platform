/**
 * Moving between the views of one library group.
 *
 * The rail splits the library in two - what the house does on its own, and how the house is
 * described - and a page belongs to one group. The rail already said which; what the header has
 * to answer is the next question, which of that group's views, and a switch in the title answers
 * it in one press instead of a trip back to the rail. The views of the other group are not
 * offered here: they are a different errand, and the rail is where errands are chosen.
 *
 * Links rather than a segmented control, even though it wears the same shape. Each view has its
 * own address: it can be bookmarked, opened in a second tab, and reached by the back button. A
 * radio group would have looked identical and thrown all of that away.
 *
 * Packages are deliberately not here. A package is the unit that ships and is supervised, and
 * the views below are the house itself — which is the same reason they sit apart in the rail.
 */
import { NavLink, useLocation } from 'react-router';

import { cn } from '@nebula-home/ui';

/** One group of views: what it is called, and its views in the order they read. */
type ViewGroup = {
  readonly label: string;
  readonly views: readonly { readonly to: string; readonly label: string }[];
};

/** The two groups, as the rail draws them. */
const GROUPS: readonly ViewGroup[] = [
  {
    label: 'Automation',
    views: [
      { to: '/automations', label: 'Automations' },
      { to: '/scenes', label: 'Scenes' },
      { to: '/aliases', label: 'Aliases' },
    ],
  },
  {
    label: 'Configuration',
    views: [
      { to: '/devices', label: 'Devices' },
      { to: '/tags', label: 'Tags' },
      { to: '/areas', label: 'Areas' },
    ],
  },
];

/**
 * Renders the switch for the group the current page is in.
 *
 * @returns The switch, or nothing on a page that belongs to neither group.
 */
export function LibraryTabs() {
  const location = useLocation();
  const group = GROUPS.find((candidate) =>
    candidate.views.some((view) => location.pathname.startsWith(view.to)),
  );

  if (group === undefined) {
    return null;
  }

  return (
    <nav
      aria-label={group.label}
      className="flex shrink-0 items-center gap-1 rounded-full border border-border-soft face-sunk p-1"
    >
      {group.views.map((view) => (
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
