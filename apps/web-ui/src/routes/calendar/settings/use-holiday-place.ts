/**
 * Where the house keeps its holidays, as the settings hold it (`calendar.*`) and as a person reads
 * it: "Italy, Lombardy, Milan".
 */
import { useQuery } from '@tanstack/react-query';

import type { CalendarPatron, SettingView } from '@nebulahome/contracts';

import { useSession } from '@/auth/session-store';
import { signalled } from '@/lib/signalled';
import { CALENDAR_SETTINGS_KEYS, fetchPlaces } from '@/routes/calendar/settings/settings-api';
import { fetchServerSettings, SETTINGS_QUERY_KEYS } from '@/settings/api';

/** The house's holiday settings, read. */
export type HolidayPlace = {
  readonly country: string | null;
  readonly region: string | null;
  readonly town: string | null;
  readonly patron: CalendarPatron | null;

  /** The weekend, 0 for Monday. */
  readonly weekendDays: readonly number[];
  readonly hiddenHolidays: readonly string[];

  /** The place in words, "Italy, Lombardy, Milan"; null while unset or unread. */
  readonly words: string | null;

  /** Whether the settings could be read at all: they need `settings:read`. */
  readonly canRead: boolean;
  readonly isPending: boolean;
};

/**
 * A setting's value, by key.
 *
 * @param items - The settings.
 * @param key - Which.
 * @returns Its value, or undefined.
 */
function valueOf(items: readonly SettingView[] | undefined, key: string): unknown {
  return items?.find((item) => item.key === key)?.value;
}

/**
 * Reads where the house keeps its holidays.
 *
 * @returns See {@link HolidayPlace}.
 */
export function useHolidayPlace(): HolidayPlace {
  const canRead = useSession((state) => state.can)('settings:read');
  const settings = useQuery({
    queryKey: SETTINGS_QUERY_KEYS.server,
    queryFn: signalled(fetchServerSettings),
    enabled: canRead,
  });
  const items = settings.data?.items;
  const country = (valueOf(items, 'calendar.country') as string | null | undefined) ?? null;
  const region = (valueOf(items, 'calendar.region') as string | null | undefined) ?? null;
  const town = (valueOf(items, 'calendar.town') as string | null | undefined) ?? null;
  const places = useQuery({
    queryKey: [...CALENDAR_SETTINGS_KEYS.places, country ?? ''],
    queryFn: signalled(async (signal) => fetchPlaces({ country }, signal)),
    enabled: canRead && country !== null,
    staleTime: 3_600_000,
  });
  const countryName = places.data?.countries.find((one) => one.code === country)?.name ?? country;
  const regionName = places.data?.regions.find((one) => one.code === region)?.name ?? region;
  const parts = [countryName, regionName, town].filter((part) => part !== null);

  return {
    country,
    region,
    town,
    patron: (valueOf(items, 'calendar.patron') as CalendarPatron | null | undefined) ?? null,
    weekendDays: (valueOf(items, 'calendar.weekend_days') as number[] | undefined) ?? [5, 6],
    hiddenHolidays: (valueOf(items, 'calendar.hidden_holidays') as string[] | undefined) ?? [],
    words: parts.length === 0 ? null : parts.join(', '),
    canRead,
    isPending: canRead && settings.isPending,
  };
}
