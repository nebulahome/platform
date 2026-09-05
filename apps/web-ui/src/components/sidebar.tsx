/**
 * The left rail.
 *
 * It reads top to bottom by scope: the dashboards you built, the library that describes your
 * house, the packages the platform supervises, then the settings and you. The four library
 * entries are behind one heading rather than sitting at the top level, because a rail with eight
 * flat items is a list to scan and a rail with three is a place you know your way around.
 *
 * The group is open when you are inside it and shut otherwise, and it can be toggled by hand.
 * That is not two behaviours: the automatic part answers "where am I", the manual part answers
 * "let me look at something else", and a group that only ever did the first would fight anyone
 * trying to navigate.
 */
import { useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router';

import { Logo } from '@nebula-home/ui';

import { useSession } from '@/auth/session-store';
import {
  ChevronIcon,
  DashboardsIcon,
  ExpandIcon,
  LibraryIcon,
  PackagesIcon,
  SettingsIcon,
} from '@/components/icons';

/** One entry inside the library group. */
type LibraryEntry = {
  /** Where it goes. */
  readonly to: string;

  /** What it is called. */
  readonly label: string;
};

/** What the library holds. The four things that describe a house. */
const LIBRARY: readonly LibraryEntry[] = [
  { to: '/automations', label: 'Automations' },
  { to: '/scenes', label: 'Scenes' },
  { to: '/devices', label: 'Devices' },
  { to: '/aliases', label: 'Aliases' },
];

/** The classes a row shares whether or not it is the current one. */
const ROW = 'flex h-10 items-center gap-3 rounded-[10px] px-2.5 text-sm transition-colors';

/**
 * Builds the initials shown in the avatar.
 *
 * @param displayName - The name the person chose.
 * @returns One or two letters.
 */
export function toInitials(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? '?';
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';

  return (first + last).toUpperCase();
}

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
        <span className="font-mono text-xs text-foreground-subtle">{count}</span>
      )}
    </NavLink>
  );
}

/**
 * The library heading and its four entries.
 *
 * @returns The group.
 */
function LibraryGroup() {
  const location = useLocation();
  const isInside = LIBRARY.some((entry) => location.pathname.startsWith(entry.to));
  const [isForcedOpen, setForcedOpen] = useState(false);
  const isOpen = isInside || isForcedOpen;

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => {
          setForcedOpen(!isOpen);
        }}
        className={`${ROW} w-full ${
          isOpen ? 'text-foreground [&_svg]:first:text-primary' : 'text-foreground-muted'
        } hover:bg-surface-raised/60 hover:text-foreground`}
      >
        <LibraryIcon />
        <span className={`grow text-left ${isOpen ? 'font-medium' : ''}`}>Library</span>
        <ChevronIcon isOpen={isOpen} className="text-foreground-subtle" />
      </button>

      {isOpen ? (
        <div className="ml-[19px] flex flex-col gap-0.5 border-l border-border pl-2.5">
          {LIBRARY.map((entry) => (
            <NavLink
              key={entry.to}
              to={entry.to}
              className={({ isActive }) =>
                `flex h-[34px] items-center rounded-lg px-2.5 text-[13.5px] transition-colors ${
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
 * A menu rather than a button that signs out on click. The chip carries an expand affordance,
 * and a control that looks like it opens something and instead ends your session is a small
 * betrayal. Escape and a click elsewhere both close it, because a menu that can only be
 * dismissed by choosing something is a trap.
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
          className="absolute bottom-full left-0 mb-1 w-full overflow-hidden rounded-[10px] border border-border bg-surface-raised p-1 shadow-lg shadow-black/40"
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
            className="flex h-9 w-full items-center rounded-lg px-2.5 text-[13px] text-foreground-muted transition-colors hover:bg-surface hover:text-danger"
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
        className="flex h-[52px] w-full items-center gap-3 rounded-[10px] px-2.5 text-left transition-colors hover:bg-surface-raised/60"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-[13px] font-medium text-primary-foreground">
          {toInitials(user?.displayName ?? '')}
        </span>
        <span className="flex min-w-0 grow flex-col">
          <span className="truncate text-[13.5px] font-medium text-foreground">
            {user?.displayName ?? 'Not signed in'}
          </span>
          <span className="text-[11.5px] text-foreground-subtle capitalize">
            {user?.role ?? ''}
          </span>
        </span>
        <ExpandIcon className="text-foreground-subtle" />
      </button>
    </div>
  );
}

/**
 * The rail.
 *
 * @returns The sidebar.
 */
export function Sidebar() {
  return (
    <nav
      aria-label="Main"
      className="flex w-[264px] shrink-0 flex-col gap-4 border-r border-border bg-surface p-4"
    >
      <div className="flex h-11 items-center gap-3 px-2">
        <Logo size={27} />
        <span className="text-base font-medium tracking-tight">Nebula</span>
      </div>

      <div className="h-px bg-border" />

      <NavRow to="/dashboards" icon={<DashboardsIcon />} label="Dashboards" />

      <div className="h-px bg-border" />

      <LibraryGroup />

      <NavRow to="/packages" icon={<PackagesIcon />} label="Packages" />

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
