/**
 * What the API asks `core` about calendars, on `svc.core.<method>` like `sync_house`.
 *
 * The API writes the rows; `core` owns the calendar entities, the times the triggers fire at and
 * the ICS sources, so it reads the rows back itself after every write (`sync_calendars`). A test
 * of a loaded file carries the file's id, never its text: NATS takes 1 MB, a file 5.
 */
import { z } from 'zod';

import { calendarIcsStateSchema, calendarIcsTestResultSchema } from './calendar-schemas.js';

/** Reads the calendars, their models and events again. */
export const CORE_SYNC_CALENDARS_METHOD = 'sync_calendars';

/** Reads an address or a stored file and says what it holds. */
export const CORE_CALENDAR_ICS_TEST_METHOD = 'calendar_ics_test';

/** Reads a calendar's source now, rather than at the next hourly round. */
export const CORE_CALENDAR_ICS_REFRESH_METHOD = 'calendar_ics_refresh';

/** Asks `core` to read the calendars again. Empty, so it can grow a field. */
export const syncCalendarsRequestSchema = z.strictObject({});

/** Asks `core` to read the calendars again. */
export type SyncCalendarsRequest = z.output<typeof syncCalendarsRequestSchema>;

/** How many calendars `core` now keeps. */
export const syncCalendarsReplySchema = z.object({ calendarCount: z.int().min(0) });

/** How many calendars `core` now keeps. */
export type SyncCalendarsReply = z.output<typeof syncCalendarsReplySchema>;

/**
 * Asks `core` to test an address or a stored file. With `calendarId`, the events are matched
 * against that calendar's models (D12); without, none match.
 */
export const calendarIcsTestRequestSchema = z.union([
  z.strictObject({ url: z.string().min(1).max(2048), calendarId: z.uuid().optional() }),
  z.strictObject({ fileId: z.uuid(), calendarId: z.uuid().optional() }),
]);

/** Asks `core` to test a source. */
export type CalendarIcsTestRequest = z.output<typeof calendarIcsTestRequestSchema>;

/** What the test found. */
export const calendarIcsTestReplySchema = calendarIcsTestResultSchema;

/** What the test found. */
export type CalendarIcsTestReply = z.output<typeof calendarIcsTestReplySchema>;

/** Asks `core` to read one calendar's source now. */
export const calendarIcsRefreshRequestSchema = z.strictObject({ calendarId: z.uuid() });

/** Asks `core` to read one calendar's source now. */
export type CalendarIcsRefreshRequest = z.output<typeof calendarIcsRefreshRequestSchema>;

/** How the read went: the calendar's ICS state after it. */
export const calendarIcsRefreshReplySchema = calendarIcsStateSchema;

/** How the read went. */
export type CalendarIcsRefreshReply = z.output<typeof calendarIcsRefreshReplySchema>;
