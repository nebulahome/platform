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
 * named on hover and to a screen reader - and opens again, by the same button, the last row at
 * both widths. The change is animated: the width moves, the words fade and the headings fold,
 * while the glyphs stay where they are. The choice is the person's alone and is kept with their
 * interface preferences; no page overrides it.
 *
 * It shows only what the role may see: an entry without its permission is not drawn, a group with
 * nothing left is not drawn, and House is drawn only for someone who may read the devices it is
 * about.
 *
 * Under Packages, the pages of the packages that ask for an entry (`ui.sidebar`), while they run:
 * a package managed from its own page is one click away, like the platform's own sections.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useLocation } from 'react-router';

import type { ApiPackage } from '@nebulahome/contracts';
import { AppIcon, CatalogueIcon, cn, Logo, type UiIconId } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { Avatar } from '@/components/avatar';
import { ChevronIcon } from '@/components/icons';
import { defineMessage, text, type Message } from '@/i18n/messages';
import { roleName } from '@/lib/role-names';
import { useRailCounts, type RailCountKey } from '@/lib/use-rail-counts';
import { useReducedMotion } from '@/lib/use-reduced-motion';
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
  readonly label: Message;

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
  readonly label: Message;
  readonly entries: readonly Entry[];

  /** The permission without which the whole group is not drawn. */
  readonly permission?: string;
};

/** The three groups, in the order they read. */
const GROUPS: readonly Group[] = [
  {
    label: defineMessage('nav.groups.automate', 'Automate'),
    entries: [
      {
        to: '/automations',
        label: defineMessage('nav.automations', 'Automations'),
        icon: 'zap',
        permission: 'automation:read',
        count: 'automations',
      },
      {
        to: '/scenes',
        label: defineMessage('nav.scenes', 'Scenes'),
        icon: 'layers',
        permission: 'scene:read',
        count: 'scenes',
      },
      {
        to: '/aliases',
        label: defineMessage('nav.aliases', 'Aliases'),
        icon: 'sigma',
        permission: 'alias:read',
        count: 'aliases',
      },
    ],
  },
  {
    label: defineMessage('nav.groups.house', 'House'),
    permission: 'device:read',
    entries: [
      {
        to: '/devices',
        label: defineMessage('nav.devices', 'Devices'),
        icon: 'cpu',
        permission: 'device:read',
        count: 'devices',
      },
      {
        to: '/areas',
        label: defineMessage('nav.areas', 'Areas'),
        icon: 'house',
        permission: 'area:read',
        count: 'areas',
      },
      {
        to: '/tags',
        label: defineMessage('nav.tags', 'Tags'),
        icon: 'tag',
        permission: 'tag:read',
        count: 'tags',
      },
      {
        to: '/configuration/dashboards',
        label: defineMessage('nav.dashboardSetup', 'Dashboard setup'),
        icon: 'layout-grid',
        permission: 'dashboard:manage',
      },
    ],
  },
  {
    label: defineMessage('nav.groups.system', 'System'),
    entries: [
      {
        to: '/integrations',
        label: defineMessage('nav.integrations', 'Integrations'),
        icon: 'library',
        permission: 'integration:read',
        count: 'integrations',
      },
      {
        to: '/packages',
        label: defineMessage('nav.packages', 'Packages'),
        icon: 'package',
        permission: 'package:read',
        count: 'packages',
      },
      {
        to: '/containers',
        label: defineMessage('nav.containers', 'Containers'),
        icon: 'container',
        permission: 'container:read',
        count: 'containers',
      },
    ],
  },
];

/** The rows above and below the groups. */
const DASHBOARDS: Entry = {
  to: '/dashboards',
  label: defineMessage('nav.dashboards', 'Dashboards'),
  icon: 'layout-dashboard',
};

/** The settings row, at the foot. */
const SETTINGS: Entry = {
  to: '/settings',
  label: defineMessage('nav.settings', 'Settings'),
  icon: 'settings',
};

/** How the rail moves: one curve and one length for its width and for everything inside it. */
const MOTION = 'duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]';

/**
 * The classes a row shares whether or not it is the current one. Its glyph sits 12px in at both
 * widths, which is the middle of the 72px rail: the rail narrows around the glyphs rather than
 * moving them, and only the words after them go.
 */
const ROW =
  'press flex h-10 w-full shrink-0 items-center gap-3 overflow-hidden rounded-field border px-3 ' +
  'text-ui whitespace-nowrap transition-colors';

/** A row that is the current page: outlined, raised, its glyph in the accent. */
const ROW_ACTIVE =
  'border-border-strong bg-surface-raised font-medium text-foreground [&_svg]:text-primary';

/** A row that is not. */
const ROW_IDLE =
  'border-transparent text-foreground-muted hover:bg-surface-raised hover:text-foreground';

/** What everything inside the rail reads about it. */
type RailState = {
  /** Whether it is the 72px one. */
  readonly isCollapsed: boolean;

  /** Whether it may move, or only change. */
  readonly isReduced: boolean;
};

const RailContext = createContext<RailState>({ isCollapsed: false, isReduced: false });

/**
 * The classes of words that leave when the rail narrows: gone at once on the way in, back only
 * once there is room for them on the way out, so a label is never seen squeezed.
 *
 * @param rail - How the rail stands.
 * @returns The classes.
 */
function fading(rail: RailState): string {
  if (rail.isReduced) {
    return rail.isCollapsed ? 'opacity-0' : '';
  }

  return cn(
    'transition-opacity',
    rail.isCollapsed ? 'opacity-0 duration-100' : 'opacity-100 delay-150 duration-200',
  );
}

/**
 * Words that leave when the rail narrows.
 *
 * @param props - The words.
 * @param props.className - Their own classes.
 * @param props.children - The words.
 * @returns The span.
 */
function Fading(props: { readonly className?: string; readonly children: ReactNode }) {
  const rail = useContext(RailContext);

  return <span className={cn(props.className, fading(rail))}>{props.children}</span>;
}

/**
 * The classes of a part that opens and shuts by its height - a group's heading, a group's rows:
 * a one-row grid whose row goes from nothing to its content, which is the one height CSS can
 * move to without being told a number.
 *
 * @param isOpen - Whether it is shown.
 * @param rail - How the rail stands.
 * @returns The classes.
 */
function folding(isOpen: boolean, rail: RailState): string {
  return cn(
    'grid',
    rail.isReduced ? undefined : `transition-[grid-template-rows,opacity] ${MOTION}`,
    isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
  );
}

/** What one row needs. */
type RowProps = {
  readonly entry: Entry;

  /** How many there are, when it is known. */
  readonly count?: number | undefined;
};

/**
 * One row: the glyph, and - while the rail is open - the name and how many. Shut, the name is
 * what the row is called and what a hover shows.
 *
 * @param props - See {@link RowProps}.
 * @returns The row.
 */
function Row(props: RowProps) {
  const { entry, count } = props;
  const { isCollapsed } = useContext(RailContext);

  return (
    <NavLink
      to={entry.to}
      title={isCollapsed ? text(entry.label) : undefined}
      aria-label={isCollapsed ? text(entry.label) : undefined}
      className={({ isActive }) => cn(ROW, isActive ? ROW_ACTIVE : ROW_IDLE)}
    >
      <AppIcon id={entry.icon} size={18} />
      <Fading className="grow truncate">{text(entry.label)}</Fading>
      {count === undefined ? null : (
        <Fading className="font-mono text-mono-caption font-normal text-foreground-subtle tabular">
          {count}
        </Fading>
      )}
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
 * A heading and the rows under it. On the narrow rail the heading folds away and a line parts
 * the group from the one above, and every row is shown: a glyph has no group to be found in.
 *
 * What is folded away is also `inert` and hidden from a screen reader: a row nobody can see must
 * not take the focus or be read out.
 *
 * @param props - See {@link NavGroupProps}.
 * @returns The group.
 */
function NavGroup(props: NavGroupProps) {
  const { label, isOpen, onToggle, children } = props;
  const rail = useContext(RailContext);
  const isShown = isOpen || rail.isCollapsed;

  return (
    <div
      className={cn(
        'flex flex-col border-t',
        rail.isReduced ? undefined : `transition-[margin,padding,border-color] ${MOTION}`,
        rail.isCollapsed ? 'mt-2 border-border pt-2' : 'mt-2.5 border-transparent pt-0',
      )}
    >
      <div className={folding(!rail.isCollapsed, rail)} inert={rail.isCollapsed}>
        <div className="min-h-0 overflow-hidden" aria-hidden={rail.isCollapsed}>
          <button
            type="button"
            aria-expanded={isOpen}
            onClick={onToggle}
            className="press flex h-8.5 w-full items-center gap-2 rounded-field px-3 font-mono text-label whitespace-nowrap text-foreground-subtle uppercase transition-colors hover:text-foreground-muted"
          >
            <span className="grow text-left">{label}</span>
            <ChevronIcon isOpen={isOpen} className="text-foreground-subtle" />
          </button>
        </div>
      </div>

      <div className={folding(isShown, rail)} inert={!isShown}>
        <div className="min-h-0 overflow-hidden" aria-hidden={!isShown}>
          <div className="flex flex-col gap-0.5 pt-0.5">{children}</div>
        </div>
      </div>
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
 * On the open rail the menu opens upward over the chip; on the narrow one it opens to the right,
 * over the page, since 72px has no room for "Sign out". Either way it sits outside the part of
 * the rail that scrolls, so nothing clips it.
 *
 * @returns The chip.
 */
function UserChip() {
  const { t } = useTranslation();
  const rail = useContext(RailContext);
  const { isCollapsed } = rail;
  const user = useSession((state) => state.user);
  const endSession = useSession((state) => state.signOut);
  const [isOpen, setOpen] = useState(false);
  const name = user?.displayName ?? t('nav.notSignedIn', 'Not signed in');
  const role = user === undefined ? '' : roleName(user.role);

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
          className={cn(
            'absolute z-30 animate-rise overflow-hidden rounded-tile border border-border-strong bg-surface p-1 shadow-float',
            isCollapsed
              ? 'bottom-0 left-full ml-4.5 w-48'
              : 'bottom-full left-0 mb-1.5 w-full min-w-48',
          )}
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
            {t('nav.signOut', 'Sign out')}
          </button>
        </div>
      ) : null}

      <button
        type="button"
        aria-label={
          isCollapsed ? t('nav.accountMenu', 'Account menu: {{name}}', { name }) : undefined
        }
        title={isCollapsed ? `${name} · ${role}` : undefined}
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
          'press mt-1.5 flex w-full items-center gap-2.5 overflow-hidden rounded-tile border text-left whitespace-nowrap hover:bg-surface-raised',
          rail.isReduced
            ? 'transition-colors'
            : `transition-[padding,border-color,background-color] ${MOTION}`,
          isCollapsed ? 'border-transparent p-1.25' : 'border-border p-2.5',
        )}
      >
        <Avatar displayName={user?.displayName ?? ''} avatarUrl={user?.avatarUrl} isAccented />
        <Fading className="flex min-w-0 grow flex-col">
          <span className="truncate text-ui font-medium text-foreground">{name}</span>
          <span className="text-caption text-foreground-subtle">{role}</span>
        </Fading>
      </button>
    </div>
  );
}

/**
 * The entries of the packages' own pages, under Packages: each running package with a page that
 * asks for one, by the label and icon it asks for - its name and logo when it says neither.
 * Indented under Packages on the open rail; glyphs in the column like every other on the narrow
 * one.
 *
 * @returns The entries; nothing when no package asks.
 */
function PackagePages() {
  const rail = useContext(RailContext);
  const { isCollapsed } = rail;
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
        'flex flex-col gap-0.5 border-l',
        rail.isReduced ? undefined : `transition-[margin,padding,border-color] ${MOTION}`,
        isCollapsed ? 'ml-0 border-transparent pl-0' : 'ml-4.5 border-border pl-2',
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
                'press flex h-8.5 w-full shrink-0 items-center overflow-hidden rounded-field border text-ui-sm whitespace-nowrap',
                rail.isReduced
                  ? 'transition-colors'
                  : `transition-[padding,gap,background-color,border-color,color] ${MOTION}`,
                // Shut, its 16px glyph sits where the rows' 18px ones do.
                isCollapsed ? 'gap-3 px-3.25' : 'gap-2 px-2.5',
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
            <Fading className="truncate">{label}</Fading>
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
 * @returns The key of the group's label, or null for a page in none.
 */
function groupOf(pathname: string, groups: readonly Group[]): string | null {
  return (
    groups.find((group) => group.entries.some((entry) => isUnder(pathname, entry.to)))?.label.key ??
    null
  );
}

/**
 * The rail.
 *
 * One element at both widths, so that the change between them can be watched rather than cut:
 * the width moves, the words fade, the headings fold into lines, and the glyphs stay where they
 * are. Three parts top to bottom - the name, the entries (the only part that scrolls), and the
 * foot with the settings, the person and the button that collapses or opens the rail, which is
 * the last row at both widths so it is always found in the same place.
 *
 * @returns The sidebar.
 */
export function Sidebar() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const can = useSession((state) => state.can);
  const width = usePreferences((state) => state.sidebar);
  const setPreferences = usePreferences((state) => state.set);
  const counts = useRailCounts();
  const isReduced = useReducedMotion();
  const isCollapsed = width === 'collapsed';
  const rail = useMemo(() => ({ isCollapsed, isReduced }), [isCollapsed, isReduced]);
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
   * @param id - The group pressed: the key of its label.
   */
  const toggle = (id: string): void => {
    setChosen({ path: pathname, open: open === id ? null : id });
  };

  return (
    <RailContext.Provider value={rail}>
      <nav
        aria-label={t('nav.main', 'Main')}
        className={cn(
          'relative z-20 flex shrink-0 flex-col border-r border-border bg-rail py-4.5',
          isReduced ? undefined : `transition-[width] ${MOTION}`,
          isCollapsed ? 'w-18' : 'w-60',
        )}
      >
        <div className="mx-3.5 mb-3.5 flex h-10 shrink-0 items-center gap-2.5 overflow-hidden px-2 whitespace-nowrap">
          <Logo size={26} />
          {/* The product's name, the same in every language. */}
          <Fading className="text-subhead font-semibold tracking-tight">
            <span translate="no">Nebula Home</span>
          </Fading>
        </div>

        {/* Narrow, the rows have exactly the 43px between the gutters: a scrollbar on a short
            window would take its width out of them and push every glyph off the middle, so it
            still scrolls but draws none. */}
        <div
          className={cn(
            'flex min-h-0 grow flex-col gap-0.5 overflow-x-hidden overflow-y-auto px-3.5',
            isCollapsed ? 'scrollbar-none' : undefined,
          )}
        >
          <Row entry={DASHBOARDS} />

          {groups.map((group) => (
            <NavGroup
              key={group.label.key}
              label={text(group.label)}
              isOpen={open === group.label.key}
              onToggle={() => {
                toggle(group.label.key);
              }}
            >
              {group.entries.map((entry) => (
                <div key={entry.to} className="flex flex-col gap-0.5">
                  <Row
                    entry={entry}
                    count={entry.count === undefined ? undefined : counts[entry.count]}
                  />
                  {entry.to === '/packages' ? <PackagePages /> : null}
                </div>
              ))}
            </NavGroup>
          ))}

          <div className="min-h-4 grow" />
        </div>

        {/*
         * Settings above the person, not below. The rail is ordered by scope and a person is the
         * narrowest thing in it; it is also the row that opens a menu rather than navigating,
         * so it sits near the bottom where a menu has room to open. The button that collapses or
         * opens the rail is the last row at both widths: it never moves.
         */}
        <div className="flex shrink-0 flex-col gap-0.5 px-3.5 pt-2">
          <Row entry={SETTINGS} />
          <UserChip />
          <button
            type="button"
            aria-label={
              isCollapsed
                ? t('nav.expand', 'Expand sidebar')
                : t('nav.collapseSidebar', 'Collapse sidebar')
            }
            title={isCollapsed ? t('nav.expand', 'Expand sidebar') : undefined}
            aria-expanded={!isCollapsed}
            onClick={() => {
              setPreferences({ sidebar: isCollapsed ? 'expanded' : 'collapsed' });
            }}
            className={cn(ROW, ROW_IDLE, 'mt-1.5 text-ui-sm')}
          >
            <AppIcon
              id="chevrons-left"
              size={18}
              className={cn(
                isReduced ? undefined : `transition-transform ${MOTION}`,
                isCollapsed ? 'rotate-180' : undefined,
              )}
            />
            <Fading className="truncate">{t('nav.collapse', 'Collapse')}</Fading>
          </button>
        </div>
      </nav>
    </RailContext.Provider>
  );
}
