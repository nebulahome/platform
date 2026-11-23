/**
 * A calendar of the house, read only (CAL-Entity): what is on now - with a bar of its days when it
 * runs over several - or what comes next and how soon, then the few events after it, and the way
 * to the page already showing that calendar. Nothing planned is one line; a source that stopped
 * answering is a warning on top, the events under it greyed.
 *
 * The entity tells only the event on now and the next; the ones after are read from the
 * calendar's occurrences.
 */
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import type { CalendarOccurrence } from '@nebulahome/contracts';
import { AppIcon, Button, cn, Note } from '@nebulahome/ui';

import {
  dayOfEvent,
  shortWhen,
  startOf,
  untilStart,
  whenLine,
  type EventTimes,
} from '@/library/calendar-words';
import { paramsOf } from '@/library/entity-control';
import { durationText } from '@/library/history-stats';
import { CALENDAR_QUERY_KEYS, fetchOccurrences } from '@/routes/calendar/api';
import { ModelToken } from '@/routes/calendar/model-token';
import { useCalendarBook } from '@/routes/calendar/use-calendars';
import { MonoLabel } from '@/routes/library/entity/sheet/parts/sheet-parts';
import type { SheetBodyProps } from '@/routes/library/entity/sheet/sheet-types';

/** How far ahead the events after the next are looked for. */
const AHEAD_DAYS = 60;

/** How many events after the next are listed. */
const THEN_COUNT = 4;

/** An event as the body draws it: its times, its title, and its model. */
type Shown = EventTimes & { readonly title: string; readonly modelId: string | null };

/**
 * A day some days after another.
 *
 * @param day - `YYYY-MM-DD`.
 * @param days - How many.
 * @returns `YYYY-MM-DD`.
 */
function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Renders the body.
 *
 * @param props - See {@link SheetBodyProps}.
 * @returns The body.
 */
export function CalendarBody(props: SheetBodyProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { entity, state, now } = props;
  const calendarId = paramsOf(entity, 'calendar')?.calendarId ?? null;
  const told = state.calendar;
  const { book } = useCalendarBook([told?.current?.icon ?? null, told?.next?.icon ?? null]);
  const calendar = calendarId === null ? undefined : book.byId.get(calendarId);
  const zone = book.zone;
  const today = book.today;
  const isStale = told?.isStale === true;

  const ahead = useQuery({
    queryKey: [...CALENDAR_QUERY_KEYS.occurrences, today, addDays(today, AHEAD_DAYS)],
    /**
     * Reads the calendar's coming times.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the read.
     * @returns The occurrences.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) =>
      fetchOccurrences(today, addDays(today, AHEAD_DAYS), signal),
    enabled: calendarId !== null,
  });

  const current: Shown | null = told?.current ?? null;
  const next: Shown | null = told?.next ?? null;
  const lead = current ?? next;

  /**
   * Whether an occurrence is the event the entity already tells.
   *
   * @param occurrence - The occurrence.
   * @returns True for the one on now or the next.
   */
  const isTold = (occurrence: CalendarOccurrence): boolean =>
    [current, next].some(
      (event) =>
        event !== null &&
        event.title === occurrence.title &&
        startOf(event, zone) === startOf(occurrence, zone),
    );
  const then = [...(ahead.data ?? [])]
    .filter(
      (occurrence) =>
        occurrence.calendarId === calendarId &&
        startOf(occurrence, zone) > now &&
        !isTold(occurrence),
    )
    .sort((a, b) => startOf(a, zone) - startOf(b, zone))
    .slice(0, THEN_COUNT);

  /**
   * The token of an event's model, when it has one.
   *
   * @param event - The event.
   * @param size - The token's side.
   * @returns The token, or nothing.
   */
  const token = (event: Shown, size: 20 | 34) => {
    const model = event.modelId === null ? undefined : book.models.get(event.modelId);

    return model === undefined ? null : (
      <ModelToken icon={book.icons.get(model.icon)} color={model.color} size={size} />
    );
  };
  const lastRead = calendar?.icsState?.lastSuccessAt ?? null;
  const days = current === null ? null : dayOfEvent(current, now, zone);
  const until = next === null || current !== null ? null : untilStart(next, now, zone);
  // A pickup the morning after goes out the evening before: the board's "out tonight".
  const isOutTonight =
    current === null &&
    next !== null &&
    next.isAllDay &&
    calendar?.kind === 'waste' &&
    next.startsOn === addDays(today, 1);

  return (
    <div className="flex grow flex-col gap-4.5 pt-1">
      {isStale ? (
        <Note tone="warning">
          {lastRead === null
            ? t('entity.sheet.calendar.staleNever', 'Not updated: the URL doesn’t answer.')
            : t(
                'entity.sheet.calendar.stale',
                'Not updated for {{time}}: the URL doesn’t answer.',
                {
                  time: durationText(now - lastRead.getTime()),
                },
              )}
        </Note>
      ) : null}

      <div className={cn('flex flex-col gap-1.5', isStale && 'opacity-60')}>
        {current === null ? (
          <MonoLabel>{t('entity.sheet.calendar.next', 'Next')}</MonoLabel>
        ) : (
          <span className="font-mono text-label text-success uppercase">
            {t('entity.sheet.calendar.onNow', 'On now')}
          </span>
        )}
        {lead === null ? (
          <>
            <span className="text-[30px] leading-[1.1] font-medium tracking-[-0.02em] text-foreground-muted">
              {t('entity.sheet.calendar.nothingPlanned', 'Nothing planned')}
            </span>
            <span className="text-ui-sm text-foreground-subtle">
              {t('entity.sheet.calendar.noEventsAhead', 'No events ahead in this calendar.')}
            </span>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3.5">
              {token(lead, 34)}
              <span className="flex min-w-0 grow flex-col gap-0.5">
                <span className="text-[30px] leading-[1.1] font-medium tracking-[-0.02em] select-text">
                  {lead.title}
                </span>
                <span className="text-ui-sm text-foreground-subtle">
                  {whenLine(lead, now, zone)}
                  {isOutTonight ? ` · ${t('entity.sheet.calendar.outTonight', 'out tonight')}` : ''}
                </span>
              </span>
              {until === null ? null : (
                <span className="shrink-0 self-start rounded-pill bg-primary/14 px-2.5 py-1 font-mono text-mono-caption text-primary">
                  {t('entity.sheet.calendar.inTime', 'in {{time}}', { time: until })}
                </span>
              )}
            </div>
            {days === null || current === null ? null : (
              <div className="mt-2 flex flex-col gap-1.5">
                <span className="flex gap-1" aria-hidden="true">
                  {Array.from({ length: days.of }, (unused, index) => (
                    <span
                      key={index}
                      className={cn(
                        'h-1 grow rounded-pill',
                        index < days.day - 1
                          ? 'bg-primary'
                          : index === days.day - 1
                            ? 'bg-primary/60'
                            : 'bg-surface-high',
                      )}
                    />
                  ))}
                </span>
                <span className="text-caption text-foreground-subtle">
                  {t('entity.sheet.calendar.dayOf', 'Day {{day}} of {{of}}', days)}
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {then.length === 0 ? null : (
        <div className={cn('flex flex-col gap-1', isStale && 'opacity-60')}>
          <MonoLabel>{t('entity.sheet.calendar.then', 'Then')}</MonoLabel>
          <ul className="flex flex-col">
            {then.map((occurrence) => (
              <li
                key={occurrence.key}
                className="flex h-10.5 items-center gap-2.5 border-b border-border last:border-b-0"
              >
                {token(occurrence, 20)}
                <span className="min-w-0 grow truncate text-ui">{occurrence.title}</span>
                <span className="shrink-0 font-mono text-mono-caption text-foreground-subtle">
                  {shortWhen(occurrence, now, zone)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grow" />
      {calendarId === null ? null : (
        <Button
          variant="ghost"
          className="w-full"
          onClick={() => {
            void navigate(
              isStale
                ? `/calendar/settings?open=${calendarId}`
                : `/calendar?calendar=${calendarId}`,
            );
          }}
        >
          <AppIcon id={isStale ? 'settings' : 'calendar'} size={15} />
          {isStale
            ? t('entity.sheet.calendar.openSettings', 'Open its settings')
            : t('entity.sheet.calendar.openCalendar', 'Open in the calendar')}
        </Button>
      )}
    </div>
  );
}
