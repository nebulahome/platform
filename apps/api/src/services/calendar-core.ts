/**
 * What the API asks `core` about calendars (`calendar-bus.ts` in the contracts).
 *
 * After a write, `sync_calendars` is best effort like every other sync: the row is written, and a
 * `core` that is away is asked again in the background and reads every calendar when it starts.
 * Testing or refreshing a source is different: the person is waiting for what it found, so a
 * `core` that is away is a 503 they see.
 */
import {
  busSubjects,
  calendarIcsRefreshReplySchema,
  calendarIcsTestReplySchema,
  CORE_CALENDAR_ICS_REFRESH_METHOD,
  CORE_CALENDAR_ICS_TEST_METHOD,
  CORE_SERVICE,
  CORE_SYNC_CALENDARS_METHOD,
  syncCalendarsReplySchema,
  type CalendarIcsRefreshReply,
  type CalendarIcsTestReply,
  type CalendarIcsTestRequest,
} from '@nebulahome/contracts';

import { requireBus } from './ask-service.js';
import type { CoreLink } from './automations-core.js';
import { askCore } from './core-retry.js';

/** How long `core` has to read a source: its download waits 20 s, then it parses. */
const ICS_TIMEOUT_MS = 35_000;

/**
 * Asks `core` to read the calendars again after a write.
 *
 * @param link - The bus, the trace id and the log.
 */
export async function syncCalendarsOnCore(link: CoreLink): Promise<void> {
  const { bus } = link;

  if (bus === undefined) {
    return;
  }

  await askCore(
    async () => {
      await bus.request(
        busSubjects.service(CORE_SERVICE, CORE_SYNC_CALENDARS_METHOD),
        {},
        syncCalendarsReplySchema,
        { traceId: link.traceId, timeoutMs: link.timeoutMs },
      );
    },
    (error) => {
      link.logger.warn({ err: error }, 'Core did not read the calendars again; it is asked again');
    },
  );
}

/**
 * Asks `core` what an address or a stored file holds.
 *
 * @param link - The bus and the trace id.
 * @param request - The address or the file's id, and the calendar whose models to match.
 * @returns What it found, or why it could not read it.
 * @throws {DeviceUnavailableError} When the bus is away or `core` does not answer.
 */
export async function testIcsOnCore(
  link: CoreLink,
  request: CalendarIcsTestRequest,
): Promise<CalendarIcsTestReply> {
  return requireBus(link, { dependency: 'core' }).request(
    busSubjects.service(CORE_SERVICE, CORE_CALENDAR_ICS_TEST_METHOD),
    request,
    calendarIcsTestReplySchema,
    { traceId: link.traceId, timeoutMs: ICS_TIMEOUT_MS },
  );
}

/**
 * Asks `core` to read a calendar's source now.
 *
 * @param link - The bus and the trace id.
 * @param calendarId - The calendar.
 * @returns Its ICS state after the read.
 * @throws {DeviceUnavailableError} When the bus is away or `core` does not answer.
 */
export async function refreshIcsOnCore(
  link: CoreLink,
  calendarId: string,
): Promise<CalendarIcsRefreshReply> {
  return requireBus(link, { dependency: 'core' }).request(
    busSubjects.service(CORE_SERVICE, CORE_CALENDAR_ICS_REFRESH_METHOD),
    { calendarId },
    calendarIcsRefreshReplySchema,
    { traceId: link.traceId, timeoutMs: ICS_TIMEOUT_MS },
  );
}
