/**
 * The month (CAL-Month): six weeks of days, Monday first. A day holds its lines - all-day chips
 * first, then the timed ones by start - as many as fit; the rest are "+N more", which opens the
 * day. Events over several days are bars across the week, in lanes over the lines. Pickups are
 * tokens at the foot of their day; holidays name themselves beside the day's number, in red.
 *
 * On a narrow window (docs/calendar.md 10) the month is its days with a dot for each calendar that
 * has something on them, and the day chosen is listed under it.
 */
import { useTranslation } from 'react-i18next';

import { addDays, DAYS_OF_WEEK, weekdayOf, type CalendarOccurrence } from '@nebulahome/contracts';
import { cn } from '@nebulahome/ui';

import {
  dayWords,
  firstDayOf,
  isOn,
  lastDayOf,
  lengthInDays,
  monthShort,
  rangeOf,
  weekdayWords,
} from '../calendar-time';
import { EventBar, EventChip } from '../event-chip';
import { LANE_CLASSES, ModelToken } from '../model-token';
import type { DaysOff } from '../today-card';
import { isPickup, lookOf, type CalendarBook } from '../use-calendars';

/** The lines a day has room for, bars included. */
const LINES = 3;

/** What both months need. */
export type MonthViewProps = {
  readonly book: CalendarBook;

  /** The day the page is on: its month is shown. */
  readonly day: string;

  /** The occurrences of the six weeks, of the calendars on. */
  readonly occurrences: readonly CalendarOccurrence[];
  readonly daysOff: DaysOff;

  /** Whether the occurrences are still being read: the days stay, the lines are placeholders. */
  readonly isLoading: boolean;

  /** Whether the reader may add an event to some calendar: an empty day then starts one. */
  readonly canAdd: boolean;
  readonly onOpen: (occurrence: CalendarOccurrence, anchor: HTMLElement) => void;
  readonly onOpenDay: (day: string, anchor: HTMLElement) => void;
  readonly onOpenPickups: (day: string, anchor: HTMLElement) => void;
  readonly onNewEvent: (day: string) => void;
};

/** A bar of a week: an occurrence over several days, where it starts and ends in the row. */
type Bar = {
  readonly occurrence: CalendarOccurrence;
  readonly from: number;
  readonly to: number;
  readonly lane: number;
};

/**
 * Lays out a week's bars in lanes, the earliest first, each in the first lane it fits.
 *
 * @param week - The week's seven days.
 * @param spans - The occurrences over several days.
 * @param zone - The house's zone.
 * @returns The bars.
 */
function barsOf(
  week: readonly string[],
  spans: readonly CalendarOccurrence[],
  zone: string,
): Bar[] {
  const first = week[0] ?? '';
  const last = week[6] ?? '';
  const lanes: [number, number][][] = [];
  const bars: Bar[] = [];

  for (const occurrence of spans) {
    const start = firstDayOf(occurrence, zone);
    const end = lastDayOf(occurrence, zone);

    if (end < first || start > last) {
      continue;
    }

    const from = start < first ? 0 : week.indexOf(start);
    const to = end > last ? 6 : week.indexOf(end);
    let lane = 0;

    while (lanes[lane]?.some(([left, right]) => !(to < left || from > right)) === true) {
      lane += 1;
    }

    (lanes[lane] ??= []).push([from, to]);
    bars.push({ occurrence, from, to, lane });
  }

  return bars;
}

/**
 * Whether a day is a weekend day of the house.
 *
 * @param day - The day.
 * @param book - The page's book.
 * @returns True on a weekend.
 */
function isWeekend(day: string, book: CalendarBook): boolean {
  return book.weekendDays.includes(DAYS_OF_WEEK.indexOf(weekdayOf(day)));
}

/**
 * Renders the month.
 *
 * @param props - See {@link MonthViewProps}.
 * @returns The grid.
 */
export function MonthView(props: MonthViewProps) {
  const { t } = useTranslation();
  const { book, day, occurrences, daysOff, isLoading, canAdd } = props;
  const { zone, today, now } = book;
  const range = rangeOf('month', day);
  const month = day.slice(0, 7);
  const days = Array.from({ length: 42 }, (unused, index) => addDays(range.from, index));
  const weeks = [0, 1, 2, 3, 4, 5].map((index) => days.slice(index * 7, index * 7 + 7));

  const lines = occurrences.filter(
    (occurrence) =>
      occurrence.kind !== 'holiday' &&
      !isPickup(occurrence, book) &&
      !(occurrence.isAllDay && lengthInDays(occurrence, zone) > 1),
  );
  const spans = occurrences.filter(
    (occurrence) =>
      occurrence.kind !== 'holiday' &&
      !isPickup(occurrence, book) &&
      occurrence.isAllDay &&
      lengthInDays(occurrence, zone) > 1,
  );
  const pickups = occurrences.filter((occurrence) => isPickup(occurrence, book));

  return (
    <section
      aria-label={t('calendar.views.month', 'Month')}
      className="relative min-w-0 grow overflow-hidden rounded-panel border border-border bg-surface"
    >
      <div aria-hidden="true" className="grid h-9 grid-cols-7 items-center">
        {weeks[0]?.map((each) => (
          <span
            key={each}
            className={cn(
              'pl-3 font-mono text-label uppercase',
              isWeekend(each, book) ? 'text-foreground-disabled' : 'text-foreground-subtle',
            )}
          >
            {weekdayWords(each, 'short')}
          </span>
        ))}
      </div>

      {weeks.map((week) => {
        const bars = barsOf(week, spans, zone);
        const laneCount = bars.reduce((most, bar) => Math.max(most, bar.lane + 1), 0);

        return (
          <div key={week[0]} className="relative grid grid-cols-7 border-t border-border">
            {week.map((each, column) => {
              const isInMonth = each.startsWith(month);
              const isToday = each === today;
              const holiday = daysOff.names.get(each);
              const isOff =
                holiday !== undefined || isWeekend(each, book) || daysOff.dayOff.has(each);
              const own = lines.filter((occurrence) => isOn(occurrence, each, zone));
              const room = Math.max(0, LINES - laneCount);
              const shown = own.slice(0, room);
              const more = own.length - shown.length;
              const bins = pickups.filter((occurrence) => isOn(occurrence, each, zone));

              return (
                <div
                  key={each}
                  className={cn(
                    'relative flex h-33.5 min-w-0 flex-col gap-0.5 p-1.75',
                    column > 0 && 'border-l border-border',
                    isToday ? 'bg-primary/5' : isOff ? 'bg-well' : undefined,
                  )}
                >
                  {canAdd ? (
                    <button
                      type="button"
                      aria-label={t('calendar.month.newOn', 'New event on {{day}}', {
                        day: dayWords(each),
                      })}
                      onClick={() => {
                        props.onNewEvent(each);
                      }}
                      className="absolute inset-0 cursor-default focus-visible:shadow-[inset_0_0_0_2px_var(--color-primary)] focus-visible:outline-none"
                    />
                  ) : null}

                  <div
                    className={cn(
                      'pointer-events-none relative flex h-6.5 shrink-0 items-center justify-between gap-1.5',
                      !isInMonth && 'opacity-60',
                    )}
                  >
                    <span
                      className={cn(
                        'inline-flex h-6.5 items-center text-ui-sm tabular',
                        isToday
                          ? 'w-6.5 justify-center rounded-full bg-primary font-semibold text-primary-foreground'
                          : 'px-1',
                        !isToday &&
                          (!isInMonth
                            ? 'text-foreground-disabled'
                            : holiday === undefined
                              ? isOff
                                ? 'text-foreground-muted'
                                : 'text-foreground'
                              : 'font-medium text-tag-red'),
                      )}
                    >
                      {each.endsWith('-01')
                        ? `${String(Number(each.slice(8)))} ${monthShort(each)}`
                        : Number(each.slice(8))}
                    </span>
                    {holiday === undefined ? null : (
                      <span className="min-w-0 truncate text-label text-tag-red">{holiday}</span>
                    )}
                  </div>

                  {laneCount > 0 ? (
                    <div
                      aria-hidden="true"
                      className="shrink-0"
                      /* eslint-disable-next-line react/forbid-dom-props -- room for this week's
                         bars: 21 px a lane, a count known only once the week is laid out
                         (RULES.md 15.3). */
                      style={{ height: laneCount * 21 }}
                    />
                  ) : null}

                  <div
                    className={cn(
                      'relative flex min-w-0 flex-col gap-0.5',
                      !isInMonth && 'opacity-45',
                    )}
                  >
                    {isLoading && occurrences.length === 0 ? (
                      <>
                        <span className="h-3 w-3/5 rounded-check bg-surface-raised" />
                        <span className="h-3 w-2/5 rounded-check bg-surface-raised" />
                      </>
                    ) : (
                      shown.map((occurrence) => (
                        <EventChip
                          key={occurrence.key}
                          occurrence={occurrence}
                          book={book}
                          isPast={
                            occurrence.isAllDay
                              ? lastDayOf(occurrence, zone) < today
                              : Date.parse(occurrence.endsAt ?? '') < now
                          }
                          onOpen={props.onOpen}
                        />
                      ))
                    )}
                  </div>

                  <div className="grow" />

                  <div
                    className={cn(
                      'relative flex min-h-4 items-center justify-between gap-1',
                      !isInMonth && 'opacity-45',
                    )}
                  >
                    {bins.length === 0 ? (
                      <span />
                    ) : (
                      <button
                        type="button"
                        aria-label={t('calendar.month.pickups', 'Pickups of {{day}}', {
                          day: dayWords(each),
                        })}
                        onClick={(event) => {
                          props.onOpenPickups(each, event.currentTarget);
                        }}
                        className="flex cursor-pointer gap-0.75 rounded-full focus-visible:shadow-focus focus-visible:outline-none"
                      >
                        {bins.map((occurrence) => {
                          const look = lookOf(occurrence, book);

                          return (
                            <ModelToken
                              key={occurrence.key}
                              icon={look.icon}
                              color={look.tokenColor}
                              size={18}
                              className="calendar-appear"
                            />
                          );
                        })}
                      </button>
                    )}
                    {more > 0 ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          props.onOpenDay(each, event.currentTarget);
                        }}
                        className="cursor-pointer rounded-check text-label whitespace-nowrap text-foreground-muted hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none"
                      >
                        {t('calendar.month.more', '+{{count}} more', { count: more })}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}

            {bars.length === 0 ? null : (
              <div className="pointer-events-none absolute inset-x-0 top-9 grid auto-rows-5 grid-cols-7 gap-y-0.5">
                {bars.map((bar) => (
                  <EventBar
                    key={bar.occurrence.key}
                    occurrence={bar.occurrence}
                    book={book}
                    startsBefore={firstDayOf(bar.occurrence, zone) < (week[0] ?? '')}
                    endsAfter={lastDayOf(bar.occurrence, zone) > (week[6] ?? '')}
                    onOpen={props.onOpen}

                    style={{
                      gridColumn: `${String(bar.from + 1)} / span ${String(bar.to - bar.from + 1)}`,
                      gridRow: bar.lane + 1,
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

/** What the narrow month needs. */
export type CompactMonthProps = Pick<MonthViewProps, 'book' | 'day' | 'occurrences' | 'daysOff'> & {
  /** Called with the day pressed. */
  readonly onPick: (day: string) => void;
};

/**
 * Renders the month on a narrow window: the days, a dot for each calendar with something on one,
 * and a square dot for its pickups (CAL-Phone-Month).
 *
 * @param props - See {@link CompactMonthProps}.
 * @returns The grid.
 */
export function CompactMonth(props: CompactMonthProps) {
  const { t } = useTranslation();
  const { book, day, occurrences, daysOff, onPick } = props;
  const { zone, today } = book;
  const range = rangeOf('month', day);
  const month = day.slice(0, 7);
  const days = Array.from({ length: 42 }, (unused, index) => addDays(range.from, index));

  return (
    <section
      aria-label={t('calendar.views.month', 'Month')}
      className="grid shrink-0 grid-cols-7 rounded-panel border border-border bg-surface px-1.5 pt-2 pb-1"
    >
      {days.slice(0, 7).map((each) => (
        <span
          key={`head-${each}`}
          aria-hidden="true"
          className={cn(
            'flex h-5.5 items-center justify-center font-mono text-label uppercase',
            isWeekend(each, book) ? 'text-foreground-disabled' : 'text-foreground-subtle',
          )}
        >
          {weekdayWords(each, 'short').slice(0, 1)}
        </span>
      ))}
      {days.map((each) => {
        const on = occurrences.filter((occurrence) => isOn(occurrence, each, zone));
        const colors = [
          ...new Set(
            on
              .filter((occurrence) => !isPickup(occurrence, book) && occurrence.kind !== 'holiday')
              .map((occurrence) => lookOf(occurrence, book).color),
          ),
        ].slice(0, 3);
        const hasBins = on.some((occurrence) => isPickup(occurrence, book));
        const isPicked = each === day;
        const isHoliday = daysOff.holidays.has(each);

        return (
          <button
            key={each}
            type="button"
            aria-label={dayWords(each)}
            aria-pressed={isPicked}
            onClick={() => {
              onPick(each);
            }}
            className={cn(
              'flex h-11.5 cursor-pointer flex-col items-center gap-0.75 pt-1 focus-visible:outline-none',
              !each.startsWith(month) && 'opacity-50',
            )}
          >
            <span
              className={cn(
                'flex size-7 items-center justify-center rounded-full text-ui tabular',
                each === today
                  ? 'bg-primary font-semibold text-primary-foreground'
                  : isPicked
                    ? 'bg-surface-high text-foreground'
                    : isHoliday
                      ? 'text-tag-red'
                      : isWeekend(each, book)
                        ? 'text-foreground-subtle'
                        : 'text-foreground',
              )}
            >
              {Number(each.slice(8))}
            </span>
            <span aria-hidden="true" className="flex h-1.25 gap-0.75">
              {colors.map((color) => (
                <span
                  key={color}
                  className={cn('size-1.25 rounded-full bg-[var(--lane)]', LANE_CLASSES[color])}
                />
              ))}
              {hasBins ? <span className="size-1.25 rounded-[1.5px] bg-tag-green/60" /> : null}
            </span>
          </button>
        );
      })}
    </section>
  );
}
