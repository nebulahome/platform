/**
 * The year (CAL-Year): twelve months, three a row, each the kit's calendar drawn small and read
 * only - holidays filled red, the one day off that makes a long weekend ringed, events over days as
 * a band, a dot under a day with something on it. Beside them, the year's long weekends and the
 * holidays that fall on a weekend, and what the marks mean.
 */
import { useTranslation } from 'react-i18next';

import {
  addDays,
  DAYS_OF_WEEK,
  longWeekendsOf,
  weekdayOf,
  type CalendarOccurrence,
} from '@nebulahome/contracts';
import { AppIcon, Calendar, cn, type CalendarDayLook } from '@nebulahome/ui';

import { dateTimeFormat, listFormat } from '@/i18n/formatters';

import { isOn, lengthInDays, weekdayWords } from '../calendar-time';
import { LANE_CLASSES } from '../model-token';
import type { DaysOff } from '../today-card';
import { isPickup, lookOf, type CalendarBook } from '../use-calendars';

/** What the year needs. */
export type YearViewProps = {
  readonly book: CalendarBook;
  readonly day: string;

  /** The occurrences of the year, of the calendars on. */
  readonly occurrences: readonly CalendarOccurrence[];
  readonly daysOff: DaysOff;
};

/**
 * The instant of a day's noon, UTC, to format it from.
 *
 * @param day - The day.
 * @returns Milliseconds since the epoch.
 */
function noonOf(day: string): number {
  return Date.parse(`${day}T12:00:00Z`);
}

/**
 * Renders the year.
 *
 * @param props - See {@link YearViewProps}.
 * @returns The months and the long weekends.
 */
export function YearView(props: YearViewProps) {
  const { t } = useTranslation();
  const { book, day, occurrences, daysOff } = props;
  const year = day.slice(0, 4);
  const marks = longWeekendsOf(
    `${year}-01-01`,
    `${year}-12-31`,
    book.weekendDays,
    daysOff.holidays,
  );
  const bridges = new Set(
    marks.longWeekends.flatMap((weekend) => (weekend.bridge === null ? [] : [weekend.bridge])),
  );
  const events = occurrences.filter(
    (occurrence) =>
      occurrence.isAllDay && occurrence.kind !== 'holiday' && !isPickup(occurrence, book),
  );

  /**
   * What a day of the year is marked with.
   *
   * @param each - The day.
   * @returns Its look.
   */
  const lookOfDay = (each: string): CalendarDayLook => {
    const holiday = daysOff.names.get(each);
    const on = events.filter((occurrence) => isOn(occurrence, each, book.zone));
    const long = on.find((occurrence) => lengthInDays(occurrence, book.zone) > 1);
    const short = on.find((occurrence) => lengthInDays(occurrence, book.zone) === 1);

    return {
      tone:
        holiday === undefined
          ? book.weekendDays.includes(DAYS_OF_WEEK.indexOf(weekdayOf(each)))
            ? 'weekend'
            : undefined
          : 'holiday',
      mark: bridges.has(each) ? 'ring' : undefined,
      band:
        long === undefined
          ? undefined
          : cn(
              'bg-[color-mix(in_srgb,var(--lane)_16%,transparent)]',
              LANE_CLASSES[lookOf(long, book).color],
            ),
      dot:
        short === undefined
          ? undefined
          : cn('bg-[var(--lane)]', LANE_CLASSES[lookOf(short, book).color]),
      note: holiday ?? long?.title ?? short?.title,
    };
  };

  /**
   * Writes a run of days: "4 – 8 December", or "30 Oct – 1 Nov" across two months.
   *
   * @param from - The first day.
   * @param to - The last day.
   * @returns The run.
   */
  const rangeWords = (from: string, to: string): string =>
    dateTimeFormat({
      day: 'numeric',
      month: from.slice(5, 7) === to.slice(5, 7) ? 'long' : 'short',
      timeZone: 'UTC',
    }).formatRange(noonOf(from), noonOf(to));

  return (
    <div className="flex min-w-0 grow items-start gap-5">
      <div className="grid min-w-0 grow grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from(
          { length: 12 },
          (unused, index) => `${year}-${String(index + 1).padStart(2, '0')}`,
        ).map((month) => (
          <div
            key={month}
            className="rounded-card border border-border bg-surface px-3 pt-3.5 pb-2.5"
          >
            <Calendar
              key={month}
              size="mini"
              isReadOnly
              month={month}
              value={null}
              onChange={() => undefined}
              renderDay={lookOfDay}
            />
          </div>
        ))}
      </div>

      <aside className="hidden w-70 shrink-0 flex-col gap-4 lg:flex">
        <section className="flex flex-col gap-3 rounded-panel border border-border bg-surface p-4.5">
          <div className="flex flex-col gap-1">
            <span className="text-title font-medium">
              {t('calendar.year.longWeekends', 'Long weekends')}
            </span>
            <span className="text-caption text-foreground-subtle">
              {t('calendar.year.fromHolidays', 'From the house’s holidays and days off.')}
            </span>
          </div>

          {marks.longWeekends.map((weekend) => {
            const isBridged = weekend.bridge !== null;
            // Every holiday in it, the ones on its weekend too: Easter with Easter Monday.
            const names = [
              ...new Set(
                Array.from({ length: weekend.days }, (unused, index) =>
                  daysOff.names.get(addDays(weekend.from, index)),
                ),
              ),
            ].filter((name) => name !== undefined);

            return (
              <div
                key={weekend.from}
                className={cn(
                  'flex flex-col gap-1.5 rounded-inner border px-4 py-3.5',
                  isBridged ? 'border-tag-red/30 bg-tag-red/7' : 'border-border bg-well',
                )}
              >
                <div className="flex items-baseline justify-between gap-2.5">
                  <span className="text-title font-medium whitespace-nowrap">
                    {rangeWords(weekend.from, weekend.to)}
                  </span>
                  <span
                    className={cn(
                      'font-mono text-caption',
                      isBridged ? 'text-tag-red' : 'text-foreground-muted',
                    )}
                  >
                    {t('calendar.year.days', {
                      count: weekend.days,
                      defaultValue_one: '{{count}} day',
                      defaultValue_other: '{{count}} days',
                    })}
                  </span>
                </div>
                <span className="text-ui-sm text-foreground-muted">
                  {listFormat({ type: 'conjunction' }).format(names)}
                </span>
                {weekend.bridge === null ? null : (
                  <span className="flex items-center gap-1.5 text-caption text-tag-red">
                    <AppIcon id="briefcase" size={13} />
                    {t('calendar.year.withDayOff', 'with one day off: {{day}}', {
                      day: `${weekdayWords(weekend.bridge)} ${String(Number(weekend.bridge.slice(8)))}`,
                    })}
                  </span>
                )}
              </div>
            );
          })}

          {marks.weekendHolidays.length === 0 ? null : (
            <div className="flex flex-col gap-2 pt-1.5">
              <span className="text-ui-sm text-foreground-muted">
                {t('calendar.year.onWeekend', 'On a weekend')}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {marks.weekendHolidays.map((each) => (
                  <span
                    key={each}
                    title={daysOff.names.get(each)}
                    className="inline-flex h-6.5 items-center rounded-pill bg-surface-raised px-2.5 font-mono text-caption whitespace-nowrap text-foreground-muted"
                  >
                    {`${dateTimeFormat({ day: 'numeric', month: 'short', timeZone: 'UTC' }).format(noonOf(each))} · ${weekdayWords(each, 'short')}`}
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-2.5 rounded-panel border border-border bg-surface px-4.5 py-4">
          <span className="flex items-center gap-2.5 text-caption text-foreground-muted">
            <span className="inline-flex size-5.5 items-center justify-center rounded-full bg-tag-red/18 text-label font-semibold text-tag-red">
              7
            </span>
            {t('calendar.year.legendHoliday', 'Holiday: a day off')}
          </span>
          <span className="flex items-center gap-2.5 text-caption text-foreground-muted">
            <span className="inline-flex size-5.5 items-center justify-center rounded-full text-label ring-2 ring-tag-red/60 ring-inset">
              6
            </span>
            {t('calendar.year.legendBridge', 'One day off makes a long weekend')}
          </span>
          <span className="flex items-center gap-2.5 text-caption text-foreground-muted">
            <span className="h-3.5 w-5.5 rounded-check bg-primary/20" />
            {t('calendar.year.legendBand', 'Several days of one event')}
          </span>
          <span className="flex items-center gap-2.5 text-caption text-foreground-muted">
            <span className="flex w-5.5 justify-center">
              <span className="size-1.25 rounded-full bg-primary" />
            </span>
            {t('calendar.year.legendDot', 'Something on that day')}
          </span>
        </section>
      </aside>
    </div>
  );
}
