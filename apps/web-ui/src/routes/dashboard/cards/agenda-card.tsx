/**
 * The coming events of some calendars, by day (CAL-Cards, Agenda), read only: a column of the next
 * few at 1×2, today beside tomorrow at 2×2, the next days under their headings at 2×3. Each event
 * is its time and a bar of its calendar's colour; the day's pickups of a calendar with models are
 * one row of their tokens. A row opens the calendar.
 */
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { CalendarOccurrence, DashboardAgendaCard } from '@nebulahome/contracts';
import { AppIcon, cn, TAG_FILL_CLASSES } from '@nebulahome/ui';

import { kindName } from '@/dashboard/card-options';
import { dateTimeFormat } from '@/i18n/formatters';
import { daysOf, startOf, endOf, timesOf, untilStart } from '@/library/calendar-words';
import { clockOf, formatClock, wallOf } from '@/library/time-values';
import { ModelToken } from '@/routes/calendar/model-token';
import { useCardCalendars } from '@/routes/dashboard/cards/calendar-data';
import { Caption } from '@/routes/dashboard/cards/card-kit';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import { useCatalogueIcons } from '@/routes/library/device-icon';

/** What the card needs. */
export type AgendaCardProps = {
  /** The card as the layout stores it. */
  readonly card: DashboardAgendaCard;
};

/** One row: an event, or the day's pickups of one calendar together. */
type Row = {
  readonly key: string;
  readonly day: string;
  readonly start: number;
  readonly events: readonly CalendarOccurrence[];
};

/** How many days ahead the card reads. */
const AHEAD_DAYS = 7;

/**
 * A day as an instant at noon, for a formatter told the zone is UTC.
 *
 * @param day - `YYYY-MM-DD`.
 * @returns Milliseconds.
 */
function noon(day: string): number {
  return Date.parse(`${day}T12:00:00Z`);
}

/**
 * Renders the agenda.
 *
 * @param props - See {@link AgendaCardProps}.
 * @returns The card.
 */
export function AgendaCard(props: AgendaCardProps) {
  const { t } = useTranslation();
  const { card } = props;
  const { calendars, occurrences, zone, now } = useCardCalendars(AHEAD_DAYS);
  const byId = new Map(calendars.map((calendar) => [calendar.id, calendar]));
  const models = new Map(
    calendars.flatMap((calendar) => calendar.models.map((model) => [model.id, model] as const)),
  );
  const icons = useCatalogueIcons([...models.values()].map((model) => model.icon));
  const picked = new Set(card.calendarIds);
  const today = wallOf(now, zone).day;
  const tomorrow = new Date(noon(today) + 86_400_000).toISOString().slice(0, 10);
  const isWide = card.w >= 2;
  const isLarge = card.h >= 3;
  const title = card.title ?? kindName('agenda');

  // The coming events, a day's pickups of one calendar as one row.
  const rows: Row[] = [];

  for (const occurrence of [...(occurrences ?? [])]
    .filter(
      (one) =>
        (picked.size === 0 || picked.has(one.calendarId)) &&
        one.kind !== 'holiday' &&
        endOf(one, zone) > now,
    )
    .sort((a, b) => startOf(a, zone) - startOf(b, zone))) {
    const day = startOf(occurrence, zone) <= now ? today : daysOf(occurrence, zone).first;
    const isPickup = occurrence.isAllDay && occurrence.modelId !== null;
    const same = isPickup
      ? rows.find(
          (row) =>
            row.day === day &&
            row.events[0]?.calendarId === occurrence.calendarId &&
            row.events[0].isAllDay &&
            row.events[0].modelId !== null,
        )
      : undefined;

    if (same === undefined) {
      rows.push({
        key: occurrence.key,
        day,
        start: startOf(occurrence, zone),
        events: [occurrence],
      });
    } else {
      rows[rows.indexOf(same)] = { ...same, events: [...same.events, occurrence] };
    }
  }

  /**
   * What a row says at its left: "on now", a time, "tonight" for tomorrow's pickups, a weekday.
   *
   * @param row - The row.
   * @param isUnderDay - Whether the row sits under its day's heading, so the day is not said.
   * @returns The words, and whether they are the green of something on now or tonight.
   */
  const timeOf = (row: Row, isUnderDay: boolean): { text: string; isLit: boolean } => {
    const [first] = row.events;

    if (first === undefined) {
      return { text: '', isLit: false };
    }

    if (row.start <= now) {
      return { text: t('dashboard.cards.agendaCard.onNow', 'on now'), isLit: true };
    }

    if (first.isAllDay) {
      return first.modelId !== null &&
        row.day === tomorrow &&
        byId.get(first.calendarId)?.kind === 'waste'
        ? { text: t('dashboard.cards.agendaCard.tonight', 'tonight'), isLit: true }
        : row.day === today || isUnderDay
          ? { text: t('dashboard.cards.agendaCard.allDay', 'all day'), isLit: false }
          : {
              text: dateTimeFormat({ weekday: 'short', timeZone: 'UTC' }).format(noon(row.day)),
              isLit: false,
            };
    }

    return row.day === today || isUnderDay
      ? { text: formatClock(clockOf(wallOf(row.start, zone).seconds, false)), isLit: false }
      : {
          text: dateTimeFormat({ weekday: 'short', timeZone: 'UTC' }).format(noon(row.day)),
          isLit: false,
        };
  };

  /**
   * Draws a row.
   *
   * @param row - The row.
   * @param isUnderDay - Whether it sits under its day's heading.
   * @returns The row.
   */
  const line = (row: Row, isUnderDay: boolean) => {
    const [first] = row.events;
    const calendar = first === undefined ? undefined : byId.get(first.calendarId);
    const time = timeOf(row, isUnderDay);
    const isPickup = first !== undefined && first.isAllDay && first.modelId !== null;
    const until = first === undefined || row.start <= now ? null : untilStart(first, now, zone);

    return (
      <li key={row.key}>
        <Link
          to="/calendar"
          className="flex h-6.5 min-w-0 items-center gap-2.5 rounded-chip transition-colors duration-150 hover:bg-foreground/[0.03]"
        >
          <span
            className={cn(
              'w-16 shrink-0 font-mono text-label whitespace-nowrap tabular-nums',
              time.isLit ? 'text-success' : 'text-foreground-subtle',
            )}
          >
            {time.text}
          </span>
          {isPickup ? (
            <span className="flex shrink-0 gap-0.5">
              {row.events.map((event) => {
                const model = event.modelId === null ? undefined : models.get(event.modelId);

                return model === undefined ? null : (
                  <ModelToken
                    key={event.key}
                    icon={icons.get(model.icon)}
                    color={model.color}
                    size={18}
                  />
                );
              })}
            </span>
          ) : (
            <span
              aria-hidden="true"
              className={cn(
                'h-4 w-0.75 shrink-0 rounded-full',
                calendar === undefined ? 'bg-foreground-subtle' : TAG_FILL_CLASSES[calendar.color],
              )}
            />
          )}
          <span className="min-w-0 grow truncate text-ui-sm text-foreground">
            {row.events
              .map((event) =>
                isPickup ? (models.get(event.modelId ?? '')?.name ?? event.title) : event.title,
              )
              .join(' · ')}
            {isLarge && !isPickup && calendar?.kind === 'personal' ? (
              <span className="text-foreground-subtle"> · {calendar.name}</span>
            ) : null}
            {isLarge && first !== undefined && row.start <= now && first.isAllDay ? (
              <span className="text-foreground-subtle">
                {' · '}
                {t('dashboard.cards.agendaCard.until', 'until {{day}}', {
                  day: dateTimeFormat({ weekday: 'long', timeZone: 'UTC' }).format(
                    noon(daysOf(first, zone).last),
                  ),
                })}
              </span>
            ) : null}
            {!isLarge && first !== undefined && !first.isAllDay && row.start <= now ? (
              <span className="text-foreground-subtle"> · {timesOf(first, zone)}</span>
            ) : null}
          </span>
          {until === null || row.day !== today ? null : (
            <span className="shrink-0 rounded-pill bg-primary/14 px-2 py-0.5 font-mono text-label text-primary">
              {isLarge
                ? t('dashboard.cards.agendaCard.inTime', 'in {{time}}', { time: until })
                : until}
            </span>
          )}
        </Link>
      </li>
    );
  };

  const where =
    picked.size === 0
      ? t('dashboard.cards.agendaCard.everyCalendar', 'Every calendar')
      : calendars
          .filter((calendar) => picked.has(calendar.id))
          .map((calendar) => calendar.name)
          .join(', ');
  const days = [...new Set(rows.map((row) => row.day))];

  /**
   * A day's heading under the large card: "Today", "Tomorrow · Friday", "Saturday 5".
   *
   * @param day - The day.
   * @returns The heading.
   */
  const heading = (day: string): string =>
    day === today
      ? t('dashboard.cards.agendaCard.today', 'Today')
      : day === tomorrow
        ? `${t('dashboard.cards.agendaCard.tomorrow', 'Tomorrow')} · ${dateTimeFormat({ weekday: 'long', timeZone: 'UTC' }).format(noon(day))}`
        : dateTimeFormat({ weekday: 'long', day: 'numeric', timeZone: 'UTC' }).format(noon(day));

  return (
    <CardFrame label={title}>
      <div className="flex h-8 shrink-0 items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-field bg-primary/14 text-primary"
        >
          <AppIcon id="calendar" size={16} />
        </span>
        <span className="flex min-w-0 grow flex-col">
          <span className="truncate text-ui leading-[18px] font-medium">{title}</span>
          <span className="truncate text-caption leading-4 text-foreground-subtle">{where}</span>
        </span>
        <Caption className="font-mono text-foreground-subtle">
          {isWide
            ? dateTimeFormat({
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                timeZone: 'UTC',
              }).format(noon(today))
            : dateTimeFormat({ weekday: 'short', day: 'numeric', timeZone: 'UTC' }).format(
                noon(today),
              )}
        </Caption>
      </div>

      {occurrences === undefined ? (
        <div className="mt-3 flex flex-col gap-2.5" aria-hidden="true">
          {Array.from({ length: 4 }, (unused, index) => (
            <span key={index} className="h-4 animate-pulse rounded-chip bg-surface-raised" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex grow items-center justify-center text-caption text-foreground-subtle">
          {t('dashboard.cards.agendaCard.nothing', 'Nothing planned')}
        </div>
      ) : isWide && !isLarge ? (
        <div className="mt-3 grid min-h-0 grid-cols-2 gap-5">
          {[today, tomorrow].map((day) => (
            <div key={day} className="flex min-w-0 flex-col gap-0.5">
              <span className="font-mono text-label text-foreground-subtle uppercase">
                {day === today
                  ? t('dashboard.cards.agendaCard.today', 'Today')
                  : t('dashboard.cards.agendaCard.tomorrow', 'Tomorrow')}
              </span>
              <ul className="flex flex-col">
                {rows
                  .filter((row) => row.day === day)
                  .slice(0, 3)
                  .map((row) => line(row, true))}
              </ul>
            </div>
          ))}
        </div>
      ) : isLarge ? (
        <div className="mt-3 flex min-h-0 flex-col gap-2 overflow-hidden">
          {days.slice(0, 4).map((day) => (
            <div key={day} className="flex flex-col gap-0.5">
              <span className="font-mono text-label text-foreground-subtle uppercase">
                {heading(day)}
              </span>
              <ul className="flex flex-col">
                {rows
                  .filter((row) => row.day === day)
                  .slice(0, 3)
                  .map((row) => line(row, true))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <ul className="mt-3 flex min-h-0 flex-col">
          {rows.slice(0, 4).map((row) => line(row, false))}
        </ul>
      )}
    </CardFrame>
  );
}
