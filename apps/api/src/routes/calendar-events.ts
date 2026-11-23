/**
 * The calendar's times: occurrences of a range, search, the events typed in the house, the
 * holidays of a year, and the places holidays are kept for (docs/calendar.md 6.1).
 *
 * Reading needs `calendar:read`; changing an event, the right to edit its calendar - and the one
 * it moves to (`calendar-access.ts`). The holidays' place, weekend, hidden holidays and typed
 * patron are settings, changed through `PATCH /settings`.
 */
import { z } from 'zod';

import {
  calendarEventPatchSchema,
  calendarEventSchema,
  calendarEventScopeQuerySchema,
  calendarEventWriteSchema,
  calendarHolidaySchema,
  calendarHolidaysQuerySchema,
  calendarOccurrenceSchema,
  calendarOccurrencesQuerySchema,
  calendarPlaceSuggestionSchema,
  calendarPlacesQuerySchema,
  calendarPlacesSchema,
  calendarSearchQuerySchema,
  calendarSearchResultSchema,
  type CalendarEvent,
  type CalendarHoliday,
  type CalendarOccurrence,
  type CalendarPlaceSuggestion,
  type CalendarPlaces,
  type CalendarSearchResult,
} from '@nebulahome/contracts';

import { requirePermission } from '../auth/permissions.js';
import type { ApiContext } from '../context.js';
import { collectionSchema } from '../http/collection.js';
import { defineRoute, type RouteEnvironment } from '../http/route.js';
import {
  createCalendarEvent,
  deleteCalendarEvent,
  updateCalendarEvent,
} from '../services/calendar-events.js';
import {
  listHolidays,
  readCalendarSettings,
  readOccurrences,
  searchOccurrences,
} from '../services/calendar-occurrences.js';
import { listPlaces, suggestPlace } from '../services/calendar-places.js';
import { readAutomationHouse } from '../services/registry.js';

import { settleCalendarWrite } from './calendars.js';

/** Which event a request is about. */
const eventParamsSchema = z.object({ eventId: z.uuid() });

/**
 * Registers the routes of the calendar's times.
 *
 * @param environment - Where routes are defined.
 * @param context - The service's collaborators.
 */
export function registerCalendarEventRoutes(
  environment: RouteEnvironment,
  context: ApiContext,
): void {
  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/calendar/occurrences',
      summary: 'Read the times things happen in the calendars over a range of days',
      tag: 'Calendar',
      permission: 'calendar:read',
      query: calendarOccurrencesQuerySchema,
      response: collectionSchema(calendarOccurrenceSchema),
    },

    /**
     * Reads the occurrences of a range: events, holidays and entities' values.
     *
     * @param route - The days, the calendars and who is asking.
     * @returns The occurrences, earliest first.
     */
    async (route): Promise<{ items: CalendarOccurrence[] }> => {
      requirePermission(route.identity, 'calendar:read');

      return {
        items: await readOccurrences(context.db, {
          from: route.query.from,
          to: route.query.to,
          calendarIds: route.query.calendars,
          identity: route.identity,
        }),
      };
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/calendar/search',
      summary: 'Look for events in every calendar by title, notes or model',
      tag: 'Calendar',
      permission: 'calendar:read',
      query: calendarSearchQuerySchema,
      response: calendarSearchResultSchema,
    },

    /**
     * Searches the events.
     *
     * @param route - What was typed and who is asking.
     * @returns The coming times and the past ones.
     */
    async (route): Promise<CalendarSearchResult> => {
      requirePermission(route.identity, 'calendar:read');

      return searchOccurrences(context.db, route.query.q, route.identity, context.now());
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/calendar/events',
      summary: 'Make an event',
      tag: 'Calendar',
      permission: 'calendar:read',
      body: calendarEventWriteSchema,
      response: calendarEventSchema,
    },

    /**
     * Makes an event in a calendar the caller edits.
     *
     * @param route - The event and who is asking.
     * @returns The event.
     */
    async (route): Promise<CalendarEvent> => {
      requirePermission(route.identity, 'calendar:read');

      const { zone } = await readCalendarSettings(context.db);
      const event = await createCalendarEvent(
        context.db,
        context.icons,
        route.identity,
        zone,
        route.body,
      );

      await settleCalendarWrite(context, route, 'calendar.event.create', event.id, {
        calendarId: event.calendarId,
        isRepeating: event.repeat !== null,
      });

      return event;
    },
  );

  defineRoute(
    environment,
    {
      method: 'PATCH',
      url: '/calendar/events/:eventId',
      summary: 'Change an event, or one time of a repeating one',
      tag: 'Calendar',
      permission: 'calendar:read',
      params: eventParamsSchema,
      query: calendarEventScopeQuerySchema,
      body: calendarEventPatchSchema,
      response: calendarEventSchema,
    },

    /**
     * Changes an event, or with `scope=one` the time of `occurrenceOn` alone.
     *
     * @param route - The change, the id, the scope and who is asking.
     * @returns The event as it now stands: for one time, the row that replaces it.
     */
    async (route): Promise<CalendarEvent> => {
      requirePermission(route.identity, 'calendar:read');

      const { zone } = await readCalendarSettings(context.db);
      const event = await updateCalendarEvent(
        context.db,
        context.icons,
        route.identity,
        zone,
        route.params.eventId,
        route.query,
        route.body,
      );

      await settleCalendarWrite(context, route, 'calendar.event.update', event.id, {
        calendarId: event.calendarId,
        scope: route.query.scope,
        changed: Object.keys(route.body),
      });

      return event;
    },
  );

  defineRoute(
    environment,
    {
      method: 'DELETE',
      url: '/calendar/events/:eventId',
      summary: 'Delete an event, or one time of a repeating one',
      tag: 'Calendar',
      permission: 'calendar:read',
      params: eventParamsSchema,
      query: calendarEventScopeQuerySchema,
      successStatus: 204,
    },

    /**
     * Deletes an event, or with `scope=one` the time of `occurrenceOn` alone.
     *
     * @param route - The id, the scope and who is asking.
     */
    async (route): Promise<void> => {
      requirePermission(route.identity, 'calendar:read');

      const calendarId = await deleteCalendarEvent(
        context.db,
        route.identity,
        route.params.eventId,
        route.query,
      );

      await settleCalendarWrite(context, route, 'calendar.event.delete', route.params.eventId, {
        calendarId,
        scope: route.query.scope,
        ...(route.query.occurrenceOn === undefined
          ? {}
          : { occurrenceOn: route.query.occurrenceOn }),
      });
      void route.reply.status(204);
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/calendar/holidays',
      summary: 'List the holidays of a year, hidden ones and the ones added by hand included',
      tag: 'Calendar',
      permission: 'calendar:read',
      query: calendarHolidaysQuerySchema,
      response: collectionSchema(calendarHolidaySchema),
    },

    /**
     * Lists a year's holidays.
     *
     * @param route - The year and who is asking.
     * @returns The holidays, by date.
     */
    async (route): Promise<{ items: CalendarHoliday[] }> => {
      requirePermission(route.identity, 'calendar:read');

      return { items: await listHolidays(context.db, route.query.year) };
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/calendar/places',
      summary: 'List the countries, regions and towns holidays are kept for',
      tag: 'Calendar',
      permission: 'calendar:read',
      query: calendarPlacesQuerySchema,
      response: calendarPlacesSchema,
    },

    /**
     * Lists what the place selects offer.
     *
     * @param route - The country, the region, what was typed and who is asking.
     * @returns Every country, the country's regions and, in Italy, the towns.
     */
    async (route): Promise<CalendarPlaces> => {
      requirePermission(route.identity, 'calendar:read');

      const { language } = await readCalendarSettings(context.db);

      return listPlaces(route.query, language);
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/calendar/places/suggest',
      summary: "Suggest the holidays' place from the house's position",
      tag: 'Calendar',
      permission: 'calendar:read',
      response: calendarPlaceSuggestionSchema,
    },

    /**
     * Suggests the place nearest the house.
     *
     * @param route - Who is asking.
     * @returns The place, or null when the house has no position or is not in Italy.
     */
    async (route): Promise<CalendarPlaceSuggestion> => {
      requirePermission(route.identity, 'calendar:read');

      return { place: suggestPlace((await readAutomationHouse(context.db)).position) };
    },
  );
}
