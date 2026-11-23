/**
 * Every call the calendar settings make, one function per endpoint: the calendars and their
 * models, sources and editors, the holidays and the house's place, and the share links.
 *
 * Each names the contract schema its answer must satisfy, as everywhere else in the client.
 */
import { z } from 'zod';

import {
  calendarFeedSchema,
  calendarIcsStateSchema,
  calendarIcsTestResultSchema,
  calendarModelSchema,
  calendarPersonSchema,
  calendarPlaceSuggestionSchema,
  calendarPlacesSchema,
  calendarUsageSchema,
  calendarViewSchema,
  type CalendarCreate,
  type CalendarFeed,
  type CalendarFeedCreate,
  type CalendarFeedUpdate,
  type CalendarIcsTestResult,
  type CalendarModel,
  type CalendarModelCreate,
  type CalendarModelUpdate,
  type CalendarPerson,
  type CalendarPlace,
  type CalendarPlaces,
  type CalendarUpdate,
  type CalendarUsage,
  type CalendarView,
} from '@nebulahome/contracts';

export type { CalendarPerson };

import { apiRequest, collectionSchema } from '@/lib/api-client';

/**
 * The keys the settings read under besides the page's (`CALENDAR_QUERY_KEYS`): all below
 * `calendar`, which the live channel refreshes.
 */
export const CALENDAR_SETTINGS_KEYS = {
  usage: ['calendar', 'usage'] as const,
  places: ['calendar', 'places'] as const,
  suggestion: ['calendar', 'places', 'suggest'] as const,
  feeds: ['calendar', 'feeds'] as const,
  people: ['calendar', 'people'] as const,
} as const;

/**
 * Makes a calendar.
 *
 * @param body - Its name, colour and source.
 * @returns The calendar.
 */
export async function createCalendar(body: CalendarCreate): Promise<CalendarView> {
  return apiRequest('/calendars', calendarViewSchema, { method: 'POST', body });
}

/**
 * Changes a calendar.
 *
 * @param calendarId - Which.
 * @param body - What changes.
 * @returns The calendar as it now stands.
 */
export async function updateCalendar(
  calendarId: string,
  body: CalendarUpdate,
): Promise<CalendarView> {
  return apiRequest(`/calendars/${calendarId}`, calendarViewSchema, { method: 'PATCH', body });
}

/**
 * Deletes a calendar, its events and its entity.
 *
 * @param calendarId - Which.
 */
export async function deleteCalendar(calendarId: string): Promise<void> {
  await apiRequest(`/calendars/${calendarId}`, z.unknown(), { method: 'DELETE' });
}

/**
 * Reads what deleting a calendar takes with it.
 *
 * @param calendarId - Which.
 * @param signal - Cancels the request.
 * @returns Its automations, share links and events.
 */
export async function fetchCalendarUsage(
  calendarId: string,
  signal?: AbortSignal,
): Promise<CalendarUsage> {
  return apiRequest(`/calendars/${calendarId}/usage`, calendarUsageSchema, { signal });
}

/**
 * Replaces a calendar's Editors.
 *
 * @param calendarId - Which.
 * @param userIds - Everyone ticked.
 */
export async function setCalendarEditors(
  calendarId: string,
  userIds: readonly string[],
): Promise<void> {
  await apiRequest(`/calendars/${calendarId}/editors`, z.unknown(), {
    method: 'PUT',
    body: { userIds },
  });
}

/**
 * Adds a model to a calendar.
 *
 * @param calendarId - Which.
 * @param body - Its name, icon and colour.
 * @returns The model.
 */
export async function createCalendarModel(
  calendarId: string,
  body: CalendarModelCreate,
): Promise<CalendarModel> {
  return apiRequest(`/calendars/${calendarId}/models`, calendarModelSchema, {
    method: 'POST',
    body,
  });
}

/**
 * Changes a model.
 *
 * @param modelId - Which.
 * @param body - What changes.
 * @returns The model.
 */
export async function updateCalendarModel(
  modelId: string,
  body: CalendarModelUpdate,
): Promise<CalendarModel> {
  return apiRequest(`/calendar-models/${modelId}`, calendarModelSchema, {
    method: 'PATCH',
    body,
  });
}

/**
 * Deletes a model; its events keep their titles.
 *
 * @param modelId - Which.
 */
export async function deleteCalendarModel(modelId: string): Promise<void> {
  await apiRequest(`/calendar-models/${modelId}`, z.unknown(), { method: 'DELETE' });
}

/**
 * Has the hub download an address and say what it found.
 *
 * @param url - The address.
 * @param calendarId - The calendar it is for, whose models its events are matched against.
 * @returns How many events, from when to when; or why it is not a calendar.
 */
export async function testIcsUrl(url: string, calendarId?: string): Promise<CalendarIcsTestResult> {
  return apiRequest('/calendars/ics/test', calendarIcsTestResultSchema, {
    method: 'POST',
    body: { url, ...(calendarId === undefined ? {} : { calendarId }) },
  });
}

/**
 * Sends a `.ics` file to be kept and tested.
 *
 * @param file - The file, read here.
 * @param calendarId - The calendar it is for, whose models its events are matched against.
 * @returns What it holds, with the id a calendar then takes it by; or why it is not a calendar.
 */
export async function uploadIcsFile(
  file: File,
  calendarId?: string,
): Promise<CalendarIcsTestResult> {
  return apiRequest('/calendar/ics-files', calendarIcsTestResultSchema, {
    method: 'POST',
    body: {
      name: file.name,
      text: await file.text(),
      ...(calendarId === undefined ? {} : { calendarId }),
    },
  });
}

/**
 * Has the hub read a calendar's address again now.
 *
 * @param calendarId - Which.
 */
export async function refreshCalendarIcs(calendarId: string): Promise<void> {
  await apiRequest(`/calendars/${calendarId}/ics/refresh`, calendarIcsStateSchema.or(z.unknown()), {
    method: 'POST',
  });
}

/**
 * Lists what the place selects offer: every country, a country's regions and its towns.
 *
 * @param place - The country, the region and the words a town is looked for by; each optional.
 * @param place.country - The country whose regions to list.
 * @param place.region - The region whose towns to list.
 * @param place.q - Words a town's name holds.
 * @param signal - Cancels the request.
 * @returns The countries, the regions and the towns.
 */
export async function fetchPlaces(
  place: { readonly country?: string | null; readonly region?: string | null; readonly q?: string },
  signal?: AbortSignal,
): Promise<CalendarPlaces> {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(place)) {
    if (typeof value === 'string' && value !== '') {
      query.set(key, value);
    }
  }

  return apiRequest(`/calendar/places?${query.toString()}`, calendarPlacesSchema, { signal });
}

/**
 * Reads the place nearest the house's position.
 *
 * @param signal - Cancels the request.
 * @returns The place, or null when the house has no position or none fits.
 */
export async function fetchPlaceSuggestion(signal?: AbortSignal): Promise<CalendarPlace | null> {
  const { place } = await apiRequest('/calendar/places/suggest', calendarPlaceSuggestionSchema, {
    signal,
  });

  return place;
}

/**
 * Lists the share links.
 *
 * @param signal - Cancels the request.
 * @returns The links.
 */
export async function fetchFeeds(signal?: AbortSignal): Promise<CalendarFeed[]> {
  const { items } = await apiRequest('/calendar/feeds', collectionSchema(calendarFeedSchema), {
    signal,
  });

  return items;
}

/**
 * Makes a share link.
 *
 * @param body - Its name and calendars.
 * @returns The link.
 */
export async function createFeed(body: CalendarFeedCreate): Promise<CalendarFeed> {
  return apiRequest('/calendar/feeds', calendarFeedSchema, { method: 'POST', body });
}

/**
 * Changes a share link: its name, its calendars, or its address.
 *
 * @param feedId - Which.
 * @param body - What changes.
 * @returns The link.
 */
export async function updateFeed(feedId: string, body: CalendarFeedUpdate): Promise<CalendarFeed> {
  return apiRequest(`/calendar/feeds/${feedId}`, calendarFeedSchema, { method: 'PATCH', body });
}

/**
 * Revokes a share link.
 *
 * @param feedId - Which.
 */
export async function deleteFeed(feedId: string): Promise<void> {
  await apiRequest(`/calendar/feeds/${feedId}`, z.unknown(), { method: 'DELETE' });
}

/**
 * Lists the people of the house, for a calendar's Editors: the active accounts, with their roles.
 *
 * @param signal - Cancels the request.
 * @returns Everyone who can sign in, by name.
 */
export async function fetchCalendarPeople(signal?: AbortSignal): Promise<CalendarPerson[]> {
  const { items } = await apiRequest('/calendar/people', collectionSchema(calendarPersonSchema), {
    signal,
  });

  return items;
}

/**
 * The address a share link is read at: plain http on the house's network, since calendar apps
 * refuse the hub's own certificate.
 *
 * @param token - The link's token.
 * @returns `webcal://<hub>:8080/api/calendar/<token>.ics`.
 */
export function feedAddress(token: string): string {
  // shortcut: the proxy's plain port is assumed 8080 (PROXY_HTTP_PORT's default) and the host is
  // the one this page was opened on; serve both from the API if an install changes the port.
  return `webcal://${globalThis.location.hostname}:8080/api/calendar/${token}.ics`;
}
