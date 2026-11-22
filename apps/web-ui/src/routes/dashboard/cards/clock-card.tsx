/**
 * The time, and the date when there is room for it, in the time zone the person set on their
 * account.
 *
 * The tile is the time and the day beside it; the strip adds the week; the square draws the time
 * on a face too, with the week and the day of the year under the date.
 *
 * It ticks once a second when it shows seconds and once a minute when it does not - aligned to
 * the turn of the minute, so it never shows 14:02 for most of 14:03.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { DashboardClockCard } from '@nebulahome/contracts';

import { useSession } from '@/auth/session-store';
import { dateTimeFormat } from '@/i18n/formatters';
import { Caption } from '@/routes/dashboard/cards/card-kit';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';

/** What a clock card needs. */
export type ClockCardProps = {
  /** The card as the layout stores it. */
  readonly card: DashboardClockCard;
};

/** One day of the calendar. */
type CalendarDay = { readonly week: number; readonly day: number };

/** A day in milliseconds. */
const DAY_MS = 86_400_000;

/**
 * The ISO week a date falls in - the week of its Thursday, counted from the week holding the
 * year's first Thursday - and its day of the year.
 *
 * @param year - The year.
 * @param month - The month, 1 to 12.
 * @param day - The day of the month.
 * @returns The week, 1 to 53, and the day of the year, 1 to 366.
 */
export function calendarDay(year: number, month: number, day: number): CalendarDay {
  const date = Date.UTC(year, month - 1, day);
  const monday = (new Date(date).getUTCDay() + 6) % 7;
  const thursday = date + (3 - monday) * DAY_MS;
  const thursdayYear = new Date(thursday).getUTCFullYear();

  return {
    week: Math.floor((thursday - Date.UTC(thursdayYear, 0, 1)) / (7 * DAY_MS)) + 1,
    day: Math.round((date - Date.UTC(year, 0, 1)) / DAY_MS) + 1,
  };
}

/**
 * The time now, kept up to date once a second or once a minute.
 *
 * @param isEverySecond - Whether it moves each second.
 * @returns The moment.
 */
function useWallClock(isEverySecond: boolean): Date {
  const [now, setNow] = useState(() => new Date());

  // A timer is something outside React to synchronise with (RULES.md 15.2).
  useEffect(() => {
    const step = isEverySecond ? 1000 : 60_000;
    let timer: ReturnType<typeof setTimeout>;

    /** Moves the clock on, then waits for the next turn of the second or the minute. */
    const tick = (): void => {
      const current = new Date();

      setNow(current);
      timer = setTimeout(tick, step - (current.getTime() % step));
    };

    tick();

    return (): void => {
      clearTimeout(timer);
    };
  }, [isEverySecond]);

  return now;
}

/**
 * Renders the clock's face: twelve marks, the quarters longer, the hour hand and the minute hand
 * in the accent.
 *
 * @param props - The time it shows.
 * @param props.hour - The hour, 0 to 23.
 * @param props.minute - The minute.
 * @returns The face.
 */
function ClockFace(props: { readonly hour: number; readonly minute: number }) {
  const { hour, minute } = props;

  return (
    <svg viewBox="0 0 168 168" aria-hidden="true" className="size-42 shrink-0">
      <circle cx="84" cy="84" r="83.5" className="fill-surface-raised stroke-border" />
      {[...Array.from({ length: 12 }).keys()].map((index) => (
        <line
          key={index}
          x1="84"
          x2="84"
          y1={index % 3 === 0 ? 5 : 6}
          y2={index % 3 === 0 ? 15 : 11}
          transform={`rotate(${String(index * 30)} 84 84)`}
          strokeWidth={index % 3 === 0 ? 2 : 1.5}
          strokeLinecap="round"
          className={index % 3 === 0 ? 'stroke-foreground-muted' : 'stroke-border-strong'}
        />
      ))}
      <line
        x1="84"
        y1="84"
        x2="84"
        y2="44"
        transform={`rotate(${String((hour % 12) * 30 + minute / 2)} 84 84)`}
        strokeWidth="4"
        strokeLinecap="round"
        className="stroke-foreground"
      />
      <line
        x1="84"
        y1="84"
        x2="84"
        y2="24"
        transform={`rotate(${String(minute * 6)} 84 84)`}
        strokeWidth="2.5"
        strokeLinecap="round"
        className="stroke-primary"
      />
      <circle cx="84" cy="84" r="4.5" className="fill-primary" />
    </svg>
  );
}

/** How the time is written, by the card's size. */
const TIME_SIZE = {
  tile: 'text-[38px]',
  strip: 'text-[44px]',
  square: 'text-[52px]',
} as const;

/**
 * Renders a clock card at its size.
 *
 * @param props - See {@link ClockCardProps}.
 * @returns The card.
 */
export function ClockCard(props: ClockCardProps) {
  const { t } = useTranslation();

  const { card } = props;
  const timeZone = useSession((state) => state.user?.timezone);
  const now = useWallClock(card.showSeconds);
  const zone = timeZone === undefined || timeZone === '' ? {} : { timeZone };
  const clock = dateTimeFormat({
    hour: '2-digit',
    minute: '2-digit',
    ...(card.showSeconds ? { second: '2-digit' } : {}),
    ...zone,
  }).formatToParts(now);
  const time = clock.map((each) => each.value).join('');
  // A twelve-hour clock's AM or PM is written small beside the figures, as a reading's unit is.
  const period = clock.find((each) => each.type === 'dayPeriod')?.value;
  const figures = clock
    .filter((each) => each.type !== 'dayPeriod')
    .map((each) => each.value)
    .join('')
    .trim();
  const weekday = dateTimeFormat({ weekday: 'long', ...zone }).format(now);
  const dayMonth = dateTimeFormat({ day: 'numeric', month: 'long', ...zone }).format(now);
  const date = dateTimeFormat({ weekday: 'long', day: 'numeric', month: 'long', ...zone }).format(
    now,
  );
  // The calendar's figures as they are where the person is, whatever the browser's own zone.
  const parts = dateTimeFormat({
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
    ...zone,
  }).formatToParts(now);
  /**
   * One figure of the moment, as it is where the person is.
   *
   * @param type - Which: the year, the hour…
   * @returns The figure.
   */
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((each) => each.type === type)?.value ?? 0);
  const calendar = calendarDay(part('year'), part('month'), part('day'));
  const week = t('dashboard.cards.clockCard.week', 'Week {{week}}', { week: calendar.week });
  const size = card.h > 1 ? 'square' : card.w > 1 ? 'strip' : 'tile';
  const figure = (
    <span
      className={`${TIME_SIZE[size]} leading-none font-medium tracking-[-0.03em] whitespace-nowrap text-foreground tabular-nums`}
    >
      {figures}
      {period === undefined ? null : (
        <span className="ml-1 text-title font-normal tracking-normal text-foreground-subtle">
          {period}
        </span>
      )}
    </span>
  );

  return (
    <CardFrame label={t('dashboard.cards.clockCard.clock', 'Clock')}>
      <time
        dateTime={now.toISOString()}
        aria-label={card.showDate ? `${time}, ${date}` : time}
        className={
          size === 'square'
            ? 'flex h-full min-w-0 items-center gap-8 pl-2'
            : 'flex h-full min-w-0 items-center justify-between gap-2.5'
        }
      >
        {size === 'square' ? (
          <>
            <ClockFace hour={part('hour')} minute={part('minute')} />
            <div className="flex min-w-0 flex-col gap-2">
              {figure}
              {card.showDate ? (
                <>
                  <span className="mt-1 truncate text-subhead font-medium first-letter:uppercase">
                    {date}
                  </span>
                  <Caption>
                    {t('dashboard.cards.clockCard.weekAndDay', '{{week}} · day {{day}}', {
                      week,
                      day: calendar.day,
                    })}
                  </Caption>
                </>
              ) : null}
            </div>
          </>
        ) : (
          <>
            {figure}
            {!card.showDate ? null : size === 'strip' ? (
              <div className="flex min-w-0 flex-col gap-1 text-right">
                <span className="truncate text-title font-medium first-letter:uppercase">
                  {date}
                </span>
                <Caption>{week}</Caption>
              </div>
            ) : (
              <div className="flex min-w-0 flex-col gap-0.5 text-right">
                <Caption className="text-foreground-muted first-letter:uppercase">
                  {weekday}
                </Caption>
                <Caption>{dayMonth}</Caption>
              </div>
            )}
          </>
        )}
      </time>
    </CardFrame>
  );
}
