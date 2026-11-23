/**
 * The subjects the API keeps the calendars in step on (`calendar-bus.ts` in the contracts).
 *
 * After every write of a calendar, a model, an event, a `calendar.*` setting or an entity's
 * calendar, the API asks `core` to read the calendars again: the entities and the triggers follow
 * at once, and a source never tried is read without the API waiting for it. A test of a source
 * and a refresh are waited for: somebody is looking at the card.
 */
import type { BusClient, BusSubscription } from '@nebulahome/bus';
import {
  busSubjects,
  calendarIcsRefreshRequestSchema,
  calendarIcsTestRequestSchema,
  CORE_CALENDAR_ICS_REFRESH_METHOD,
  CORE_CALENDAR_ICS_TEST_METHOD,
  CORE_SERVICE,
  CORE_SYNC_CALENDARS_METHOD,
  syncCalendarsRequestSchema,
  type CalendarIcsRefreshReply,
  type CalendarIcsRefreshRequest,
  type CalendarIcsTestReply,
  type CalendarIcsTestRequest,
  type SyncCalendarsReply,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';

import type { CalendarMonitor } from './calendar-monitor.js';
import type { IcsFetcher } from './ics-fetcher.js';

/** What the calendar service needs. */
export type CalendarServiceOptions = {
  readonly client: BusClient;
  readonly monitor: CalendarMonitor;
  readonly fetcher: IcsFetcher;
  readonly logger: PlatformLogger;
};

/**
 * Serves the calendar subjects.
 *
 * @param options - The bus client, the monitor, the fetcher and the logger.
 * @returns The subscriptions, to unsubscribe on shutdown.
 */
export function startCalendarService(options: CalendarServiceOptions): BusSubscription[] {
  const { client, monitor, fetcher, logger } = options;

  return [
    client.serve(
      busSubjects.service(CORE_SERVICE, CORE_SYNC_CALENDARS_METHOD),
      syncCalendarsRequestSchema,

      /**
       * Reads the calendars again, and their sources never tried.
       *
       * @returns How many calendars there are.
       */
      async (): Promise<SyncCalendarsReply> => {
        const calendarCount = await monitor.reload();

        void fetcher.syncCalendars();
        logger.info({ calendarCount }, 'Read the calendars again');

        return { calendarCount };
      },
    ),
    client.serve(
      busSubjects.service(CORE_SERVICE, CORE_CALENDAR_ICS_TEST_METHOD),
      calendarIcsTestRequestSchema,

      /**
       * Says what an address or a loaded file holds.
       *
       * @param request - The address or the file, and the calendar whose models to match.
       * @returns What it holds, or why it cannot be read.
       */
      async (request: CalendarIcsTestRequest): Promise<CalendarIcsTestReply> =>
        fetcher.test(request),
    ),
    client.serve(
      busSubjects.service(CORE_SERVICE, CORE_CALENDAR_ICS_REFRESH_METHOD),
      calendarIcsRefreshRequestSchema,

      /**
       * Reads a calendar's source now.
       *
       * @param request - Which calendar.
       * @returns Its source's state after the read.
       */
      async (request: CalendarIcsRefreshRequest): Promise<CalendarIcsRefreshReply> =>
        fetcher.refresh(request.calendarId),
    ),
  ];
}
