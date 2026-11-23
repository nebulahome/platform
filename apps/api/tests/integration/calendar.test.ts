/**
 * Calendars against a real database: who may change what, the personal calendar an account comes
 * and goes with, the share link read at home only, and repeating times across a clock change.
 *
 * Four people: one who manages the calendars, one of a calendar's editors, a member who owns a
 * personal calendar, and a guest. The house's zone is set to Europe/Rome for the run (and put
 * back), so a weekly event at 18:00 keeps 18:00 across the end of summer time.
 *
 * Needs the development stack: `pnpm infra:up` and `pnpm db:migrate`. Every row is scoped to ids
 * unique to the run and removed afterwards.
 */
import { randomUUID } from 'node:crypto';

import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  calendarEventSchema,
  calendarFeedSchema,
  calendarOccurrenceSchema,
  calendarViewSchema,
  PERMISSIONS,
  type CalendarView,
} from '@nebulahome/contracts';
import { createDatabase, schema } from '@nebulahome/db';

import { createPersonalCalendar } from '@/services/calendar-store.js';
import { bearerFor, buildTestServer, calendarSyncs, stopHub } from '@/testing/hub-harness.js';

const DATABASE_URL = 'postgres://nebula:nebula@localhost:5432/nebula';

const suffix = randomUUID().slice(0, 8);

/** Who manages the calendars, an editor of one, a member with a calendar of their own, a guest. */
const managerId = randomUUID();
const editorId = randomUUID();
const memberId = randomUUID();
const guestId = randomUUID();

let database: ReturnType<typeof createDatabase>;
let server: FastifyInstance;
let custom: CalendarView;
let personalId: string;
let houseId: string;
let holidaysId: string;

/** The house's zone before the run, put back afterwards. */
let previousZone: unknown;

/** Calendars, feeds and accounts the run made, removed whatever the tests got to. */
const madeCalendars = new Set<string>();
const madeFeeds = new Set<string>();
const madeUsers = new Set<string>([managerId, editorId, memberId, guestId]);

/**
 * Calls the API as one of the people.
 *
 * @param userId - Who asks. The manager holds every permission; the rest `calendar:read`.
 * @param method - The verb.
 * @param url - The path under `/api/v1`.
 * @param payload - The body, if any.
 * @returns The status and the parsed body.
 */
async function call(
  userId: string,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  payload?: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const keys = userId === managerId ? PERMISSIONS.map((each) => each.key) : ['calendar:read'];
  const response = await server.inject({
    method,
    url: `/api/v1${url}`,
    headers: {
      authorization: await bearerFor(userId, ...keys.map((key) => ({ key, scope: '*' }))),
    },
    ...(payload === undefined ? {} : { payload }),
  });

  return {
    status: response.statusCode,
    body: response.statusCode === 204 ? undefined : response.json(),
  };
}

/**
 * The calendars as one person is told them.
 *
 * @param userId - Who asks.
 * @returns The calendars.
 */
async function calendarsFor(userId: string): Promise<CalendarView[]> {
  const { body } = await call(userId, 'GET', '/calendars');

  return calendarViewSchema.array().parse((body as { items: unknown }).items);
}

beforeAll(async () => {
  database = createDatabase({ connectionString: DATABASE_URL, applicationName: 'api-calendar' });

  const roles = await database.db
    .select({ id: schema.auth.roles.id, key: schema.auth.roles.key })
    .from(schema.auth.roles);
  /**
   * A role's id.
   *
   * @param key - The role.
   * @returns Its id.
   */
  const roleOf = (key: string): string => roles.find((role) => role.key === key)?.id ?? '';

  await database.db.insert(schema.auth.users).values(
    (
      [
        [managerId, 'manager', 'admin'],
        [editorId, 'editor', 'member'],
        [memberId, 'member', 'member'],
        [guestId, 'guest', 'guest'],
      ] as const
    ).map(([id, name, role]) => ({
      id,
      username: `cal-${name}-${suffix}`,
      displayName: `Cal ${name} ${suffix}`,
      passwordHash: 'not-a-hash',
      roleId: roleOf(role),
    })),
  );
  personalId =
    (await createPersonalCalendar(database.db, {
      id: memberId,
      username: `cal-member-${suffix}`,
      displayName: `Cal member ${suffix}`,
      roleKey: 'member',
    })) ?? '';

  const [zone] = await database.db
    .select({ value: schema.system.settings.value })
    .from(schema.system.settings)
    .where(eq(schema.system.settings.key, 'house.timezone'));

  previousZone = zone?.value ?? null;
  await database.db
    .update(schema.system.settings)
    .set({ value: 'Europe/Rome' })
    .where(eq(schema.system.settings.key, 'house.timezone'));

  const defaults = await database.db
    .select({ id: schema.registry.calendars.id, kind: schema.registry.calendars.kind })
    .from(schema.registry.calendars);

  houseId = defaults.find((each) => each.kind === 'house')?.id ?? '';
  holidaysId = defaults.find((each) => each.kind === 'holidays')?.id ?? '';

  server = await buildTestServer(true, database.db);
});

afterAll(async () => {
  stopHub();
  await server.close();

  await database.db
    .update(schema.system.settings)
    .set({ value: previousZone ?? 'UTC' })
    .where(eq(schema.system.settings.key, 'house.timezone'));
  await database.db
    .delete(schema.registry.calendarFeeds)
    .where(inArray(schema.registry.calendarFeeds.id, [...madeFeeds]));
  await database.db
    .delete(schema.registry.calendars)
    .where(inArray(schema.registry.calendars.id, [...madeCalendars]));
  // Hard deletes: the cascades take the personal calendars and editor rows with them.
  await database.db.delete(schema.auth.users).where(inArray(schema.auth.users.id, [...madeUsers]));
  await database.close();
});

describe('who may change what', () => {
  it('lets only whoever manages the calendars make one, and makes its maker an editor', async () => {
    expect(
      (await call(guestId, 'POST', '/calendars', { name: 'Nope', color: 'teal' })).status,
    ).toBe(403);

    const { status, body } = await call(managerId, 'POST', '/calendars', {
      name: `Scuola ${suffix}`,
      color: 'teal',
    });

    expect(status).toBe(201);
    custom = calendarViewSchema.parse(body);
    madeCalendars.add(custom.id);
    expect(custom).toMatchObject({
      kind: 'custom',
      editorIds: [managerId],
      canEdit: true,
      canManage: true,
      icsUrl: null,
      icsState: null,
    });
    expect(calendarSyncs.count).toBeGreaterThan(0);
  });

  it('gives an editor the events and the models, not the calendar itself', async () => {
    expect(
      (await call(managerId, 'PUT', `/calendars/${custom.id}/editors`, { userIds: [editorId] }))
        .status,
    ).toBe(200);

    const seen = (await calendarsFor(editorId)).find((each) => each.id === custom.id);

    expect([seen?.canEdit, seen?.canManage]).toEqual([true, false]);
    expect(
      (await call(editorId, 'PATCH', `/calendars/${custom.id}`, { name: 'Mine now' })).status,
    ).toBe(403);
    expect(
      (
        await call(editorId, 'POST', `/calendars/${custom.id}/models`, {
          name: 'Gita',
          icon: 'bus',
          color: 'blue',
        })
      ).status,
    ).toBe(201);

    const { status, body } = await call(editorId, 'POST', '/calendar/events', {
      calendarId: custom.id,
      title: 'Colloqui',
      isAllDay: true,
      startsOn: '2026-12-03',
      endsOn: '2026-12-03',
    });

    expect(status).toBe(201);

    const event = calendarEventSchema.parse(body);

    // House is not one of theirs: the event cannot move there.
    expect(
      (await call(editorId, 'PATCH', `/calendar/events/${event.id}`, { calendarId: houseId }))
        .status,
    ).toBe(403);
  });

  it('shows every calendar to a guest and lets them change none', async () => {
    const seen = await calendarsFor(guestId);

    expect(seen.map((each) => each.id)).toEqual(expect.arrayContaining([custom.id, personalId]));
    expect(seen.every((each) => !each.canEdit && !each.canManage)).toBe(true);
    expect(
      (
        await call(guestId, 'POST', '/calendar/events', {
          calendarId: custom.id,
          title: 'Not mine',
          isAllDay: true,
          startsOn: '2026-12-04',
          endsOn: '2026-12-04',
        })
      ).status,
    ).toBe(403);
  });

  it('lets the owner of a personal calendar change it and pick its editors, and nobody delete it', async () => {
    expect(
      (await call(memberId, 'PATCH', `/calendars/${personalId}`, { name: 'Mia agenda' })).status,
    ).toBe(200);
    expect(
      (await call(memberId, 'PUT', `/calendars/${personalId}/editors`, { userIds: [editorId] }))
        .status,
    ).toBe(200);
    expect(
      (await call(editorId, 'PATCH', `/calendars/${personalId}`, { name: 'Taken' })).status,
    ).toBe(403);
    expect((await call(managerId, 'DELETE', `/calendars/${personalId}`)).status).toBe(409);
  });

  it('keeps Holidays to whoever manages the calendars, editors or not', async () => {
    const event = {
      calendarId: holidaysId,
      title: 'Chiusura',
      isAllDay: true,
      startsOn: '2026-08-14',
      endsOn: '2026-08-14',
    };

    expect((await call(editorId, 'POST', '/calendar/events', event)).status).toBe(403);

    const { status, body } = await call(managerId, 'POST', '/calendar/events', event);

    expect(status).toBe(201);
    expect(
      (await call(managerId, 'DELETE', `/calendar/events/${calendarEventSchema.parse(body).id}`))
        .status,
    ).toBe(204);
    expect((await call(managerId, 'DELETE', `/calendars/${holidaysId}`)).status).toBe(409);
  });

  it('never lets anyone change an event a source brought in', async () => {
    const [row] = await database.db
      .insert(schema.registry.calendarEvents)
      .values({
        calendarId: custom.id,
        title: 'From the school site',
        isAllDay: true,
        startsOn: '2026-12-10',
        endsOn: '2026-12-10',
        timeZone: 'Europe/Rome',
        source: 'ics',
        sourceUid: `uid-${suffix}`,
      })
      .returning({ id: schema.registry.calendarEvents.id });

    expect(
      (await call(managerId, 'PATCH', `/calendar/events/${row?.id ?? ''}`, { title: 'Mine' }))
        .status,
    ).toBe(403);

    const { body } = await call(
      managerId,
      'GET',
      `/calendar/occurrences?from=2026-12-01&to=2026-12-31&calendars=${custom.id}`,
    );
    const items = calendarOccurrenceSchema.array().parse((body as { items: unknown }).items);

    expect(items.find((each) => each.eventId === row?.id)).toMatchObject({
      source: 'ics',
      canEdit: false,
    });
    expect(items.find((each) => each.title === 'Colloqui')?.canEdit).toBe(true);
  });

  it('takes a loaded file as a source, and refuses an address beside it', async () => {
    const { status, body } = await call(guestId, 'POST', '/calendar/ics-files', {
      name: 'raccolta.ics',
      text: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n',
    });

    expect(status).toBe(200);

    const fileId = (body as { fileId?: string }).fileId ?? '';
    const loaded = await call(managerId, 'PATCH', `/calendars/${custom.id}`, {
      icsFileId: fileId,
    });

    expect(calendarViewSchema.parse(loaded.body).icsFile).toMatchObject({ name: 'raccolta.ics' });
    expect(
      (
        await call(managerId, 'PATCH', `/calendars/${custom.id}`, {
          icsUrl: 'https://example.com/school.ics',
        })
      ).status,
    ).toBe(409);

    const removed = await call(managerId, 'PATCH', `/calendars/${custom.id}`, { icsFileId: null });

    expect(calendarViewSchema.parse(removed.body)).toMatchObject({ icsFile: null, icsState: null });
  });
});

describe('a personal calendar comes and goes with its account', () => {
  let userId = '';

  it('is made with the account, and its owner edits House and Waste as a member', async () => {
    const { status, body } = await call(managerId, 'POST', '/users', {
      username: `cal-new-${suffix}`,
      displayName: 'Giulia',
      password: 'a-long-enough-password-1',
      role: 'member',
    });

    expect(status).toBe(201);
    userId = (body as { id: string }).id;
    madeUsers.add(userId);

    const [personal] = await database.db
      .select()
      .from(schema.registry.calendars)
      .where(eq(schema.registry.calendars.ownerUserId, userId));
    const editing = await database.db
      .select({ calendarId: schema.registry.calendarEditors.calendarId })
      .from(schema.registry.calendarEditors)
      .where(eq(schema.registry.calendarEditors.userId, userId));

    expect(personal).toMatchObject({ kind: 'personal', name: 'Giulia', icon: 'user' });
    expect(editing.map((each) => each.calendarId)).toContain(houseId);
  });

  it('goes with the account, and so do the editor rows', async () => {
    expect((await call(managerId, 'DELETE', `/users/${userId}`)).status).toBe(204);

    const left = await database.db
      .select()
      .from(schema.registry.calendars)
      .where(eq(schema.registry.calendars.ownerUserId, userId));
    const editing = await database.db
      .select()
      .from(schema.registry.calendarEditors)
      .where(eq(schema.registry.calendarEditors.userId, userId));

    expect([left, editing]).toEqual([[], []]);
  });
});

describe('a share link', () => {
  let token = '';

  it('is made by whoever manages the calendars, with a token of its own', async () => {
    expect(
      (await call(editorId, 'POST', '/calendar/feeds', { name: 'Fam', calendarIds: [custom.id] }))
        .status,
    ).toBe(403);

    const { status, body } = await call(managerId, 'POST', '/calendar/feeds', {
      name: `Famiglia ${suffix}`,
      calendarIds: [custom.id],
    });

    expect(status).toBe(201);

    const feed = calendarFeedSchema.parse(body);

    madeFeeds.add(feed.id);
    token = feed.token;
  });

  it('answers a caller at home with the calendar file, and stamps the read', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/api/calendar/${token}.ics`,
      headers: { 'user-agent': 'Calendar/1.0' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/calendar; charset=utf-8');
    expect(response.body).toContain('SUMMARY:Colloqui');
    expect(response.body).toContain(`X-WR-CALNAME:Famiglia ${suffix}`);

    const [row] = await database.db
      .select({ agent: schema.registry.calendarFeeds.lastReadAgent })
      .from(schema.registry.calendarFeeds)
      .where(eq(schema.registry.calendarFeeds.token, token));

    expect(row?.agent).toBe('Calendar/1.0');
  });

  it('answers 404 to a caller from outside, as to a token that is no link or no token', async () => {
    const outside = await server.inject({
      method: 'GET',
      url: `/api/calendar/${token}.ics`,
      remoteAddress: '203.0.113.7',
    });
    const unknown = await server.inject({
      method: 'GET',
      url: `/api/calendar/${'0'.repeat(32)}.ics`,
    });
    const malformed = await server.inject({ method: 'GET', url: '/api/calendar/nope.ics' });

    expect([outside.statusCode, unknown.statusCode, malformed.statusCode]).toEqual([404, 404, 404]);
  });
});

describe('a weekly event across the end of summer time', () => {
  let seriesId = '';

  /**
   * The times of the series between two days.
   *
   * @param userId - Who reads.
   * @returns The occurrences of the run's calendar.
   */
  async function weekly(
    userId: string,
  ): Promise<ReturnType<typeof calendarOccurrenceSchema.parse>[]> {
    const { body } = await call(
      userId,
      'GET',
      `/calendar/occurrences?from=2026-10-12&to=2026-11-08&calendars=${custom.id}`,
    );

    return calendarOccurrenceSchema
      .array()
      .parse((body as { items: unknown }).items)
      .filter((each) => each.eventId === seriesId || each.seriesId === seriesId);
  }

  it('keeps 18:00 in Rome on both sides of 25 October', async () => {
    const { status, body } = await call(editorId, 'POST', '/calendar/events', {
      calendarId: custom.id,
      title: 'Nuoto',
      isAllDay: false,
      startsAt: '2026-10-15T16:00:00Z',
      endsAt: '2026-10-15T17:00:00Z',
      repeat: { every: 1, unit: 'week', ends: { kind: 'never' } },
    });

    expect(status).toBe(201);

    const event = calendarEventSchema.parse(body);

    seriesId = event.id;
    expect(event.timeZone).toBe('Europe/Rome');
    expect((await weekly(editorId)).map((each) => each.startsAt)).toEqual([
      '2026-10-15T16:00:00.000Z',
      '2026-10-22T16:00:00.000Z',
      '2026-10-29T17:00:00.000Z',
      '2026-11-05T17:00:00.000Z',
    ]);
  });

  it('changes one time alone and deletes another, and the rest stay', async () => {
    const moved = await call(
      editorId,
      'PATCH',
      `/calendar/events/${seriesId}?scope=one&occurrenceOn=2026-10-29`,
      { startsAt: '2026-10-29T18:00:00Z', endsAt: '2026-10-29T19:00:00Z' },
    );

    expect(moved.status).toBe(200);
    expect(calendarEventSchema.parse(moved.body)).toMatchObject({
      seriesId,
      occurrenceOn: '2026-10-29',
      repeat: null,
    });
    expect(
      (
        await call(
          editorId,
          'DELETE',
          `/calendar/events/${seriesId}?scope=one&occurrenceOn=2026-11-05`,
        )
      ).status,
    ).toBe(204);

    const times = await weekly(guestId);

    expect(times.map((each) => [each.startsAt, each.occurrenceOn, each.canEdit])).toEqual([
      ['2026-10-15T16:00:00.000Z', '2026-10-15', false],
      ['2026-10-22T16:00:00.000Z', '2026-10-22', false],
      ['2026-10-29T18:00:00.000Z', '2026-10-29', false],
    ]);

    const [series] = await database.db
      .select({ skippedOn: schema.registry.calendarEvents.skippedOn })
      .from(schema.registry.calendarEvents)
      .where(
        and(
          eq(schema.registry.calendarEvents.id, seriesId),
          eq(schema.registry.calendarEvents.calendarId, custom.id),
        ),
      );

    expect(series?.skippedOn).toEqual(['2026-11-05']);
  });
});
