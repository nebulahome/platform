/**
 * The calendars themselves: their rows, models, editors, sources, and the personal calendar
 * each account has (docs/calendar.md 6).
 *
 * Who may do what is `calendar-access.ts`; this file reads the rows those rights need and writes
 * what a route asked once they allow it. A calendar's source is an address or a loaded file, never
 * both: changing it drops the events the old one brought in and clears the state `core` kept of
 * it, so `core` reads the new one as never tried (`sync_calendars`).
 */
import { and, asc, count, eq, inArray, isNotNull, isNull, like, sql } from 'drizzle-orm';

import {
  CALENDAR_KINDS,
  calendarIcsStateSchema,
  calendarModelSchema,
  calendarPersonSchema,
  calendarViewSchema,
  ConflictError,
  NotFoundError,
  ValidationError,
  type CalendarCreate,
  type CalendarEditors,
  type CalendarKind,
  type CalendarModel,
  type CalendarModelCreate,
  type CalendarModelUpdate,
  type CalendarPerson as CalendarPersonView,
  type CalendarUpdate,
  type CalendarUsage,
  type CalendarView,
  type Identity,
} from '@nebulahome/contracts';
import { schema, type Database } from '@nebulahome/db';

import { readAvatarUrls } from './avatars.js';
import {
  canChangeCalendar,
  canEditCalendar,
  requireCanChangeCalendar,
  requireCanEditCalendar,
  type CalendarRights,
} from './calendar-access.js';
import { checkIcon, type IconLookup } from './icon-lookup.js';

/** What a database handle or a transaction inside one can do, as far as this file needs. */
export type Writer = Pick<Database, 'select' | 'insert' | 'delete' | 'update'>;

/** A calendar as the rights and the writes need it. */
export type CalendarRecord = CalendarRights & {
  readonly id: string;
  readonly name: string;
  readonly icsUrl: string | null;
  readonly icsState: unknown;
  readonly isDayOff: boolean;
};

/** The colours personal calendars take in turn, as the migration gave them. */
const PERSONAL_COLORS = ['amber', 'teal', 'pink', 'violet', 'cyan', 'orange', 'lime', 'blue'];

/** The roles that edit House and Waste from the start. */
const HOUSE_EDITOR_ROLES = new Set(['owner', 'admin', 'member']);

const calendars = schema.registry.calendars;
const models = schema.registry.calendarModels;
const editors = schema.registry.calendarEditors;
const events = schema.registry.calendarEvents;
const files = schema.registry.calendarIcsFiles;

/**
 * A kind as the column holds it, narrowed.
 *
 * @param kind - The column's value.
 * @returns The kind; `custom` for one this build does not know.
 */
export function calendarKindOf(kind: string): CalendarKind {
  return CALENDAR_KINDS.find((each) => each === kind) ?? 'custom';
}

/**
 * Reads calendars with their editors, as the rights need them.
 *
 * @param db - The database.
 * @param calendarIds - Which; every calendar when left out.
 * @returns The calendars, by id.
 */
export async function readCalendarRecords(
  db: Writer,
  calendarIds?: readonly string[],
): Promise<Map<string, CalendarRecord>> {
  const [rows, editorRows] = await Promise.all([
    db
      .select({
        id: calendars.id,
        kind: calendars.kind,
        name: calendars.name,
        ownerUserId: calendars.ownerUserId,
        icsUrl: calendars.icsUrl,
        icsState: calendars.icsState,
        isDayOff: calendars.isDayOff,
      })
      .from(calendars)
      .where(calendarIds === undefined ? undefined : inArray(calendars.id, [...calendarIds])),
    db
      .select({ calendarId: editors.calendarId, userId: editors.userId })
      .from(editors)
      .where(calendarIds === undefined ? undefined : inArray(editors.calendarId, [...calendarIds])),
  ]);

  return new Map(
    rows.map((row) => [
      row.id,
      {
        ...row,
        kind: calendarKindOf(row.kind),
        editorIds: editorRows
          .filter((each) => each.calendarId === row.id)
          .map((each) => each.userId),
      },
    ]),
  );
}

/**
 * Reads one calendar, or says there is none.
 *
 * @param db - The database.
 * @param calendarId - Which.
 * @returns The calendar.
 * @throws {NotFoundError} When no calendar has that id.
 */
export async function readCalendar(db: Writer, calendarId: string): Promise<CalendarRecord> {
  const found = (await readCalendarRecords(db, [calendarId])).get(calendarId);

  if (found === undefined) {
    throw new NotFoundError('No calendar has that id', { details: { calendarId } });
  }

  return found;
}

/**
 * Whether a calendar's last read of its source failed: its events are then shown greyed.
 *
 * @param icsState - The state `core` keeps.
 * @returns True when it holds an error.
 */
export function isIcsStale(icsState: unknown): boolean {
  const parsed = calendarIcsStateSchema.safeParse(icsState ?? {});

  return parsed.success && parsed.data.error !== null;
}

/**
 * Lists the calendars as someone is told them: every one, with what they may do to it.
 *
 * @param db - The database.
 * @param identity - Who is asking.
 * @param calendarIds - Which; every calendar when left out.
 * @returns The calendars, in their order.
 */
export async function listCalendars(
  db: Database,
  identity: Identity,
  calendarIds?: readonly string[],
): Promise<CalendarView[]> {
  const only = calendarIds === undefined ? undefined : [...calendarIds];
  const [rows, modelRows, editorRows, fileRows, entityRows, counts] = await Promise.all([
    db
      .select()
      .from(calendars)
      .where(only === undefined ? undefined : inArray(calendars.id, only))
      .orderBy(asc(calendars.position), asc(calendars.name)),
    db.select().from(models).orderBy(asc(models.position), asc(models.name)),
    db.select({ calendarId: editors.calendarId, userId: editors.userId }).from(editors),
    db
      .select({
        calendarId: files.calendarId,
        name: files.name,
        size: files.size,
        uploadedAt: files.createdAt,
        uploadedBy: files.uploadedBy,
      })
      .from(files)
      .where(isNotNull(files.calendarId)),

    // A calendar's own entity is the `calendar.` one `core` made and marked with it.
    db
      .select({
        calendarId: schema.registry.entities.calendarId,
        entityId: schema.registry.entities.entityId,
      })
      .from(schema.registry.entities)
      .where(
        and(
          isNotNull(schema.registry.entities.calendarId),
          like(schema.registry.entities.entityId, 'calendar.%'),
        ),
      ),
    db
      .select({ calendarId: events.calendarId, total: count() })
      .from(events)
      .where(isNull(events.seriesId))
      .groupBy(events.calendarId),
  ]);

  return rows.map((row) => {
    const kind = calendarKindOf(row.kind);
    const editorIds =
      kind === 'holidays'
        ? []
        : editorRows.filter((each) => each.calendarId === row.id).map((each) => each.userId);
    const rights = { kind, ownerUserId: row.ownerUserId, editorIds };
    const file = fileRows.find((each) => each.calendarId === row.id);
    const state = calendarIcsStateSchema.safeParse(row.icsState ?? {});

    return calendarViewSchema.parse({
      id: row.id,
      kind,
      name: row.name,
      color: row.color,
      icon: row.icon,
      ownerUserId: row.ownerUserId,
      isDayOff: row.isDayOff,
      position: row.position,
      icsUrl: row.icsUrl,
      icsFile:
        file === undefined
          ? null
          : {
              name: file.name,
              size: file.size,
              uploadedAt: file.uploadedAt,
              uploadedBy: file.uploadedBy,
            },
      icsState:
        row.icsUrl === null && file === undefined
          ? null
          : state.success
            ? state.data
            : calendarIcsStateSchema.parse({}),
      models: modelRows.filter((each) => each.calendarId === row.id).map(toModel),
      editorIds,
      canEdit: canEditCalendar(identity, rights),
      canManage: canChangeCalendar(identity, rights),
      entityId: entityRows.find((each) => each.calendarId === row.id)?.entityId ?? null,
      eventCount: counts.find((each) => each.calendarId === row.id)?.total ?? 0,
    });
  });
}

/**
 * Reads one calendar as someone is told it.
 *
 * @param db - The database.
 * @param identity - Who is asking.
 * @param calendarId - Which.
 * @returns The calendar.
 * @throws {NotFoundError} When no calendar has that id.
 */
export async function readCalendarView(
  db: Database,
  identity: Identity,
  calendarId: string,
): Promise<CalendarView> {
  const [found] = await listCalendars(db, identity, [calendarId]);

  if (found === undefined) {
    throw new NotFoundError('No calendar has that id', { details: { calendarId } });
  }

  return found;
}

/**
 * A model row as the API tells it.
 *
 * @param row - The row.
 * @returns The model.
 */
function toModel(row: typeof models.$inferSelect): CalendarModel {
  return calendarModelSchema.parse({
    id: row.id,
    calendarId: row.calendarId,
    name: row.name,
    icon: row.icon,
    color: row.color,
    position: row.position,
  });
}

/**
 * The place after the last of a list.
 *
 * @param db - The database.
 * @param table - The calendars or the models.
 * @param calendarId - For models, the calendar whose list it is.
 * @returns One more than the highest position, 0 for an empty list.
 */
async function nextPosition(
  db: Writer,
  table: typeof calendars | typeof models,
  calendarId?: string,
): Promise<number> {
  const [row] = await db
    .select({ last: sql<number>`coalesce(max(${table.position}), -1)::int` })
    .from(table)
    .where(calendarId === undefined ? undefined : eq(models.calendarId, calendarId));

  return (row?.last ?? -1) + 1;
}

/**
 * Moves one item of an ordered list to a place, and numbers the list again from 0.
 *
 * @param db - The database.
 * @param table - The calendars or the models.
 * @param ordered - The ids, in their order now.
 * @param movedId - The one that moves.
 * @param position - Where it goes, from 0; past the end is the end.
 */
async function moveTo(
  db: Writer,
  table: typeof calendars | typeof models,
  ordered: readonly string[],
  movedId: string,
  position: number,
): Promise<void> {
  const rest = ordered.filter((id) => id !== movedId);
  const placed = [...rest.slice(0, position), movedId, ...rest.slice(position)];

  for (const [index, id] of placed.entries()) {
    // eslint-disable-next-line no-await-in-loop -- one connection: the updates run in turn anyway
    await db.update(table).set({ position: index }).where(eq(table.id, id));
  }
}

/**
 * Gives a calendar a loaded file that only was tested, as its source.
 *
 * @param db - The transaction.
 * @param calendarId - The calendar.
 * @param fileId - The file.
 * @throws {ValidationError} When no file waits under that id.
 */
async function attachFile(db: Writer, calendarId: string, fileId: string): Promise<void> {
  const attached = await db
    .update(files)
    .set({ calendarId })
    .where(and(eq(files.id, fileId), isNull(files.calendarId)))
    .returning({ id: files.id });

  if (attached.length === 0) {
    throw new ValidationError('No loaded file waits under that id', {
      details: { issues: [{ path: 'icsFileId', message: 'Load the file again' }] },
    });
  }
}

/**
 * Makes a calendar of the owner's: empty, reading an address, or reading a file already tested.
 * Its maker becomes one of its editors.
 *
 * @param db - The database.
 * @param icons - The catalogue, to check the icon against.
 * @param identity - Who makes it.
 * @param body - Its name, colour, icon, Day off and source.
 * @returns The new calendar's id.
 * @throws {ValidationError} When the icon is not in the catalogue, or no file waits under the id.
 */
export async function createCalendar(
  db: Database,
  icons: IconLookup,
  identity: Identity,
  body: CalendarCreate,
): Promise<string> {
  if (body.icon !== undefined) {
    checkIcon(icons, body.icon);
  }

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(calendars)
      .values({
        kind: 'custom',
        name: body.name,
        color: body.color,
        icon: body.icon ?? null,
        isDayOff: body.isDayOff,
        icsUrl: body.source.kind === 'url' ? body.source.icsUrl : null,
        position: await nextPosition(tx, calendars),
        createdBy: identity.userId,
      })
      .returning({ id: calendars.id });

    if (created === undefined) {
      throw new ConflictError('The calendar could not be made');
    }

    if (body.source.kind === 'file') {
      await attachFile(tx, created.id, body.source.icsFileId);
    }

    await tx
      .insert(editors)
      .values({ calendarId: created.id, userId: identity.userId })
      .onConflictDoNothing();

    return created.id;
  });
}

/**
 * Changes a calendar: its name, colour, icon, Day off, place in the list, or its source.
 *
 * @param db - The database.
 * @param icons - The catalogue, to check the icon against.
 * @param identity - Who asks.
 * @param calendarId - Which.
 * @param body - What to change.
 * @throws {NotFoundError} When no calendar has that id.
 * @throws {PermissionError} When they may not change it.
 * @throws {ValidationError} When Holidays would stop being days off, the icon is unknown or no
 * file waits under the id.
 * @throws {ConflictError} When it would read an address and a file at once.
 */
export async function updateCalendar(
  db: Database,
  icons: IconLookup,
  identity: Identity,
  calendarId: string,
  body: CalendarUpdate,
): Promise<void> {
  const calendar = await readCalendar(db, calendarId);

  requireCanChangeCalendar(identity, calendar);

  if (body.icon !== undefined && body.icon !== null) {
    checkIcon(icons, body.icon);
  }

  if (calendar.kind === 'holidays' && body.isDayOff === false) {
    throw new ValidationError('Holidays are always days off', {
      details: { issues: [{ path: 'isDayOff', message: 'Holidays are always days off' }] },
    });
  }

  const [file] = await db
    .select({ id: files.id })
    .from(files)
    .where(eq(files.calendarId, calendarId));
  const hasUrl = body.icsUrl === undefined ? calendar.icsUrl !== null : body.icsUrl !== null;
  const hasFile = body.icsFileId === undefined ? file !== undefined : body.icsFileId !== null;

  if (hasUrl && hasFile) {
    throw new ConflictError(
      body.icsFileId !== undefined
        ? 'This calendar reads an address: remove it before loading a file'
        : 'This calendar reads a file: remove it before giving it an address',
      { details: { calendarId } },
    );
  }

  const isUrlChanged = body.icsUrl !== undefined && body.icsUrl !== calendar.icsUrl;
  const isFileChanged = body.icsFileId !== undefined && body.icsFileId !== (file?.id ?? null);

  await db.transaction(async (tx) => {
    await tx
      .update(calendars)
      .set({
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.color === undefined ? {} : { color: body.color }),
        ...(body.icon === undefined ? {} : { icon: body.icon }),
        ...(body.isDayOff === undefined ? {} : { isDayOff: body.isDayOff }),
        ...(body.icsUrl === undefined ? {} : { icsUrl: body.icsUrl }),

        // `core` reads a source it has no state of at once, on the sync after this write.
        ...(isUrlChanged || isFileChanged ? { icsState: {} } : {}),
      })
      .where(eq(calendars.id, calendarId));

    if (isUrlChanged || isFileChanged) {
      await tx
        .delete(events)
        .where(and(eq(events.calendarId, calendarId), eq(events.source, 'ics')));
    }

    if (isFileChanged) {
      await tx.delete(files).where(eq(files.calendarId, calendarId));

      if (typeof body.icsFileId === 'string') {
        await attachFile(tx, calendarId, body.icsFileId);
      }
    }

    if (body.position !== undefined) {
      const ordered = await tx
        .select({ id: calendars.id })
        .from(calendars)
        .orderBy(asc(calendars.position), asc(calendars.name));

      await moveTo(
        tx,
        calendars,
        ordered.map((row) => row.id),
        calendarId,
        body.position,
      );
    }
  });
}

/**
 * Deletes a calendar, with its models, events, file, editors and place in share links.
 *
 * @param db - The database.
 * @param calendarId - Which.
 * @returns The calendar as it was.
 * @throws {NotFoundError} When no calendar has that id.
 * @throws {ConflictError} For Holidays, and for a personal calendar, which goes with its account.
 */
export async function deleteCalendar(db: Database, calendarId: string): Promise<CalendarRecord> {
  const calendar = await readCalendar(db, calendarId);

  if (calendar.kind === 'holidays' || calendar.kind === 'personal') {
    throw new ConflictError(
      calendar.kind === 'holidays'
        ? 'The Holidays calendar cannot be deleted'
        : 'A personal calendar goes with its account',
      { details: { calendarId, kind: calendar.kind } },
    );
  }

  await db.delete(calendars).where(eq(calendars.id, calendarId));

  return calendar;
}

/**
 * What deleting a calendar would take with it.
 *
 * @param db - The database.
 * @param calendarId - Which.
 * @returns The automations whose trigger names it, the share links that carry it, its events.
 * @throws {NotFoundError} When no calendar has that id.
 */
export async function readCalendarUsage(db: Database, calendarId: string): Promise<CalendarUsage> {
  await readCalendar(db, calendarId);

  const automations = schema.registry.automations;
  const feeds = schema.registry.calendarFeeds;
  const feedCalendars = schema.registry.calendarFeedCalendars;
  const [named, carried, counted] = await Promise.all([
    db
      .select({ id: automations.id, name: automations.name })
      .from(automations)
      .where(
        sql`${automations.definition} -> 'triggers' @> ${JSON.stringify([{ type: 'calendar', calendarId }])}::jsonb`,
      )
      .orderBy(asc(automations.name)),
    db
      .select({ id: feeds.id, name: feeds.name })
      .from(feedCalendars)
      .innerJoin(feeds, eq(feeds.id, feedCalendars.feedId))
      .where(eq(feedCalendars.calendarId, calendarId))
      .orderBy(asc(feeds.name)),
    db
      .select({
        own: sql<number>`count(*) FILTER (WHERE ${events.source} = 'user' AND ${events.seriesId} IS NULL)::int`,
        ics: sql<number>`count(*) FILTER (WHERE ${events.source} = 'ics')::int`,
      })
      .from(events)
      .where(eq(events.calendarId, calendarId)),
  ]);

  return {
    automations: named,
    feeds: carried,
    eventCount: counted[0]?.own ?? 0,
    icsEventCount: counted[0]?.ics ?? 0,
  };
}

/**
 * Replaces a calendar's Editors with a whole new set.
 *
 * @param db - The database.
 * @param identity - Who asks.
 * @param calendarId - Which.
 * @param body - Everyone who should edit it.
 * @throws {NotFoundError} When no calendar has that id.
 * @throws {PermissionError} When they may not change it.
 * @throws {ConflictError} For Holidays, which has no list.
 * @throws {ValidationError} When an id names no account.
 */
export async function replaceCalendarEditors(
  db: Database,
  identity: Identity,
  calendarId: string,
  body: CalendarEditors,
): Promise<void> {
  const calendar = await readCalendar(db, calendarId);

  requireCanChangeCalendar(identity, calendar);

  if (calendar.kind === 'holidays') {
    throw new ConflictError('Holidays has no editors: whoever manages the calendars edits it', {
      details: { calendarId },
    });
  }

  const wanted = [...new Set(body.userIds)];
  const living =
    wanted.length === 0
      ? []
      : await db
          .select({ id: schema.auth.users.id })
          .from(schema.auth.users)
          .where(and(inArray(schema.auth.users.id, wanted), isNull(schema.auth.users.deletedAt)));
  const missing = wanted.filter((id) => !living.some((row) => row.id === id));

  if (missing.length > 0) {
    throw new ValidationError('An editor is not one of the people of the house', {
      details: { issues: [{ path: 'userIds', message: `No account ${missing.join(', ')}` }] },
    });
  }

  await db.transaction(async (tx) => {
    await tx.delete(editors).where(eq(editors.calendarId, calendarId));

    if (wanted.length > 0) {
      await tx.insert(editors).values(wanted.map((userId) => ({ calendarId, userId })));
    }
  });
}

/**
 * Reads a model and the calendar it belongs to, refusing someone who may not edit that calendar.
 *
 * @param db - The database.
 * @param identity - Who asks.
 * @param modelId - Which.
 * @returns The model's row and its calendar.
 * @throws {NotFoundError} When no model has that id.
 * @throws {PermissionError} When they may not edit its calendar.
 */
async function editableModel(
  db: Database,
  identity: Identity,
  modelId: string,
): Promise<{ row: typeof models.$inferSelect; calendar: CalendarRecord }> {
  const [row] = await db.select().from(models).where(eq(models.id, modelId));

  if (row === undefined) {
    throw new NotFoundError('No model has that id', { details: { modelId } });
  }

  const calendar = await readCalendar(db, row.calendarId);

  requireCanEditCalendar(identity, calendar);

  return { row, calendar };
}

/**
 * Adds a model to a calendar, last in its list.
 *
 * @param db - The database.
 * @param icons - The catalogue, to check the icon against.
 * @param identity - Who asks.
 * @param calendarId - The calendar.
 * @param body - Its name, icon and colour.
 * @returns The model.
 * @throws {NotFoundError} When no calendar has that id.
 * @throws {PermissionError} When they may not edit it.
 * @throws {ConflictError} For Holidays, which has no models.
 * @throws {ValidationError} When the icon is not in the catalogue.
 */
export async function createCalendarModel(
  db: Database,
  icons: IconLookup,
  identity: Identity,
  calendarId: string,
  body: CalendarModelCreate,
): Promise<CalendarModel> {
  const calendar = await readCalendar(db, calendarId);

  requireCanEditCalendar(identity, calendar);

  if (calendar.kind === 'holidays') {
    throw new ConflictError('Holidays has no models', { details: { calendarId } });
  }

  checkIcon(icons, body.icon);

  const [created] = await db
    .insert(models)
    .values({ calendarId, ...body, position: await nextPosition(db, models, calendarId) })
    .returning();

  if (created === undefined) {
    throw new ConflictError('The model could not be made');
  }

  return toModel(created);
}

/**
 * Changes a model, its place in its calendar's list among what may change.
 *
 * @param db - The database.
 * @param icons - The catalogue, to check the icon against.
 * @param identity - Who asks.
 * @param modelId - Which.
 * @param body - What to change.
 * @returns The model as it now stands, and its calendar.
 * @throws {NotFoundError} When no model has that id.
 * @throws {PermissionError} When they may not edit its calendar.
 * @throws {ValidationError} When the icon is not in the catalogue.
 */
export async function updateCalendarModel(
  db: Database,
  icons: IconLookup,
  identity: Identity,
  modelId: string,
  body: CalendarModelUpdate,
): Promise<CalendarModel> {
  const { row } = await editableModel(db, identity, modelId);

  if (body.icon !== undefined) {
    checkIcon(icons, body.icon);
  }

  return db.transaction(async (tx) => {
    const { position, ...fields } = body;

    if (Object.keys(fields).length > 0) {
      await tx.update(models).set(fields).where(eq(models.id, modelId));
    }

    if (position !== undefined) {
      const ordered = await tx
        .select({ id: models.id })
        .from(models)
        .where(eq(models.calendarId, row.calendarId))
        .orderBy(asc(models.position), asc(models.name));

      await moveTo(
        tx,
        models,
        ordered.map((each) => each.id),
        modelId,
        position,
      );
    }

    const [changed] = await tx.select().from(models).where(eq(models.id, modelId));

    return toModel(changed ?? row);
  });
}

/**
 * Deletes a model; its events keep their place and lose the model.
 *
 * @param db - The database.
 * @param identity - Who asks.
 * @param modelId - Which.
 * @returns The calendar it belonged to.
 * @throws {NotFoundError} When no model has that id.
 * @throws {PermissionError} When they may not edit its calendar.
 */
export async function deleteCalendarModel(
  db: Database,
  identity: Identity,
  modelId: string,
): Promise<string> {
  const { row } = await editableModel(db, identity, modelId);

  await db.delete(models).where(eq(models.id, modelId));

  return row.calendarId;
}

/**
 * Keeps a `.ics` file read in the browser, on no calendar yet, for `core` to test.
 *
 * @param db - The database.
 * @param upload - Its name and text.
 * @param upload.name - The file's name.
 * @param upload.text - What it holds.
 * @param userId - Who loaded it.
 * @returns The file's id.
 * @throws {ConflictError} When the row could not be written.
 */
export async function storeIcsFile(
  db: Database,
  upload: { readonly name: string; readonly text: string },
  userId: string,
): Promise<string> {
  const [stored] = await db
    .insert(files)
    .values({
      name: upload.name,
      size: Buffer.byteLength(upload.text, 'utf8'),
      body: upload.text,
      uploadedBy: userId,
    })
    .returning({ id: files.id });

  if (stored === undefined) {
    throw new ConflictError('The file could not be kept');
  }

  return stored.id;
}

/**
 * Forgets a file that failed its test, unless a calendar took it meanwhile.
 *
 * @param db - The database.
 * @param fileId - Which.
 */
export async function dropIcsFile(db: Database, fileId: string): Promise<void> {
  await db.delete(files).where(and(eq(files.id, fileId), isNull(files.calendarId)));
}

/** An account, as its personal calendar needs it. */
export type CalendarPerson = {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;

  /** The key of its role: `owner`, `member`, a custom role's… */
  readonly roleKey: string;
};

/**
 * Gives a new account its personal calendar, named after it in the next colour, and makes a
 * member or above an editor of House and Waste, as the migration did for everyone there was.
 *
 * @param db - The database, or the transaction that made the account.
 * @param person - The account.
 * @returns The calendar's id; null for a service identity, which has none.
 */
export async function createPersonalCalendar(
  db: Writer,
  person: CalendarPerson,
): Promise<string | null> {
  if (person.roleKey === 'service') {
    return null;
  }

  const [personal] = await db
    .select({ total: count() })
    .from(calendars)
    .where(eq(calendars.kind, 'personal'));
  const [created] = await db
    .insert(calendars)
    .values({
      kind: 'personal',
      name: person.displayName.trim().slice(0, 40).trim() || person.username,
      color: PERSONAL_COLORS[(personal?.total ?? 0) % PERSONAL_COLORS.length] ?? 'amber',
      icon: 'user',
      ownerUserId: person.id,
      position: await nextPosition(db, calendars),
      createdBy: person.id,
    })
    .onConflictDoNothing()
    .returning({ id: calendars.id });

  if (HOUSE_EDITOR_ROLES.has(person.roleKey)) {
    const shared = await db
      .select({ id: calendars.id })
      .from(calendars)
      .where(inArray(calendars.kind, ['house', 'waste']));

    if (shared.length > 0) {
      await db
        .insert(editors)
        .values(shared.map((row) => ({ calendarId: row.id, userId: person.id })))
        .onConflictDoNothing();
    }
  }

  return created?.id ?? null;
}

/**
 * Deletes an account's personal calendar and takes it off every Editors list. Accounts are
 * deleted softly, so the cascades on `auth.users` never fire: this does what they would.
 *
 * @param db - The database.
 * @param userId - The account.
 * @returns The id of the calendar deleted, or null when it had none.
 */
export async function removePersonalCalendar(db: Database, userId: string): Promise<string | null> {
  return db.transaction(async (tx) => {
    const deleted = await tx
      .delete(calendars)
      .where(eq(calendars.ownerUserId, userId))
      .returning({ id: calendars.id });

    await tx.delete(editors).where(eq(editors.userId, userId));

    return deleted[0]?.id ?? null;
  });
}

/**
 * Lists the people a calendar's Editors list shows: the active accounts that are not services.
 * Served to whoever reads calendars, unlike the users list, so a member sees who edits what.
 *
 * @param db - The database.
 * @returns The people, by name.
 */
export async function listCalendarPeople(db: Database): Promise<CalendarPersonView[]> {
  const { roles, users } = schema.auth;
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      role: roles.key,
    })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(and(isNull(users.deletedAt), eq(users.isActive, true)))
    .orderBy(asc(users.displayName), asc(users.username));
  const people = rows.filter((row) => row.role !== 'service');
  const avatars = await readAvatarUrls(
    db,
    people.map((row) => row.id),
  );

  return people.map((row) =>
    calendarPersonSchema.parse({ ...row, avatarUrl: avatars.get(row.id) ?? null }),
  );
}
