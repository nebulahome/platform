/**
 * What the calendar cards read: the calendars with their models, the coming times of their
 * events, and the house's clock. Under a sample source (the Add card catalogue, the lab) they read
 * the samples and ask the hub nothing.
 */
import { useQuery } from '@tanstack/react-query';

import type { CalendarOccurrence, CalendarView } from '@nebulahome/contracts';
import { useNow } from '@nebulahome/ui';

import { signalled } from '@/lib/signalled';
import { BROWSER_ZONE } from '@/lib/time-zones';
import { fetchAutomationHouse, LIBRARY_QUERY_KEYS } from '@/library/api';
import { wallOf } from '@/library/time-values';
import { CALENDAR_QUERY_KEYS, fetchCalendars, fetchOccurrences } from '@/routes/calendar/api';
import { useCardSample } from '@/routes/dashboard/cards/card-sample';

/** What the cards read. */
export type CardCalendars = {
  readonly calendars: readonly CalendarView[];

  /** The coming times, as read; undefined while they are. */
  readonly occurrences: readonly CalendarOccurrence[] | undefined;

  /** The house's zone: the calendar's clock. */
  readonly zone: string;

  /** Now, ticking a minute at a time. */
  readonly now: number;
};

/** Nothing yet. */
const NO_CALENDARS: readonly CalendarView[] = [];

/**
 * A day some days on.
 *
 * @param day - `YYYY-MM-DD`.
 * @param days - How many.
 * @returns `YYYY-MM-DD`.
 */
function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Reads the calendars and, when asked, the times of their events from today on.
 *
 * @param days - How many days ahead to read the times of; 0 for none.
 * @returns See {@link CardCalendars}.
 */
export function useCardCalendars(days: number): CardCalendars {
  const sample = useCardSample();
  const now = useNow(60_000);
  const house = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.automationHouse,
    queryFn: signalled(fetchAutomationHouse),
    staleTime: 3_600_000,
    enabled: sample === null,
  });
  const zone = house.data?.timeZone ?? BROWSER_ZONE;
  const today = wallOf(now, zone).day;
  const last = addDays(today, days);
  const calendars = useQuery({
    queryKey: CALENDAR_QUERY_KEYS.calendars,
    queryFn: signalled(fetchCalendars),
    enabled: sample === null,
  });
  const occurrences = useQuery({
    queryKey: [...CALENDAR_QUERY_KEYS.occurrences, today, last],
    queryFn: signalled(async (signal) => fetchOccurrences(today, last, signal)),
    enabled: sample === null && days > 0,
    refetchInterval: 300_000,
  });

  return sample === null
    ? { calendars: calendars.data ?? NO_CALENDARS, occurrences: occurrences.data, zone, now }
    : {
        calendars: sample.calendars ?? NO_CALENDARS,
        occurrences: sample.occurrences ?? [],
        zone,
        now,
      };
}
