/**
 * Calendars: the calendars themselves, their models, their editors and their sources
 * (docs/calendar.md 6.1).
 *
 * Everyone who reads calendars sees every one. Making and deleting one needs `calendar:manage`;
 * changing one, its editors and its source, that or owning it (a personal calendar); its models
 * and a refresh of its source, the right to edit its events (`calendar-access.ts`). Testing a
 * source needs only `calendar:read`, so the owner of a personal calendar can give it one, and is
 * rate limited per person: each test makes `core` download or parse a file. After every write
 * `core` reads the calendars again, and the audit entry tells open pages (`library_event`).
 */
import { z } from 'zod';

import {
  CALENDAR_ICS_MAXIMUM_BYTES,
  calendarCreateSchema,
  calendarEditorsSchema,
  calendarIcsFileUploadSchema,
  calendarIcsStateSchema,
  calendarIcsTestResultSchema,
  calendarIcsTestSchema,
  calendarModelCreateSchema,
  calendarModelSchema,
  calendarModelUpdateSchema,
  calendarUpdateSchema,
  calendarUsageSchema,
  calendarViewSchema,
  ValidationError,
  type CalendarIcsState,
  type CalendarIcsTestResult,
  type CalendarModel,
  type CalendarUsage,
  type CalendarView,
} from '@nebulahome/contracts';

import { requirePermission } from '../auth/permissions.js';
import type { ApiContext } from '../context.js';
import { collectionSchema } from '../http/collection.js';
import { defineRoute, type RouteEnvironment } from '../http/route.js';
import { auditOrigin, type AuditRoute } from '../services/audit.js';
import type { CoreLink } from '../services/automations-core.js';
import { requireCanEditCalendar } from '../services/calendar-access.js';
import { refreshIcsOnCore, syncCalendarsOnCore, testIcsOnCore } from '../services/calendar-core.js';
import {
  createCalendar,
  createCalendarModel,
  deleteCalendar,
  deleteCalendarModel,
  dropIcsFile,
  listCalendars,
  readCalendarUsage,
  readCalendarView,
  replaceCalendarEditors,
  storeIcsFile,
  updateCalendar,
  updateCalendarModel,
} from '../services/calendar-store.js';

/** Which calendar a request is about. */
const calendarParamsSchema = z.object({ calendarId: z.uuid() });

/** Which model a request is about. */
const modelParamsSchema = z.object({ modelId: z.uuid() });

/** How many sources one person may test a minute: each one is a download or a parse. */
const ICS_TESTS_PER_MINUTE = { max: 10, timeWindow: 60_000 } as const;

/** The body a loaded file may come in: the file's 5 MB, as JSON, with room to spare. */
const ICS_FILE_BODY_LIMIT = 6 * 1024 * 1024;

/**
 * What a request to `core` needs, from the context and the request.
 *
 * @param context - The service context.
 * @param traceId - The request's trace id.
 * @returns The link.
 */
export function coreLinkOf(context: ApiContext, traceId: string): CoreLink {
  return {
    bus: context.bus,
    traceId,
    timeoutMs: context.config.API_BUS_TIMEOUT_MS,
    logger: context.logger,
  };
}

/**
 * After a calendar write: `core` reads the calendars again, and the write is recorded, which also
 * tells open pages the calendars changed.
 *
 * @param context - The service context.
 * @param route - Who asked, and from where.
 * @param action - The audit action, `calendar.…`.
 * @param resourceId - The calendar, event, model or link written.
 * @param details - What else is worth keeping.
 */
export async function settleCalendarWrite(
  context: ApiContext,
  route: AuditRoute,
  action: string,
  resourceId: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  await syncCalendarsOnCore(coreLinkOf(context, route.request.traceId));
  await context.audit.record({
    action,
    resourceType: 'calendar',
    resourceId,
    result: 'success',
    ...auditOrigin(route),
    details,
  });
}

/**
 * Registers the calendar routes.
 *
 * @param environment - Where routes are defined.
 * @param context - The service's collaborators.
 */
export function registerCalendarRoutes(environment: RouteEnvironment, context: ApiContext): void {
  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/calendars',
      summary: 'List the calendars, with what the caller may do to each',
      tag: 'Calendar',
      permission: 'calendar:read',
      response: collectionSchema(calendarViewSchema),
    },

    /**
     * Lists every calendar.
     *
     * @param route - Who is asking.
     * @returns The calendars, in their order.
     */
    async (route): Promise<{ items: CalendarView[] }> => {
      requirePermission(route.identity, 'calendar:read');

      return { items: await listCalendars(context.db, route.identity) };
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/calendars',
      summary: 'Make a calendar: empty, from an address or from a tested file',
      tag: 'Calendar',
      permission: 'calendar:manage',
      body: calendarCreateSchema,
      response: calendarViewSchema,
    },

    /**
     * Makes a calendar; its maker becomes one of its editors.
     *
     * @param route - The body and who is asking.
     * @returns The calendar.
     */
    async (route): Promise<CalendarView> => {
      requirePermission(route.identity, 'calendar:manage');

      const calendarId = await createCalendar(
        context.db,
        context.icons,
        route.identity,
        route.body,
      );

      await settleCalendarWrite(context, route, 'calendar.create', calendarId, {
        name: route.body.name,
        source: route.body.source.kind,
      });

      return readCalendarView(context.db, route.identity, calendarId);
    },
  );

  defineRoute(
    environment,
    {
      method: 'PATCH',
      url: '/calendars/:calendarId',
      summary: 'Change a calendar: name, colour, icon, Day off, place or source',
      tag: 'Calendar',
      permission: 'calendar:read',
      params: calendarParamsSchema,
      body: calendarUpdateSchema,
      response: calendarViewSchema,
    },

    /**
     * Changes a calendar; whoever manages the calendars, or the owner of a personal one.
     *
     * @param route - The body, the id and who is asking.
     * @returns The calendar as it now stands.
     */
    async (route): Promise<CalendarView> => {
      requirePermission(route.identity, 'calendar:read');

      await updateCalendar(
        context.db,
        context.icons,
        route.identity,
        route.params.calendarId,
        route.body,
      );
      await settleCalendarWrite(context, route, 'calendar.update', route.params.calendarId, {
        changed: Object.keys(route.body),
      });

      return readCalendarView(context.db, route.identity, route.params.calendarId);
    },
  );

  defineRoute(
    environment,
    {
      method: 'DELETE',
      url: '/calendars/:calendarId',
      summary: 'Delete a calendar with its events',
      tag: 'Calendar',
      permission: 'calendar:manage',
      params: calendarParamsSchema,
      successStatus: 204,
    },

    /**
     * Deletes a calendar; not Holidays, not a personal one.
     *
     * @param route - The id and who is asking.
     */
    async (route): Promise<void> => {
      requirePermission(route.identity, 'calendar:manage');

      const deleted = await deleteCalendar(context.db, route.params.calendarId);

      await settleCalendarWrite(context, route, 'calendar.delete', deleted.id, {
        name: deleted.name,
        kind: deleted.kind,
      });
      void route.reply.status(204);
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/calendars/:calendarId/usage',
      summary: 'Say what deleting a calendar would take with it',
      tag: 'Calendar',
      permission: 'calendar:read',
      params: calendarParamsSchema,
      response: calendarUsageSchema,
    },

    /**
     * Reads what uses a calendar.
     *
     * @param route - The id and who is asking.
     * @returns Its automations, share links and event counts.
     */
    async (route): Promise<CalendarUsage> => {
      requirePermission(route.identity, 'calendar:read');

      return readCalendarUsage(context.db, route.params.calendarId);
    },
  );

  defineRoute(
    environment,
    {
      method: 'PUT',
      url: '/calendars/:calendarId/editors',
      summary: "Replace a calendar's Editors",
      tag: 'Calendar',
      permission: 'calendar:read',
      params: calendarParamsSchema,
      body: calendarEditorsSchema,
      response: calendarViewSchema,
    },

    /**
     * Replaces who edits a calendar; whoever manages the calendars, or the owner of a personal one.
     *
     * @param route - The set, the id and who is asking.
     * @returns The calendar as it now stands.
     */
    async (route): Promise<CalendarView> => {
      requirePermission(route.identity, 'calendar:read');

      await replaceCalendarEditors(context.db, route.identity, route.params.calendarId, route.body);
      await settleCalendarWrite(context, route, 'calendar.editors', route.params.calendarId, {
        count: route.body.userIds.length,
      });

      return readCalendarView(context.db, route.identity, route.params.calendarId);
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/calendars/:calendarId/models',
      summary: 'Add a model to a calendar',
      tag: 'Calendar',
      permission: 'calendar:read',
      params: calendarParamsSchema,
      body: calendarModelCreateSchema,
      response: calendarModelSchema,
    },

    /**
     * Adds a model, last in the calendar's list; whoever edits the calendar.
     *
     * @param route - The model, the calendar and who is asking.
     * @returns The model.
     */
    async (route): Promise<CalendarModel> => {
      requirePermission(route.identity, 'calendar:read');

      const model = await createCalendarModel(
        context.db,
        context.icons,
        route.identity,
        route.params.calendarId,
        route.body,
      );

      await settleCalendarWrite(context, route, 'calendar.model.create', model.id, {
        calendarId: model.calendarId,
        name: model.name,
      });

      return model;
    },
  );

  defineRoute(
    environment,
    {
      method: 'PATCH',
      url: '/calendar-models/:modelId',
      summary: 'Change a model, or move it in its list',
      tag: 'Calendar',
      permission: 'calendar:read',
      params: modelParamsSchema,
      body: calendarModelUpdateSchema,
      response: calendarModelSchema,
    },

    /**
     * Changes a model; whoever edits its calendar.
     *
     * @param route - The change, the id and who is asking.
     * @returns The model as it now stands.
     */
    async (route): Promise<CalendarModel> => {
      requirePermission(route.identity, 'calendar:read');

      const model = await updateCalendarModel(
        context.db,
        context.icons,
        route.identity,
        route.params.modelId,
        route.body,
      );

      await settleCalendarWrite(context, route, 'calendar.model.update', model.id, {
        calendarId: model.calendarId,
        changed: Object.keys(route.body),
      });

      return model;
    },
  );

  defineRoute(
    environment,
    {
      method: 'DELETE',
      url: '/calendar-models/:modelId',
      summary: 'Delete a model; its events keep their place',
      tag: 'Calendar',
      permission: 'calendar:read',
      params: modelParamsSchema,
      successStatus: 204,
    },

    /**
     * Deletes a model; whoever edits its calendar.
     *
     * @param route - The id and who is asking.
     */
    async (route): Promise<void> => {
      requirePermission(route.identity, 'calendar:read');

      const calendarId = await deleteCalendarModel(
        context.db,
        route.identity,
        route.params.modelId,
      );

      await settleCalendarWrite(context, route, 'calendar.model.delete', route.params.modelId, {
        calendarId,
      });
      void route.reply.status(204);
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/calendars/ics/test',
      summary: 'Ask whether an address is a calendar, and what it holds',
      tag: 'Calendar',
      permission: 'calendar:read',
      body: calendarIcsTestSchema,
      response: calendarIcsTestResultSchema,
      successStatus: 200,
      rateLimit: ICS_TESTS_PER_MINUTE,
    },

    /**
     * Has `core` read an address.
     *
     * @param route - The address, the calendar whose models to match, and who is asking.
     * @returns What it found, or why it could not read it.
     */
    async (route): Promise<CalendarIcsTestResult> => {
      requirePermission(route.identity, 'calendar:read');

      return testIcsOnCore(coreLinkOf(context, route.request.traceId), route.body);
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/calendar/ics-files',
      summary: 'Keep a .ics file read in the browser and say what it holds',
      tag: 'Calendar',
      permission: 'calendar:read',
      body: calendarIcsFileUploadSchema,
      response: calendarIcsTestResultSchema,
      successStatus: 200,
      rateLimit: ICS_TESTS_PER_MINUTE,
      bodyLimit: ICS_FILE_BODY_LIMIT,
    },

    /**
     * Keeps the file on no calendar and has `core` test it by its id; the bus carries the id,
     * never the text. A file that fails is not kept: there is nothing to attach.
     *
     * @param route - The file's name and text, and who is asking.
     * @returns What it holds, with the id a calendar then names it by; or why it is no calendar.
     */
    async (route): Promise<CalendarIcsTestResult> => {
      requirePermission(route.identity, 'calendar:read');

      if (Buffer.byteLength(route.body.text, 'utf8') > CALENDAR_ICS_MAXIMUM_BYTES) {
        return { kind: 'error', code: 'too_big', detail: 'The file is larger than 5 MB' };
      }

      const fileId = await storeIcsFile(context.db, route.body, route.identity.userId);
      let result: CalendarIcsTestResult;

      try {
        result = await testIcsOnCore(coreLinkOf(context, route.request.traceId), {
          fileId,
          ...(route.body.calendarId === undefined ? {} : { calendarId: route.body.calendarId }),
        });
      } catch (error: unknown) {
        await dropIcsFile(context.db, fileId);

        throw error;
      }

      if (result.kind === 'error') {
        await dropIcsFile(context.db, fileId);

        return result;
      }

      await context.audit.record({
        action: 'calendar.ics_file.upload',
        resourceType: 'calendar',
        resourceId: fileId,
        result: 'success',
        ...auditOrigin(route),
        details: { name: route.body.name, eventCount: result.eventCount },
      });

      return { ...result, fileId };
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/calendars/:calendarId/ics/refresh',
      summary: "Read a calendar's source now",
      tag: 'Calendar',
      permission: 'calendar:read',
      params: calendarParamsSchema,
      response: calendarIcsStateSchema,
      successStatus: 200,
    },

    /**
     * Has `core` read the source now; whoever edits the calendar.
     *
     * @param route - The id and who is asking.
     * @returns The source's state after the read.
     * @throws {ValidationError} When the calendar reads no source.
     */
    async (route): Promise<CalendarIcsState> => {
      requirePermission(route.identity, 'calendar:read');

      const calendar = await readCalendarView(context.db, route.identity, route.params.calendarId);

      requireCanEditCalendar(route.identity, calendar);

      if (calendar.icsUrl === null && calendar.icsFile === null) {
        throw new ValidationError('This calendar reads no address and no file', {
          details: { calendarId: calendar.id },
        });
      }

      const state = await refreshIcsOnCore(coreLinkOf(context, route.request.traceId), calendar.id);

      await context.audit.record({
        action: 'calendar.ics.refresh',
        resourceType: 'calendar',
        resourceId: calendar.id,
        result: 'success',
        ...auditOrigin(route),
        details: { eventCount: state.eventCount, error: state.error?.code ?? null },
      });

      return state;
    },
  );
}
