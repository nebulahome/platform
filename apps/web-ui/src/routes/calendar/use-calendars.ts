/**
 * What every part of the calendar page reads: the calendars and their models, the house's zone
 * and place, the weekend, the icons on screen, which calendars are switched off, and now.
 *
 * Gathered once by the page into a {@link CalendarBook} and handed down, as the dashboard hands
 * its cards their data: a view draws, it does not fetch.
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  SETTINGS,
  wallOf,
  type CalendarModel,
  type CalendarOccurrence,
  type CalendarView,
  type GeoPosition,
  type IconView,
  type TagColor,
} from '@nebulahome/contracts';
import { useNow } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { signalled } from '@/lib/signalled';
import { BROWSER_ZONE } from '@/lib/time-zones';
import { fetchAutomationHouse, LIBRARY_QUERY_KEYS } from '@/library/api';
import { useCatalogueIcons } from '@/routes/library/device-icon';
import { fetchServerSettings, SETTINGS_QUERY_KEYS } from '@/settings/api';
import { usePreferences } from '@/settings/preferences';

import { CALENDAR_QUERY_KEYS, fetchCalendars } from './api';
import { CALENDAR_SETTINGS_KEYS, fetchCalendarPeople } from './settings/settings-api';

/** The weekend until the settings say otherwise: Saturday and Sunday, 0 being Monday. */
const DEFAULT_WEEKEND: readonly number[] = (SETTINGS.find(
  (setting) => setting.key === 'calendar.weekend_days',
)?.defaultValue as readonly number[] | undefined) ?? [5, 6];

/** No calendars yet, the same each time. */
const NO_CALENDARS: readonly CalendarView[] = [];

/** What the page draws with. */
export type CalendarBook = {
  /** Every calendar, in its order. */
  readonly calendars: readonly CalendarView[];
  readonly byId: ReadonlyMap<string, CalendarView>;

  /** Every calendar's models, by id. */
  readonly models: ReadonlyMap<string, CalendarModel>;

  /** The catalogue's drawings of the icons on screen, by id. */
  readonly icons: ReadonlyMap<string, IconView>;

  /** The house's zone: the grid's clock. */
  readonly zone: string;

  /** Where the house is, for the sun; null when it has no position. */
  readonly position: GeoPosition | null;

  /** The weekend's days of the week, 0 for Monday. */
  readonly weekendDays: readonly number[];

  /** The calendars switched off. */
  readonly hidden: ReadonlySet<string>;

  /** Now, ms, a tick a minute. */
  readonly now: number;

  /** Today, in the house. */
  readonly today: string;
};

/**
 * Reads every calendar.
 *
 * @returns The query.
 */
export function useCalendars() {
  return useQuery({ queryKey: CALENDAR_QUERY_KEYS.calendars, queryFn: signalled(fetchCalendars) });
}

/**
 * Gathers what the page draws with.
 *
 * @param iconIds - The icons the occurrences on screen carry, beside the calendars' and models'.
 * @returns The book, and whether the calendars are still being read.
 */
export function useCalendarBook(iconIds: readonly (string | null)[]): {
  readonly book: CalendarBook;
  readonly isPending: boolean;
  readonly error: Error | null;
} {
  const can = useSession((state) => state.can);
  const calendars = useCalendars();
  const house = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.automationHouse,
    queryFn: signalled(fetchAutomationHouse),
    staleTime: 3_600_000,
  });

  // The weekend is a setting; someone who may not read the settings gets the usual one.
  const settings = useQuery({
    queryKey: SETTINGS_QUERY_KEYS.server,
    queryFn: signalled(fetchServerSettings),
    enabled: can('settings:read'),
  });
  const hiddenIds = usePreferences((state) => state.hiddenCalendars);
  const now = useNow(60_000);
  const list = calendars.data ?? NO_CALENDARS;

  const wanted = useMemo(
    () => [
      ...iconIds,
      ...list.flatMap((calendar) => [calendar.icon, ...calendar.models.map((model) => model.icon)]),
    ],
    [iconIds, list],
  );
  const icons = useCatalogueIcons(wanted);
  const weekend = settings.data?.items.find((item) => item.key === 'calendar.weekend_days')?.value;
  const zone = house.data?.timeZone ?? BROWSER_ZONE;

  const book = useMemo<CalendarBook>(
    () => ({
      calendars: list,
      byId: new Map(list.map((calendar) => [calendar.id, calendar])),
      models: new Map(
        list.flatMap((calendar) => calendar.models.map((model) => [model.id, model])),
      ),
      icons,
      zone,
      position: house.data?.position ?? null,
      weekendDays: Array.isArray(weekend)
        ? weekend.filter((day): day is number => typeof day === 'number')
        : DEFAULT_WEEKEND,
      hidden: new Set(hiddenIds),
      now,
      today: wallOf(now, zone).day,
    }),
    [list, icons, zone, house.data?.position, weekend, hiddenIds, now],
  );

  return { book, isPending: calendars.isPending, error: calendars.error };
}

/** How an occurrence is drawn: its calendar, its model, its colour and its icon. */
export type OccurrenceLook = {
  readonly calendar: CalendarView | undefined;
  readonly model: CalendarModel | undefined;

  /** The calendar's colour: what the chip is painted in. */
  readonly color: TagColor;

  /** The model's colour, else the calendar's: what its own icon and token are painted in. */
  readonly tokenColor: TagColor;

  /** Its own icon, else its model's, drawn from the catalogue. */
  readonly icon: IconView | undefined;
};

/**
 * Works out how an occurrence is drawn.
 *
 * @param occurrence - The occurrence.
 * @param book - The page's book.
 * @returns Its look.
 */
export function lookOf(occurrence: CalendarOccurrence, book: CalendarBook): OccurrenceLook {
  const calendar = book.byId.get(occurrence.calendarId);
  const model = occurrence.modelId === null ? undefined : book.models.get(occurrence.modelId);
  const iconId = occurrence.icon ?? model?.icon ?? null;

  return {
    calendar,
    model,
    color: calendar?.color ?? 'indigo',
    tokenColor: model?.color ?? calendar?.color ?? 'indigo',
    icon: iconId === null ? undefined : book.icons.get(iconId),
  };
}

/**
 * Whether an occurrence is a pickup: a day of the Waste calendar, shown as a token on the day
 * rather than a line.
 *
 * @param occurrence - The occurrence.
 * @param book - The page's book.
 * @returns True for one.
 */
export function isPickup(occurrence: CalendarOccurrence, book: CalendarBook): boolean {
  return occurrence.isAllDay && book.byId.get(occurrence.calendarId)?.kind === 'waste';
}

/**
 * The names of the people of the house, by id: every calendar reader may know them.
 *
 * @returns Usernames by id.
 */
export function usePeopleNames(): ReadonlyMap<string, string> {
  const people = useQuery({
    queryKey: CALENDAR_SETTINGS_KEYS.people,
    queryFn: signalled(fetchCalendarPeople),
  });

  return useMemo(
    () => new Map((people.data ?? []).map((person) => [person.id, person.username] as const)),
    [people.data],
  );
}
