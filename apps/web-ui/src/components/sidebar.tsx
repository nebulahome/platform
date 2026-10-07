/**
 * The left rail.
 *
 * It reads top to bottom by scope: the dashboards you built; what the house does on its own
 * (Automate: automations, scenes, aliases); how the house is described (House: devices, areas,
 * tags, and the setup of the dashboards); what the platform runs (System: integrations, packages,
 * containers); then the settings and you. Each entry carries how many there are, read from the
 * lists the pages read.
 *
 * A group is open when you are inside it and shut otherwise, and it can be toggled by hand.
 * That is not two behaviours: the automatic part answers "where am I", the manual part answers
 * "let me look at something else", and a group that only ever did the first would fight anyone
 * trying to navigate. One group is open at a time, and a toggle by hand holds only on the page it
 * was made on: held any longer, it outlived the navigation it was for.
 *
 * The rail collapses to 72px of glyphs - every entry of every group, flat, parted by a line, each
 * named on hover and to a screen reader - by the button beside the title, and opens again from
 * the one at the foot. The choice is the person's and is kept with their interface preferences;
 * the dashboard editor collapses it whatever they chose, to give the grid the room.
 *
 * It shows only what the role may see: an entry without its permission is not drawn, a group with
 * nothing left is not drawn, and House is drawn only for someone who may read the devices it is
 * about.
 *
 * Under Packages, the pages of the packages that ask for an entry (`ui.sidebar`), while they run:
 * a package managed from its own page is one click away, like the platform's own sections.
 */
import { useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router';

import type { ApiPackage } from '@nebulahome/contracts';
import { AppIcon, CatalogueIcon, cn, Logo, type UiIconId } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { Avatar } from '@/components/avatar';
import { ChevronIcon } from '@/components/icons';
import { useRailCounts, type RailCountKey } from '@/lib/use-rail-counts';
import { packageAppPath } from '@/packages/package-paths';
import { useInstalledPackages } from '@/packages/use-packages';
import { useCatalogueIcons } from '@/routes/library/device-icon';
import { PackageLogo } from '@/routes/packages/package-tile';
import { usePreferences } from '@/settings/preferences';

/** One entry of the rail. */
type Entry = {
  /** Where it goes. */
  readonly to: string;

  /** What it is called. */
  readonly label: string;

  /** Its glyph. */
  readonly icon: UiIconId;

  /**
   * The permission needed to open it, when one is; the entry is not drawn without it. A courtesy
   * rather than a control - the route checks the permission itself.
   */
  readonly permission?: string;

  /** Which count it carries, when it carries one. */
  readonly count?: RailCountKey;
};

/** A group of the rail, before the permissions narrow it. */
type Group = {
  readonly label: string;
  readonly entries: readonly Entry[];

  /** The permission without which the whole group is not drawn. */
  readonly permission?: string;
};

/** The three groups, in the order they read. */
const GROUPS: readonly Group[] = [
  {
    label: 'Automate',
    entries: [
      {
        to: '/automations',
        label: 'Automations',
        icon: 'zap',
        permission: 'automation:read',
        count: 'automations',
      },
      { to: '/scenes', label: 'Scenes', icon: 'layers', permission: 'scene:read', count: 'scenes' },
      {
        to: '/aliases',
        label: 'Aliases',
        icon: 'sigma',
        permission: 'alias:read',
        count: 'aliases',
      },
    ],
  },
  {
    label: 'House',
    permission: 'device:read',
    entries: [
      {
        to: '/devices',
        label: 'Devices',
        icon: 'cpu',
        permission: 'device:read',
        count: 'devices',
      },
      { to: '/areas', label: 'Areas', icon: 'house', permission: 'area:read', count: 'areas' },
      { to: '/tags', label: 'Tags', icon: 'tag', permission: 'tag:read', count: 'tags' },
      {
        to: '/configuration/dashboards',
        label: 'Dashboard setup',
        icon: 'layout-grid',
        permission: 'dashboard:manage',
      },
    ],
  },
  {
    label: 'System',
    entries: [
      {
        to: '/integrations',
        label: 'Integrations',
        icon: 'library',
        permission: 'integration:read',
        count: 'integrations',
      },
      {
        to: '/packages',
        label: 'Packages',
        icon: 'package',
        permission: 'package:read',
        count: 'packages',
      },
      {
        to: '/containers',
        label: 'Containers',
        icon: 'container',
        permission: 'container:read',
        count: 'containers',
      },
    ],
  },
];

/** The classes a row shares whether or not it is the current one. */
const ROW =
  'press flex h-9.5 shrink-0 items-center gap-3 rounded-field border px-3 text-ui transition-colors';

/** A row that is the current page: outlined, raised, its glyph in the accent. */
const ROW_ACTIVE =
  'border-border-strong bg-surface-raised font-medium text-foreground [&_svg]:text-primary';

/** A row that is not. */
const ROW_IDLE =
  'border-transparent text-foreground-muted hover:bg-surface-raised hover:text-foreground';

/** A glyph of the collapsed rail: a 44px square, named on hover. */
const SQUARE =
  'press flex size-11 shrink-0 items-center justify-center rounded-tile border transition-colors';

/** The round button that collapses or opens the rail. */
const TOGGLE =
  'press inline-flex size-7.5 shrink-0 items-center justify-center rounded-full text-foreground-muted ' +
  'transition-colors hover:bg-surface-raised hover:text-foreground';

/** What one row needs. */
type RowProps = {
  readonly entry: Entry;

  /** How many there are, when it is known. */
  readonly count?: number | undefined;
};

/**
 * One row of the open rail: the glyph, the name, and how many.
 *
 * @param props - See {@link RowProps}.
 * @returns The row.
 */
function Row(props: RowProps) {
  const { entry, count } = props;

  return (
    <NavLink to={entry.to} className={({ isActive }) => cn(ROW, isActive ? ROW_ACTIVE : ROW_IDLE)}>
      <AppIcon id={entry.icon} size={18} />
      <span className="grow truncate">{entry.label}</span>
      {count === undefined ? null : (
        <span className="font-mono text-mono-caption font-normal text-foreground-subtle tabular">
          {count}
        </span>
      )}
    </NavLink>
  );
}

/**
 * One glyph of the collapsed rail.
 *
 * @param props - The entry.
 * @param props.entry - Where it goes, and what it is called.
 * @returns The square.
 */
function Square(props: { readonly entry: Entry }) {
  const { entry } = props;

  return (
    <NavLink
      to={entry.to}
      title={entry.label}
      aria-label={entry.label}
      className={({ isActive }) => cn(SQUARE, isActive ? ROW_ACTIVE : ROW_IDLE)}
    >
      <AppIcon id={entry.icon} size={18} />
    </NavLink>
  );
}

/** What a group needs. */
type NavGroupProps = {
  /** What it is called. */
  readonly label: string;

  /** Whether it is open, which the rail decides for every group together. */
  readonly isOpen: boolean;

  /** Called when the heading is pressed. */
  readonly onToggle: () => void;

  /** The rows under it. */
  readonly children: ReactNode;
};

/**
 * A heading and the rows under it.
 *
 * @param props - See {@link NavGroupProps}.
 * @returns The group.
 */
function NavGroup(props: NavGroupProps) {
  const { label, isOpen, onToggle, children } = props;

  return (
    <div className="mt-2.5 flex flex-col gap-0.5">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={onToggle}
        className="press flex h-8.5 w-full items-center gap-2 rounded-field px-3 font-mono text-label text-foreground-subtle uppercase transition-colors hover:text-foreground-muted"
      >
        <span className="grow text-left">{label}</span>
        <ChevronIcon isOpen={isOpen} className="text-foreground-subtle" />
      </button>

      {isOpen ? children : null}
    </div>
  );
}

/**
 * The person, and the menu the chip opens.
 *
 * A menu rather than a button that signs out on click: a control that looks like it opens
 * something and instead ends your session is a small betrayal. Escape and a click elsewhere
 * both close it, because a menu that can only be dismissed by choosing something is a trap.
 *
 * @param props - How much room it has.
 * @param props.isCollapsed - Whether the rail is the 72px one: the picture alone.
 * @returns The chip.
 */
function UserChip(props: { readonly isCollapsed: boolean }) {
  const { isCollapsed } = props;
  const user = useSession((state) => state.user);
  const endSession = useSession((state) => state.signOut);
  const [isOpen, setOpen] = useState(false);
  const name = user?.displayName ?? 'Not signed in';

  return (
    // `onBlur` on the wrapper closes the menu when focus leaves the whole subtree, which is
    // what "clicked elsewhere" means for a keyboard as well as a mouse. Escape is handled on
    // the controls themselves rather than here: a div with a key handler is not a control, and
    // saying otherwise to the linter would be lying to it.
    <div
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      {isOpen ? (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-30 mb-1.5 w-full min-w-48 animate-rise overflow-hidden rounded-tile border border-border-strong bg-surface p-1 shadow-float"
        >
          <button
            type="button"
            role="menuitem"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setOpen(false);
              }
            }}
            onClick={() => {
              setOpen(false);
              void endSession();
            }}
            className="press flex h-8 w-full items-center rounded-chip px-2.5 text-ui text-foreground-muted hover:bg-surface-raised hover:text-danger"
          >
            Sign out
          </button>
        </div>
      ) : null}

      <button
        type="button"
        aria-label={isCollapsed ? `Account menu: ${name}` : undefined}
        title={isCollapsed ? `${name} · ${user?.role ?? ''}` : undefined}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
        onClick={() => {
          setOpen(!isOpen);
        }}
        className={cn(
          'press flex items-center transition-colors hover:bg-surface-raised',
          isCollapsed
            ? 'mx-auto mt-1.5 rounded-full p-0.5'
            : 'mt-1.5 w-full gap-2.5 rounded-tile border border-border p-2.5 text-left',
        )}
      >
        <Avatar displayName={user?.displayName ?? ''} avatarUrl={user?.avatarUrl} isAccented />
        {isCollapsed ? null : (
          <span className="flex min-w-0 grow flex-col">
            <span className="truncate text-ui font-medium text-foreground">{name}</span>
            <span className="text-caption text-foreground-subtle capitalize">
              {user?.role ?? ''}
            </span>
          </span>
        )}
      </button>
    </div>
  );
}

/**
 * The entries of the packages' own pages, under Packages: each running package with a page that
 * asks for one, by the label and icon it asks for - its name and logo when it says neither.
 *
 * @param props - How much room they have.
 * @param props.isCollapsed - Whether the rail is the 72px one: the glyphs alone.
 * @returns The entries; nothing when no package asks.
 */
function PackagePages(props: { readonly isCollapsed: boolean }) {
  const { isCollapsed } = props;
  const { packages } = useInstalledPackages();
  const pages = packages.filter(
    (found): found is ApiPackage & { ui: NonNullable<ApiPackage['ui']> } =>
      found.state === 'running' && found.ui?.page === true && found.ui.sidebar !== undefined,
  );
  const icons = useCatalogueIcons(pages.map((found) => found.ui.sidebar?.icon ?? null));

  if (pages.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-0.5',
        isCollapsed ? 'items-center' : 'ml-4.5 border-l border-border pl-2',
      )}
    >
      {pages.map((found) => {
        const iconId = found.ui.sidebar?.icon;
        const icon = iconId === undefined ? undefined : icons.get(iconId);
        const label = found.ui.sidebar?.label ?? found.name;

        return (
          <NavLink
            key={found.id}
            to={packageAppPath(found.id)}
            title={isCollapsed ? label : undefined}
            aria-label={isCollapsed ? label : undefined}
            className={({ isActive }) =>
              cn(
                isCollapsed
                  ? SQUARE
                  : 'press flex h-8.5 items-center gap-2 rounded-field border px-2.5 text-ui-sm transition-colors',
                isActive ? ROW_ACTIVE : ROW_IDLE,
              )
            }
          >
            {iconId === undefined ? (
              <PackageLogo found={found} size={16} />
            ) : (
              <CatalogueIcon
                node={icon?.node ?? []}
                frame={icon?.frame ?? { x: 0, y: 0, size: 24 }}
                size={16}
              />
            )}
            {isCollapsed ? null : <span className="truncate">{label}</span>}
          </NavLink>
        );
      })}
    </div>
  );
}

/**
 * Whether a page is under an entry: the entry itself, or a page beneath it.
 *
 * @param pathname - The page.
 * @param to - The entry.
 * @returns True when the page belongs to it.
 */
function isUnder(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`);
}

/**
 * Which group a page opens: the one holding an entry it is under.
 *
 * @param pathname - The page.
 * @param groups - The groups, narrowed to what may be opened.
 * @returns The group's label, or null for a page in none.
 */
function groupOf(pathname: string, groups: readonly Group[]): string | null {
  return (
    groups.find((group) => group.entries.some((entry) => isUnder(pathname, entry.to)))?.label ??
    null
  );
}

/** The page whose grid needs the room: the rail is collapsed while it is open. */
const DASHBOARD_EDITOR = /^\/configuration\/dashboards\/[^/]+\/edit$/u;

/**
 * The rail.
 *
 * @returns The sidebar.
 */
export function Sidebar() {
  const { pathname } = useLocation();
  const can = useSession((state) => state.can);
  const width = usePreferences((state) => state.sidebar);
  const setPreferences = usePreferences((state) => state.set);
  const counts = useRailCounts();
  const isForced = DASHBOARD_EDITOR.test(pathname);
  const isCollapsed = isForced || width === 'collapsed';
  const groups = GROUPS.filter((group) => group.permission === undefined || can(group.permission))
    .map((group) => ({
      ...group,
      entries: group.entries.filter(
        (entry) => entry.permission === undefined || can(entry.permission),
      ),
    }))
    .filter((group) => group.entries.length > 0);

  // What was chosen by hand, and on which page: it stops holding the moment the page changes.
  const [chosen, setChosen] = useState<{ readonly path: string; readonly open: string | null }>();
  const open = chosen?.path === pathname ? chosen.open : groupOf(pathname, groups);

  /**
   * Opens a group, closing the other, or closes it when it is the open one.
   *
   * @param label - The group pressed.
   */
  const toggle = (label: string): void => {
    setChosen({ path: pathname, open: open === label ? null : label });
  };

  const dashboards: Entry = { to: '/dashboards', label: 'Dashboards', icon: 'layout-dashboard' };
  const settings: Entry = { to: '/settings', label: 'Settings', icon: 'settings' };

  if (isCollapsed) {
    return (
      <nav
        aria-label="Main"
        className="flex w-18 shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-r border-border bg-rail px-3.5 py-4.5"
      >
        <div className="mb-4 flex h-10 items-center justify-center">
          <Logo size={26} />
        </div>

        <Square entry={dashboards} />

        {groups.map((group) => (
          <div
            key={group.label}
            className="mt-2 flex flex-col items-center gap-0.5 border-t border-border pt-2"
          >
            {group.entries.map((entry) => (
              <div key={entry.to} className="flex flex-col items-center gap-0.5">
                <Square entry={entry} />
                {entry.to === '/packages' ? <PackagePages isCollapsed /> : null}
              </div>
            ))}
          </div>
        ))}

        <div className="min-h-4 grow" />

        <Square entry={settings} />
        <UserChip isCollapsed />
        {isForced ? null : (
          <button
            type="button"
            aria-label="Expand sidebar"
            title="Expand sidebar"
            onClick={() => {
              setPreferences({ sidebar: 'expanded' });
            }}
            className={cn(TOGGLE, 'mt-2')}
          >
            <AppIcon id="chevron-right" size={16} />
          </button>
        )}
      </nav>
    );
  }

  return (
    <nav
      aria-label="Main"
      className="flex w-60 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border bg-rail px-3.5 py-4.5"
    >
      <div className="mb-3.5 flex h-10 items-center gap-2.5 pr-1 pl-1.5">
        <Logo size={26} />
        <span className="grow text-subhead font-semibold tracking-tight">Nebula Home</span>
        <button
          type="button"
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
          onClick={() => {
            setPreferences({ sidebar: 'collapsed' });
          }}
          className={TOGGLE}
        >
          <AppIcon id="chevron-left" size={16} />
        </button>
      </div>

      <Row entry={dashboards} />

      {groups.map((group) => (
        <NavGroup
          key={group.label}
          label={group.label}
          isOpen={open === group.label}
          onToggle={() => {
            toggle(group.label);
          }}
        >
          {group.entries.map((entry) => (
            <div key={entry.to} className="flex flex-col gap-0.5">
              <Row
                entry={entry}
                count={entry.count === undefined ? undefined : counts[entry.count]}
              />
              {entry.to === '/packages' ? <PackagePages isCollapsed={false} /> : null}
            </div>
          ))}
        </NavGroup>
      ))}

      <div className="min-h-4 grow" />

      <div className="flex flex-col gap-0.5">
        <Row entry={settings} />

        {/*
         * Settings above the person, not below. The rail is ordered by scope and a person is the
         * narrowest thing in it; it is also the row that opens a menu rather than navigating,
         * so it sits at the very bottom where a menu has room to open upward.
         */}
        <UserChip isCollapsed={false} />
      </div>
    </nav>
  );
}
