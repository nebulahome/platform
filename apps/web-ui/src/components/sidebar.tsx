/**
 * The left rail.
 *
 * It reads top to bottom by scope: the dashboards you built, the library that describes your
 * house, the packages the platform supervises, then the settings and you. The library entries
 * are behind two headings rather than sitting at the top level, because a rail with nine flat
 * items is a list to scan and a rail with four is a place you know your way around. The two
 * headings split the library by what a person is there to do: automations, scenes and aliases
 * are what the house does on its own, and devices, tags and areas are how the house is described
 * so that it can.
 *
 * A group is open when you are inside it and shut otherwise, and it can be toggled by hand.
 * That is not two behaviours: the automatic part answers "where am I", the manual part answers
 * "let me look at something else", and a group that only ever did the first would fight anyone
 * trying to navigate.
 *
 * One group is open at a time, and a toggle by hand holds only on the page it was made on. Held
 * any longer, it outlived the navigation it was for: a group opened from the dashboards stayed
 * open on every page after, beside the one the new page opened, and the group you were inside
 * could not be closed at all.
 *
 * Under Packages, the pages of the packages that ask for an entry (`ui.sidebar`), while they run:
 * a package managed from its own page is one click away, like the platform's own sections.
 *
 * Drawn as the Nebula rail: 240px on `rail`, rows 38px tall, the current one outlined on
 * `surface-raised` with its glyph in `primary`, and each group's heading in the mono label style.
 */
import { useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router';

import type { ApiPackage } from '@nebulahome/contracts';
import { AppIcon, CatalogueIcon, Logo, type UiIconId } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { Avatar } from '@/components/avatar';
import {
  ChevronIcon,
  ContainersIcon,
  DashboardsIcon,
  LibraryIcon,
  PackagesIcon,
  SettingsIcon,
} from '@/components/icons';
import { packageAppPath } from '@/packages/package-paths';
import { useInstalledPackages } from '@/packages/use-packages';
import { useCatalogueIcons } from '@/routes/library/device-icon';
import { PackageLogo } from '@/routes/packages/package-tile';

/** One entry inside a group. */
type GroupEntry = {
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
};

/** What the house does on its own. */
const AUTOMATION: readonly GroupEntry[] = [
  { to: '/automations', label: 'Automations', icon: 'zap' },
  { to: '/scenes', label: 'Scenes', icon: 'layers' },
  { to: '/aliases', label: 'Aliases', icon: 'sigma' },
];

/** How the house is described, and the dashboards it is shown on. */
const CONFIGURATION: readonly GroupEntry[] = [
  { to: '/devices', label: 'Devices', icon: 'cpu' },
  { to: '/tags', label: 'Tags', icon: 'tag' },
  { to: '/areas', label: 'Areas', icon: 'house' },
  {
    to: '/configuration/dashboards',
    label: 'Dashboards',
    icon: 'layout-grid',
    permission: 'dashboard:manage',
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

/** What one top-level row needs. */
type NavRowProps = {
  /** Where it goes. */
  readonly to: string;

  /** The glyph. */
  readonly icon: ReactNode;

  /** What it is called. */
  readonly label: string;

  /** A count shown on the right, when there is one worth showing. */
  readonly count?: string;
};

/**
 * One top-level row.
 *
 * @param props - See {@link NavRowProps}.
 * @returns The row.
 */
function NavRow(props: NavRowProps) {
  const { to, icon, label, count } = props;

  return (
    <NavLink to={to} className={({ isActive }) => `${ROW} ${isActive ? ROW_ACTIVE : ROW_IDLE}`}>
      {icon}
      <span className="grow truncate">{label}</span>
      {count === undefined ? null : (
        <span className="font-mono text-mono-caption text-foreground-subtle">{count}</span>
      )}
    </NavLink>
  );
}

/** What a group needs. */
type NavGroupProps = {
  /** What it is called. */
  readonly label: string;

  /** The entries under it, in the order they read, already narrowed to what may be opened. */
  readonly entries: readonly GroupEntry[];

  /** Whether it is open, which the rail decides for every group together. */
  readonly isOpen: boolean;

  /** Called when the heading is pressed. */
  readonly onToggle: () => void;
};

/**
 * A heading and the entries under it.
 *
 * @param props - See {@link NavGroupProps}.
 * @returns The group.
 */
function NavGroup(props: NavGroupProps) {
  const { label, entries, isOpen, onToggle } = props;

  return (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={onToggle}
        className="press flex h-9.5 w-full items-center gap-3 rounded-field px-3 font-mono text-label text-foreground-subtle uppercase transition-colors hover:text-foreground-muted"
      >
        <span className="grow text-left">{label}</span>
        <ChevronIcon isOpen={isOpen} className="text-foreground-subtle" />
      </button>

      {isOpen
        ? entries.map((entry) => (
            <NavLink
              key={entry.to}
              to={entry.to}
              className={({ isActive }) => `${ROW} ${isActive ? ROW_ACTIVE : ROW_IDLE}`}
            >
              <AppIcon id={entry.icon} size={18} />
              <span className="grow truncate">{entry.label}</span>
            </NavLink>
          ))
        : null}
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
 * @returns The chip.
 */
function UserChip() {
  const user = useSession((state) => state.user);
  const endSession = useSession((state) => state.signOut);
  const [isOpen, setOpen] = useState(false);

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
          className="absolute bottom-full left-0 mb-1.5 w-full animate-rise overflow-hidden rounded-tile border border-border-strong bg-surface p-1 shadow-float"
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
        className="press mt-1.5 flex w-full items-center gap-2.5 rounded-tile border border-border p-2.5 text-left transition-colors hover:bg-surface-raised"
      >
        <Avatar displayName={user?.displayName ?? ''} avatarUrl={user?.avatarUrl} isAccented />
        <span className="flex min-w-0 grow flex-col">
          <span className="truncate text-ui font-medium text-foreground">
            {user?.displayName ?? 'Not signed in'}
          </span>
          <span className="text-caption text-foreground-subtle capitalize">{user?.role ?? ''}</span>
        </span>
      </button>
    </div>
  );
}

/**
 * The entries of the packages' own pages, under Packages: each running package with a page that
 * asks for one, by the label and icon it asks for - its name and logo when it says neither.
 *
 * @returns The entries; nothing when no package asks.
 */
function PackagePages() {
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
    <div className="ml-4.5 flex flex-col gap-0.5 border-l border-border pl-2">
      {pages.map((found) => {
        const iconId = found.ui.sidebar?.icon;
        const icon = iconId === undefined ? undefined : icons.get(iconId);

        return (
          <NavLink
            key={found.id}
            to={packageAppPath(found.id)}
            className={({ isActive }) =>
              `press flex h-8.5 items-center gap-2 rounded-field border px-2.5 text-ui-sm transition-colors ${
                isActive ? ROW_ACTIVE : ROW_IDLE
              }`
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
            <span className="truncate">{found.ui.sidebar?.label ?? found.name}</span>
          </NavLink>
        );
      })}
    </div>
  );
}

/** A group of the rail, before the permissions narrow it. */
type Group = {
  readonly label: string;
  readonly entries: readonly GroupEntry[];
};

/** The two groups, in the order they read. */
const GROUPS: readonly Group[] = [
  { label: 'Automation', entries: AUTOMATION },
  { label: 'Configuration', entries: CONFIGURATION },
];

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

/**
 * The rail.
 *
 * @returns The sidebar.
 */
export function Sidebar() {
  const { pathname } = useLocation();
  const can = useSession((state) => state.can);
  const groups = GROUPS.map((group) => ({
    ...group,
    entries: group.entries.filter(
      (entry) => entry.permission === undefined || can(entry.permission),
    ),
  }));

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

  return (
    <nav
      aria-label="Main"
      className="flex w-60 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border bg-rail px-3.5 py-4.5"
    >
      <div className="mb-4 flex h-8 items-center gap-2.5 px-1.5">
        <Logo size={26} />
        <span className="text-subhead font-semibold tracking-tight">Nebula Home</span>
      </div>

      <NavRow to="/dashboards" icon={<DashboardsIcon />} label="Dashboards" />

      <div className="h-3 shrink-0" />

      {groups.map((group) => (
        <NavGroup
          key={group.label}
          label={group.label}
          entries={group.entries}
          isOpen={open === group.label}
          onToggle={() => {
            toggle(group.label);
          }}
        />
      ))}

      <NavRow to="/integrations" icon={<LibraryIcon />} label="Integrations" />

      <NavRow to="/packages" icon={<PackagesIcon />} label="Packages" />

      <PackagePages />

      {can('container:read') ? (
        <NavRow to="/containers" icon={<ContainersIcon />} label="Containers" />
      ) : null}

      <div className="min-h-4 grow" />

      <div className="flex flex-col gap-0.5">
        <NavRow to="/settings" icon={<SettingsIcon />} label="Settings" />

        {/*
         * Settings above the person, not below. The rail is ordered by scope and a person is the
         * narrowest thing in it; it is also the row that opens a menu rather than navigating,
         * so it sits at the very bottom where a menu has room to open upward.
         */}
        <UserChip />
      </div>
    </nav>
  );
}
