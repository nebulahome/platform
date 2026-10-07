/**
 * The time, and the date when there is room for it, in the time zone the person set on their
 * account.
 *
 * It ticks once a second when it shows seconds and once a minute when it does not - aligned to
 * the turn of the minute, so it never shows 14:02 for most of 14:03.
 */
import { useEffect, useState } from 'react';

import type { DashboardClockCard } from '@nebulahome/contracts';

import { useSession } from '@/auth/session-store';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';

/** What a clock card needs. */
export type ClockCardProps = {
  /** The card as the layout stores it. */
  readonly card: DashboardClockCard;
};

/**
 * The time now, kept up to date once a second or once a minute.
 *
 * @param isEverySecond - Whether it moves each second.
 * @returns The moment.
 */
function useNow(isEverySecond: boolean): Date {
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
 * Renders a clock card at its size.
 *
 * @param props - See {@link ClockCardProps}.
 * @returns The card.
 */
export function ClockCard(props: ClockCardProps) {
  const { card } = props;
  const timeZone = useSession((state) => state.user?.timezone);
  const now = useNow(card.showSeconds);
  const zone = timeZone === undefined || timeZone === '' ? {} : { timeZone };
  const time = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    ...(card.showSeconds ? { second: '2-digit' } : {}),
    ...zone,
  }).format(now);
  const date = new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...zone,
  }).format(now);
  const isTile = card.w === 1 && card.h === 1;
  const isLarge = card.h > 1;

  return (
    <CardFrame label="Clock" className="justify-center">
      <time
        dateTime={now.toISOString()}
        className="flex min-w-0 flex-col gap-1"
        aria-label={`${time}, ${date}`}
      >
        <span
          className={
            isLarge
              ? 'font-mono text-mono-reading leading-none tabular'
              : 'text-reading leading-none font-medium tabular'
          }
        >
          {time}
        </span>
        {card.showDate && !isTile ? (
          <span className="truncate text-ui text-foreground-muted first-letter:uppercase">
            {date}
          </span>
        ) : null}
      </time>
    </CardFrame>
  );
}
