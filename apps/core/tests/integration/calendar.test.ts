/**
 * The calendars in `core`, against the real database: the Calendar device's entities following
 * the calendars, their states, and the ICS sources read from a local server and from stored files.
 *
 * The bus is the in-memory one of the test harness: what is checked here is the reading and the
 * writing of the rows. The server answers what the boards draw: a calendar, a 304, a 404, a web
 * page, a sign-in, and one too slow to wait for.
 *
 * Requires the development infrastructure:
 * `pnpm infra:up`, then `pnpm db:migrate`. It writes the Calendar device and the entities of the
 * calendars already in that database, as `core` does when it starts.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  addDays,
  busSubjects,
  CORE_SERVICE,
  CORE_SYNC_CALENDARS_METHOD,
  parseEntityId,
  syncCalendarsReplySchema,
  wallOf,
} from '@nebulahome/contracts';
import { createDatabase, schema, type DatabaseHandle } from '@nebulahome/db';

import { WORKING_TODAY_ENTITY_ID } from '@/persistence/calendar-entities.js';
import { icsStateOf, sweepTestedFiles } from '@/persistence/calendar-store.js';
import { CalendarMonitor } from '@/services/calendar-monitor.js';
import { startCalendarService } from '@/services/calendar-service.js';
import { IcsFetcher } from '@/services/ics-fetcher.js';
import { createCoreHarness, type CoreHarness } from '@/testing/harness.js';

const DATABASE_URL = 'postgres://nebula:nebula@localhost:5432/nebula';
const ZONE = 'Europe/Rome';
const SUFFIX = Date.now().toString(36);

const { calendars, calendarEvents, calendarIcsFiles, calendarModels, entities } = schema.registry;

/**
 * A calendar file from its lines.
 *
 * @param lines - The lines between BEGIN and END:VCALENDAR.
 * @returns The file.
 */
function ics(...lines: string[]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', ...lines, 'END:VCALENDAR', ''].join('\r\n');
}

/**
 * A day as an ICS date.
 *
 * @param day - `YYYY-MM-DD`.
 * @returns `YYYYMMDD`.
 */
function icsDay(day: string): string {
  return day.replaceAll('-', '');
}

const today = wallOf(Date.now(), ZONE).day;
const WASTE_ICS = ics(
  'X-WR-CALNAME:Raccolta',
  'BEGIN:VEVENT',
  `DTSTART;VALUE=DATE:${icsDay(addDays(today, 1))}`,
  'UID:glass@town.example',
  'SUMMARY:Glass collection',
  'END:VEVENT',
  'BEGIN:VEVENT',
  `DTSTART;VALUE=DATE:${icsDay(addDays(today, 2))}`,
  'RRULE:FREQ=WEEKLY;COUNT=3',
  'UID:paper@town.example',
  'SUMMARY:Paper',
  'END:VEVENT',
);

describe('calendars in core', () => {
  let database: DatabaseHandle;
  let harness: CoreHarness;
  let monitor: CalendarMonitor;
  let fetcher: IcsFetcher;
  let server: Server;
  let base: string;
  let houseId: string;
  let sourceId: string;
  let glassModelId: string;

  beforeAll(async () => {
    database = createDatabase({ connectionString: DATABASE_URL, applicationName: 'core-calendar' });
    harness = createCoreHarness();
    server = createServer((request, response) => {
      switch (request.url) {
        case '/waste.ics': {
          if (request.headers['if-none-match'] === '"v1"') {
            response.writeHead(304).end();
          } else {
            response.writeHead(200, { 'content-type': 'text/calendar', etag: '"v1"' });
            response.end(WASTE_ICS);
          }

          break;
        }
        case '/page': {
          response.writeHead(200, { 'content-type': 'text/html' });
          response.end('<!doctype html><title>Calendar</title>');
          break;
        }
        case '/private.ics': {
          response.writeHead(401).end();
          break;
        }
        case '/slow.ics': {
          setTimeout(() => response.writeHead(200).end(WASTE_ICS), 2000);
          break;
        }
        default: {
          response.writeHead(404).end();
        }
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;

    const [house, source] = await database.db
      .insert(calendars)
      .values([
        { kind: 'custom', name: `Città ${SUFFIX}`, color: 'blue', position: 90 },
        {
          kind: 'custom',
          name: `Rifiuti ${SUFFIX}`,
          color: 'green',
          position: 91,
          icsUrl: `${base}/waste.ics`,
        },
      ])
      .returning({ id: calendars.id });

    houseId = house?.id ?? '';
    sourceId = source?.id ?? '';

    const [glass] = await database.db
      .insert(calendarModels)
      .values({ calendarId: sourceId, name: 'Glass', icon: 'bottle', color: 'green' })
      .returning({ id: calendarModels.id });

    glassModelId = glass?.id ?? '';

    // Now and for two hours: on at once.
    await database.db.insert(calendarEvents).values({
      calendarId: houseId,
      title: 'Plumber',
      isAllDay: false,
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 7_200_000),
      timeZone: ZONE,
    });

    monitor = new CalendarMonitor({
      db: database.db,
      ingest: harness,
      logger: harness.logger,
      newTraceId: () => 'calendar-test',
    });
    fetcher = new IcsFetcher({
      db: database.db,
      client: harness.client,
      logger: harness.logger,
      onImported: async () => monitor.reload(),
      // The download's own 20 s, cut short: the slow server is a timeout all the same.
      fetch: async (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(300) }),
    });
    fetcher.sync(ZONE);
    startCalendarService({ client: harness.client, monitor, fetcher, logger: harness.logger });
    await monitor.start(ZONE);
  });

  afterAll(async () => {
    monitor.stop();
    fetcher.stop();
    await database.db.delete(calendars).where(inArray(calendars.id, [houseId, sourceId]));
    await monitor.reload();
    await new Promise((resolve) => server.close(resolve));
    await database.close();
  });

  /**
   * The entity of a calendar, as its row says.
   *
   * @param calendarId - The calendar.
   * @returns Its id and name, or undefined.
   */
  async function entityOf(
    calendarId: string,
  ): Promise<{ entityId: string; name: string } | undefined> {
    const [row] = await database.db
      .select({ entityId: entities.entityId, name: entities.name })
      .from(entities)
      .where(and(eq(entities.calendarId, calendarId), eq(entities.domain, 'calendar')));

    return row;
  }

  it('makes an entity per calendar, its slug from the name, and the working-day sensors', async () => {
    const entity = await entityOf(houseId);

    expect(entity).toEqual({ entityId: `calendar.citta_${SUFFIX}`, name: `Città ${SUFFIX}` });
    expect(harness.directory.get(WORKING_TODAY_ENTITY_ID)?.capabilities.has('sensor_binary')).toBe(
      true,
    );
    expect(
      harness.directory.get(parseEntityId(entity?.entityId ?? ''))?.capabilities.get('calendar'),
    ).toEqual({ calendarId: houseId, color: 'blue' });
  });

  it("reports an event on now in its calendar's entity", () => {
    const state = harness.registry.get(parseEntityId(`calendar.citta_${SUFFIX}`))?.state;

    expect(state).toMatchObject({
      calendar: { isActive: true, current: { title: 'Plumber' }, isStale: false },
    });
  });

  it('keeps the entity id on a rename, and the name follows', async () => {
    await database.db
      .update(calendars)
      .set({ name: `Casa ${SUFFIX}` })
      .where(eq(calendars.id, houseId));

    const reply = await harness
      .clientFor('api')
      .request(
        busSubjects.service(CORE_SERVICE, CORE_SYNC_CALENDARS_METHOD),
        {},
        syncCalendarsReplySchema,
      );

    expect(reply.calendarCount).toBeGreaterThanOrEqual(2);
    expect(await entityOf(houseId)).toEqual({
      entityId: `calendar.citta_${SUFFIX}`,
      name: `Casa ${SUFFIX}`,
    });
  });

  it('reads a source never tried, its models matched by name', async () => {
    await fetcher.syncCalendars();

    const rows = await database.db
      .select({ title: calendarEvents.title, modelId: calendarEvents.modelId })
      .from(calendarEvents)
      .where(and(eq(calendarEvents.calendarId, sourceId), eq(calendarEvents.source, 'ics')));
    const [row] = await database.db
      .select({ state: calendars.icsState })
      .from(calendars)
      .where(eq(calendars.id, sourceId));
    const state = icsStateOf(row?.state);

    expect(rows).toHaveLength(4);
    expect(rows.find((each) => each.title === 'Glass collection')?.modelId).toBe(glassModelId);
    expect(state).toMatchObject({ eventCount: 4, matchedModels: 1, etag: '"v1"', error: null });
    expect(state.lastSuccessAt).not.toBeNull();
    expect(harness.registry.get(parseEntityId(`calendar.rifiuti_${SUFFIX}`))?.state).toMatchObject({
      calendar: { next: { title: 'Glass collection', modelId: glassModelId } },
    });
  });

  it('takes a 304 on a refresh, keeping the events', async () => {
    const state = await fetcher.refresh(sourceId);
    const rows = await database.db
      .select({ id: calendarEvents.id })
      .from(calendarEvents)
      .where(eq(calendarEvents.calendarId, sourceId));

    expect(state).toMatchObject({ error: null, eventCount: 4 });
    expect(rows).toHaveLength(4);
  });

  it('keeps the old events when the source fails, and marks them stale', async () => {
    await database.db
      .update(calendars)
      .set({ icsUrl: `${base}/gone.ics` })
      .where(eq(calendars.id, sourceId));

    const state = await fetcher.refresh(sourceId);
    const rows = await database.db
      .select({ id: calendarEvents.id })
      .from(calendarEvents)
      .where(eq(calendarEvents.calendarId, sourceId));

    expect(state.error?.code).toBe('not_found');
    expect(rows).toHaveLength(4);
    expect(harness.registry.get(parseEntityId(`calendar.rifiuti_${SUFFIX}`))?.state).toMatchObject({
      calendar: { isStale: true },
    });
  });

  it('names what an address is when it is not a calendar', async () => {
    const results = await Promise.all(
      ['/page', '/private.ics', '/slow.ics', '/missing.ics'].map(async (path) =>
        fetcher.test({ url: `${base}${path}` }),
      ),
    );

    expect(results.map((result) => (result.kind === 'error' ? result.code : 'ok'))).toEqual([
      'not_calendar',
      'needs_sign_in',
      'unreachable',
      'not_found',
    ]);
  });

  it('tests a stored file against a calendar, and refuses a PDF', async () => {
    const [waste, pdf] = await database.db
      .insert(calendarIcsFiles)
      .values([
        { name: 'raccolta.ics', size: WASTE_ICS.length, body: WASTE_ICS },
        { name: 'flyer.ics', size: 20, body: '%PDF-1.7\n1 0 obj\nendobj\n' },
      ])
      .returning({ id: calendarIcsFiles.id });

    try {
      const found = await fetcher.test({ fileId: waste?.id ?? '', calendarId: sourceId });
      const refused = await fetcher.test({ fileId: pdf?.id ?? '' });

      expect(found).toMatchObject({
        kind: 'ok',
        fileId: waste?.id,
        eventCount: 4,
        matchedModels: 1,
        calendarName: 'Raccolta',
        allPast: false,
        next: { title: 'Glass collection', startsOn: addDays(today, 1) },
      });
      expect(refused).toMatchObject({ kind: 'error', code: 'not_calendar' });
    } finally {
      await database.db
        .delete(calendarIcsFiles)
        .where(inArray(calendarIcsFiles.id, [waste?.id ?? '', pdf?.id ?? '']));
    }
  });

  it('sweeps the files tested a day ago and never attached', async () => {
    const [old] = await database.db
      .insert(calendarIcsFiles)
      .values({
        name: 'old.ics',
        size: WASTE_ICS.length,
        body: WASTE_ICS,
        createdAt: new Date(Date.now() - 2 * 86_400_000),
      })
      .returning({ id: calendarIcsFiles.id });

    await sweepTestedFiles(database.db, new Date(Date.now() - 86_400_000));

    const left = await database.db
      .select({ id: calendarIcsFiles.id })
      .from(calendarIcsFiles)
      .where(eq(calendarIcsFiles.id, old?.id ?? ''));

    expect(left).toEqual([]);
  });

  it('takes the entity away with its calendar', async () => {
    await database.db.delete(calendars).where(eq(calendars.id, sourceId));
    await monitor.reload();

    expect(harness.directory.get(parseEntityId(`calendar.rifiuti_${SUFFIX}`))).toBeUndefined();
    expect(
      await database.db
        .select({ id: entities.id })
        .from(entities)
        .where(eq(entities.entityId, `calendar.rifiuti_${SUFFIX}`)),
    ).toEqual([]);
  });
});
