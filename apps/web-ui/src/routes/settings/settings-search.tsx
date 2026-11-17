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
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { AppIcon, cn, Popover, type UiIconId } from '@nebulahome/ui';

import { text } from '@/i18n/messages';
import { markMatch } from '@/lib/mark-match';
import { PERMISSION_GROUPS, permissionLabel } from '@/lib/permission-labels';
import { foldForSearch } from '@/lib/search-text';
import { SETTINGS_INDEX } from '@/routes/settings/settings-index';
import type { SettingsGroup } from '@/routes/settings/settings-tree';
import { settingDescription } from '@/settings/setting-descriptions';

/** The longest list the popover shows. */
const MOST = 12;

/** The popover's width, wider than the field it hangs off. */
const WIDTH = 460;

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
  const folded = foldForSearch(query);

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
    folded !== '' && words.some((word) => foldForSearch(word).includes(folded));

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
                            {markMatch(
                              result.title,
                              [folded],
                              'rounded-check bg-primary/25 text-foreground',
                            )}
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
