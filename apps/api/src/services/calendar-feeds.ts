/**
 * Share links: an ICS feed of some calendars that phones and computers at home subscribe to
 * (docs/calendar.md 6.4).
 *
 * The token is the link's whole secret: 128 random bits, shown to whoever manages the calendars
 * and replaced on request (New address), which kills the old link. The file lists the times from
 * six months back to eighteen ahead, expanded (plan D6), through `feedFileOf`.
 */
import { randomBytes } from 'node:crypto';

import { asc, eq, inArray } from 'drizzle-orm';

import {
  addDays,
  calendarFeedSchema,
  ValidationError,
  NotFoundError,
  wallOf,
  type CalendarFeed,
  type CalendarFeedCreate,
  type CalendarFeedUpdate,
  type DayKey,
  type Identity,
} from '@nebulahome/contracts';
import { schema, type Database } from '@nebulahome/db';

import { feedFileOf } from './calendar-feed.js';
import { readCalendarSettings, readOccurrences } from './calendar-occurrences.js';

const feeds = schema.registry.calendarFeeds;
const feedCalendars = schema.registry.calendarFeedCalendars;

/** The longest user agent kept of the app that read a link. */
const AGENT_MAXIMUM_LENGTH = 200;

/**
 * A new token.
 *
 * @returns 32 hexadecimal digits.
 */
function newToken(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Lists the share links.
 *
 * @param db - The database.
 * @param feedId - Only this one, when given.
 * @returns The links, by name.
 */
export async function listFeeds(db: Database, feedId?: string): Promise<CalendarFeed[]> {
  const [rows, carried] = await Promise.all([
    db
      .select()
      .from(feeds)
      .where(feedId === undefined ? undefined : eq(feeds.id, feedId))
      .orderBy(asc(feeds.name)),
    db.select().from(feedCalendars),
  ]);

  return rows.map((row) =>
    calendarFeedSchema.parse({
      id: row.id,
      name: row.name,
      token: row.token,
      calendarIds: carried.filter((each) => each.feedId === row.id).map((each) => each.calendarId),
      createdAt: row.createdAt,
      lastReadAt: row.lastReadAt,
      lastReadAgent: row.lastReadAgent,
    }),
  );
}

/**
 * Reads one share link, or says there is none.
 *
 * @param db - The database.
 * @param feedId - Which.
 * @returns The link.
 * @throws {NotFoundError} When no link has that id.
 */
async function readFeed(db: Database, feedId: string): Promise<CalendarFeed> {
  const [found] = await listFeeds(db, feedId);

  if (found === undefined) {
    throw new NotFoundError('No share link has that id', { details: { feedId } });
  }

  return found;
}

/**
 * Refuses calendar ids that name no calendar.
 *
 * @param db - The database.
 * @param calendarIds - The ids.
 * @throws {ValidationError} Naming the field.
 */
async function requireCalendars(db: Database, calendarIds: readonly string[]): Promise<void> {
  const found = await db
    .select({ id: schema.registry.calendars.id })
    .from(schema.registry.calendars)
    .where(inArray(schema.registry.calendars.id, [...calendarIds]));

  if (found.length !== new Set(calendarIds).size) {
    throw new ValidationError('A calendar of the link does not exist', {
      details: { issues: [{ path: 'calendarIds', message: 'No calendar has one of these ids' }] },
    });
  }
}

/**
 * Makes a share link.
 *
 * @param db - The database.
 * @param identity - Who makes it.
 * @param body - Its name and calendars.
 * @returns The link.
 * @throws {ValidationError} When a calendar id names no calendar.
 */
export async function createFeed(
  db: Database,
  identity: Identity,
  body: CalendarFeedCreate,
): Promise<CalendarFeed> {
  await requireCalendars(db, body.calendarIds);

  const id = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(feeds)
      .values({ name: body.name, token: newToken(), createdBy: identity.userId })
      .returning({ id: feeds.id });
    const feedId = created?.id ?? '';

    await tx
      .insert(feedCalendars)
      .values([...new Set(body.calendarIds)].map((calendarId) => ({ feedId, calendarId })));

    return feedId;
  });

  return readFeed(db, id);
}

/**
 * Changes a share link: its name, its calendars, or its address.
 *
 * @param db - The database.
 * @param feedId - Which.
 * @param body - What to change.
 * @returns The link as it now stands.
 * @throws {NotFoundError} When no link has that id.
 * @throws {ValidationError} When a calendar id names no calendar.
 */
export async function updateFeed(
  db: Database,
  feedId: string,
  body: CalendarFeedUpdate,
): Promise<CalendarFeed> {
  await readFeed(db, feedId);

  if (body.calendarIds !== undefined) {
    await requireCalendars(db, body.calendarIds);
  }

  await db.transaction(async (tx) => {
    if (body.name !== undefined || body.newToken === true) {
      await tx
        .update(feeds)
        .set({
          ...(body.name === undefined ? {} : { name: body.name }),
          ...(body.newToken === true ? { token: newToken() } : {}),
        })
        .where(eq(feeds.id, feedId));
    }

    if (body.calendarIds !== undefined) {
      await tx.delete(feedCalendars).where(eq(feedCalendars.feedId, feedId));
      await tx
        .insert(feedCalendars)
        .values([...new Set(body.calendarIds)].map((calendarId) => ({ feedId, calendarId })));
    }
  });

  return readFeed(db, feedId);
}

/**
 * Deletes a share link; its address stops working.
 *
 * @param db - The database.
 * @param feedId - Which.
 * @throws {NotFoundError} When no link has that id.
 */
export async function deleteFeed(db: Database, feedId: string): Promise<void> {
  const deleted = await db.delete(feeds).where(eq(feeds.id, feedId)).returning({ id: feeds.id });

  if (deleted.length === 0) {
    throw new NotFoundError('No share link has that id', { details: { feedId } });
  }
}

/**
 * A day some months from another, the day of the month kept where the month has it.
 *
 * @param day - The day.
 * @param months - How many months on; negative goes back.
 * @returns That day.
 */
function addMonths(day: DayKey, months: number): DayKey {
  const [year = 1970, month = 1, date = 1] = day.split('-').map(Number);

  return new Date(Date.UTC(year, month - 1 + months, date)).toISOString().slice(0, 10);
}

/**
 * Writes the file of a share link, and stamps when and by what it was read.
 *
 * @param db - The database.
 * @param token - The link's token.
 * @param userAgent - The app reading it.
 * @param now - Now.
 * @returns The file, or null when no link has that token.
 */
export async function readFeedFile(
  db: Database,
  token: string,
  userAgent: string | null,
  now: Date,
): Promise<string | null> {
  const [feed] = await db
    .select({ id: feeds.id, name: feeds.name })
    .from(feeds)
    .where(eq(feeds.token, token));

  if (feed === undefined) {
    return null;
  }

  const settings = await readCalendarSettings(db);
  const calendarIds = (
    await db
      .select({ calendarId: feedCalendars.calendarId })
      .from(feedCalendars)
      .where(eq(feedCalendars.feedId, feed.id))
  ).map((row) => row.calendarId);
  const today = wallOf(now.getTime(), settings.zone).day;
  // shortcut: six months back and eighteen ahead (plan D6); widen it if someone needs older times.
  const occurrences = await readOccurrences(
    db,
    {
      from: addMonths(today, -6),
      to: addDays(addMonths(today, 18), -1),
      calendarIds,
      identity: null,
    },
    settings,
  );
  const modelNames = new Map(
    (
      await db
        .select({
          id: schema.registry.calendarModels.id,
          name: schema.registry.calendarModels.name,
        })
        .from(schema.registry.calendarModels)
        .where(inArray(schema.registry.calendarModels.calendarId, calendarIds))
    ).map((row) => [row.id, row.name]),
  );

  await db
    .update(feeds)
    .set({
      lastReadAt: now,
      lastReadAgent: userAgent === null ? null : userAgent.slice(0, AGENT_MAXIMUM_LENGTH),
    })
    .where(eq(feeds.id, feed.id));

  return feedFileOf(
    feed.name,
    occurrences.map((occurrence) => {
      const day =
        occurrence.occurrenceOn ??
        occurrence.startsOn ??
        wallOf(Date.parse(occurrence.startsAt ?? ''), settings.zone).day;

      return {
        uid:
          occurrence.eventId === null
            ? `${occurrence.key}@nebula`
            : `${occurrence.eventId}-${day}@nebula`,
        title: occurrence.title,
        notes: occurrence.notes,
        category: occurrence.modelId === null ? null : (modelNames.get(occurrence.modelId) ?? null),
        isAllDay: occurrence.isAllDay,
        startsOn: occurrence.startsOn,
        endsOn: occurrence.endsOn,
        startsAt: occurrence.startsAt,
        endsAt: occurrence.endsAt,
      };
    }),
    now,
  );
}
