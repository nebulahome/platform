/**
 * The Calendar page (docs/calendar.md 8): the header with the search, the settings and New event;
 * the toolbar; the view - week, month, year or agenda, in the address with the day it is on
 * (`?view=month&date=2026-12-03`) - and the side panel on its right, which the toolbar hides for
 * whoever is in front of this browser. Everything an occurrence opens - its popover, a day, the
 * pickups, the event dialog, the questions a repeating event asks - is drawn from here.
 *
 * On a narrow window (docs/calendar.md 10) it is the month as dots with the chosen day under it,
 * or the agenda, beside the sidebar as it is: the phone's own dock is a piece of work of its own.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

import { addDays, type CalendarOccurrence, type CalendarSearchMatch } from '@nebulahome/contracts';
import { AppIcon, Button, PageHeader, toast } from '@nebulahome/ui';

import { toMessage } from '@/lib/error-message';
import { useMediaQuery } from '@/lib/use-media-query';
import { momentOf } from '@/library/time-values';
import { SearchField } from '@/routes/library/search-field';
import { usePreferences } from '@/settings/preferences';

import { CALENDAR_QUERY_KEYS, createEvent, fetchEvent, updateEvent } from './api';
import {
  CALENDAR_PAGE_VIEWS,
  dayWords,
  firstDayOf,
  rangeOf,
  repeatWords,
  stepDay,
  timesText,
  titleOf,
  type CalendarPageView,
} from './calendar-time';
import { CalendarToolbar } from './calendar-toolbar';
import { DayPopover } from './day-popover';
import { useDeleteEvent } from './delete-event';
import { EventDialog, type EventSeed } from './dialogs/event-dialog';
import { SeriesDialog } from './dialogs/series-dialog';
import { EventPopover, PickupsPopover } from './event-popover';
import { SearchResults } from './search-results';
import { SidePanel } from './side-panel';
import { daysOffOf, LOOK_AHEAD_DAYS } from './today-card';
import { useCalendarBook } from './use-calendars';
import { useOccurrences, useShown } from './use-occurrences';
import { AgendaDay, AgendaView } from './views/agenda-view';
import { CompactMonth, MonthView } from './views/month-view';
import { QuickAdd, WeekView } from './views/week-view';
import { YearView } from './views/year-view';

/** Narrower than this, the page is the phone's: month as dots, or the agenda. */
const NARROW_QUERY = '(max-width: 899.98px)';

/** What a drag asks before it moves a repeating event. */
type PendingMove = {
  readonly occurrence: CalendarOccurrence;
  readonly startsAt: string;
  readonly endsAt: string;
};

/**
 * Renders the Calendar page.
 *
 * @returns The page.
 */
export function CalendarPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const isNarrow = useMediaQuery(NARROW_QUERY);
  const panel = usePreferences((state) => state.calendarPanel);
  const setPreferences = usePreferences((state) => state.set);

  const asked = params.get('view');
  const wanted: CalendarPageView = CALENDAR_PAGE_VIEWS.find((each) => each === asked) ?? 'month';
  const view: CalendarPageView =
    isNarrow && (wanted === 'week' || wanted === 'year') ? 'month' : wanted;

  // The day comes from the address; today, in the house, until the calendars say where that is.
  const [shownIcons, setShownIcons] = useState<readonly (string | null)[]>([]);
  const { book, error } = useCalendarBook(shownIcons);

  // "Open in the calendar" from a calendar's entity: that calendar alone, the others switched off
  // in the list as a tap would, so "Show all" brings them back.
  const only = params.get('calendar');

  useEffect(() => {
    if (only === null || book.calendars.length === 0) {
      return;
    }

    setPreferences({
      hiddenCalendars: book.calendars.filter((each) => each.id !== only).map((each) => each.id),
    });
    setParams(
      (current) => {
        const next = new URLSearchParams(current);

        next.delete('calendar');

        return next;
      },
      { replace: true },
    );
  }, [only, book.calendars, setPreferences, setParams]);
  const askedDay = params.get('date');
  const day = askedDay !== null && /^\d{4}-\d{2}-\d{2}$/u.test(askedDay) ? askedDay : book.today;
  const range = rangeOf(view, day);
  const read = useOccurrences(range);
  const isPanelOpen = panel === 'open' && !isNarrow && view !== 'year';
  const ahead = useOccurrences(
    { from: book.today, to: addDays(book.today, LOOK_AHEAD_DAYS) },
    isPanelOpen,
  );
  const shown = useShown(read.data, book);
  const daysOff = useMemo(
    () => daysOffOf([...(read.data ?? []), ...(ahead.data ?? [])], book),
    [read.data, ahead.data, book],
  );

  // The icons the occurrences carry, read with the calendars' in one request.
  const icons = useMemo(
    () => [...new Set([...(read.data ?? []), ...(ahead.data ?? [])].map((each) => each.icon))],
    [read.data, ahead.data],
  );

  if (icons.join() !== shownIcons.join()) {
    setShownIcons(icons);
  }

  const anchor = useRef<HTMLElement | null>(null);
  const searchBox = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const [opened, setOpened] = useState<CalendarOccurrence | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [pickupsDay, setPickupsDay] = useState<string | null>(null);
  const [seed, setSeed] = useState<EventSeed | null>(null);
  const [drawn, setDrawn] = useState<{ day: string; start: number; end: number } | null>(null);
  const [moving, setMoving] = useState<PendingMove | null>(null);
  const [words, setWords] = useState('');
  const [isSearching, setSearching] = useState(false);
  const deletion = useDeleteEvent(book);
  const canAdd = book.calendars.some((calendar) => calendar.canEdit);
  const allOff =
    book.calendars.length > 0 && book.calendars.every((calendar) => book.hidden.has(calendar.id));

  /**
   * Shows another view or day, keeping the rest of the address.
   *
   * @param changes - The view, the day, or both.
   * @param changes.view - The view.
   * @param changes.date - The day.
   */
  const go = (changes: { view?: CalendarPageView; date?: string }): void => {
    setParams((current) => {
      const next = new URLSearchParams(current);

      if (changes.view !== undefined) {
        next.set('view', changes.view);
      }

      if (changes.date !== undefined) {
        next.set('date', changes.date);
      }

      return next;
    });
  };

  /**
   * Opens an occurrence's popover beside what was pressed.
   *
   * @param occurrence - The occurrence.
   * @param element - What was pressed.
   */
  const open = (occurrence: CalendarOccurrence, element: HTMLElement): void => {
    setOpenDay(null);
    setPickupsDay(null);
    anchor.current = element;
    setOpened(occurrence);
  };

  /**
   * Opens a day's popover beside what was pressed.
   *
   * @param each - The day.
   * @param element - What was pressed.
   */
  const showDay = (each: string, element: HTMLElement): void => {
    setOpened(null);
    setPickupsDay(null);
    anchor.current = element;
    setOpenDay(each);
  };

  /**
   * Opens a day's pickups beside what was pressed.
   *
   * @param each - The day.
   * @param element - What was pressed.
   */
  const showPickups = (each: string, element: HTMLElement): void => {
    setOpened(null);
    setOpenDay(null);
    anchor.current = element;
    setPickupsDay(each);
  };

  /** Closes whatever hangs off the grid. */
  const closeAll = (): void => {
    setOpened(null);
    setOpenDay(null);
    setPickupsDay(null);
  };

  const quickSave = useMutation({
    /**
     * Makes the event drawn in the week.
     *
     * @param input - Its title and calendar.
     * @param input.title - The title.
     * @param input.calendarId - The calendar.
     * @returns The event.
     */
    mutationFn: async (input: { title: string; calendarId: string }) => {
      const slot = drawn ?? { day, start: 0, end: 60 };

      return createEvent({
        calendarId: input.calendarId,
        title: input.title,
        isAllDay: false,
        startsAt: momentAt(slot.day, slot.start, book.zone),
        endsAt: momentAt(slot.day, slot.end, book.zone),
      });
    },
    /**
     * Shuts the title's popover and reads the page again.
     *
     * @param saved - The event.
     * @param input - What was asked.
     * @param input.title - Its title, for the toast.
     */
    onSuccess: async (saved, input) => {
      setDrawn(null);
      await queryClient.invalidateQueries({ queryKey: CALENDAR_QUERY_KEYS.all });
      toast.success({
        title: t('calendar.dialog.saved', '{{title}} saved', { title: input.title }),
      });
    },
    /**
     * Says why it could not be made.
     *
     * @param failure - What went wrong.
     */
    onError: (failure: unknown) => {
      toast.error({
        title: t('calendar.dialog.notSaved', 'The event could not be saved'),
        message: toMessage(failure),
      });
    },
  });

  const move = useMutation({
    /**
     * Moves an event, a time of a series, or the whole series by as much.
     *
     * @param input - The move and which times.
     * @param input.change - Where it goes.
     * @param input.scope - Which times, for a repeating event.
     * @returns The event as kept.
     */
    mutationFn: async (input: { change: PendingMove; scope: 'one' | 'all' | null }) => {
      const { occurrence, startsAt, endsAt } = input.change;
      const seriesId = occurrence.seriesId ?? occurrence.eventId ?? '';

      if (input.scope === null) {
        return updateEvent(occurrence.eventId ?? '', { startsAt, endsAt });
      }

      if (input.scope === 'one') {
        return updateEvent(
          seriesId,
          { startsAt, endsAt },
          {
            scope: 'one',
            occurrenceOn: occurrence.occurrenceOn ?? firstDayOf(occurrence, book.zone),
          },
        );
      }

      // shortcut: the whole series moves by as much as this time did; a weekly rule keeps its
      // weekdays, so moving it to another day moves its first day only.
      const series = await fetchEvent(seriesId);
      const shift = Date.parse(startsAt) - Date.parse(occurrence.startsAt ?? startsAt);
      const start = Date.parse(series.startsAt ?? startsAt) + shift;

      return updateEvent(
        seriesId,
        {
          startsAt: new Date(start).toISOString(),
          endsAt: new Date(start + Date.parse(endsAt) - Date.parse(startsAt)).toISOString(),
        },
        { scope: 'all' },
      );
    },
    /** Reads the page again. */
    onSuccess: async () => {
      setMoving(null);
      await queryClient.invalidateQueries({ queryKey: CALENDAR_QUERY_KEYS.all });
    },
    /**
     * Says why it could not be moved.
     *
     * @param failure - What went wrong.
     */
    onError: (failure: unknown) => {
      setMoving(null);
      toast.error({
        title: t('calendar.page.notMoved', 'The event could not be moved'),
        message: toMessage(failure),
      });
    },
  });

  const shared = {
    book,
    day,
    occurrences: shown,
    daysOff,
    onOpen: open,
    onOpenPickups: showPickups,
  };

  let body;

  if (isNarrow && view === 'month') {
    body = (
      <div className="flex min-w-0 grow flex-col gap-3.5">
        <CompactMonth
          book={book}
          day={day}
          occurrences={shown}
          daysOff={daysOff}
          onPick={(each) => {
            go({ date: each });
          }}
        />
        <section className="overflow-hidden rounded-panel border border-border bg-surface pb-1">
          <div className="flex items-baseline justify-between px-3.5 pt-3 pb-2.5">
            <span className="text-title font-medium first-letter:uppercase">
              {day === book.today
                ? t('calendar.page.todayDay', 'Today · {{day}}', { day: dayWords(day, 'weekday') })
                : dayWords(day)}
            </span>
          </div>
          <div className="border-t border-border">
            <AgendaDay {...shared} isBare isCompact />
          </div>
        </section>
      </div>
    );
  } else if (view === 'week') {
    body = (
      <WeekView
        {...shared}
        canAdd={canAdd}
        drawn={drawn}
        ghostRef={ghost}
        onDrawn={(each, start, end) => {
          closeAll();
          setDrawn({ day: each, start, end });
        }}
        onMoved={(occurrence, startsAt, endsAt) => {
          if (occurrence.isRepeating) {
            setMoving({ occurrence, startsAt, endsAt });
          } else {
            move.mutate({ change: { occurrence, startsAt, endsAt }, scope: null });
          }
        }}
      />
    );
  } else if (view === 'year') {
    body = <YearView book={book} day={day} occurrences={shown} daysOff={daysOff} />;
  } else if (view === 'agenda') {
    body = (
      <AgendaView
        {...shared}
        canAdd={canAdd}
        onNewEvent={() => {
          setSeed({ mode: 'new', day });
        }}
        onShowAll={() => {
          setPreferences({ hiddenCalendars: [] });
        }}
      />
    );
  } else {
    body = (
      <MonthView
        {...shared}
        isLoading={read.isPending}
        canAdd={canAdd}
        onOpenDay={showDay}
        onNewEvent={(each) => {
          setSeed({ mode: 'new', day: each });
        }}
      />
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 grow flex-col gap-5 overflow-y-auto px-8 pt-6 pb-10">
      <PageHeader
        title={t('calendar.page.title', 'Calendar')}
        meta={
          view === 'year' || view === 'agenda'
            ? undefined
            : t('calendar.page.count', {
                count: book.calendars.length,
                defaultValue_one: '{{count}} calendar',
                defaultValue_other: '{{count}} calendars',
              })
        }
        actions={
          <>
            <div
              ref={searchBox}
              onFocusCapture={() => {
                setSearching(true);
              }}
            >
              <SearchField
                label={t('calendar.page.search', 'Search events')}
                placeholder={t('calendar.page.search', 'Search events')}
                value={words}
                className="w-44 lg:w-56"
                onChange={(next) => {
                  setWords(next);
                  setSearching(true);
                }}
              />
            </div>
            <Link
              to="/calendar/settings"
              aria-label={t('calendar.page.settings', 'Calendar settings')}
              title={t('calendar.page.settings', 'Calendar settings')}
              className="press-scale inline-flex size-control shrink-0 items-center justify-center rounded-pill border border-border-strong bg-surface-raised text-foreground-muted hover:bg-surface-high hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none"
            >
              <AppIcon id="settings" size={16} />
            </Link>
            {canAdd ? (
              <Button
                onClick={() => {
                  setSeed({
                    mode: 'new',
                    day: day < book.today && view !== 'week' ? book.today : day,
                  });
                }}
              >
                <AppIcon id="plus" size={16} />
                {t('calendar.page.newEvent', 'New event')}
              </Button>
            ) : null}
          </>
        }
      />

      <CalendarToolbar
        view={view}
        title={titleOf(view, day)}
        isNarrow={isNarrow}
        onStep={(by) => {
          go({ date: stepDay(view, day, by) });
        }}
        onToday={() => {
          go({ date: book.today });
        }}
        onViewChange={(next) => {
          go({ view: next });
        }}
        isPanelOpen={isNarrow || view === 'year' ? undefined : panel === 'open'}
        onPanelToggle={() => {
          setPreferences({ calendarPanel: panel === 'open' ? 'closed' : 'open' });
        }}
      />

      {error === null ? null : (
        <p
          role="alert"
          className="rounded-inner border border-danger/40 bg-danger-soft px-4 py-3 text-ui-sm text-danger"
        >
          {toMessage(error)}
        </p>
      )}

      {allOff ? (
        <div className="flex items-center justify-between gap-3 rounded-card border border-border bg-surface px-4 py-3.5">
          <span className="flex items-center gap-2.5 text-ui-sm text-foreground-muted">
            <AppIcon id="eye-off" size={16} className="text-foreground-subtle" />
            {t('calendar.page.allOff', {
              count: book.calendars.length,
              defaultValue_one: 'The calendar is off',
              defaultValue_other: 'All {{count}} calendars are off',
            })}
          </span>
          <Button
            variant="ghost"
            size="compact"
            onClick={() => {
              setPreferences({ hiddenCalendars: [] });
            }}
          >
            {t('calendar.list.showAll', 'Show all')}
          </Button>
        </div>
      ) : null}

      <div className="flex min-w-0 items-start gap-5">
        {body}
        {isPanelOpen ? (
          <SidePanel
            book={book}
            ahead={ahead.data ?? []}
            onOpen={open}
            onShowDay={(each) => {
              go({ date: each });
            }}
            onHiddenChange={(hiddenCalendars) => {
              setPreferences({ hiddenCalendars: [...hiddenCalendars] });
            }}
          />
        ) : null}
      </div>

      <SearchResults
        book={book}
        words={words}
        anchor={searchBox}
        isOpen={isSearching}
        onClose={() => {
          setSearching(false);
        }}
        onPick={(match: CalendarSearchMatch) => {
          setSearching(false);
          go({ date: firstDayOf(match, book.zone) });
          open(match, searchBox.current ?? document.body);
        }}
      />

      <EventPopover
        book={book}
        occurrence={opened}
        anchor={anchor}
        daysOff={daysOff}
        onClose={() => {
          setOpened(null);
        }}
        onEdit={(occurrence) => {
          closeAll();
          setSeed({ mode: 'edit', occurrence });
        }}
        onDelete={(occurrence) => {
          closeAll();
          deletion.start(occurrence);
        }}
      />

      <DayPopover
        book={book}
        day={openDay}
        occurrences={shown}
        daysOff={daysOff}
        anchor={anchor}
        canAdd={canAdd}
        onClose={() => {
          setOpenDay(null);
        }}
        onNewEvent={(each) => {
          setSeed({ mode: 'new', day: each });
        }}
        onOpen={open}
        onOpenPickups={showPickups}
      />

      <PickupsPopover
        book={book}
        day={pickupsDay}
        occurrences={[...shown, ...(ahead.data ?? [])]}
        anchor={anchor}
        onClose={() => {
          setPickupsDay(null);
        }}
        onEdit={(occurrence) => {
          closeAll();
          setSeed({ mode: 'edit', occurrence });
        }}
      />

      <QuickAdd
        key={drawn === null ? 'shut' : `${drawn.day}-${String(drawn.start)}`}
        book={book}
        drawn={drawn}
        anchor={ghost}
        isBusy={quickSave.isPending}
        onClose={() => {
          setDrawn(null);
        }}
        onSave={(title, calendarId) => {
          quickSave.mutate({ title, calendarId });
        }}
        onMore={(title, calendarId) => {
          if (drawn !== null) {
            setSeed({
              mode: 'new',
              day: drawn.day,
              start: drawn.start,
              end: drawn.end,
              title,
              calendarId,
            });
          }

          setDrawn(null);
        }}
      />

      {seed === null ? null : (
        <EventDialog
          book={book}
          seed={seed}
          onClose={() => {
            setSeed(null);
          }}
        />
      )}

      {moving === null ? null : (
        <SeriesDialog
          purpose="move"
          title={moving.occurrence.title}
          rule={null}
          onlyNote={t('calendar.page.moveOnly', '{{when}}. The others stay where they are.', {
            when: `${dayWords(firstDayOf({ ...moving.occurrence, startsAt: moving.startsAt }, book.zone))}, ${timesText(
              { ...moving.occurrence, startsAt: moving.startsAt, endsAt: moving.endsAt },
              book.zone,
            )}`,
          })}
          allNote={t('calendar.page.moveAll', 'Every time it repeats, from {{times}}.', {
            times: timesText(
              { ...moving.occurrence, startsAt: moving.startsAt, endsAt: moving.endsAt },
              book.zone,
            ),
          })}
          isBusy={move.isPending}
          onCancel={() => {
            setMoving(null);
          }}
          onConfirm={(choice) => {
            move.mutate({ change: moving, scope: choice === 'one' ? 'one' : 'all' });
          }}
        />
      )}

      {deletion.pending === null ? null : (
        <SeriesDialog
          purpose="delete"
          title={deletion.pending.title}
          rule={
            deletion.series?.repeat === null || deletion.series === undefined
              ? null
              : repeatWords(deletion.series.repeat, firstDayOf(deletion.pending, book.zone))
          }
          onlyNote={t('calendar.page.deleteOnly', '{{day}}. The others stay.', {
            day: dayWords(deletion.pending.occurrenceOn ?? firstDayOf(deletion.pending, book.zone)),
          })}
          allNote={t(
            'calendar.page.deleteFollowing',
            'The ones already past stay in the calendar.',
          )}
          isBusy={deletion.isBusy}
          onCancel={deletion.cancel}
          onConfirm={deletion.confirm}
        />
      )}
    </div>
  );
}

/**
 * The instant a day's minute is on the house's clock.
 *
 * @param day - The day.
 * @param minutes - Minutes since midnight; a whole day is the next midnight.
 * @param zone - The house's zone.
 * @returns ISO 8601 with its offset.
 */
function momentAt(day: string, minutes: number, zone: string): string {
  return minutes >= 1440 ? momentOf(addDays(day, 1), 0, zone) : momentOf(day, minutes * 60, zone);
}
