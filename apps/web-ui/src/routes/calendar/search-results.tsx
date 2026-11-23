/**
 * What the header's search found, under it (CAL-Search): the coming times, soonest first, then the
 * past ones, in every calendar - the switched-off ones too, as the foot says. The arrows move
 * through them and Enter opens one; with nothing found, it says so.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { daysBetween, type CalendarSearchMatch } from '@nebulahome/contracts';
import { AppIcon, cn, Popover } from '@nebulahome/ui';

import { relativeTimeFormat } from '@/i18n/formatters';
import { signalled } from '@/lib/signalled';
import { useDebounced } from '@/lib/use-debounced';

import { CALENDAR_QUERY_KEYS, searchCalendars } from './api';
import { dayWords, firstDayOf } from './calendar-time';
import { LANE_CLASSES } from './model-token';
import { lookOf, type CalendarBook } from './use-calendars';

/** What the results need. */
export type SearchResultsProps = {
  readonly book: CalendarBook;

  /** What is typed in the search. */
  readonly words: string;

  /** The search box: the results hang under it, and its keys move through them. */
  readonly anchor: RefObject<HTMLElement | null>;
  readonly isOpen: boolean;
  readonly onClose: () => void;

  /** Called with the match opened. */
  readonly onPick: (match: CalendarSearchMatch) => void;
};

/**
 * Says how far a day is from today: "tomorrow", "in 15 days", "3 weeks ago".
 *
 * @param day - The day.
 * @param today - Today.
 * @returns The words.
 */
function distanceWords(day: string, today: string): string {
  const days = daysBetween(today, day);
  const format = relativeTimeFormat({ numeric: 'auto' });

  return Math.abs(days) < 14
    ? format.format(days, 'day')
    : format.format(Math.round(days / 7), 'week');
}

/**
 * A title with the words found in it marked.
 *
 * @param props - The title and the words.
 * @param props.title - The title.
 * @param props.words - What was searched.
 * @returns The title.
 */
function Marked(props: { readonly title: string; readonly words: string }) {
  const { title, words } = props;
  const at = title.toLowerCase().indexOf(words.trim().toLowerCase());

  if (at < 0 || words.trim() === '') {
    return title;
  }

  const end = at + words.trim().length;

  return (
    <>
      {title.slice(0, at)}
      <mark className="rounded-check bg-primary/28 px-px text-foreground">
        {title.slice(at, end)}
      </mark>
      {title.slice(end)}
    </>
  );
}

/**
 * Renders the search's results.
 *
 * @param props - See {@link SearchResultsProps}.
 * @returns The popover.
 */
export function SearchResults(props: SearchResultsProps) {
  const { t } = useTranslation();
  const { book, words, anchor, isOpen, onClose, onPick } = props;
  const settled = useDebounced(words.trim(), 250);
  const [active, setActive] = useState(0);
  const found = useQuery({
    queryKey: [...CALENDAR_QUERY_KEYS.search, settled],
    queryFn: signalled(async (signal) => searchCalendars(settled, signal)),
    enabled: isOpen && settled !== '',
  });
  const matches = useMemo(
    () => [...(found.data?.comingUp ?? []), ...(found.data?.past ?? [])],
    [found.data],
  );

  // The search box's own keys move through the results.
  useEffect(() => {
    const box = anchor.current;

    if (box === null || !isOpen) {
      return undefined;
    }

    /**
     * Moves, or opens the result the keyboard is on.
     *
     * @param event - The key press.
     */
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((at) =>
          matches.length === 0
            ? 0
            : (at + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length,
        );
      } else if (event.key === 'Enter') {
        const match = matches[active];

        if (match !== undefined) {
          event.preventDefault();
          onPick(match);
        }
      }
    };

    box.addEventListener('keydown', onKey);

    return () => {
      box.removeEventListener('keydown', onKey);
    };
  }, [anchor, isOpen, matches, active, onPick]);

  /**
   * One result.
   *
   * @param match - The match.
   * @param index - Its place among all of them.
   * @param isPast - Whether it is over.
   * @returns The row.
   */
  const row = (match: CalendarSearchMatch, index: number, isPast: boolean) => {
    const look = lookOf(match, book);
    const day = firstDayOf(match, book.zone);

    return (
      <button
        key={match.key}
        type="button"
        role="option"
        aria-selected={index === active}
        onMouseEnter={() => {
          setActive(index);
        }}
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={() => {
          onPick(match);
        }}
        className={cn(
          'flex min-h-12.5 w-full cursor-pointer items-center gap-3 rounded-tile px-3.5 py-1 text-left',
          index === active && 'bg-surface-high',
          isPast && 'opacity-55',
          LANE_CLASSES[look.color],
        )}
      >
        <span className="flex w-18.5 shrink-0 flex-col gap-px">
          <span className="font-mono text-caption text-foreground-muted">
            {dayWords(day, 'short')}
          </span>
          <span className="text-label text-foreground-subtle">
            {distanceWords(day, book.today)}
          </span>
        </span>
        <span aria-hidden="true" className="h-7 w-1 shrink-0 rounded-full bg-[var(--lane)]" />
        <span className="flex min-w-0 grow flex-col gap-px">
          <span className="truncate text-ui">
            <Marked title={match.title} words={settled} />
          </span>
          <span className="truncate text-caption text-foreground-subtle">
            {[look.calendar?.name, look.model?.name]
              .filter((part) => part !== undefined)
              .join(' · ')}
          </span>
        </span>
      </button>
    );
  };

  const comingUp = found.data?.comingUp ?? [];
  const past = found.data?.past ?? [];
  /**
   * A group's heading.
   *
   * @param title - The group.
   * @param count - How many are in it.
   * @returns The heading.
   */
  const heading = (title: string, count: number) => (
    <div className="flex justify-between px-3.5 py-1.5">
      <span className="font-mono text-label text-foreground-subtle uppercase">{title}</span>
      <span className="font-mono text-label text-foreground-subtle">{count}</span>
    </div>
  );

  return (
    <Popover
      anchor={anchor}
      isOpen={isOpen && settled !== ''}
      onClose={onClose}
      width={440}
      label={t('calendar.search.results', 'Search results')}
      // A little clear of the search's pill, which is lit while the results are open.
      className="mt-1.5 rounded-panel"
    >
      <div
        role="listbox"
        aria-label={t('calendar.search.results', 'Search results')}
        className="flex flex-col gap-0.5 overflow-y-auto p-2.5"
      >
        {found.isPending ? (
          <span className="px-3.5 py-4 text-ui-sm text-foreground-subtle">
            {t('common.loading', 'Loading…')}
          </span>
        ) : matches.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 pt-6.5 pb-5.5 text-center">
            <AppIcon id="search-x" size={22} className="text-foreground-muted" />
            <span className="text-ui font-medium">
              {t('calendar.search.nothing', 'Nothing called “{{words}}”', { words: settled })}
            </span>
          </div>
        ) : (
          <>
            {comingUp.length === 0
              ? null
              : heading(t('calendar.search.comingUp', 'Coming up'), comingUp.length)}
            {comingUp.map((match, index) => row(match, index, false))}
            {past.length === 0 ? null : (
              <div className={cn(comingUp.length > 0 && 'mt-1 border-t border-border pt-1')}>
                {heading(t('calendar.search.past', 'Past'), past.length)}
              </div>
            )}
            {past.map((match, index) => row(match, comingUp.length + index, true))}
          </>
        )}
        <div className="mt-1 flex items-center justify-between gap-3 border-t border-border px-3.5 pt-2.5 pb-1.5 text-caption text-foreground-subtle">
          <span>{t('calendar.search.everywhere', 'In every calendar, hidden ones too')}</span>
          <span className="whitespace-nowrap">
            {t('calendar.search.keys', '↑↓ to move · Enter to open')}
          </span>
        </div>
      </div>
    </Popover>
  );
}
