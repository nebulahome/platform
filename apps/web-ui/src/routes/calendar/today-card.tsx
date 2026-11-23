/**
 * Today, at the top of the side panel (CAL-Month): the day, whether it is a working day and
 * whether tomorrow is, what is left of it, the bins to put out tonight, and the next long weekend.
 */
import { useTranslation } from 'react-i18next';

import {
  addDays,
  DAYS_OF_WEEK,
  daysBetween,
  isWorkingDay,
  longWeekendsOf,
  weekdayOf,
  type CalendarOccurrence,
} from '@nebulahome/contracts';
import { AppIcon, cn } from '@nebulahome/ui';

import { dateTimeFormat } from '@/i18n/formatters';

import {
  clockText,
  dayWords,
  isOn,
  lastDayOf,
  firstDayOf,
  untilWords,
  weekdayWords,
} from './calendar-time';
import { LANE_CLASSES, ModelToken } from './model-token';
import { isPickup, lookOf, type CalendarBook } from './use-calendars';

/** How far ahead the next long weekend is looked for. */
export const LOOK_AHEAD_DAYS = 60;

/** The days off the occurrences of a stretch make: holidays, and days of day-off calendars. */
export type DaysOff = {
  readonly holidays: ReadonlySet<string>;
  readonly dayOff: ReadonlySet<string>;
  readonly names: ReadonlyMap<string, string>;
};

/**
 * Collects the days off some occurrences make.
 *
 * @param occurrences - Every occurrence of a stretch, switched off or not: a day off is a fact.
 * @param book - The page's book.
 * @returns The holidays' days and names, and the days day-off calendars cover.
 */
export function daysOffOf(occurrences: readonly CalendarOccurrence[], book: CalendarBook): DaysOff {
  const holidays = new Set<string>();
  const dayOff = new Set<string>();
  const names = new Map<string, string>();

  for (const occurrence of occurrences) {
    const isHoliday = occurrence.kind === 'holiday';

    if (!occurrence.isAllDay || !(isHoliday || book.byId.get(occurrence.calendarId)?.isDayOff)) {
      continue;
    }

    const last = lastDayOf(occurrence, book.zone);

    for (let day = firstDayOf(occurrence, book.zone); day <= last; day = addDays(day, 1)) {
      (isHoliday ? holidays : dayOff).add(day);

      if (isHoliday && !names.has(day)) {
        names.set(day, occurrence.title);
      }
    }
  }

  return { holidays, dayOff, names };
}

/**
 * The ISO week a day is in.
 *
 * @param day - The day.
 * @returns 1 to 53.
 */
function weekNumber(day: string): number {
  const thursday = addDays(day, 3 - DAYS_OF_WEEK.indexOf(weekdayOf(day)));

  return Math.floor(daysBetween(`${thursday.slice(0, 4)}-01-01`, thursday) / 7) + 1;
}

/** What the card needs. */
export type TodayCardProps = {
  readonly book: CalendarBook;

  /** Every occurrence from today to {@link LOOK_AHEAD_DAYS} on, switched off or not. */
  readonly occurrences: readonly CalendarOccurrence[];

  /** Called with an occurrence pressed. */
  readonly onOpen: (occurrence: CalendarOccurrence, anchor: HTMLElement) => void;

  /** Called with the first day of the long weekend pressed. */
  readonly onShowDay: (day: string) => void;
};

/**
 * Renders today.
 *
 * @param props - See {@link TodayCardProps}.
 * @returns The card.
 */
export function TodayCard(props: TodayCardProps) {
  const { t } = useTranslation();
  const { book, occurrences, onOpen, onShowDay } = props;
  const { today, now, zone } = book;
  const tomorrow = addDays(today, 1);
  const off = daysOffOf(occurrences, book);
  /**
   * Whether a day is a working day.
   *
   * @param day - The day.
   * @returns False on a weekend, a holiday or a day off.
   */
  const isWorking = (day: string): boolean =>
    isWorkingDay(day, book.weekendDays, off.holidays, off.dayOff);
  const shown = occurrences.filter((occurrence) => !book.hidden.has(occurrence.calendarId));

  const timed = shown
    .filter(
      (occurrence) =>
        !occurrence.isAllDay && occurrence.startsAt !== null && isOn(occurrence, today, zone),
    )
    .toSorted((left, right) => Date.parse(left.startsAt ?? '') - Date.parse(right.startsAt ?? ''));
  const left = timed.filter((occurrence) => Date.parse(occurrence.endsAt ?? '') > now).length;
  const next = timed.find((occurrence) => Date.parse(occurrence.startsAt ?? '') > now);
  const bins = shown.filter(
    (occurrence) => isPickup(occurrence, book) && isOn(occurrence, tomorrow, zone),
  );
  const weekend = longWeekendsOf(
    today,
    addDays(today, LOOK_AHEAD_DAYS),
    book.weekendDays,
    off.holidays,
  ).longWeekends.find((each) => each.to >= today);
  const isWorkingToday = isWorking(today);
  const isWorkingTomorrow = isWorking(tomorrow);

  return (
    <section
      aria-label={t('calendar.today.label', 'Today')}
      className="flex flex-col gap-3.5 rounded-panel border border-border bg-surface px-4.5 pt-4.5 pb-4 shadow-edge"
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-label text-primary uppercase">
          {t('calendar.today.label', 'Today')}
        </span>
        <span className="font-mono text-caption text-foreground-subtle">
          {clockText(new Date(now).toISOString(), zone)}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-display leading-none font-medium first-letter:uppercase">
          {weekdayWords(today)} {Number(today.slice(8, 10))}
        </span>
        <span className="text-ui text-foreground-muted first-letter:uppercase">
          {t('calendar.today.monthWeek', '{{month}} · week {{week}}', {
            month: dateTimeFormat({ month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
              Date.parse(`${today}T12:00:00Z`),
            ),
            week: weekNumber(today),
          })}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <span
          className={cn(
            'inline-flex h-6 items-center gap-1.5 rounded-pill border border-border-strong bg-foreground/4 px-2.5 text-caption font-medium',
            isWorkingToday ? 'text-success' : 'text-foreground-muted',
          )}
        >
          <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
          {isWorkingToday
            ? t('calendar.today.workingDay', 'Working day')
            : t('calendar.today.dayOff', 'Day off')}
        </span>
        <span className="inline-flex h-6 items-center rounded-pill bg-surface-raised px-2.5 text-caption text-foreground-muted">
          {isWorkingTomorrow === isWorkingToday
            ? t('calendar.today.tomorrowToo', 'Tomorrow too')
            : isWorkingTomorrow
              ? t('calendar.today.workingTomorrow', 'Working tomorrow')
              : t('calendar.today.offTomorrow', 'Day off tomorrow')}
        </span>
      </div>

      {timed.length === 0 ? null : (
        <div className="flex flex-col gap-0.5 border-t border-border pt-1">
          <div className="flex h-7.5 items-center justify-between">
            <span className="font-mono text-label text-foreground-subtle uppercase">
              {t('calendar.today.stillToday', 'Still today')}
            </span>
            <span className="font-mono text-label text-foreground-subtle">
              {t('calendar.today.left', {
                count: left,
                defaultValue_one: '{{count}} left',
                defaultValue_other: '{{count}} left',
              })}
            </span>
          </div>
          {timed.map((occurrence) => {
            const look = lookOf(occurrence, book);
            const isOver = Date.parse(occurrence.endsAt ?? '') <= now;

            return (
              <button
                key={occurrence.key}
                type="button"
                onClick={(event) => {
                  onOpen(occurrence, event.currentTarget);
                }}
                className={cn(
                  'flex h-7.5 cursor-pointer items-center gap-2.5 rounded-check text-left hover:bg-surface-high/60',
                  'focus-visible:shadow-focus focus-visible:outline-none',
                  isOver && 'opacity-50',
                  LANE_CLASSES[look.color],
                )}
              >
                <span
                  className={cn(
                    'min-w-10 shrink-0 font-mono text-caption whitespace-nowrap',
                    isOver ? 'text-foreground-subtle' : 'text-foreground-muted',
                  )}
                >
                  {clockText(occurrence.startsAt ?? '', zone)}
                </span>
                <span
                  aria-hidden="true"
                  className="h-4.5 w-0.75 shrink-0 rounded-full bg-[var(--lane)]"
                />
                <span className="min-w-0 grow truncate text-ui-sm">
                  {occurrence.title}{' '}
                  <span className="text-foreground-subtle">· {look.calendar?.name}</span>
                </span>
                {occurrence === next ? (
                  <span className="shrink-0 font-mono text-label whitespace-nowrap text-primary">
                    {untilWords(Date.parse(occurrence.startsAt ?? ''), now)}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      {bins.length === 0 ? null : (
        <div className="flex items-center gap-3 rounded-inner border border-border bg-well p-3">
          <span className="flex gap-1">
            {bins.map((occurrence) => {
              const look = lookOf(occurrence, book);

              return (
                <ModelToken
                  key={occurrence.key}
                  icon={look.icon}
                  color={look.tokenColor}
                  size={30}
                />
              );
            })}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-ui-sm font-medium">
              {t('calendar.today.outTonight', 'Out tonight')}
            </span>
            <span className="truncate text-caption text-foreground-subtle">
              {bins.map((occurrence) => occurrence.title).join(' · ')}
            </span>
          </span>
        </div>
      )}

      {weekend === undefined ? null : (
        <button
          type="button"
          onClick={() => {
            onShowDay(weekend.from);
          }}
          className={cn(
            'flex cursor-pointer items-center gap-3 rounded-inner border border-tag-red/22 bg-tag-red/7 p-3 text-left',
            'hover:bg-tag-red/10 focus-visible:shadow-focus focus-visible:outline-none',
          )}
        >
          <span className="flex size-7.5 shrink-0 items-center justify-center rounded-field bg-tag-red/14 text-tag-red">
            <AppIcon id="flag" size={15} />
          </span>
          <span className="flex min-w-0 grow flex-col gap-0.5">
            <span className="text-ui-sm font-medium">
              {t('calendar.today.longWeekend', {
                count: weekend.days,
                defaultValue_one: 'Long weekend · {{count}} day',
                defaultValue_other: 'Long weekend · {{count}} days',
              })}
            </span>
            <span className="truncate text-caption text-foreground-subtle">
              {[
                off.names.get(weekend.holidays[0] ?? ''),
                `${dayWords(weekend.from, 'brief')} – ${dayWords(weekend.to, 'brief')}`,
              ]
                .filter((part) => part !== undefined)
                .join(' · ')}
            </span>
          </span>
          <AppIcon id="chevron-right" size={14} className="shrink-0 text-foreground-subtle" />
        </button>
      )}
    </section>
  );
}
