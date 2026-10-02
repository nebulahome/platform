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
 */
import { useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router';

import { Logo } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { Avatar } from '@/components/avatar';
import {
  ChevronIcon,
  ContainersIcon,
  DashboardsIcon,
  LibraryIcon,
  PackagesIcon,
  SettingsIcon,
  WrenchIcon,
  ZapIcon,
} from '@/components/icons';

/** One entry inside a group. */
type GroupEntry = {
  /** Where it goes. */
  readonly to: string;

  /** What it is called. */
  readonly label: string;

  /**
   * The permission needed to open it, when one is; the entry is not drawn without it. A courtesy
   * rather than a control - the route checks the permission itself.
   */
  readonly permission?: string;
};

/** What the house does on its own. */
const AUTOMATION: readonly GroupEntry[] = [
  { to: '/automations', label: 'Automations' },
  { to: '/scenes', label: 'Scenes' },
  { to: '/aliases', label: 'Aliases' },
];

/** How the house is described, and the dashboards it is shown on. */
const CONFIGURATION: readonly GroupEntry[] = [
  { to: '/devices', label: 'Devices' },
  { to: '/tags', label: 'Tags' },
  { to: '/areas', label: 'Areas' },
  { to: '/configuration/dashboards', label: 'Dashboards', permission: 'dashboard:manage' },
];

/** The classes a row shares whether or not it is the current one. */
const ROW = 'press flex h-10 items-center gap-3 rounded-field px-2.5 text-title';

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
    <NavLink
      to={to}
      className={({ isActive }) =>
        `${ROW} ${
          isActive
            ? 'bg-surface-raised font-medium text-foreground [&_svg]:text-primary'
            : 'text-foreground-muted hover:bg-surface-raised/60 hover:text-foreground'
        }`
      }
    >
      {icon}
      <span className="grow">{label}</span>
      {count === undefined ? null : (
        <span className="font-mono text-caption text-foreground-subtle">{count}</span>
      )}
    </NavLink>
  );
}

/** What a group needs. */
type NavGroupProps = {
  /** What it is called. */
  readonly label: string;

  /** The glyph beside the heading. */
  readonly icon: ReactNode;

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
  const { label, icon, entries, isOpen, onToggle } = props;

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={onToggle}
        className={`${ROW} w-full ${
          isOpen ? 'text-foreground [&_svg]:first:text-primary' : 'text-foreground-muted'
        } hover:bg-surface-raised/60 hover:text-foreground`}
      >
        {icon}
        <span className={`grow text-left ${isOpen ? 'font-medium' : ''}`}>{label}</span>
        <ChevronIcon isOpen={isOpen} className="text-foreground-subtle" />
      </button>

      {isOpen ? (
        <div className="ml-[19px] flex flex-col gap-0.5 border-l border-border pl-2.5">
          {entries.map((entry) => (
            <NavLink
              key={entry.to}
              to={entry.to}
              className={({ isActive }) =>
                `press flex h-8.5 items-center rounded-chip px-2.5 text-ui ${
                  isActive
                    ? 'bg-surface-raised font-medium text-foreground'
                    : 'text-foreground-muted hover:text-foreground'
                }`
              }
            >
              {entry.label}
            </NavLink>
          ))}
        </div>
      ) : null}
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
          className="absolute bottom-full left-0 mb-1 w-full overflow-hidden rounded-field border border-border-strong face-card p-1 shadow-dialog"
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
            className="press flex h-9 w-full items-center rounded-chip px-2.5 text-ui text-foreground-muted hover:bg-surface hover:text-danger"
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
        className="press flex h-13 w-full items-center gap-3 rounded-field px-2.5 text-left hover:bg-surface-raised/60"
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

/** A group of the rail, before the permissions narrow it. */
type Group = {
  readonly label: string;
  readonly icon: ReactNode;
  readonly entries: readonly GroupEntry[];
};

/** The two groups, in the order they read. */
const GROUPS: readonly Group[] = [
  { label: 'Automation', icon: <ZapIcon />, entries: AUTOMATION },
  { label: 'Configuration', icon: <WrenchIcon />, entries: CONFIGURATION },
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
      className="flex w-66 shrink-0 flex-col gap-4 border-r border-border bg-rail p-4"
    >
      <div className="flex h-11 items-center gap-3 px-2">
        <Logo size={27} />
        <span className="text-subhead font-semibold tracking-tight">Nebula Home</span>
      </div>

      <div className="h-px bg-border" />

      <NavRow to="/dashboards" icon={<DashboardsIcon />} label="Dashboards" />

      <div className="h-px bg-border" />

      {groups.map((group) => (
        <NavGroup
          key={group.label}
          label={group.label}
          icon={group.icon}
          entries={group.entries}
          isOpen={open === group.label}
          onToggle={() => {
            toggle(group.label);
          }}
        />
      ))}

      <NavRow to="/integrations" icon={<LibraryIcon />} label="Integrations" />

      <NavRow to="/packages" icon={<PackagesIcon />} label="Packages" />

      {can('container:read') ? (
        <NavRow to="/containers" icon={<ContainersIcon />} label="Containers" />
      ) : null}

      <div className="grow" />

      <div className="h-px bg-border" />

      <div className="flex flex-col gap-1">
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
