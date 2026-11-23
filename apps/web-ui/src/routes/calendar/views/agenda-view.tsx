/**
 * The agenda (CAL-Agenda): a week of days from the one the page is on, each a list - what runs all
 * day, the pickups, the timed events by start - with its holiday or "day off" over it. Today adds
 * the bins to put out tonight and how long until what is next.
 *
 * One day of it is also what the narrow month lists under its days.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
  addDays,
  daysBetween,
  DAYS_OF_WEEK,
  weekdayOf,
  type CalendarOccurrence,
} from '@nebulahome/contracts';
import { AppIcon, Button, CatalogueIcon, cn } from '@nebulahome/ui';

import {
  clockText,
  firstDayOf,
  isOn,
  lastDayOf,
  lengthInDays,
  monthShort,
  rangeOf,
  timesText,
  untilWords,
  weekdayWords,
} from '../calendar-time';
import { SourceMark } from '../event-chip';
import { LANE_CLASSES, ModelToken } from '../model-token';
import type { DaysOff } from '../today-card';
import { isPickup, lookOf, type CalendarBook } from '../use-calendars';

/** What a day of the agenda needs. */
export type AgendaDayProps = {
  readonly book: CalendarBook;
  readonly day: string;

  /** The occurrences shown around it: the ones on it are picked out. */
  readonly occurrences: readonly CalendarOccurrence[];
  readonly daysOff: DaysOff;
  readonly onOpen: (occurrence: CalendarOccurrence, anchor: HTMLElement) => void;
  readonly onOpenPickups: (day: string, anchor: HTMLElement) => void;

  /** Whether the day's number is left out: the narrow month and the day's popover show it above. */
  readonly isBare?: boolean;

  /** Whether it is drawn narrow, in the day's popover: start times only, nothing at the end. */
  readonly isCompact?: boolean;
};

/**
 * One row of a day: a time, a bar or tokens, a title and what it is.
 *
 * @param props - The row's parts.
 * @param props.time - The time column.
 * @param props.timeTone - The time's colour.
 * @param props.mark - The bar or the tokens.
 * @param props.title - The title line.
 * @param props.sub - The line under it.
 * @param props.trail - What sits at the end.
 * @param props.isDim - Whether it is over.
 * @param props.isCompact - Whether it is drawn narrow.
 * @param props.onPress - Called with the row pressed.
 * @returns The row.
 */
function Row(props: {
  readonly time: string;
  readonly timeTone?: string | undefined;
  readonly mark: ReactNode;
  readonly title: ReactNode;
  readonly sub: ReactNode;
  readonly trail?: ReactNode;
  readonly isDim?: boolean;
  readonly isCompact?: boolean;
  readonly onPress: (anchor: HTMLElement) => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        props.onPress(event.currentTarget);
      }}
      className={cn(
        'flex w-full cursor-pointer items-center border-t border-border text-left first:border-t-0',
        props.isCompact ? 'min-h-12 gap-3 px-4 py-1' : 'min-h-13 gap-4 py-1.5',
        'hover:bg-surface-raised/40 focus-visible:shadow-focus focus-visible:outline-none',
        props.isDim && 'opacity-50',
      )}
    >
      <span
        className={cn(
          'shrink-0 font-mono text-caption',
          props.isCompact ? 'w-13' : 'w-29',
          props.timeTone ?? 'text-foreground-muted',
        )}
      >
        {props.time}
      </span>
      {props.mark}
      <span className="flex min-w-0 grow flex-col gap-0.5">
        <span className="flex items-center gap-1.75 truncate text-ui font-medium">
          {props.title}
        </span>
        <span className="flex items-center gap-1.5 truncate text-caption text-foreground-subtle">
          {props.sub}
        </span>
      </span>
      {props.isCompact ? null : props.trail}
    </button>
  );
}

/**
 * Renders one day of the agenda.
 *
 * @param props - See {@link AgendaDayProps}.
 * @returns The day.
 */
export function AgendaDay(props: AgendaDayProps) {
  const { t } = useTranslation();
  const { book, day, occurrences, daysOff, onOpen, onOpenPickups } = props;
  const { isBare = false, isCompact = false } = props;
  const { zone, today, now } = book;
  const isToday = day === today;
  const holiday = daysOff.names.get(day);
  const isWeekend = book.weekendDays.includes(DAYS_OF_WEEK.indexOf(weekdayOf(day)));
  const on = occurrences.filter(
    (occurrence) => occurrence.kind !== 'holiday' && isOn(occurrence, day, zone),
  );
  const allDay = on.filter((occurrence) => occurrence.isAllDay && !isPickup(occurrence, book));
  const bins = on.filter((occurrence) => isPickup(occurrence, book));
  const timed = on.filter((occurrence) => !occurrence.isAllDay);
  const next = isToday
    ? timed.find((occurrence) => Date.parse(occurrence.startsAt ?? '') > now)
    : undefined;
  const tonight = isToday
    ? occurrences.filter(
        (occurrence) => isPickup(occurrence, book) && isOn(occurrence, addDays(day, 1), zone),
      )
    : [];
  const relative = isToday
    ? t('calendar.agenda.today', 'Today')
    : day === addDays(today, 1)
      ? t('calendar.agenda.tomorrow', 'Tomorrow')
      : null;

  /**
   * The bar of a row, in its calendar's colour.
   *
   * @param occurrence - The occurrence.
   * @returns The bar.
   */
  const bar = (occurrence: CalendarOccurrence) => (
    <span
      aria-hidden="true"
      className={cn(
        'h-7.5 w-1 shrink-0 rounded-full bg-[var(--lane)]',
        LANE_CLASSES[lookOf(occurrence, book).color],
      )}
    />
  );

  /**
   * The title of a row, with its own icon.
   *
   * @param occurrence - The occurrence.
   * @returns The title.
   */
  const title = (occurrence: CalendarOccurrence) => {
    const look = lookOf(occurrence, book);

    return (
      <>
        {look.icon === undefined ? null : (
          <CatalogueIcon
            node={look.icon.node}
            frame={look.icon.frame}
            size={14}
            className={cn('shrink-0 text-[var(--lane)]', LANE_CLASSES[look.tokenColor])}
          />
        )}
        <span className="truncate">{occurrence.title}</span>
      </>
    );
  };

  /**
   * The tokens of some pickups.
   *
   * @param list - The pickups.
   * @returns The tokens.
   */
  const tokens = (list: readonly CalendarOccurrence[]) => (
    <span className="flex shrink-0 gap-1.5">
      {list.map((occurrence) => {
        const look = lookOf(occurrence, book);

        return (
          <ModelToken key={occurrence.key} icon={look.icon} color={look.tokenColor} size={28} />
        );
      })}
    </span>
  );

  const waste = book.calendars.find((calendar) => calendar.kind === 'waste')?.name ?? '';
  const rows = [
    ...allDay.map((occurrence) => {
      const look = lookOf(occurrence, book);
      const total = lengthInDays(occurrence, zone);

      return (
        <Row
          isCompact={isCompact}
          key={occurrence.key}
          time={t('calendar.agenda.allDay', 'all day')}
          mark={bar(occurrence)}
          title={title(occurrence)}
          sub={
            <>
              <SourceMark occurrence={occurrence} size={12} hasRepeat />
              <span className="truncate">
                {total > 1
                  ? t('calendar.agenda.dayOf', '{{calendar}} · day {{day}} of {{count}}', {
                      calendar: look.calendar?.name ?? '',
                      day: daysBetween(firstDayOf(occurrence, zone), day) + 1,
                      count: total,
                    })
                  : look.calendar?.name}
              </span>
            </>
          }
          onPress={(anchor) => {
            onOpen(occurrence, anchor);
          }}
        />
      );
    }),
    bins.length === 0 ? null : (
      <Row
        isCompact={isCompact}
        key="pickup"
        time={t('calendar.agenda.pickup', 'pickup')}
        timeTone="text-foreground-subtle"
        mark={tokens(bins)}
        title={bins.map((occurrence) => occurrence.title).join(' · ')}
        sub={t('calendar.agenda.collectedMorning', '{{calendar}} · collected in the morning', {
          calendar: waste,
        })}
        isDim={day < today || isToday}
        onPress={(anchor) => {
          onOpenPickups(day, anchor);
        }}
      />
    ),
    ...timed.map((occurrence) => {
      const look = lookOf(occurrence, book);
      const isNext = occurrence === next;
      const start = firstDayOf(occurrence, zone);
      const end = lastDayOf(occurrence, zone);

      return (
        <Row
          isCompact={isCompact}
          key={occurrence.key}
          time={
            start !== end
              ? t('calendar.agenda.allDay', 'all day')
              : isCompact
                ? clockText(occurrence.startsAt ?? '', zone)
                : timesText(occurrence, zone)
          }
          timeTone={isNext ? 'text-primary' : undefined}
          mark={bar(occurrence)}
          title={title(occurrence)}
          sub={
            <>
              <SourceMark occurrence={occurrence} size={12} hasRepeat />
              <span className="truncate">{look.calendar?.name}</span>
            </>
          }
          isDim={Date.parse(occurrence.endsAt ?? '') < now}
          trail={
            <>
              {isNext ? (
                <span className="inline-flex h-6.5 shrink-0 items-center rounded-pill bg-primary/14 px-2.5 font-mono text-caption whitespace-nowrap text-primary">
                  {untilWords(Date.parse(occurrence.startsAt ?? ''), now)}
                </span>
              ) : null}
              {look.calendar?.kind === 'personal' ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    'inline-flex size-6.5 shrink-0 items-center justify-center rounded-full border-2 border-[var(--lane)] text-label font-bold text-[var(--lane)]',
                    LANE_CLASSES[look.color],
                  )}
                >
                  {look.calendar.name.slice(0, 1).toUpperCase()}
                </span>
              ) : null}
            </>
          }
          onPress={(anchor) => {
            onOpen(occurrence, anchor);
          }}
        />
      );
    }),
    tonight.length === 0 ? null : (
      <Row
        isCompact={isCompact}
        key="tonight"
        time={t('calendar.agenda.tonight', 'tonight')}
        timeTone="text-success"
        mark={tokens(tonight)}
        title={tonight.map((occurrence) => occurrence.title).join(' · ')}
        sub={t('calendar.agenda.putOutTonight', 'Put out tonight · collected tomorrow morning')}
        onPress={(anchor) => {
          onOpenPickups(addDays(day, 1), anchor);
        }}
      />
    ),
  ].filter((row) => row !== null);

  const band =
    holiday === undefined ? (
      isWeekend || daysOff.dayOff.has(day) ? (
        <span className="text-caption text-foreground-subtle">
          {t('calendar.agenda.dayOff', 'day off')}
        </span>
      ) : null
    ) : (
      <span className="inline-flex h-6 items-center gap-1.5 rounded-pill bg-tag-red/12 px-2.5 text-caption font-medium whitespace-nowrap text-tag-red">
        <AppIcon id="flag" size={12} />
        {t('calendar.agenda.holidayDayOff', '{{name}} · day off', { name: holiday })}
      </span>
    );

  return (
    <div
      className={cn(
        'grid gap-5',
        isBare
          ? 'grid-cols-1'
          : 'grid-cols-[112px_minmax(0,1fr)] border-t border-border pt-4.5 pb-2.5 first:border-t-0',
      )}
    >
      {isBare ? null : (
        <div className="flex flex-col gap-0.5 pt-0.5">
          <span className="flex items-baseline gap-2">
            <span
              className={cn(
                'text-display leading-none font-medium tabular',
                isToday
                  ? 'text-primary'
                  : holiday === undefined
                    ? 'text-foreground'
                    : 'text-tag-red',
              )}
            >
              {Number(day.slice(8))}
            </span>
            <span className="font-mono text-label text-foreground-subtle uppercase">
              {monthShort(day)}
            </span>
          </span>
          <span
            className={cn(
              'text-ui-sm first-letter:uppercase',
              isToday ? 'font-medium text-foreground' : 'text-foreground-muted',
            )}
          >
            {relative === null ? weekdayWords(day) : `${relative} · ${weekdayWords(day)}`}
          </span>
        </div>
      )}
      <div className="flex min-w-0 flex-col">
        {band === null ? null : <div className="flex min-h-8 items-center pb-2">{band}</div>}
        <div className={cn('flex flex-col', band !== null && '[&>*:first-child]:border-t')}>
          {rows}
        </div>
        {rows.length === 0 ? (
          <span className="py-1.5 text-ui-sm text-foreground-subtle">
            {t('calendar.agenda.nothing', 'Nothing planned')}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** What the agenda needs. */
export type AgendaViewProps = Omit<AgendaDayProps, 'day' | 'isBare'> & {
  readonly day: string;

  /** Whether the reader may add an event: the empty agenda then offers one. */
  readonly canAdd: boolean;
  readonly onNewEvent: () => void;
  readonly onShowAll: () => void;
};

/**
 * Renders the agenda.
 *
 * @param props - See {@link AgendaViewProps}.
 * @returns The days.
 */
export function AgendaView(props: AgendaViewProps) {
  const { t } = useTranslation();
  const { book, day, occurrences } = props;
  const range = rangeOf('agenda', day);
  const days = Array.from({ length: daysBetween(range.from, range.to) + 1 }, (unused, index) =>
    addDays(range.from, index),
  );
  const offCount = book.hidden.size;
  const isEmpty = !occurrences.some((occurrence) => occurrence.kind !== 'holiday');

  return (
    <section
      aria-label={t('calendar.views.agenda', 'Agenda')}
      className="min-w-0 grow rounded-panel border border-border bg-surface px-6 pb-2"
    >
      {isEmpty ? (
        <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
          <span className="flex size-12 items-center justify-center rounded-inner bg-surface-raised text-foreground-muted">
            <AppIcon id="calendar-check" size={22} />
          </span>
          <span className="text-subhead font-medium">
            {t('calendar.agenda.nothingUntil', 'Nothing until {{day}}', {
              day: weekdayWords(range.to),
            })}
          </span>
          {offCount === 0 ? null : (
            <span className="text-ui-sm text-foreground-subtle">
              {t('calendar.agenda.offCount', {
                count: offCount,
                defaultValue_one: '{{count}} calendar is off:',
                defaultValue_other: '{{count}} calendars are off:',
              })}{' '}
              <button
                type="button"
                onClick={props.onShowAll}
                className="cursor-pointer text-primary hover:text-primary-hover"
              >
                {t('calendar.agenda.showAll', 'show all')}
              </button>
            </span>
          )}
          {props.canAdd ? (
            <Button size="compact" onClick={props.onNewEvent}>
              <AppIcon id="plus" size={14} />
              {t('calendar.page.newEvent', 'New event')}
            </Button>
          ) : null}
        </div>
      ) : (
        days.map((each) => <AgendaDay key={each} {...props} day={each} />)
      )}
    </section>
  );
}
