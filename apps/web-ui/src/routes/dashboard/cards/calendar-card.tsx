/**
 * A calendar of the house as an entity card (CAL-Cards, Calendar): what is on now, or what comes
 * next and how soon, or Nothing planned. The tile says it in a figure and a line; the strip lays
 * the title beside when it is - with the bar of its days for one that runs over several. The next
 * event's model shows as its token.
 */
import { useTranslation } from 'react-i18next';

import { cn } from '@nebulahome/ui';

import {
  dayOfEvent,
  daysOf,
  endOf,
  lastWeekday,
  shortWhen,
  startOf,
  untilStart,
  whenLine,
} from '@/library/calendar-words';
import { paramsOf } from '@/library/entity-control';
import { clockOf, formatClock, wallOf } from '@/library/time-values';
import { ModelToken } from '@/routes/calendar/model-token';
import { useCardCalendars } from '@/routes/dashboard/cards/calendar-data';
import { BigValue, Caption, CardHead } from '@/routes/dashboard/cards/card-kit';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import { sizeKey, type EntityCardModel } from '@/routes/dashboard/cards/entity-model';
import { useCatalogueIcons } from '@/routes/library/device-icon';

/**
 * Renders a calendar's card at its size.
 *
 * @param props - The card, ready to draw.
 * @param props.model - See {@link EntityCardModel}.
 * @returns The card.
 */
export function CalendarCard(props: { readonly model: EntityCardModel }) {
  const { t } = useTranslation();
  const { model } = props;
  const told = model.state.calendar;
  const current = told?.current ?? null;
  const next = told?.next ?? null;
  const lead = current ?? next;
  const { calendars, zone, now } = useCardCalendars(0);
  const calendarId = paramsOf(model.entity, 'calendar')?.calendarId ?? null;
  const calendar = calendars.find((one) => one.id === calendarId);
  const leadModel =
    lead?.modelId == null ? undefined : calendar?.models.find((one) => one.id === lead.modelId);
  const icons = useCatalogueIcons([leadModel?.icon ?? null]);
  const isStale = told?.isStale === true || model.isOffline;
  const until = current === null && next !== null ? untilStart(next, now, zone) : null;
  const days = current === null ? null : dayOfEvent(current, now, zone);
  const today = wallOf(now, zone).day;
  const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
  // A pickup the morning after goes out the evening before.
  const isOutTonight =
    current === null &&
    next !== null &&
    next.isAllDay &&
    leadModel !== undefined &&
    calendar?.kind === 'waste' &&
    next.startsOn === tomorrow;
  const subtitle =
    current !== null
      ? t('dashboard.cards.calendarCard.onNow', 'On now')
      : isOutTonight
        ? t('dashboard.cards.calendarCard.outTonight', 'Out tonight')
        : t('dashboard.cards.calendarCard.next', 'Next');
  const head = <CardHead model={{ ...model, subtitle }} isActive={current !== null} />;
  const token =
    leadModel === undefined ? null : (
      <ModelToken icon={icons.get(leadModel.icon)} color={leadModel.color} size={30} />
    );

  /**
   * Until when the event on now lasts: "until Sat", "until 21:00".
   *
   * @returns The words, or empty when nothing is on.
   */
  const untilWords = (): string => {
    if (current === null) {
      return '';
    }

    const { first, last } = daysOf(current, zone);

    return t('dashboard.cards.calendarCard.until', 'until {{when}}', {
      when:
        first === last && !current.isAllDay
          ? formatClock(clockOf(wallOf(endOf(current, zone), zone).seconds, false))
          : lastWeekday(current, zone),
    });
  };

  if (sizeKey(model.size) === '2x1') {
    return (
      <CardFrame label={model.title}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 grow">{head}</div>
          {days !== null ? (
            <Caption className="font-mono text-foreground-subtle">
              {t('dashboard.cards.calendarCard.dayOf', 'day {{day}} of {{of}}', days)}
            </Caption>
          ) : until === null ? null : (
            <span className="shrink-0 rounded-pill bg-primary/14 px-2 py-0.5 font-mono text-label text-primary">
              {t('dashboard.cards.calendarCard.inTime', 'in {{time}}', { time: until })}
            </span>
          )}
        </div>
        <div className="grow" />
        <div className="flex min-w-0 items-center gap-3">
          {token}
          <BigValue
            value={lead?.title ?? t('dashboard.cards.calendarCard.nothing', 'Nothing planned')}
            size={22}
            className={cn(
              'truncate',
              isStale || lead === null ? 'text-foreground-subtle' : undefined,
            )}
          />
          {days === null ? (
            <span className="grow" />
          ) : (
            <span className="flex min-w-16 grow gap-1" aria-hidden="true">
              {Array.from({ length: days.of }, (unused, index) => (
                <span
                  key={index}
                  className={cn(
                    'h-1 grow rounded-pill',
                    index < days.day ? 'bg-primary' : 'bg-surface-high',
                  )}
                />
              ))}
            </span>
          )}
          <Caption>
            {current !== null ? untilWords() : next === null ? '' : whenLine(next, now, zone)}
          </Caption>
        </div>
      </CardFrame>
    );
  }

  return (
    <CardFrame label={model.title}>
      {head}
      <div className="grow" />
      <div className="flex min-w-0 items-end justify-between gap-2.5">
        {token}
        <BigValue
          value={
            lead === null
              ? t('dashboard.cards.calendarCard.nothing', 'Nothing planned')
              : current === null && until !== null && !lead.isAllDay
                ? formatClock(clockOf(wallOf(startOf(lead, zone), zone).seconds, false))
                : lead.title
          }
          size={lead !== null && current === null && until !== null ? 26 : 22}
          className={cn(
            'truncate',
            isStale || lead === null ? 'text-foreground-subtle' : undefined,
          )}
        />
        <Caption>
          {current !== null
            ? untilWords()
            : next === null
              ? ''
              : until !== null
                ? t('dashboard.cards.calendarCard.titleIn', '{{title}} · in {{time}}', {
                    title: next.title,
                    time: until,
                  })
                : shortWhen(next, now, zone)}
        </Caption>
      </div>
    </CardFrame>
  );
}
