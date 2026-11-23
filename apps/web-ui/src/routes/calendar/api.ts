/**
 * The calendar's calls to the API, and the keys its answers are cached under (docs/calendar.md
 * 6.1). Every key starts with `calendar`, so one invalidation of {@link CALENDAR_QUERY_KEYS.all}
 * - what a `library_event` of kind `calendar` does - reads everything on the page again.
 *
 * The settings page keeps its own calls beside its own screens and caches under these keys too.
 */
import { z } from 'zod';

import {
  calendarEventSchema,
  calendarHolidaySchema,
  calendarOccurrenceSchema,
  calendarSearchResultSchema,
  calendarViewSchema,
  type CalendarEvent,
  type CalendarEventPatch,
  type CalendarEventWrite,
  type CalendarHoliday,
  type CalendarOccurrence,
  type CalendarSearchResult,
  type CalendarView,
} from '@nebulahome/contracts';

import { apiRequest, collectionSchema } from '@/lib/api-client';

/** The keys the calendar caches under. */
export const CALENDAR_QUERY_KEYS = {
  /** Everything the calendar reads: what a change made elsewhere makes stale. */
  all: ['calendar'] as const,

  /** Every calendar, with its models and what the caller may do to it. */
  calendars: ['calendar', 'calendars'] as const,

  /** Occurrences of a range of days, under `[from, to]`. */
  occurrences: ['calendar', 'occurrences'] as const,

  /** One event as it is kept, under its id: its repeat rule. */
  event: ['calendar', 'event'] as const,

  /** What a search found, under its words. */
  search: ['calendar', 'search'] as const,

  /** A year's holidays, under the year. */
  holidays: ['calendar', 'holidays'] as const,
};

/** Which times of a repeating event a change or a delete is for. */
export type EventScope =
  { readonly scope: 'one'; readonly occurrenceOn: string } | { readonly scope: 'all' };

/**
 * The query that says which times a change is for.
 *
 * @param scope - The times.
 * @returns `?scope=all`, or `?scope=one&occurrenceOn=2026-12-03`.
 */
function scopeQuery(scope: EventScope): string {
  return scope.scope === 'all'
    ? '?scope=all'
    : `?scope=one&occurrenceOn=${encodeURIComponent(scope.occurrenceOn)}`;
}

/**
 * Reads every calendar.
 *
 * @param signal - Cancels the request.
 * @returns The calendars, in their order.
 */
export async function fetchCalendars(signal?: AbortSignal): Promise<CalendarView[]> {
  const { items } = await apiRequest('/calendars', collectionSchema(calendarViewSchema), {
    signal,
  });

  return items;
}

/**
 * Reads the times things happen in a range of days, in every calendar: the page hides the ones
 * switched off itself, so switching one back on asks nothing.
 *
 * @param from - The first day, `YYYY-MM-DD`.
 * @param to - The last day, included.
 * @param signal - Cancels the request.
 * @returns The occurrences.
 */
export async function fetchOccurrences(
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<CalendarOccurrence[]> {
  const query = new URLSearchParams({ from, to });
  const { items } = await apiRequest(
    `/calendar/occurrences?${query.toString()}`,
    collectionSchema(calendarOccurrenceSchema),
    { signal },
  );

  return items;
}

/**
 * Reads one event as it is kept: what an occurrence does not carry, its repeat rule.
 *
 * @param eventId - The event.
 * @param signal - Cancels the request.
 * @returns The event.
 */
export async function fetchEvent(eventId: string, signal?: AbortSignal): Promise<CalendarEvent> {
  return apiRequest(`/calendar/events/${encodeURIComponent(eventId)}`, calendarEventSchema, {
    signal,
  });
}

/**
 * Looks for words in every calendar, the hidden ones too.
 *
 * @param words - What was typed.
 * @param signal - Cancels the request.
 * @returns The coming times, soonest first, and the past ones, latest first.
 */
export async function searchCalendars(
  words: string,
  signal?: AbortSignal,
): Promise<CalendarSearchResult> {
  return apiRequest(
    `/calendar/search?${new URLSearchParams({ q: words }).toString()}`,
    calendarSearchResultSchema,
    { signal },
  );
}

/**
 * Makes an event.
 *
 * @param event - Its calendar, title and times.
 * @returns The event as kept.
 */
export async function createEvent(event: CalendarEventWrite): Promise<CalendarEvent> {
  return apiRequest('/calendar/events', calendarEventSchema, { method: 'POST', body: event });
}

/**
 * Changes an event, or one time of a repeating one.
 *
 * @param eventId - The event.
 * @param patch - What changes.
 * @param scope - Which times.
 * @returns The event as kept: for one time, the row that now stands for it.
 */
export async function updateEvent(
  eventId: string,
  patch: CalendarEventPatch,
  scope: EventScope = { scope: 'all' },
): Promise<CalendarEvent> {
  return apiRequest(
    `/calendar/events/${encodeURIComponent(eventId)}${scopeQuery(scope)}`,
    calendarEventSchema,
    { method: 'PATCH', body: patch },
  );
}

/**
 * Deletes an event, or one time of a repeating one.
 *
 * @param eventId - The event.
 * @param scope - Which times.
 */
export async function deleteEvent(
  eventId: string,
  scope: EventScope = { scope: 'all' },
): Promise<void> {
  await apiRequest(
    `/calendar/events/${encodeURIComponent(eventId)}${scopeQuery(scope)}`,
    z.undefined(),
    {
      method: 'DELETE',
    },
  );
}

/**
 * Reads a year's holidays, the hidden ones marked.
 *
 * @param year - The year.
 * @param signal - Cancels the request.
 * @returns The holidays, by date.
 */
export async function fetchHolidays(
  year: number,
  signal?: AbortSignal,
): Promise<CalendarHoliday[]> {
  const { items } = await apiRequest(
    `/calendar/holidays?year=${String(year)}`,
    collectionSchema(calendarHolidaySchema),
    { signal },
  );

  return items;
}
