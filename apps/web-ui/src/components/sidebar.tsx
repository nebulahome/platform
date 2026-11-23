/**
 * The sidebar: a card on the left of every page.
 *
 * It floats 16px off the window's top, bottom and left edges, over the canvas, and the page beside
 * it always makes room: opening it pushes the page over, it never covers it.
 *
 * It reads top to bottom by scope: the dashboards you built; what the house does on its own
 * (Automate: automations, scenes, aliases); how the house is described (House: devices, areas,
 * tags, and the setup of the dashboards); what the platform runs (System: brokers, integrations,
 * packages, containers); then the settings and you. Each entry carries how many there are, read
 * from the lists the pages read, and an update waiting puts a dot on its icon.
 *
 * On the open card one section stands open at a time: a heading opens its section and folds the
 * one that was open, and going to a page opens the page's section the same way. The open one is
 * kept on this device with the width. A folded section still shows the row of the page you are
 * on, so where you are is never folded away, and a dot beside its heading says when something
 * inside wants a look. The
 * shut card shows every icon whatever is folded: an icon has no heading to be found under.
 *
 * The card is 64px wide with one icon per page, or 280px with their names and counts. The button
 * that changes it is the last row at both widths, so it is always found in the same place. The
 * icons never move between the two: the card widens around them, the names fade in after them,
 * and each section's heading cross-fades with the line that stands for it when shut. Shut, a
 * page's name - with how many there are, or what wants a look - shows beside the card on hover
 * and on keyboard focus.
 *
 * The width is the person's choice, kept on this device with their interface preferences; no page
 * overrides it. A window narrower than 1100px starts it shut and leaves the choice as it was.
 *
 * It shows only what the role may see: an entry without its permission is not drawn, a section
 * with nothing left is not drawn, and House is drawn only for someone who may read the devices it
 * is about.
 *
 * Under Packages, the pages of the packages that ask for an entry (`ui.sidebar`), while they run:
 * a package managed from its own page is one click away, like the platform's own sections.
 */
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, useLocation } from 'react-router';

import { LOCALE_NAMES, type ApiPackage } from '@nebulahome/contracts';
import { AppIcon, CatalogueIcon, cn, Logo, type UiIconId } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { Avatar } from '@/components/avatar';
import { defineMessage, text, type Message } from '@/i18n/messages';
import { roleName } from '@/lib/role-names';
import { useMediaQuery } from '@/lib/use-media-query';
import {
  useRailAlerts,
  useRailCounts,
  type RailAlertKey,
  type RailCountKey,
} from '@/lib/use-rail-counts';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { packageAppPath } from '@/packages/package-paths';
import { useInstalledPackages } from '@/packages/use-packages';
import { usePaletteStore } from '@/palette/palette-store';
import { paletteShortcutLabel } from '@/palette/use-palette-shortcut';
import { useCatalogueIcons } from '@/routes/library/device-icon';
import { PackageLogo } from '@/routes/packages/package-tile';
import { THEME_LABELS, usePreferences, type SidebarSection } from '@/settings/preferences';

/** One entry of the sidebar. */
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

  /** Which updates it shows waiting, when it can show some. */
  readonly alert?: RailAlertKey;
};

/** A section of the sidebar, before the permissions narrow it. */
type Group = {
  /** What its fold is kept under. */
  readonly id: SidebarSection;

  readonly label: Message;
  readonly entries: readonly Entry[];

  /** The permission without which the whole section is not drawn. */
  readonly permission?: string;
};

/** The three sections, in the order they read. */
const GROUPS: readonly Group[] = [
  {
    id: 'automate',
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
    id: 'house',
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
    id: 'system',
    label: defineMessage('nav.groups.system', 'System'),
    entries: [
      {
        to: '/brokers',
        label: defineMessage('nav.brokers', 'Brokers'),
        icon: 'waypoints',
        permission: 'device:read',
      },
      {
        to: '/integrations',
        label: defineMessage('nav.integrations', 'Integrations'),
        icon: 'library',
        permission: 'integration:read',
        count: 'integrations',
        alert: 'integrations',
      },
      {
        to: '/packages',
        label: defineMessage('nav.packages', 'Packages'),
        icon: 'package',
        permission: 'package:read',
        count: 'packages',
        alert: 'packages',
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

/** The row above the sections. */
const DASHBOARDS: Entry = {
  to: '/dashboards',
  label: defineMessage('nav.dashboards', 'Dashboards'),
  icon: 'layout-dashboard',
};

/** The calendar's row, under the dashboards. */
const CALENDAR: Entry = {
  to: '/calendar',
  label: defineMessage('nav.calendar', 'Calendar'),
  icon: 'calendar-days',
  permission: 'calendar:read',
};

/** The settings row, at the foot. */
const SETTINGS: Entry = {
  to: '/settings',
  label: defineMessage('nav.settings', 'Settings'),
  icon: 'settings',
};

/** Every page the sidebar leads to, with its name and icon: where a dashboard shortcut may go. */
export const NAV_PAGES: readonly Pick<Entry, 'to' | 'label' | 'icon'>[] = [
  DASHBOARDS,
  CALENDAR,
  ...GROUPS.flatMap((group) => group.entries),
  SETTINGS,
];

/** Narrower than this, the card starts shut. In jsdom no query matches: a wide window. */
const NARROW_QUERY = '(max-width: 1099.98px)';

/** How long the pointer rests on an icon before its name shows. */
const TIP_DELAY_MS = 120;

/**
 * How soon after one name went another shows at once: running the pointer down the icons reads
 * them one after another, rather than waiting on each.
 */
const TIP_GRACE_MS = 300;

/** How the card moves: one length and one curve for its width and everything that follows it. */
const MOTION = 'duration-220 ease-[cubic-bezier(0.22,1,0.36,1)]';

/**
 * The classes a row shares whether or not it is the current one. Its 20px icon sits 11px in, past
 * the card's 9px and the row's own edge, which is the middle of the 64px card: the card narrows
 * around the icons rather than moving them, and only the words after them go.
 */
// The focus ring sits inside the row: the part that scrolls clips anything drawn outside it.
const ROW =
  'press group flex h-11 w-full shrink-0 items-center gap-3.25 overflow-hidden rounded-tile border ' +
  'px-2.75 text-ui whitespace-nowrap transition-colors focus-visible:-outline-offset-2';

/**
 * A package's page under Packages: a shorter row with a 16px icon. Open, it stands indented past
 * the line that hangs from the Packages icon; shut, its icon is in the column of the others. The
 * only icons that move when the card opens, so they slide: no `press` here, whose own transition
 * would stop the padding from moving.
 */
const SUB_ROW =
  'group flex h-9 w-full shrink-0 items-center gap-2.5 overflow-hidden rounded-field border ' +
  'text-ui-sm whitespace-nowrap focus-visible:-outline-offset-2';

/** A row that is the current page: outlined, raised, its glyph in the accent. */
const ROW_ACTIVE =
  'border-border-strong bg-surface-raised font-medium text-foreground [&_svg]:text-primary';

/** A row that is not: a hover lifts it half a step, so it never reads as the current one. */
const ROW_IDLE =
  'border-transparent text-foreground-muted hover:bg-surface-raised/60 hover:text-foreground';

/** A row of the account menu. */
const MENU_ROW =
  'flex h-10 w-full shrink-0 items-center gap-3 rounded-field px-3 text-left text-ui whitespace-nowrap ' +
  'transition-colors focus-visible:outline-none';

/**
 * What a control spreads on itself for its name to show beside the shut card. The words are its
 * `data-tip`, set only while the card is shut: open, the name is on the row already.
 */
type TipHandlers = {
  readonly onMouseEnter: (event: { readonly currentTarget: HTMLElement }) => void;
  readonly onMouseLeave: () => void;
  readonly onFocus: (event: FocusEvent<HTMLElement>) => void;
  readonly onBlur: () => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
};

/** What everything inside the sidebar reads about it. */
type RailState = {
  /** Whether it is the 64px one. */
  readonly isCollapsed: boolean;

  /** Whether it may move, or only change. */
  readonly isReduced: boolean;

  /** See {@link TipHandlers}. */
  readonly tip: TipHandlers;

  /** Takes the name away now. */
  readonly hideTip: () => void;
};

const RailContext = createContext<RailState>({
  isCollapsed: false,
  isReduced: false,
  tip: { onMouseEnter: noop, onMouseLeave: noop, onFocus: noop, onBlur: noop, onKeyDown: noop },
  hideTip: noop,
});

/** Does nothing: the context's default, outside a sidebar. */
function noop(): void {
  // Nothing to do.
}

/**
 * The classes of words that leave when the card narrows: gone at once on the way in, back only
 * as there is room for them on the way out, so a name is never seen squeezed.
 *
 * @param rail - How the card stands.
 * @returns The classes.
 */
function fading(rail: RailState): string {
  if (rail.isReduced) {
    return rail.isCollapsed ? 'opacity-0' : '';
  }

  return cn(
    'transition-opacity',
    rail.isCollapsed ? 'opacity-0 duration-100' : 'opacity-100 delay-60 duration-160',
  );
}

/**
 * The classes of the line that stands for a section's heading on the shut card: the heading's
 * timing the other way round, and drawn out from its middle as it comes.
 *
 * @param rail - How the card stands.
 * @returns The classes.
 */
function lining(rail: RailState): string {
  if (rail.isReduced) {
    return rail.isCollapsed ? '' : 'opacity-0';
  }

  return cn(
    'transition-[opacity,scale]',
    rail.isCollapsed
      ? 'scale-x-100 opacity-100 delay-60 duration-160'
      : 'scale-x-50 opacity-0 duration-100',
  );
}

/**
 * Words that leave when the card narrows.
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
 * The dot an icon carries while something under it wants a look, ringed in the row's own ground
 * so it reads as cut out of the icon.
 *
 * @returns The dot.
 */
function AlertDot() {
  return (
    <span
      aria-hidden="true"
      className="absolute -top-0.75 -right-1.5 size-3 animate-fade-in rounded-full border-2 border-surface bg-warning group-aria-[current=page]:border-surface-raised"
    />
  );
}

/**
 * The Search row, between the logo and the pages: what opens the command palette for a pointer or
 * a finger, and says which keys open it from anywhere. It reads as a field, not as a page - an
 * outline at rest, raised under the pointer - and is never the current one.
 *
 * @returns The row.
 */
function SearchRow() {
  const { t } = useTranslation();
  const rail = useContext(RailContext);
  const open = usePaletteStore((state) => state.open);
  const label = t('palette.search', 'Search');
  const keys = paletteShortcutLabel();

  return (
    <button
      type="button"
      onClick={open}
      aria-label={rail.isCollapsed ? label : undefined}
      aria-keyshortcuts={keys === '⌘K' ? 'Meta+K' : 'Control+K'}
      data-tip={rail.isCollapsed ? `${label} · ${keys}` : undefined}
      {...rail.tip}
      className={cn(
        ROW,
        'mt-1.5 mb-2.5 border-border text-foreground-subtle hover:border-border-strong hover:bg-surface-raised hover:text-foreground focus-visible:border-border-strong focus-visible:bg-surface-raised focus-visible:text-foreground',
      )}
    >
      <AppIcon id="search" size={20} className="shrink-0" />
      <Fading className="grow truncate text-left">{label}</Fading>
      <Fading className="flex shrink-0">
        <kbd className="rounded-check border border-border-strong px-1.5 font-mono text-label text-foreground-subtle">
          {keys}
        </kbd>
      </Fading>
    </button>
  );
}

/** What one row needs. */
type RowProps = {
  readonly entry: Entry;

  /** How many there are, when it is known. */
  readonly count?: number | undefined;

  /** What wants a look, in words, when something does. */
  readonly alert?: string | undefined;

  /** The fold of what hangs under the row - the packages' pages under Packages - when it has any. */
  readonly fold?: FoldControl | undefined;
};

/** A fold a row carries for the rows hanging under it. */
type FoldControl = {
  /** Whether they are folded. */
  readonly isFolded: boolean;

  /** What the button is called. */
  readonly label: string;

  /** The id of what it folds. */
  readonly controls: string;

  /** Called when it is pressed. */
  readonly onToggle: () => void;
};

/**
 * One row: the icon, and - while the card is open - the name and how many, or what wants a look
 * in place of the count. Shut, the name is what the row is called and what shows beside the card.
 *
 * A row with rows hanging under it carries, on the open card, the button that folds them: a
 * chevron in the column of the sections' own, beside the link rather than inside it, since a
 * button in a link is a control nobody can reach.
 *
 * @param props - See {@link RowProps}.
 * @returns The row.
 */
function Row(props: RowProps) {
  const { entry, count, alert, fold } = props;
  const rail = useContext(RailContext);
  const label = text(entry.label);
  const detail = alert ?? (count === undefined ? undefined : String(count));

  const link = (
    <NavLink
      to={entry.to}
      aria-label={rail.isCollapsed ? [label, alert].filter(Boolean).join(', ') : undefined}
      className={({ isActive }) =>
        cn(
          ROW,
          isActive ? ROW_ACTIVE : ROW_IDLE,
          fold === undefined || rail.isCollapsed ? undefined : 'pr-9',
        )
      }
      data-tip={
        rail.isCollapsed
          ? [label, detail].filter((part) => part !== undefined).join(' · ')
          : undefined
      }
      {...rail.tip}
    >
      <span className="relative flex shrink-0">
        <AppIcon id={entry.icon} size={20} />
        {alert === undefined ? null : <AlertDot />}
      </span>
      <Fading className="grow truncate">{label}</Fading>
      {alert === undefined ? null : (
        <Fading className="text-caption font-normal text-warning">{alert}</Fading>
      )}
      {alert !== undefined || count === undefined ? null : (
        <Fading className="font-mono text-mono-caption font-normal text-foreground-subtle tabular">
          {count}
        </Fading>
      )}
    </NavLink>
  );

  if (fold === undefined) {
    return link;
  }

  return (
    <div className="relative flex shrink-0">
      {link}
      <span
        inert={rail.isCollapsed}
        aria-hidden={rail.isCollapsed}
        className={cn('absolute top-1/2 right-1.25 flex -translate-y-1/2', fading(rail))}
      >
        <button
          type="button"
          aria-label={fold.label}
          aria-expanded={!fold.isFolded}
          aria-controls={fold.controls}
          onClick={fold.onToggle}
          className="press flex size-7 items-center justify-center rounded-chip text-foreground-subtle hover:bg-surface-high hover:text-foreground focus-visible:-outline-offset-2"
        >
          <AppIcon
            id="chevron-down"
            size={14}
            className={cn(
              rail.isReduced ? undefined : `transition-[rotate] ${MOTION}`,
              fold.isFolded ? '-rotate-90' : undefined,
            )}
          />
        </button>
      </span>
    </div>
  );
}

/** What a section needs. */
type SectionProps = {
  /** What it is called. */
  readonly label: string;

  /** Whether it is folded on the open card. */
  readonly isFolded: boolean;

  /** What wants a look in the rows a fold hides, in words, when something does. */
  readonly alert?: string | undefined;

  /** Called when the heading is pressed. */
  readonly onToggle: () => void;

  /** The rows under it, each in a {@link Fold}. */
  readonly children: ReactNode;
};

/**
 * A heading and the rows under it.
 *
 * On the open card the heading is the button that opens the section, folding the others: its name, and a
 * chevron at the right edge, in the column of the counts, that turns from down to right as it
 * folds. Folded with something waiting inside, a dot beside the name says so.
 *
 * The heading is 32px open - room enough between folded sections, and a heading's worth of
 * target - and shut it is a 16px line parting the section from the one above, the two
 * cross-fading. The button is inert then, since a shut card folds nothing. The
 * name stays the group's label for a screen reader at both.
 *
 * @param props - See {@link SectionProps}.
 * @returns The section.
 */
function Section(props: SectionProps) {
  const { label, isFolded, alert, onToggle, children } = props;
  const rail = useContext(RailContext);
  const id = useId();
  const rows = useId();

  return (
    <div role="group" aria-labelledby={id} className="flex flex-col">
      <div
        className={cn(
          'relative flex shrink-0',
          rail.isReduced ? undefined : `transition-[height] ${MOTION}`,
          rail.isCollapsed ? 'h-4' : 'h-8',
        )}
      >
        <div className="flex w-full" inert={rail.isCollapsed} aria-hidden={rail.isCollapsed}>
          <button
            type="button"
            aria-expanded={!isFolded}
            aria-controls={rows}
            onClick={onToggle}
            className="press group/heading flex w-full overflow-hidden rounded-chip px-3 text-left whitespace-nowrap focus-visible:-outline-offset-2"
          >
            {/* The fade on a span of its own: `press` sets the button's transition timing. */}
            <span className={cn('flex grow items-center gap-2', fading(rail))}>
              <span
                id={id}
                className="font-mono text-label text-foreground-subtle uppercase transition-colors group-hover/heading:text-foreground-muted"
              >
                {label}
              </span>
              {isFolded && alert !== undefined ? (
                <>
                  <span
                    aria-hidden="true"
                    className="size-1.5 shrink-0 animate-fade-in rounded-full bg-warning"
                  />
                  <span className="sr-only">, {alert}</span>
                </>
              ) : null}
              <span className="grow" />
              <AppIcon
                id="chevron-down"
                size={14}
                className={cn(
                  'shrink-0 text-foreground-subtle group-hover/heading:text-foreground-muted',
                  rail.isReduced ? undefined : `transition-[rotate,color] ${MOTION}`,
                  isFolded ? '-rotate-90' : undefined,
                )}
              />
            </span>
          </button>
        </div>
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-x-3 top-1/2 h-px bg-border',
            lining(rail),
          )}
        />
      </div>
      <div id={rows} className="flex flex-col">
        {children}
      </div>
    </div>
  );
}

/**
 * One entry of a section - its row, and under Packages the packages' pages - and the fold that
 * hides it: a one-row grid whose row goes from nothing to its content, which is the one height
 * CSS can move to without being told a number. Its 2px of space comes inside it, so a folded
 * entry leaves none behind. Hidden, it is also `inert` and gone from a screen reader: a row
 * nobody can see must not take the focus or be read out.
 *
 * @param props - The entry.
 * @param props.isShown - Whether it shows.
 * @param props.children - Its rows.
 * @returns The fold.
 */
function Fold(props: { readonly isShown: boolean; readonly children: ReactNode }) {
  const { isShown, children } = props;
  const rail = useContext(RailContext);

  return (
    <div
      inert={!isShown}
      className={cn(
        'grid',
        rail.isReduced ? undefined : `transition-[grid-template-rows,opacity] ${MOTION}`,
        isShown ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
      )}
    >
      <div className="min-h-0 overflow-hidden" aria-hidden={!isShown}>
        <div className="flex flex-col gap-0.5 pt-0.5">{children}</div>
      </div>
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
 * Opens one section and folds the other two: one section stands open at a time. The fold of the
 * packages' pages is left as it is. Kept with the other preferences, so it holds on reload.
 *
 * @param section - The section to open.
 */
function openSection(section: SidebarSection): void {
  const { foldedSections, set } = usePreferences.getState();
  const groups = GROUPS.map((group) => group.id);
  const next = [
    ...foldedSections.filter((other) => !groups.includes(other)),
    ...groups.filter((other) => other !== section),
  ];

  if (next.length !== foldedSections.length || next.some((s) => !foldedSections.includes(s))) {
    set({ foldedSections: next });
  }
}

/**
 * The person, and the menu the chip opens: their profile, the theme and the language they read
 * the house in - each said as it stands, each a way to the setting - and signing out.
 *
 * A menu rather than a button that signs out on click: a control that looks like it opens
 * something and instead ends your session is a small betrayal. It opens beside the card at both
 * widths, level with the chip, so it never covers a row; the chip's chevron points there. Opened,
 * the focus is on its first choice; the arrow keys move along, Escape and a click elsewhere both
 * close it, because a menu that can only be dismissed by choosing something is a trap.
 *
 * @returns The chip.
 */
function UserChip() {
  const { t } = useTranslation();
  const rail = useContext(RailContext);
  const user = useSession((state) => state.user);
  const endSession = useSession((state) => state.signOut);
  const theme = usePreferences((state) => state.theme);
  const [isOpen, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const name = user?.displayName ?? t('nav.notSignedIn', 'Not signed in');
  const role = user === undefined ? '' : roleName(user.role);
  const locale = user === undefined ? undefined : (user.locale ?? user.houseLocale);

  useEffect(() => {
    if (isOpen) {
      // Without scrolling: the menu stands beside the card, and a box that clips it must not be
      // scrolled sideways to bring it in.
      list.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    }
  }, [isOpen]);

  /** Closes the menu and gives the focus back to the chip. */
  const close = (): void => {
    setOpen(false);
    button.current?.focus();
  };

  /**
   * Moves along the choices, or closes the menu.
   *
   * @param event - The key pressed inside the menu.
   */
  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }

    const choices = [...(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = choices.findIndex((choice) => choice === document.activeElement);
    const next = {
      ArrowDown: at + 1,
      ArrowUp: at - 1,
      Home: 0,
      End: choices.length - 1,
    }[event.key];

    if (next !== undefined) {
      event.preventDefault();
      choices[(next + choices.length) % choices.length]?.focus();
    }
  };

  const links: readonly {
    readonly to: string;
    readonly icon: UiIconId;
    readonly label: string;
    readonly value?: string | undefined;
  }[] = [
    { to: '/settings/account', icon: 'user-round', label: t('nav.profile', 'Profile') },
    {
      to: '/settings/interface?highlight=theme',
      icon: 'moon',
      label: t('settings.interface.theme', 'Theme'),
      value: text(THEME_LABELS[theme]),
    },
    {
      to: '/settings/account?highlight=language',
      icon: 'globe',
      label: t('settings.language.title', 'Language'),
      value: locale === undefined ? undefined : LOCALE_NAMES[locale],
    },
  ];

  return (
    // `onBlur` on the wrapper closes the menu when focus leaves the whole subtree, which is
    // what "clicked elsewhere" means for a keyboard as well as a mouse.
    <div
      className="relative shrink-0"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      {isOpen ? (
        <div
          ref={list}
          role="menu"
          aria-label={t('nav.account', 'Account')}
          tabIndex={-1}
          onKeyDown={onMenuKey}
          // Past the card's 9px and its edge, then 8px of air: level with the chip, beside the card.
          className="absolute bottom-0 left-full z-30 ml-4.5 flex w-60 animate-nudge flex-col gap-0.5 rounded-card border border-border-strong bg-surface p-1.5 shadow-float"
        >
          {links.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              role="menuitem"
              onClick={() => {
                setOpen(false);
              }}
              className={cn(
                MENU_ROW,
                'text-foreground-muted hover:bg-surface-raised/60 hover:text-foreground focus-visible:bg-surface-raised/60 focus-visible:text-foreground',
              )}
            >
              <AppIcon id={link.icon} size={18} className="shrink-0" />
              <span className="grow">{link.label}</span>
              {link.value === undefined ? null : (
                <>
                  <span className="text-ui-sm text-foreground-subtle">{link.value}</span>
                  <AppIcon id="chevron-right" size={14} className="text-foreground-subtle" />
                </>
              )}
            </Link>
          ))}

          <div role="separator" className="mx-2 my-1 h-px shrink-0 bg-border" />

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void endSession();
            }}
            className={cn(
              MENU_ROW,
              'text-danger hover:bg-danger-soft focus-visible:bg-danger-soft',
            )}
          >
            <AppIcon id="log-out" size={18} className="shrink-0" />
            {t('nav.signOut', 'Sign out')}
          </button>
        </div>
      ) : null}

      <button
        ref={button}
        type="button"
        aria-label={
          rail.isCollapsed ? t('nav.accountMenu', 'Account menu: {{name}}', { name }) : undefined
        }
        aria-haspopup="menu"
        aria-expanded={isOpen}
        data-tip={rail.isCollapsed && !isOpen && role !== '' ? `${name} · ${role}` : undefined}
        {...rail.tip}
        onKeyDown={(event) => {
          rail.tip.onKeyDown(event);

          if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
        onClick={() => {
          rail.hideTip();
          setOpen(!isOpen);
        }}
        className={cn(
          'press flex h-11 w-full items-center gap-2.5 overflow-hidden rounded-tile border px-1.25 text-left whitespace-nowrap transition-colors focus-visible:-outline-offset-2',
          isOpen
            ? 'border-border-strong bg-surface-raised'
            : 'border-transparent hover:bg-surface-raised/60',
        )}
      >
        <Avatar displayName={user?.displayName ?? ''} avatarUrl={user?.avatarUrl} isAccented />
        <Fading className="flex min-w-0 grow items-baseline gap-1 text-ui">
          <span className="truncate font-medium text-foreground">{name}</span>
          {role === '' ? null : (
            <>
              <span aria-hidden="true" className="text-foreground-subtle">
                ·
              </span>
              <span className="shrink-0 text-foreground-subtle">{role}</span>
            </>
          )}
        </Fading>
        <Fading className="flex shrink-0 pr-1.5">
          <AppIcon id="chevron-right" size={14} className="text-foreground-subtle" />
        </Fading>
      </button>
    </div>
  );
}

/** A running package with a page that asks for an entry in the sidebar. */
type PackagePage = ApiPackage & { ui: NonNullable<ApiPackage['ui']> };

/**
 * Reads the packages whose pages hang under Packages: each running package with a page that asks
 * for an entry (`ui.sidebar`).
 *
 * @returns The packages, in the order they are listed.
 */
function usePackagePages(): readonly PackagePage[] {
  const { packages } = useInstalledPackages();

  return packages.filter(
    (found): found is PackagePage =>
      found.state === 'running' && found.ui?.page === true && found.ui.sidebar !== undefined,
  );
}

/** What the packages' pages need. */
type PackagePagesProps = {
  /** The packages, from {@link usePackagePages}. */
  readonly pages: readonly PackagePage[];

  /** Whether they are folded on the open card. */
  readonly isFolded: boolean;

  /** The page you are on: its own entry stays when the rest are folded. */
  readonly pathname: string;

  /** The id the fold button points at. */
  readonly id: string;
};

/**
 * The entries of the packages' own pages, under Packages, by the label and icon each asks for -
 * its name and logo when it says neither.
 *
 * Open, they hang from a line dropped from the middle of the Packages icon, indented past it, so
 * they read as Packages' own; shut, the line goes and their icons slide back into the column of
 * the others. Folded, only the one you are on stays.
 *
 * @param props - See {@link PackagePagesProps}.
 * @returns The entries; nothing when no package asks.
 */
function PackagePages(props: PackagePagesProps) {
  const { pages, isFolded, pathname, id } = props;
  const rail = useContext(RailContext);
  const icons = useCatalogueIcons(pages.map((found) => found.ui.sidebar?.icon ?? null));
  const motion = rail.isReduced ? undefined : MOTION;

  if (pages.length === 0) {
    return null;
  }

  return (
    // Up by the gap above it, so the line starts where the Packages row ends.
    <div
      id={id}
      className={cn(
        '-mt-0.5 flex flex-col border-l',
        motion === undefined ? undefined : `transition-[margin,padding,border-color] ${motion}`,
        rail.isCollapsed ? 'ml-0 border-transparent pl-0' : 'ml-5.5 border-border pl-2',
      )}
    >
      {pages.map((found) => {
        const iconId = found.ui.sidebar?.icon;
        const icon = iconId === undefined ? undefined : icons.get(iconId);
        const label = found.ui.sidebar?.label ?? found.name;
        const to = packageAppPath(found.id);

        return (
          <Fold key={found.id} isShown={rail.isCollapsed || !isFolded || isUnder(pathname, to)}>
            <NavLink
              to={to}
              aria-label={rail.isCollapsed ? label : undefined}
              className={({ isActive }) =>
                cn(
                  SUB_ROW,
                  motion === undefined
                    ? 'transition-colors'
                    : `transition-[padding,background-color,border-color,color] ${motion}`,
                  // Shut, its 16px icon sits where the rows' 20px ones do.
                  rail.isCollapsed ? 'px-3' : 'px-2.5',
                  isActive ? ROW_ACTIVE : ROW_IDLE,
                )
              }
              data-tip={rail.isCollapsed ? label : undefined}
              {...rail.tip}
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
          </Fold>
        );
      })}
    </div>
  );
}

/** A name showing beside the shut card, and where: the middle of its row, from the card's top. */
type Tip = {
  readonly words: string;
  readonly top: number;
};

/** Which edges the entries run on past, when the window is too short for them all. */
type Edges = 'none' | 'top' | 'bottom' | 'both';

/** The fade each edge the entries run on past takes: the last 24px going to nothing. */
const FADES: Readonly<Record<Edges, string>> = {
  none: '',
  top: '[mask-image:linear-gradient(to_bottom,transparent,black_1.5rem)]',
  bottom: '[mask-image:linear-gradient(to_bottom,black_calc(100%_-_1.5rem),transparent)]',
  both: '[mask-image:linear-gradient(to_bottom,transparent,black_1.5rem,black_calc(100%_-_1.5rem),transparent)]',
};

/**
 * Reads which edges a scrolling list runs on past.
 *
 * @param list - The list.
 * @returns The edges.
 */
function edgesOf(list: HTMLElement): Edges {
  const isAbove = list.scrollTop > 0;
  const isBelow = list.scrollTop + list.clientHeight < list.scrollHeight - 1;

  if (isAbove && isBelow) {
    return 'both';
  }

  if (isAbove) {
    return 'top';
  }

  return isBelow ? 'bottom' : 'none';
}

/**
 * The sidebar.
 *
 * One element at both widths, so that the change between them can be watched rather than cut.
 * Four parts top to bottom: the name; the entries, the only part that scrolls; the settings and
 * the person; and, under a line, the button that opens or shuts the card.
 *
 * The names beside the shut card hang off the frame around the card rather than off their rows:
 * the part that scrolls would clip anything drawn outside it.
 *
 * @returns The sidebar.
 */
export function Sidebar() {
  const { t } = useTranslation();
  const can = useSession((state) => state.can);
  const width = usePreferences((state) => state.sidebar);
  const setPreferences = usePreferences((state) => state.set);
  const foldedSections = usePreferences((state) => state.foldedSections);
  const { pathname } = useLocation();
  const packagePages = usePackagePages();
  const packagePagesId = useId();
  const counts = useRailCounts();
  const alerts = useRailAlerts();
  const isReduced = useReducedMotion();
  const isNarrow = useMediaQuery(NARROW_QUERY);

  // Opened by hand on a narrow window: held for this visit, never saved, because the saved
  // choice is the one for a window with room for it.
  const [isOpenedNarrow, setOpenedNarrow] = useState(false);
  const isCollapsed = isNarrow ? !isOpenedNarrow : width === 'collapsed';

  const frame = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const isTipShown = useRef(false);
  const hiddenAt = useRef(Number.NEGATIVE_INFINITY);
  const [tip, setTip] = useState<Tip | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<Edges>('none');

  useEffect(
    () => (): void => {
      globalThis.clearTimeout(timer.current);
    },
    [],
  );

  // The list's own height changes with the window, its content's with the counts and the
  // packages' pages: either can make it run on past an edge, or stop.
  useEffect(() => {
    const box = list.current;
    const inner = content.current;

    if (box === null || inner === null || typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver(() => {
      setEdges(edgesOf(box));
    });

    observer.observe(box);
    observer.observe(inner);

    return (): void => {
      observer.disconnect();
    };
  }, []);

  const rail = useMemo((): RailState => {
    /** Takes the name away. */
    const hideTip = (): void => {
      globalThis.clearTimeout(timer.current);

      if (isTipShown.current) {
        isTipShown.current = false;
        hiddenAt.current = performance.now();
      }

      setTip(null);
    };

    /**
     * Shows a control's name beside it, when it has one to show: at once for the keyboard or
     * right after another, after a short rest for a pointer passing by.
     *
     * @param target - The control.
     * @param isNow - Whether to skip the rest.
     */
    const showTip = (target: HTMLElement, isNow: boolean): void => {
      globalThis.clearTimeout(timer.current);

      const words = target.dataset['tip'];

      if (words === undefined) {
        return;
      }

      /** Measures the control against the frame and shows the name there. */
      const place = (): void => {
        const box = frame.current?.getBoundingClientRect();
        const row = target.getBoundingClientRect();

        if (box !== undefined) {
          isTipShown.current = true;
          setTip({ words, top: row.top - box.top + row.height / 2 });
        }
      };

      if (isNow || performance.now() - hiddenAt.current < TIP_GRACE_MS) {
        place();
      } else {
        timer.current = globalThis.setTimeout(place, TIP_DELAY_MS);
      }
    };

    return {
      isCollapsed,
      isReduced,
      hideTip,
      tip: {
        onMouseLeave: hideTip,
        onBlur: hideTip,

        /**
         * Shows the name after a short rest.
         *
         * @param event - The pointer arriving.
         * @param event.currentTarget - The control.
         */
        onMouseEnter: (event: { readonly currentTarget: HTMLElement }): void => {
          showTip(event.currentTarget, false);
        },

        /**
         * Shows the name at once.
         *
         * @param event - The focus arriving.
         */
        onFocus: (event: FocusEvent<HTMLElement>): void => {
          showTip(event.currentTarget, true);
        },

        /**
         * Lets Escape take the name away, as from any tooltip.
         *
         * @param event - The key pressed on the control.
         */
        onKeyDown: (event: KeyboardEvent<HTMLElement>): void => {
          if (event.key === 'Escape') {
            hideTip();
          }
        },
      },
    };
  }, [isCollapsed, isReduced]);

  const groups = GROUPS.filter((group) => group.permission === undefined || can(group.permission))
    .map((group) => ({
      ...group,
      entries: group.entries.filter(
        (entry) => entry.permission === undefined || can(entry.permission),
      ),
    }))
    .filter((group) => group.entries.length > 0);

  // One section open: the first not folded among those drawn, and the page's own whenever the
  // page changes, so moving to a page in another section swaps them.
  const openId = (groups.find((group) => !foldedSections.includes(group.id)) ?? groups[0])?.id;
  const pageGroup = groups.find((group) =>
    group.entries.some((entry) => isUnder(pathname, entry.to)),
  )?.id;

  useEffect(() => {
    if (pageGroup !== undefined) {
      openSection(pageGroup);
    }
  }, [pathname, pageGroup]);

  /**
   * The words of what an entry has waiting.
   *
   * @param entry - The entry.
   * @returns "1 update", or undefined when nothing waits.
   */
  const alertOf = (entry: Entry): string | undefined => {
    const count = entry.alert === undefined ? 0 : alerts[entry.alert];

    return count === 0
      ? undefined
      : t('nav.updates', {
          count,
          defaultValue_one: '{{count}} update',
          defaultValue_other: '{{count}} updates',
        });
  };

  /**
   * Folds what can be folded, or unfolds it: the choice is kept with the others.
   *
   * @param section - What was pressed.
   */
  const toggleFold = (section: SidebarSection): void => {
    // Read now rather than from this render: two folds in one go must both hold.
    const folded = usePreferences.getState().foldedSections;

    setPreferences({
      foldedSections: folded.includes(section)
        ? folded.filter((other) => other !== section)
        : [...folded, section],
    });
  };

  /** Opens or shuts the card: the saved choice on a wide window, this visit's on a narrow one. */
  const toggle = (): void => {
    rail.hideTip();

    if (isNarrow) {
      setOpenedNarrow(!isOpenedNarrow);
    } else {
      setPreferences({ sidebar: isCollapsed ? 'expanded' : 'collapsed' });
    }
  };

  return (
    <RailContext.Provider value={rail}>
      <div ref={frame} className="relative z-20 flex shrink-0 py-4 pl-4">
        <nav
          aria-label={t('nav.main', 'Main')}
          className={cn(
            'flex flex-col gap-0.5 rounded-dialog border border-border-strong bg-surface px-2.25 py-2.5 shadow-rail',
            isReduced ? undefined : `transition-[width] ${MOTION}`,
            isCollapsed ? 'w-16' : 'w-70',
          )}
        >
          <div className="flex h-11 shrink-0 items-center gap-3.25 overflow-hidden px-2.25 whitespace-nowrap">
            <Logo size={26} />
            {/* The product's name, the same in every language. */}
            <Fading className="text-subhead font-semibold tracking-tight">
              <span translate="no">Nebula Home</span>
            </Fading>
          </div>

          <SearchRow />

          {/* On a short window the entries scroll, and draw no scrollbar: its width would come
              out of the rows and push every icon off the card's middle. The edge the list runs on
              past fades out instead, which says there is more without taking any room. */}
          <div
            ref={list}
            onScroll={(event) => {
              rail.hideTip();
              setEdges(edgesOf(event.currentTarget));
            }}
            className={cn(
              'flex min-h-0 grow scrollbar-none flex-col overflow-x-hidden overflow-y-auto',
              FADES[edges],
            )}
          >
            <div ref={content} className="flex shrink-0 flex-col gap-0.5">
              <Row entry={DASHBOARDS} />
              {can('calendar:read') ? <Row entry={CALENDAR} /> : null}

              {groups.map((group) => {
                const isFolded = group.id !== openId;

                /**
                 * Whether an entry shows: always on the shut card, and on the open one unless its
                 * section is folded and you are elsewhere.
                 *
                 * @param entry - The entry.
                 * @returns True when it shows.
                 */
                const isShown = (entry: Entry): boolean =>
                  isCollapsed || !isFolded || isUnder(pathname, entry.to);
                const hidden = group.entries
                  .filter((entry) => !isShown(entry))
                  .map(alertOf)
                  .filter((alert) => alert !== undefined);

                return (
                  <Section
                    key={group.id}
                    label={text(group.label)}
                    isFolded={isFolded}
                    alert={hidden.length === 0 ? undefined : hidden.join(', ')}
                    onToggle={() => {
                      openSection(group.id);
                    }}
                  >
                    {group.entries.map((entry) => (
                      <Fold key={entry.to} isShown={isShown(entry)}>
                        <Row
                          entry={entry}
                          count={entry.count === undefined ? undefined : counts[entry.count]}
                          alert={alertOf(entry)}
                          fold={
                            entry.to === '/packages' && packagePages.length > 0
                              ? {
                                  isFolded: foldedSections.includes('packages'),
                                  label: t('nav.packagePages', 'Package pages'),
                                  controls: packagePagesId,

                                  /** Folds the packages' pages, or unfolds them. */
                                  onToggle: () => {
                                    toggleFold('packages');
                                  },
                                }
                              : undefined
                          }
                        />
                        {entry.to === '/packages' ? (
                          <PackagePages
                            pages={packagePages}
                            isFolded={foldedSections.includes('packages')}
                            pathname={pathname}
                            id={packagePagesId}
                          />
                        ) : null}
                      </Fold>
                    ))}
                  </Section>
                );
              })}
            </div>
          </div>

          {/*
           * Settings above the person, not below. The sidebar is ordered by scope and a person is
           * the narrowest thing in it; it is also the row that opens a menu rather than
           * navigating. The button that opens or shuts the card is the last row at both widths:
           * it never moves.
           */}
          <Row entry={SETTINGS} />
          <UserChip />
          <div aria-hidden="true" className="mx-2 my-1.5 h-px shrink-0 bg-border" />
          <button
            type="button"
            aria-label={
              isCollapsed
                ? t('nav.expand', 'Expand sidebar')
                : t('nav.collapseSidebar', 'Collapse sidebar')
            }
            aria-expanded={!isCollapsed}
            data-tip={isCollapsed ? t('nav.expand', 'Expand sidebar') : undefined}
            {...rail.tip}
            onClick={toggle}
            className={cn(ROW, ROW_IDLE)}
          >
            <AppIcon id="panel-left" size={20} />
            <Fading className="truncate">{t('nav.collapse', 'Collapse')}</Fading>
          </button>
        </nav>

        {tip === null || !isCollapsed ? null : (
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute left-full z-30 ml-2 flex h-7.5 -translate-y-1/2 animate-nudge items-center rounded-chip border border-border-strong bg-surface-raised px-2.5 text-ui-sm whitespace-nowrap text-foreground shadow-float',
              isReduced ? undefined : 'transition-[top] duration-150 ease-out',
            )}
            /* eslint-disable-next-line react/forbid-dom-props -- where the row is, measured at run
               time. */
            style={{ top: tip.top }}
          >
            {tip.words}
          </span>
        )}
      </div>
    </RailContext.Provider>
  );
}
