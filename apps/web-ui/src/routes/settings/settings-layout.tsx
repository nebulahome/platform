/**
 * The settings frame, and the rail inside it.
 *
 * The section is arranged by whose answer a setting is, which is the only division that stays
 * true as it grows. **You** is this account and this browser: nobody else is affected by any of
 * it, and nobody needs a permission to change their own password. **Server** is the
 * installation: one answer, everyone lives with it, and every entry behind a permission.
 *
 * A section nobody may open is not shown. That is a courtesy rather than a control - the rail is
 * built from the same table the routes are, and each route checks the permission itself, because
 * a hidden link is not a closed door.
 *
 * The scrolling column below is `relative`, and that is load-bearing rather than decorative. A
 * visually hidden label - Tailwind's `sr-only` - is `position: absolute`, and an absolutely
 * positioned element is only clipped by an ancestor's `overflow` when that ancestor is also its
 * containing block. Without a positioned one, its containing block is the whole document: it
 * escapes this column, lands wherever its static position would have been, and stretches the
 * page. Fifteen hidden labels on the settings screen gave the window a second scrollbar that
 * nothing appeared to own, and scrolling with a wheel moved whichever of the two the pointer
 * happened to be over.
 */
import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router';

import { Badge } from '@nebula-home/ui';

import { useSession } from '@/auth/session-store';
import { LockIcon } from '@/components/icons';

/** One entry in the settings rail. */
export type SettingsSection = {
  /** Its address. */
  readonly path: string;

  /** What it is called. */
  readonly label: string;

  /** Whose answer the settings in it are. */
  readonly group: 'you' | 'server';

  /** The permission needed to open it, or null when anyone signed in may. */
  readonly permission: string | null;
};

/**
 * Every section, in the order they read.
 *
 * One table, so the rail, the routes and the permission checks cannot be changed independently
 * of each other.
 */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { path: '/settings/account', label: 'Account & security', group: 'you', permission: null },
  { path: '/settings/interface', label: 'Interface', group: 'you', permission: null },
  {
    path: '/settings/system',
    label: 'System monitor',
    group: 'server',
    permission: 'system:read',
  },
  { path: '/settings/users', label: 'Users & roles', group: 'server', permission: 'user:read' },
  {
    path: '/settings/data',
    label: 'Data & retention',
    group: 'server',
    permission: 'settings:read',
  },
  { path: '/settings/icons', label: 'Icons', group: 'server', permission: 'settings:read' },
];

/** Where somebody who opens `/settings` with nothing more specific in mind ends up. */
export const DEFAULT_SETTINGS_SECTION = '/settings/account';

/** What one group of the rail needs. */
type SectionGroupProps = {
  /** The heading. */
  readonly title: string;

  /** A badge beside it, such as the role that unlocked the group. */
  readonly badge?: ReactNode;

  /** The entries. */
  readonly sections: readonly SettingsSection[];
};

/**
 * One group of the rail.
 *
 * @param props - See {@link SectionGroupProps}.
 * @returns The group, or nothing when every entry in it is out of reach.
 */
function SectionGroup(props: SectionGroupProps) {
  const { title, badge, sections } = props;

  if (sections.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-5 items-center justify-between gap-2 px-3">
        <span className="text-label text-foreground-subtle uppercase">{title}</span>
        {badge}
      </div>

      {sections.map((section) => (
        <NavLink
          key={section.path}
          to={section.path}
          className={({ isActive }) =>
            `flex h-9 items-center rounded-field px-3 text-ui transition-colors ${
              isActive
                ? 'bg-surface-raised font-medium text-foreground'
                : 'text-foreground-muted hover:text-foreground'
            }`
          }
        >
          {section.label}
        </NavLink>
      ))}
    </div>
  );
}

/**
 * Renders the settings frame.
 *
 * @returns The page.
 */
export function SettingsLayout() {
  const can = useSession((state) => state.can);
  const role = useSession((state) => state.user?.role);
  const reachable = SETTINGS_SECTIONS.filter(
    (section) => section.permission === null || can(section.permission),
  );
  const server = reachable.filter((section) => section.group === 'server');

  return (
    <div className="flex min-w-0 grow flex-col">
      <header className="flex h-17 shrink-0 items-center border-b border-border px-6">
        <h1 className="text-head font-semibold tracking-tight">Settings</h1>
      </header>

      <div className="flex min-h-0 grow gap-6 overflow-hidden p-6">
        <nav aria-label="Settings" className="flex w-56 shrink-0 flex-col gap-5">
          <SectionGroup
            title="You"
            sections={reachable.filter((section) => section.group === 'you')}
          />

          <SectionGroup
            title="Server"
            sections={server}
            badge={
              server.length === 0 || role === undefined ? undefined : (
                <Badge tone="accent" icon={<LockIcon width="11" height="11" />}>
                  <span className="capitalize">{role}</span>
                </Badge>
              )
            }
          />
        </nav>

        <div className="relative flex min-w-0 grow flex-col gap-4 overflow-y-auto pr-1 pb-2">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
