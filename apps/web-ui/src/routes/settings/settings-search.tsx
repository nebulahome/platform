/**
 * The settings search (boards N-Settings-Search, N-Settings-Search-Result).
 *
 * A field at the top of the settings column (`/` focuses it) whose results open in a popover under
 * it, in three groups: **Pages** (from the tree), **Settings** (the rows worth finding, listed
 * below by page and section) and **Permissions** (the catalogue, found on the roles page). Each
 * result has an icon chip, its title with the match marked, where it lives, and one line. The
 * first is active; the arrows move, Enter opens. Opening a setting goes to its page with
 * `?highlight=<id>`, where its row scrolls into view and lights up (`SettingsRow`); the field
 * keeps the query.
 *
 * What is searched: names, descriptions and permission keys - no API, the index is here. Only
 * what the person may open is offered.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { AppIcon, cn, Popover, type UiIconId } from '@nebulahome/ui';

import { defineMessage, text, type Message } from '@/i18n/messages';
import { PERMISSION_GROUPS, permissionLabel } from '@/lib/permission-labels';
import type { SettingsGroup } from '@/routes/settings/settings-tree';
import { settingDescription } from '@/settings/setting-descriptions';

/** The longest list the popover shows. */
const MOST = 12;

/** The popover's width, wider than the field it hangs off. */
const WIDTH = 460;

/** One setting worth finding: a row with a `searchId` on its page. */
type SettingEntry = {
  /** The row's `searchId`. */
  readonly id: string;

  /** The page it is on. */
  readonly path: string;

  /** The section of the page. */
  readonly section: Message;

  /** What the row is called. */
  readonly title: Message;

  /** Its line, or the catalogue's description of the setting it holds. */
  readonly note: Message | 'catalogue';

  /** Its glyph in the results. */
  readonly icon: UiIconId;
};

/** Sections that more than one entry sits in. */
const SECTIONS = {
  security: defineMessage('settings.account.security', 'Security'),
  language: defineMessage('settings.language.title', 'Language'),
  appearance: defineMessage('settings.interface.appearance', 'Appearance'),
  startup: defineMessage('settings.interface.startup', 'Startup'),
  history: defineMessage('settings.data.historyAndLogs', 'History and logs'),
  installation: defineMessage('settings.data.installation', 'This installation'),
  schedule: defineMessage('backup.schedule', 'Schedule'),
  key: defineMessage('backup.key.section', 'Encryption key'),
  endpoint: defineMessage('settings.webhooks.endpoint', 'Endpoint'),
  automaticUpdates: defineMessage('settingsMaintenance.automatic', 'Automatic updates'),
  howUpdatesRun: defineMessage('settingsMaintenance.howTheyRun', 'How updates run'),
  power: defineMessage('settingsMaintenance.power', 'Restart and power'),
};

/** Every setting the search finds. */
const SETTINGS_INDEX: readonly SettingEntry[] = [
  {
    id: 'password',
    path: '/settings/account',
    section: SECTIONS.security,
    title: defineMessage('settings.password.title', 'Password'),
    note: defineMessage(
      'settings.password.note',
      'At least twelve characters, and no other rules.',
    ),
    icon: 'key',
  },
  {
    id: 'two-factor',
    path: '/settings/account',
    section: SECTIONS.security,
    title: defineMessage('settings.twoFactor.title', 'Authenticator app'),
    note: defineMessage('settings.search.notes.twoFactor', 'A code after the password.'),
    icon: 'shield-check',
  },
  {
    id: 'language',
    path: '/settings/account',
    section: SECTIONS.language,
    title: defineMessage('settings.language.title', 'Language'),
    note: defineMessage(
      'settings.language.note',
      'What the interface speaks to you. Names and anything typed stay as they were written.',
    ),
    icon: 'globe',
  },
  {
    id: 'theme',
    path: '/settings/interface',
    section: SECTIONS.appearance,
    title: defineMessage('settings.interface.theme', 'Theme'),
    note: defineMessage(
      'settings.interface.themeNote',
      'Follows the operating system unless you pick one.',
    ),
    icon: 'moon',
  },
  {
    id: 'motion',
    path: '/settings/interface',
    section: SECTIONS.appearance,
    title: defineMessage('settings.interface.motion', 'Motion'),
    note: defineMessage('settings.search.notes.motion', 'Reduced stops background motion.'),
    icon: 'sparkles',
  },
  {
    id: 'sidebar',
    path: '/settings/interface',
    section: SECTIONS.appearance,
    title: defineMessage('settings.interface.sidebar', 'Sidebar'),
    note: defineMessage('settings.search.notes.sidebar', 'How it opens on this device.'),
    icon: 'columns-2',
  },
  {
    id: 'open-on',
    path: '/settings/interface',
    section: SECTIONS.startup,
    title: defineMessage('settings.interface.openOn', 'Open on'),
    note: defineMessage(
      'settings.interface.openOnNote',
      'Which page you land on when you sign in.',
    ),
    icon: 'app-window',
  },
  {
    id: 'history.state_history.retention_days',
    path: '/settings/data/retention',
    section: SECTIONS.history,
    title: defineMessage('settings.data.rows.stateChanges', 'Entity state changes'),
    note: 'catalogue',
    icon: 'database',
  },
  {
    id: 'history.automation_runs.retention_days',
    path: '/settings/data/retention',
    section: SECTIONS.history,
    title: defineMessage('settings.data.rows.automationTraces', 'Automation traces'),
    note: 'catalogue',
    icon: 'database',
  },
  {
    id: 'history.logs.retention_days',
    path: '/settings/data/retention',
    section: SECTIONS.history,
    title: defineMessage('settings.data.rows.logs', 'Logs'),
    note: 'catalogue',
    icon: 'database',
  },
  {
    id: 'system.audit_log.retention_days',
    path: '/settings/data/retention',
    section: SECTIONS.history,
    title: defineMessage('settings.data.rows.audit', 'Audit trail'),
    note: 'catalogue',
    icon: 'database',
  },
  {
    id: 'history.logs.min_level',
    path: '/settings/data/retention',
    section: SECTIONS.history,
    title: defineMessage('settings.data.logLevel', 'Log level'),
    note: 'catalogue',
    icon: 'list-filter',
  },
  {
    id: 'units.temperature',
    path: '/settings/data/retention',
    section: SECTIONS.installation,
    title: defineMessage('settings.data.temperature', 'Temperature'),
    note: 'catalogue',
    icon: 'thermometer',
  },
  {
    id: 'ui.default_theme',
    path: '/settings/data/retention',
    section: SECTIONS.installation,
    title: defineMessage('settings.data.defaultTheme', 'Default theme'),
    note: 'catalogue',
    icon: 'moon',
  },
  {
    id: 'house.timezone',
    path: '/settings/data/retention',
    section: SECTIONS.installation,
    title: defineMessage('firstRun.home.timeZone', 'Time zone'),
    note: 'catalogue',
    icon: 'clock',
  },
  {
    id: 'house.locale',
    path: '/settings/data/retention',
    section: SECTIONS.installation,
    title: defineMessage('settings.data.houseLanguage', 'House language'),
    note: 'catalogue',
    icon: 'globe',
  },
  {
    id: 'security.session_lifetime_hours',
    path: '/settings/data/retention',
    section: SECTIONS.installation,
    title: defineMessage('settings.data.sessionLifetime', 'Session lifetime'),
    note: 'catalogue',
    icon: 'timer',
  },
  {
    id: 'backup.automatic',
    path: '/settings/system/backup',
    section: SECTIONS.schedule,
    title: defineMessage('backup.automatic', 'Automatic backups'),
    note: defineMessage('settings.search.notes.automaticBackups', 'Runs on the schedule below.'),
    icon: 'toggle-left',
  },
  {
    id: 'backup.frequency',
    path: '/settings/system/backup',
    section: SECTIONS.schedule,
    title: defineMessage('backup.frequency', 'How often'),
    note: defineMessage('settings.search.notes.frequency', 'Daily, weekly, or the days chosen.'),
    icon: 'calendar',
  },
  {
    id: 'backup.when',
    path: '/settings/system/backup',
    section: SECTIONS.schedule,
    title: defineMessage('backup.when', 'When'),
    note: defineMessage('settings.search.notes.when', 'At a time, or when the house is quietest.'),
    icon: 'clock',
  },
  {
    id: 'updates.auto.packages',
    path: '/settings/system/maintenance',
    section: SECTIONS.automaticUpdates,
    title: defineMessage('settingsMaintenance.packages', 'Packages'),
    note: 'catalogue',
    icon: 'package',
  },
  {
    id: 'updates.auto.integrations',
    path: '/settings/system/maintenance',
    section: SECTIONS.automaticUpdates,
    title: defineMessage('settingsMaintenance.integrations', 'Integrations'),
    note: 'catalogue',
    icon: 'plug',
  },
  {
    id: 'updates.window',
    path: '/settings/system/maintenance',
    section: SECTIONS.howUpdatesRun,
    title: defineMessage('settingsMaintenance.when', 'When'),
    note: 'catalogue',
    icon: 'clock',
  },
  {
    id: 'updates.backup_first',
    path: '/settings/system/maintenance',
    section: SECTIONS.howUpdatesRun,
    title: defineMessage('settingsMaintenance.backupFirst', 'Back up first'),
    note: defineMessage('settings.search.notes.backupFirst', 'A backup before each update.'),
    icon: 'hard-drive',
  },
  {
    id: 'updates.channel.core',
    path: '/settings/system/maintenance',
    section: SECTIONS.howUpdatesRun,
    title: defineMessage('settingsMaintenance.channelCore', 'Nebula Home channel'),
    note: 'catalogue',
    icon: 'git-branch',
  },
  {
    id: 'system.restart',
    path: '/settings/system/maintenance',
    section: SECTIONS.power,
    title: defineMessage('settingsMaintenance.restartTitle', 'Restart Nebula Home'),
    note: defineMessage('settingsMaintenance.restartNote', 'About 30 s without services.'),
    icon: 'rotate-ccw',
  },
  {
    id: 'system.shutdown',
    path: '/settings/system/maintenance',
    section: SECTIONS.power,
    title: defineMessage('settingsMaintenance.shutdownTitle', 'Shut down'),
    note: defineMessage('settingsMaintenance.shutdownNote', 'Until the container starts again.'),
    icon: 'power',
  },
  {
    id: 'backup.key',
    path: '/settings/system/backup',
    section: SECTIONS.key,
    title: defineMessage('backup.key.title', 'Backup key'),
    note: defineMessage('settings.search.notes.backupKey', 'Needed on another machine.'),
    icon: 'key',
  },
  {
    id: 'webhooks.base',
    path: '/settings/network/webhooks',
    section: SECTIONS.endpoint,
    title: defineMessage('settings.webhooks.baseAddress', 'Base address'),
    note: defineMessage('settings.webhooks.baseAddressNote', 'Every webhook is a path under it.'),
    icon: 'webhook',
  },
  {
    id: 'webhooks.allow_internet',
    path: '/settings/network/webhooks',
    section: SECTIONS.endpoint,
    title: defineMessage('settings.webhooks.fromTheInternet', 'From the internet'),
    note: defineMessage(
      'settings.webhooks.fromTheInternetNote',
      'Through remote access. Off: webhooks marked Internet answer 404 from outside.',
    ),
    icon: 'globe',
  },
  {
    id: 'webhooks.rate_per_minute',
    path: '/settings/network/webhooks',
    section: SECTIONS.endpoint,
    title: defineMessage('settings.webhooks.limit', 'Limit'),
    note: defineMessage('settings.webhooks.limitNote', 'Calls above it get 429 and start nothing.'),
    icon: 'gauge',
  },
];

/** Where the permissions are found. */
const ROLES_PATH = '/settings/people/roles';

/** One result, whatever kind. */
type Result = {
  readonly key: string;
  readonly kind: 'pages' | 'settings' | 'permissions';
  readonly title: string;
  readonly trail: readonly string[];
  readonly line: string;
  readonly isMono: boolean;
  readonly icon: UiIconId;
  readonly to: string;
};

/**
 * Folds a string for matching: lower case, accents gone.
 *
 * @param value - What to fold.
 * @returns The folded string.
 */
function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();
}

/**
 * Marks where the query sits in a title.
 *
 * Folding never changes a string's length for the letters a title is written in, so the place
 * found in the folded copy is the place in the original.
 *
 * @param title - The title.
 * @param query - What was typed, folded.
 * @returns The title, with the match marked.
 */
function marked(title: string, query: string): ReactNode {
  const at = fold(title).indexOf(query);

  if (at < 0 || fold(title).length !== title.length) {
    return title;
  }

  return (
    <>
      {title.slice(0, at)}
      <mark className="rounded-check bg-primary/25 text-foreground">
        {title.slice(at, at + query.length)}
      </mark>
      {title.slice(at + query.length)}
    </>
  );
}

/** What the search needs. */
export type SettingsSearchProps = {
  /** The tree as far as the person may open it. */
  readonly tree: readonly SettingsGroup[];
};

/**
 * Renders the settings search.
 *
 * @param props - See {@link SettingsSearchProps}.
 * @returns The field and its results.
 */
export function SettingsSearch(props: SettingsSearchProps) {
  const { t } = useTranslation();
  const { tree } = props;
  const navigate = useNavigate();
  const field = useRef<HTMLLabelElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [isOpen, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [visits, setVisits] = useState(0);
  const folded = fold(query.trim());

  useEffect(() => {
    /**
     * Focuses the field on `/`, unless somebody is typing somewhere already.
     *
     * @param event - The key press.
     */
    const onSlash = (event: globalThis.KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target !== null &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

      if (event.key === '/' && !isTyping && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        input.current?.focus();
      }
    };

    globalThis.document.addEventListener('keydown', onSlash);

    return () => {
      globalThis.document.removeEventListener('keydown', onSlash);
    };
  }, []);

  const pages = tree.flatMap((group) => group.pages.map((page) => ({ group, page })));
  const where = new Map(pages.map(({ group, page }) => [page.path, { group, page }]));

  /**
   * Whether an entry matches what was typed.
   *
   * @param words - Its title, line and anything else it is found by.
   * @returns True on a match.
   */
  const matches = (...words: string[]): boolean =>
    folded !== '' && words.some((word) => fold(word).includes(folded));

  const results: Result[] = [
    ...pages
      .filter(({ page }) => matches(text(page.label), text(page.description)))
      .map(({ group, page }): Result => ({
        key: `page:${page.path}`,
        kind: 'pages',
        title: text(page.label),
        trail: group.isLeaf ? [] : [text(group.label), text(page.label)],
        line: text(page.description),
        isMono: false,
        icon: page.icon,
        to: page.path,
      })),
    ...SETTINGS_INDEX.flatMap((entry): Result[] => {
      const home = where.get(entry.path);
      const line =
        entry.note === 'catalogue' ? settingDescription(entry.id, undefined) : text(entry.note);

      return home === undefined || !matches(text(entry.title), line)
        ? []
        : [
            {
              key: `setting:${entry.id}`,
              kind: 'settings',
              title: text(entry.title),
              trail: [text(home.page.label), text(entry.section)],
              line,
              isMono: false,
              icon: entry.icon,
              to: `${entry.path}?highlight=${encodeURIComponent(entry.id)}`,
            },
          ];
    }),
    ...(where.has(ROLES_PATH)
      ? PERMISSION_GROUPS.flatMap((group) =>
          group.keys
            .filter((key) => matches(permissionLabel(key), key))
            .map((key): Result => ({
              key: `permission:${key}`,
              kind: 'permissions',
              title: permissionLabel(key),
              trail: [text(where.get(ROLES_PATH)?.page.label ?? group.label), text(group.label)],
              line: key,
              isMono: true,
              icon: 'shield',
              to: ROLES_PATH,
            })),
        )
      : []),
  ].slice(0, MOST);

  const shown = isOpen && folded !== '';
  const current = Math.min(active, Math.max(0, results.length - 1));
  const groups = [
    { kind: 'pages', label: t('settings.search.pages', 'Pages') },
    { kind: 'settings', label: t('settings.search.settings', 'Settings') },
    { kind: 'permissions', label: t('settings.search.permissions', 'Permissions') },
  ] as const;

  /**
   * Opens a result.
   *
   * @param result - Which.
   */
  const open = (result: Result): void => {
    setOpen(false);
    (globalThis.document.activeElement as HTMLElement | null)?.blur();
    setVisits(visits + 1);
    // Each visit carries its own moment, so finding the same row twice lights it twice.
    void navigate(result.kind === 'settings' ? `${result.to}&at=${String(visits + 1)}` : result.to);
  };

  /**
   * Moves through the results, opens one, or closes.
   *
   * @param event - The key press, in the field.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setActive(
        (current + (event.key === 'ArrowDown' ? 1 : -1) + results.length) %
          Math.max(1, results.length),
      );
    } else if (event.key === 'Enter') {
      const result = results[current];

      if (result !== undefined) {
        event.preventDefault();
        open(result);
      }
    } else if (event.key === 'Escape' && shown) {
      event.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <>
      <label
        ref={field}
        className={cn(
          'flex h-control-field w-full items-center gap-2.5 rounded-field border bg-surface px-3 text-foreground-subtle transition-[border-color,box-shadow] duration-150',
          'focus-within:border-primary focus-within:shadow-focus',
          isOpen && folded !== ''
            ? 'border-primary'
            : 'border-border-strong hover:border-foreground-subtle/50',
        )}
      >
        <AppIcon id="search" size={16} />
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-expanded={shown}
          aria-controls="settings-search-results"
          aria-autocomplete="list"
          aria-label={t('settings.search.label', 'Search settings')}
          placeholder={t('settings.search.label', 'Search settings')}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          className="min-w-0 grow bg-transparent text-ui text-foreground placeholder:text-foreground-subtle focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {query === '' ? (
          <kbd className="rounded-check border border-border-strong px-1.5 font-mono text-label text-foreground-subtle">
            /
          </kbd>
        ) : (
          <button
            type="button"
            aria-label={t('settings.search.clear', 'Clear the search')}
            onClick={() => {
              setQuery('');
              input.current?.focus();
            }}
            className="flex size-4.5 items-center justify-center rounded-full bg-surface-high text-foreground-muted transition-colors hover:text-foreground"
          >
            <AppIcon id="x" size={11} />
          </button>
        )}
      </label>

      <Popover
        anchor={field}
        isOpen={shown}
        onClose={() => {
          setOpen(false);
        }}
        label={t('settings.search.results', 'Search results')}
        width={WIDTH}
      >
        <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-border px-3.5 text-caption text-foreground-subtle">
          <span className="font-mono">
            {t('settings.search.count', {
              count: results.length,
              defaultValue_one: '{{count}} result',
              defaultValue_other: '{{count}} results',
            })}
          </span>
          <span>{t('settings.search.keys', '↑ ↓ to move · Enter to open')}</span>
        </div>

        <div
          id="settings-search-results"
          role="listbox"
          className="flex flex-col overflow-y-auto p-1.5"
        >
          {results.length === 0 ? (
            <p className="px-2.5 py-4 text-ui text-foreground-muted">
              {t('settings.search.nothing', 'Nothing matches “{{query}}”.', {
                query: query.trim(),
              })}
            </p>
          ) : (
            groups.map((group) => {
              const inGroup = results.filter((result) => result.kind === group.kind);

              return inGroup.length === 0 ? null : (
                <div key={group.kind} className="flex flex-col">
                  <span className="px-2.5 pt-2 pb-1.5 font-mono text-label text-foreground-subtle uppercase">
                    {group.label}
                  </span>
                  {inGroup.map((result) => {
                    // The results are already in the order the groups read, so the arrows walk them as seen.
                    const at = results.indexOf(result);
                    const isActive = at === current;

                    return (
                      <button
                        key={result.key}
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        onPointerDown={(event) => {
                          // Keeps the focus in the field, so the popover is not shut before the click.
                          event.preventDefault();
                        }}
                        onPointerEnter={() => {
                          setActive(at);
                        }}
                        onClick={() => {
                          open(result);
                        }}
                        className={cn(
                          'flex items-start gap-3 rounded-tile px-2.5 py-2 text-left transition-colors duration-100',
                          isActive ? 'bg-surface-high' : 'hover:bg-surface-high/60',
                        )}
                      >
                        <span
                          className={cn(
                            'mt-0.5 flex size-7.5 shrink-0 items-center justify-center rounded-field transition-colors',
                            isActive
                              ? 'bg-primary/14 text-primary'
                              : 'bg-surface-high text-foreground-subtle',
                          )}
                        >
                          <AppIcon id={result.icon} size={15} />
                        </span>
                        <span className="flex min-w-0 grow flex-col gap-0.5">
                          <span className="truncate text-ui text-foreground">
                            {marked(result.title, folded)}
                          </span>
                          {result.trail.length === 0 ? null : (
                            <span className="flex items-center gap-1 text-caption text-foreground-subtle">
                              {result.trail.map((step, stepIndex) => (
                                <span key={step} className="flex items-center gap-1">
                                  {stepIndex === 0 ? null : (
                                    <AppIcon id="chevron-right" size={11} />
                                  )}
                                  {step}
                                </span>
                              ))}
                            </span>
                          )}
                          <span
                            translate={result.isMono ? 'no' : undefined}
                            className={cn(
                              'truncate text-caption text-foreground-subtle',
                              result.isMono && 'font-mono',
                            )}
                          >
                            {result.line}
                          </span>
                        </span>
                        <AppIcon
                          id="corner-down-left"
                          size={14}
                          className={cn(
                            'mt-2 shrink-0 text-primary transition-opacity',
                            isActive ? 'opacity-100' : 'opacity-0',
                          )}
                        />
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-t border-border px-3.5 text-caption text-foreground-subtle">
          <span>{t('settings.search.what', 'Searches names, descriptions and permissions')}</span>
          <span>{t('settings.search.esc', 'Esc to close')}</span>
        </div>
      </Popover>
    </>
  );
}
