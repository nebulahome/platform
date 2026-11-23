/**
 * The times things happen in a range of days, as the page reads them: every calendar at once,
 * keyed by the range, the switched-off calendars left out here rather than by the API - so
 * switching one back on is instant, and the search, which covers them all, agrees with the grid.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { CalendarOccurrence } from '@nebulahome/contracts';

import { CALENDAR_QUERY_KEYS, fetchOccurrences } from './api';
import { firstDayOf, type DayRange } from './calendar-time';
import type { CalendarBook } from './use-calendars';

/** Nothing yet, the same each time. */
const NONE: readonly CalendarOccurrence[] = [];

/**
 * Reads the occurrences of a range of days.
 *
 * @param range - The days, both included.
 * @param isEnabled - False to read nothing (a lab, or a view that does not need them).
 * @returns The query; the previous range's answer stays while the next one is read, so stepping
 *   a week does not blank the grid.
 */
export function useOccurrences(range: DayRange, isEnabled = true) {
  return useQuery({
    queryKey: [...CALENDAR_QUERY_KEYS.occurrences, range.from, range.to],
    /**
     * Reads the range.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the request when the range changes.
     * @returns The occurrences.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) =>
      fetchOccurrences(range.from, range.to, signal),
    placeholderData: keepPreviousData,
    enabled: isEnabled,
  });
}

/**
 * The occurrences of the calendars switched on, earliest first: all day before timed on a day,
 * then by start.
 *
 * @param occurrences - What was read.
 * @param book - The page's book.
 * @returns The ones shown.
 */
export function useShown(
  occurrences: readonly CalendarOccurrence[] | undefined,
  book: CalendarBook,
): readonly CalendarOccurrence[] {
  const { hidden, zone, models } = book;

  return useMemo(() => {
    /**
     * Where an occurrence's model is in its calendar's list: pickups in the order Waste lists them.
     *
     * @param occurrence - The occurrence.
     * @returns The model's place, or 0.
     */
    const positionOf = (occurrence: CalendarOccurrence): number =>
      occurrence.modelId === null ? 0 : (models.get(occurrence.modelId)?.position ?? 0);

    return (occurrences ?? NONE)
      .filter((occurrence) => !hidden.has(occurrence.calendarId))
      .toSorted(
        (left, right) =>
          firstDayOf(left, zone).localeCompare(firstDayOf(right, zone)) ||
          Number(right.isAllDay) - Number(left.isAllDay) ||
          (Date.parse(left.startsAt ?? '') || 0) - (Date.parse(right.startsAt ?? '') || 0) ||
          positionOf(left) - positionOf(right) ||
          left.title.localeCompare(right.title),
      );
  }, [occurrences, hidden, zone, models]);
}
