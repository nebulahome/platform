/**
 * Making, changing and deleting the events typed in the house (docs/calendar.md 6.1).
 *
 * A repeating event is one row and its rule. Changing one time of it alone writes a row of its
 * own that names the series and the day it replaces; deleting one time alone adds the day to the
 * series' `skipped_on`. Deleting a row that replaced a time skips that day in the series too, or
 * the time would come back as it was. Events a source brought in are never changed here: they
 * change at their source. Every save keeps the house's zone of the moment, the wall clock a
 * repeating event's times are kept in.
 */
import { and, eq, sql } from 'drizzle-orm';

import {
  calendarEventSchema,
  calendarEventTimeProblem,
  calendarRepeatSchema,
  NotFoundError,
  occurrencesOf,
  PermissionError,
  ValidationError,
  type CalendarEvent,
  type CalendarEventPatch,
  type CalendarEventScopeQuery,
  type CalendarEventWrite,
  type CalendarRepeat,
  type DayKey,
  type Identity,
} from '@nebulahome/contracts';
import { schema, type Database } from '@nebulahome/db';

import { requireCanEditCalendar } from './calendar-access.js';
import { readCalendar } from './calendar-store.js';
import { checkIcon, type IconLookup } from './icon-lookup.js';

/** An event row. */
type EventRow = typeof schema.registry.calendarEvents.$inferSelect;

/** An event's fields as they are written. */
type EventFields = Omit<
  typeof schema.registry.calendarEvents.$inferInsert,
  'id' | 'createdAt' | 'updatedAt'
>;

const events = schema.registry.calendarEvents;

/**
 * The repeat rule of a row, when it holds one.
 *
 * @param row - The event.
 * @returns The rule, or null.
 */
function repeatOf(row: EventRow): CalendarRepeat | null {
  const parsed = calendarRepeatSchema.safeParse(row.repeat);

  return parsed.success ? parsed.data : null;
}

/**
 * The fields of a row that a write carries on: all but its id and its stamps.
 *
 * @param row - The row.
 * @returns Its fields.
 */
function fieldsOf(row: EventRow): EventFields {
  return {
    calendarId: row.calendarId,
    modelId: row.modelId,
    title: row.title,
    icon: row.icon,
    notes: row.notes,
    isAllDay: row.isAllDay,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    timeZone: row.timeZone,
    repeat: row.repeat,
    skippedOn: row.skippedOn,
    seriesId: row.seriesId,
    occurrenceOn: row.occurrenceOn,
    source: row.source,
    sourceUid: row.sourceUid,
    createdBy: row.createdBy,
  };
}

/**
 * A row as the API tells it.
 *
 * @param row - The row.
 * @returns The event.
 */
function toEvent(row: EventRow): CalendarEvent {
  return calendarEventSchema.parse({
    ...row,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    repeat: repeatOf(row),
    source: row.source === 'ics' ? 'ics' : 'user',
  });
}

/**
 * Reads an event someone may change: typed in the house, in a calendar they edit.
 *
 * @param db - The database.
 * @param identity - Who asks.
 * @param eventId - Which.
 * @returns The row.
 * @throws {NotFoundError} When no event has that id.
 * @throws {PermissionError} When it came from a source, or they do not edit its calendar.
 */
async function editableEvent(db: Database, identity: Identity, eventId: string): Promise<EventRow> {
  const [row] = await db.select().from(events).where(eq(events.id, eventId));

  if (row === undefined) {
    throw new NotFoundError('No event has that id', { details: { eventId } });
  }

  if (row.source !== 'user') {
    throw new PermissionError('An event from a source changes at its source', {
      details: { eventId, source: row.source },
    });
  }

  requireCanEditCalendar(identity, await readCalendar(db, row.calendarId));

  return row;
}

/**
 * Refuses a model that is not one of a calendar's.
 *
 * @param db - The database.
 * @param calendarId - The calendar.
 * @param modelId - The model.
 * @throws {ValidationError} When it is not.
 */
async function requireModelOf(db: Database, calendarId: string, modelId: string): Promise<void> {
  const [found] = await db
    .select({ id: schema.registry.calendarModels.id })
    .from(schema.registry.calendarModels)
    .where(
      and(
        eq(schema.registry.calendarModels.id, modelId),
        eq(schema.registry.calendarModels.calendarId, calendarId),
      ),
    );

  if (found === undefined) {
    throw new ValidationError('The model is not one of the calendar’s', {
      details: { issues: [{ path: 'modelId', message: 'Not a model of this calendar' }] },
    });
  }
}

/**
 * Refuses times that do not hold: days for an all-day event, instants for a timed one, the end
 * not before the start.
 *
 * @param fields - The event as it would be written.
 * @throws {ValidationError} Naming why.
 */
function requireTimes(fields: EventFields): void {
  const problem = calendarEventTimeProblem({
    isAllDay: fields.isAllDay,
    startsOn: fields.startsOn,
    endsOn: fields.endsOn,
    startsAt: fields.startsAt?.toISOString() ?? null,
    endsAt: fields.endsAt?.toISOString() ?? null,
  });

  if (problem !== null) {
    throw new ValidationError(problem, {
      details: { issues: [{ path: 'startsOn', message: problem }] },
    });
  }
}

/**
 * An instant as a write gives it.
 *
 * @param moment - ISO 8601, or null.
 * @returns The instant, or null.
 */
function instantOrNull(moment: string | null | undefined): Date | null {
  return typeof moment === 'string' ? new Date(moment) : null;
}

/**
 * Lays a change over an event's fields. The pair of times an event does not use is cleared, so a
 * change from all day to timed needs only the new times.
 *
 * @param base - The event as it is.
 * @param body - The change.
 * @returns The event as it would be.
 */
function merged(base: EventFields, body: CalendarEventPatch): EventFields {
  const isAllDay = body.isAllDay ?? base.isAllDay;

  return {
    ...base,
    ...(body.title === undefined ? {} : { title: body.title }),
    ...(body.icon === undefined ? {} : { icon: body.icon }),
    ...(body.notes === undefined ? {} : { notes: body.notes }),
    ...(body.repeat === undefined ? {} : { repeat: body.repeat }),
    isAllDay,
    startsOn: isAllDay ? (body.startsOn === undefined ? base.startsOn : body.startsOn) : null,
    endsOn: isAllDay ? (body.endsOn === undefined ? base.endsOn : body.endsOn) : null,
    startsAt: isAllDay
      ? null
      : body.startsAt === undefined
        ? base.startsAt
        : instantOrNull(body.startsAt),
    endsAt: isAllDay ? null : body.endsAt === undefined ? base.endsAt : instantOrNull(body.endsAt),
  };
}

/**
 * Makes an event.
 *
 * @param db - The database.
 * @param icons - The catalogue, to check the icon against.
 * @param identity - Who makes it.
 * @param zone - The house's zone now.
 * @param body - The event.
 * @returns The event.
 * @throws {NotFoundError} When no calendar has the id.
 * @throws {PermissionError} When they do not edit the calendar.
 * @throws {ValidationError} When the icon or the model is not one it may have.
 */
export async function createCalendarEvent(
  db: Database,
  icons: IconLookup,
  identity: Identity,
  zone: string,
  body: CalendarEventWrite,
): Promise<CalendarEvent> {
  requireCanEditCalendar(identity, await readCalendar(db, body.calendarId));

  if (typeof body.icon === 'string') {
    checkIcon(icons, body.icon);
  }

  if (typeof body.modelId === 'string') {
    await requireModelOf(db, body.calendarId, body.modelId);
  }

  const [created] = await db
    .insert(events)
    .values({
      calendarId: body.calendarId,
      modelId: body.modelId ?? null,
      title: body.title,
      icon: body.icon ?? null,
      notes: body.notes ?? null,
      isAllDay: body.isAllDay,
      startsOn: body.isAllDay ? (body.startsOn ?? null) : null,
      endsOn: body.isAllDay ? (body.endsOn ?? null) : null,
      startsAt: body.isAllDay ? null : instantOrNull(body.startsAt),
      endsAt: body.isAllDay ? null : instantOrNull(body.endsAt),
      timeZone: zone,
      repeat: body.repeat ?? null,
      source: 'user',
      createdBy: identity.userId,
    })
    .returning();

  if (created === undefined) {
    throw new NotFoundError('The event could not be made');
  }

  return toEvent(created);
}

/**
 * Changes an event: the whole of it, or one time of a series (`scope` `one`), which then gets a
 * row of its own. Moving it to another calendar needs the right to edit that one too.
 *
 * @param db - The database.
 * @param icons - The catalogue, to check the icon against.
 * @param identity - Who asks.
 * @param zone - The house's zone now.
 * @param eventId - Which.
 * @param scope - All of it, or the time of one day.
 * @param body - What to change.
 * @returns The event as it now stands: the row that replaces the time, for one time.
 * @throws {NotFoundError} When no event has the id, or the series has no time that day.
 * @throws {PermissionError} When it came from a source, or they do not edit a calendar it is in.
 * @throws {ValidationError} When the times do not hold, or the icon or the model does not fit.
 */
export async function updateCalendarEvent(
  db: Database,
  icons: IconLookup,
  identity: Identity,
  zone: string,
  eventId: string,
  scope: CalendarEventScopeQuery,
  body: CalendarEventPatch,
): Promise<CalendarEvent> {
  const row = await editableEvent(db, identity, eventId);
  const repeat = repeatOf(row);
  const day = scope.scope === 'one' && repeat !== null ? (scope.occurrenceOn ?? null) : null;

  if (day !== null) {
    const [replacing] = await db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.seriesId, row.id), eq(events.occurrenceOn, day)));

    // That time has a row of its own already: the change is that row's.
    if (replacing !== undefined) {
      return updateCalendarEvent(db, icons, identity, zone, replacing.id, { scope: 'all' }, body);
    }
  }

  const calendarId = body.calendarId ?? row.calendarId;

  if (calendarId !== row.calendarId) {
    requireCanEditCalendar(identity, await readCalendar(db, calendarId));
  }

  if (typeof body.icon === 'string') {
    checkIcon(icons, body.icon);
  }

  // A model belongs to its calendar: one moved without a model of the new calendar has none.
  const modelId =
    body.modelId !== undefined ? body.modelId : calendarId === row.calendarId ? row.modelId : null;

  if (modelId !== null && modelId !== row.modelId) {
    await requireModelOf(db, calendarId, modelId);
  }

  const base: EventFields = { ...fieldsOf(row), calendarId, modelId, timeZone: zone };

  if (day !== null) {
    if (body.repeat !== undefined && body.repeat !== null) {
      throw new ValidationError('One time of a series does not repeat', {
        details: { issues: [{ path: 'repeat', message: 'Change the whole series to repeat' }] },
      });
    }

    return replaceOneTime(db, row, day, base, body);
  }

  const fields = merged(base, body);

  requireTimes(fields);

  const changed = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(events)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(events.id, row.id))
      .returning();

    if (calendarId !== row.calendarId) {
      // The times changed one by one go where their series goes.
      await tx.update(events).set({ calendarId, modelId: null }).where(eq(events.seriesId, row.id));
    }

    return updated;
  });

  return toEvent(changed ?? row);
}

/**
 * Writes the row that replaces one time of a series.
 *
 * @param db - The database.
 * @param series - The repeating event.
 * @param day - The day of the series the time is.
 * @param base - The series' fields, with the calendar, model and zone it will have.
 * @param body - The change.
 * @returns The new row.
 * @throws {NotFoundError} When the series has no time that day.
 * @throws {ValidationError} When the times do not hold.
 */
async function replaceOneTime(
  db: Database,
  series: EventRow,
  day: DayKey,
  base: EventFields,
  body: CalendarEventPatch,
): Promise<CalendarEvent> {
  const time = occurrencesOf(
    {
      isAllDay: series.isAllDay,
      startsOn: series.startsOn,
      endsOn: series.endsOn,
      startsAt: series.startsAt?.toISOString() ?? null,
      endsAt: series.endsAt?.toISOString() ?? null,
      timeZone: series.timeZone,
      repeat: repeatOf(series),
      skippedOn: series.skippedOn,
    },
    day,
    day,
    series.timeZone,
  ).find((each) => each.occurrenceOn === day);

  if (time === undefined) {
    throw new NotFoundError('The series has no time on that day', {
      details: { eventId: series.id, occurrenceOn: day },
    });
  }

  const fields = merged(
    {
      ...base,
      ...(time.isAllDay
        ? { startsOn: time.startsOn, endsOn: time.endsOn, startsAt: null, endsAt: null }
        : {
            startsOn: null,
            endsOn: null,
            startsAt: new Date(time.startsAt),
            endsAt: new Date(time.endsAt),
          }),
      repeat: null,
      skippedOn: [],
      seriesId: series.id,
      occurrenceOn: day,
    },
    body,
  );

  requireTimes(fields);

  const [created] = await db.insert(events).values(fields).returning();

  if (created === undefined) {
    throw new NotFoundError('The time could not be changed');
  }

  return toEvent(created);
}

/**
 * Deletes an event: the whole of it, or one time of a series (`scope` `one`).
 *
 * @param db - The database.
 * @param identity - Who asks.
 * @param eventId - Which.
 * @param scope - All of it, or the time of one day.
 * @returns The calendar it was in.
 * @throws {NotFoundError} When no event has the id.
 * @throws {PermissionError} When it came from a source, or they do not edit its calendar.
 */
export async function deleteCalendarEvent(
  db: Database,
  identity: Identity,
  eventId: string,
  scope: CalendarEventScopeQuery,
): Promise<string> {
  const row = await editableEvent(db, identity, eventId);

  /**
   * Adds a day to a series' skipped days, once.
   *
   * @param tx - The transaction.
   * @param seriesId - The series.
   * @param day - The day.
   */
  const skip = async (
    tx: Pick<Database, 'update'>,
    seriesId: string,
    day: DayKey,
  ): Promise<void> => {
    await tx
      .update(events)
      .set({ skippedOn: sql`array_append(${events.skippedOn}, ${day}::date)` })
      .where(and(eq(events.id, seriesId), sql`NOT (${day}::date = ANY(${events.skippedOn}))`));
  };

  await db.transaction(async (tx) => {
    if (scope.scope === 'one' && repeatOf(row) !== null && scope.occurrenceOn !== undefined) {
      await skip(tx, row.id, scope.occurrenceOn);
      await tx
        .delete(events)
        .where(and(eq(events.seriesId, row.id), eq(events.occurrenceOn, scope.occurrenceOn)));

      return;
    }

    if (row.seriesId !== null && row.occurrenceOn !== null) {
      await skip(tx, row.seriesId, row.occurrenceOn);
    }

    await tx.delete(events).where(eq(events.id, row.id));
  });

  return row.calendarId;
}
