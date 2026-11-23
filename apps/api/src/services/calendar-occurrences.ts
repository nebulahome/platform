/**
 * The times things happen in the calendars, for a range of days: what the page draws, the feed
 * lists and the search finds (docs/calendar.md 6.1).
 *
 * Four kinds, read in the house's zone. Events typed in the house are expanded from their rule
 * (`occurrencesOf`), the days deleted one by one skipped and the ones changed one by one left to
 * the rows that replace them. Events a source brought in are already one row a time (`core`
 * expanded them), so they go through the same expansion as one-offs. Holidays are computed from
 * the house's place each year; a hidden one is a working day and no occurrence (the Holidays tab
 * lists it from {@link listHolidays}). A time, date or date-and-time entity shown in a calendar
 * gives its current value: a date is that whole day, a moment that instant, a time every day.
 */
import { and, asc, eq, gte, ilike, inArray, isNotNull, lt, lte, or } from 'drizzle-orm';
import { z } from 'zod';

import {
  addDays,
  calendarPatronSchema,
  calendarRepeatSchema,
  DAY_MS,
  entityIdSchema,
  iconIdSchema,
  instantOf,
  occurrencesOf,
  secondsOfDay,
  wallOf,
  type CalendarHoliday,
  type CalendarOccurrence,
  type CalendarPatron,
  type CalendarPlace,
  type CalendarSearchMatch,
  type CalendarSearchResult,
  type DayKey,
  type Identity,
} from '@nebulahome/contracts';
import { holidaysOf } from '@nebulahome/contracts/holidays';
import { schema, type Database } from '@nebulahome/db';

import { canEditEvent } from './calendar-access.js';
import { isIcsStale, readCalendarRecords, type CalendarRecord } from './calendar-store.js';

/** What the calendars read of the settings. */
export type CalendarSettings = {
  /** The house's zone: what days and wall clocks are read in. */
  readonly zone: string;

  /** The house's language, for the holidays' names. */
  readonly language: string;

  /** Where the holidays come from; null until the owner says. */
  readonly place: CalendarPlace | null;
  readonly patron: CalendarPatron | null;

  /** The keys of the holidays the owner hid. */
  readonly hiddenHolidays: ReadonlySet<string>;
};

/** What a read of occurrences covers. */
export type OccurrenceRange = {
  /** The first and last day, both included, in the house's zone. */
  readonly from: DayKey;
  readonly to: DayKey;

  /** Which calendars; every one when left out. */
  readonly calendarIds?: readonly string[] | undefined;

  /** Who reads, for what they may edit; null for a share link, which edits nothing. */
  readonly identity: Identity | null;
};

/** The values a time, date or date-and-time entity reports; anything else reads as none. */
const timeStateSchema = z
  .object({
    date: z.object({ value: z.string().nullable() }).optional(),
    datetime: z.object({ value: z.string().nullable() }).optional(),
    time_of_day: z.object({ value: z.string().nullable() }).optional(),
  })
  .catch({});

/** An event row as the expansion reads it. */
type EventRow = typeof schema.registry.calendarEvents.$inferSelect;

const events = schema.registry.calendarEvents;
const models = schema.registry.calendarModels;

/** The settings the calendars read. */
const SETTING_KEYS = [
  'house.timezone',
  'house.locale',
  'calendar.country',
  'calendar.region',
  'calendar.town',
  'calendar.patron',
  'calendar.hidden_holidays',
];

/**
 * A setting's value when it is a string.
 *
 * @param value - The value.
 * @returns It, or null.
 */
function textOf(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Reads what the calendars need of the settings.
 *
 * @param db - The database.
 * @returns The zone, the language, the place and the hidden holidays.
 */
export async function readCalendarSettings(db: Database): Promise<CalendarSettings> {
  const rows = await db
    .select({ key: schema.system.settings.key, value: schema.system.settings.value })
    .from(schema.system.settings)
    .where(inArray(schema.system.settings.key, SETTING_KEYS));
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const country = textOf(values.get('calendar.country'));
  const hidden = values.get('calendar.hidden_holidays');

  return {
    zone: textOf(values.get('house.timezone')) ?? 'UTC',
    language: (textOf(values.get('house.locale')) ?? 'en').slice(0, 2),
    place:
      country === null
        ? null
        : {
            country,
            region: textOf(values.get('calendar.region')),
            town: textOf(values.get('calendar.town')),
          },
    patron: calendarPatronSchema
      .nullable()
      .catch(null)
      .parse(values.get('calendar.patron') ?? null),
    hiddenHolidays: new Set(
      Array.isArray(hidden) ? hidden.filter((key) => typeof key === 'string') : [],
    ),
  };
}

/**
 * The repeat rule of a row, when it holds one this build reads.
 *
 * @param row - The event.
 * @returns The rule, or null: a one-off.
 */
function repeatOf(row: EventRow): ReturnType<typeof calendarRepeatSchema.parse> | null {
  const parsed = calendarRepeatSchema.safeParse(row.repeat);

  return parsed.success ? parsed.data : null;
}

/**
 * The days of each series that a row of their own replaces.
 *
 * @param db - The database.
 * @param seriesIds - The repeating events.
 * @returns The days, by series.
 */
async function replacedDays(
  db: Database,
  seriesIds: readonly string[],
): Promise<Map<string, Set<DayKey>>> {
  const replaced = new Map<string, Set<DayKey>>();

  if (seriesIds.length === 0) {
    return replaced;
  }

  const rows = await db
    .select({ seriesId: events.seriesId, occurrenceOn: events.occurrenceOn })
    .from(events)
    .where(inArray(events.seriesId, [...seriesIds]));

  for (const row of rows) {
    if (row.seriesId !== null && row.occurrenceOn !== null) {
      replaced.set(row.seriesId, (replaced.get(row.seriesId) ?? new Set()).add(row.occurrenceOn));
    }
  }

  return replaced;
}

/**
 * The times of event rows that touch a range of days.
 *
 * @param rows - The events.
 * @param range - The days and who reads.
 * @param zone - The house's zone.
 * @param replaced - The days of each series replaced by a row of their own.
 * @param calendars - The rows' calendars.
 * @returns The occurrences, in no order.
 */
function expandEvents(
  rows: readonly EventRow[],
  range: OccurrenceRange,
  zone: string,
  replaced: ReadonlyMap<string, ReadonlySet<DayKey>>,
  calendars: ReadonlyMap<string, CalendarRecord>,
): CalendarOccurrence[] {
  return rows.flatMap((row) => {
    const calendar = calendars.get(row.calendarId);

    if (calendar === undefined) {
      return [];
    }

    const repeat = repeatOf(row);
    const source = row.source === 'ics' ? 'ics' : 'user';
    const times = occurrencesOf(
      {
        isAllDay: row.isAllDay,
        startsOn: row.startsOn,
        endsOn: row.endsOn,
        startsAt: row.startsAt?.toISOString() ?? null,
        endsAt: row.endsAt?.toISOString() ?? null,
        timeZone: row.timeZone,
        repeat,
        skippedOn: row.skippedOn,
      },
      range.from,
      range.to,
      zone,
      replaced.get(row.id),
    );

    return times.map((time): CalendarOccurrence => ({
      key: `${row.id}:${time.occurrenceOn}`,
      kind: 'event',
      eventId: row.id,
      seriesId: row.seriesId,
      calendarId: row.calendarId,
      modelId: row.modelId,
      title: row.title,
      icon: row.icon,
      notes: row.notes,
      isAllDay: time.isAllDay,
      startsOn: time.isAllDay ? time.startsOn : null,
      endsOn: time.isAllDay ? time.endsOn : null,
      startsAt: time.isAllDay ? null : time.startsAt,
      endsAt: time.isAllDay ? null : time.endsAt,
      occurrenceOn: repeat === null ? row.occurrenceOn : time.occurrenceOn,
      isRepeating: repeat !== null || row.seriesId !== null,
      source,
      entityId: null,
      canEdit: range.identity !== null && canEditEvent(range.identity, calendar, source),
      isStale: source === 'ics' && isIcsStale(calendar.icsState),
      createdBy: row.createdBy,
    }));
  });
}

/**
 * The holidays of the years a range spans, inside it and not hidden.
 *
 * @param settings - The place, the language, the patron and the hidden keys.
 * @param from - The first day.
 * @param to - The last day.
 * @param calendarId - The Holidays calendar.
 * @returns The occurrences.
 */
function holidayOccurrences(
  settings: CalendarSettings,
  from: DayKey,
  to: DayKey,
  calendarId: string,
): CalendarOccurrence[] {
  const { place } = settings;

  if (place === null) {
    return [];
  }

  const occurrences: CalendarOccurrence[] = [];

  for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year += 1) {
    for (const holiday of holidaysOf(year, place, settings.language, settings.patron)) {
      if (holiday.date >= from && holiday.date <= to && !settings.hiddenHolidays.has(holiday.key)) {
        occurrences.push({
          key: `holiday:${holiday.key}:${holiday.date}`,
          kind: 'holiday',
          eventId: null,
          seriesId: null,
          calendarId,
          modelId: null,
          title: holiday.name,
          icon: null,
          notes: null,
          isAllDay: true,
          startsOn: holiday.date,
          endsOn: holiday.date,
          startsAt: null,
          endsAt: null,
          occurrenceOn: null,
          isRepeating: false,
          source: 'holiday',
          entityId: null,
          canEdit: false,
          isStale: false,
          createdBy: null,
        });
      }
    }
  }

  return occurrences;
}

/**
 * The times the values of the entities shown in some calendars give inside a range.
 *
 * @param db - The database.
 * @param range - The days.
 * @param zone - The house's zone, the one a time of day is kept in.
 * @param calendarIds - The calendars read.
 * @returns The occurrences.
 */
async function entityOccurrences(
  db: Database,
  range: OccurrenceRange,
  zone: string,
  calendarIds: readonly string[],
): Promise<CalendarOccurrence[]> {
  if (calendarIds.length === 0) {
    return [];
  }

  const entities = schema.registry.entities;
  const rows = await db
    .select({
      entityId: entities.entityId,
      name: entities.name,
      icon: entities.icon,
      calendarId: entities.calendarId,
      state: schema.registry.entityStates.state,
    })
    .from(entities)
    .leftJoin(schema.registry.entityStates, eq(schema.registry.entityStates.entityId, entities.id))
    .where(and(inArray(entities.calendarId, [...calendarIds]), eq(entities.isEnabled, true)));

  return rows.flatMap((row) => {
    const entityId = entityIdSchema.safeParse(row.entityId);
    const state = timeStateSchema.parse(row.state ?? {});

    if (!entityId.success) {
      return [];
    }

    /**
     * One time of the entity.
     *
     * @param day - The day it falls on, part of its key.
     * @param times - Its day, or its instant.
     * @returns The occurrence.
     */
    const at = (
      day: DayKey,
      times: Pick<CalendarOccurrence, 'isAllDay' | 'startsOn' | 'endsOn' | 'startsAt' | 'endsAt'>,
    ): CalendarOccurrence => ({
      key: `entity:${row.entityId}:${day}`,
      kind: 'entity',
      eventId: null,
      seriesId: null,
      calendarId: row.calendarId ?? '',
      modelId: null,
      title: row.name,
      icon: iconIdSchema.safeParse(row.icon).success ? row.icon : null,
      notes: null,
      ...times,
      occurrenceOn: null,
      isRepeating: false,
      source: 'entity',
      entityId: entityId.data,
      canEdit: false,
      isStale: false,
      createdBy: null,
    });
    const date = state.date?.value;
    const moment = state.datetime?.value;
    const clock = state.time_of_day?.value;

    if (typeof date === 'string') {
      return date >= range.from && date <= range.to
        ? [at(date, { isAllDay: true, startsOn: date, endsOn: date, startsAt: null, endsAt: null })]
        : [];
    }

    if (typeof moment === 'string') {
      const instant = new Date(moment);
      const day = wallOf(instant.getTime(), zone).day;

      return Number.isNaN(instant.getTime()) || day < range.from || day > range.to
        ? []
        : [
            at(day, {
              isAllDay: false,
              startsOn: null,
              endsOn: null,
              startsAt: instant.toISOString(),
              endsAt: instant.toISOString(),
            }),
          ];
    }

    if (typeof clock === 'string') {
      const days: CalendarOccurrence[] = [];

      for (let day = range.from; day <= range.to; day = addDays(day, 1)) {
        const startsAt = new Date(instantOf(day, secondsOfDay(clock), zone)).toISOString();

        days.push(
          at(day, { isAllDay: false, startsOn: null, endsOn: null, startsAt, endsAt: startsAt }),
        );
      }

      return days;
    }

    return [];
  });
}

/**
 * The instant an occurrence starts, to put them in order.
 *
 * @param occurrence - The occurrence.
 * @param zone - The house's zone, where an all-day one starts at midnight.
 * @returns Milliseconds since the epoch.
 */
function startOf(occurrence: CalendarOccurrence, zone: string): number {
  return occurrence.startsAt === null
    ? instantOf(occurrence.startsOn ?? '1970-01-01', 0, zone)
    : Date.parse(occurrence.startsAt);
}

/**
 * Puts occurrences in order: by start, an all-day one before a timed one at the same instant.
 *
 * @param occurrences - The occurrences.
 * @param zone - The house's zone.
 * @returns Them, ordered.
 */
function inOrder(occurrences: CalendarOccurrence[], zone: string): CalendarOccurrence[] {
  return occurrences.toSorted(
    (left, right) =>
      startOf(left, zone) - startOf(right, zone) ||
      Number(right.isAllDay) - Number(left.isAllDay) ||
      left.title.localeCompare(right.title),
  );
}

/**
 * Reads the times things happen in some calendars over a range of days.
 *
 * @param db - The database.
 * @param range - The days, the calendars and who reads.
 * @param settings - The calendar settings, when already read.
 * @returns The occurrences, earliest first.
 */
export async function readOccurrences(
  db: Database,
  range: OccurrenceRange,
  settings?: CalendarSettings,
): Promise<CalendarOccurrence[]> {
  const known = settings ?? (await readCalendarSettings(db));
  const calendars = await readCalendarRecords(db, range.calendarIds);
  const calendarIds = [...calendars.keys()];

  if (calendarIds.length === 0) {
    return [];
  }

  // A day on either side, so no zone puts an event's edge outside what is read.
  const fromInstant = new Date(instantOf(range.from, 0, known.zone) - DAY_MS);
  const toInstant = new Date(instantOf(addDays(range.to, 1), 0, known.zone) + DAY_MS);
  const rows = await db
    .select()
    .from(events)
    .where(
      and(
        inArray(events.calendarId, calendarIds),
        or(
          and(
            eq(events.isAllDay, true),
            lte(events.startsOn, addDays(range.to, 1)),
            or(isNotNull(events.repeat), gte(events.endsOn, addDays(range.from, -1))),
          ),
          and(
            eq(events.isAllDay, false),
            lt(events.startsAt, toInstant),
            or(isNotNull(events.repeat), gte(events.endsAt, fromInstant)),
          ),
        ),
      ),
    );
  const replaced = await replacedDays(
    db,
    rows.filter((row) => row.repeat !== null).map((row) => row.id),
  );
  const holidays = [...calendars.values()].find((calendar) => calendar.kind === 'holidays');

  return inOrder(
    [
      ...expandEvents(rows, range, known.zone, replaced, calendars),
      ...(holidays === undefined
        ? []
        : holidayOccurrences(known, range.from, range.to, holidays.id)),
      ...(await entityOccurrences(db, range, known.zone, calendarIds)),
    ],
    known.zone,
  );
}

/** How far either side of today a search looks for the times of what it found. */
const SEARCH_SPAN_DAYS = 400;

/** How many times of one event a search lists, either side of now: a daily event fills none. */
const SEARCH_TIMES_PER_EVENT = 3;

/** How many times a search lists, either side of now. */
const SEARCH_LIMIT = 100;

/**
 * Escapes the wildcards of a `LIKE` pattern.
 *
 * @param text - What was typed.
 * @returns It, matching itself.
 */
function likeLiteral(text: string): string {
  return text.replaceAll(/[\\%_]/gu, (character) => `\\${character}`);
}

/**
 * Looks for events in every calendar by their title, notes or model's name.
 *
 * @param db - The database.
 * @param q - What was typed.
 * @param identity - Who looks, for what they may edit.
 * @param now - Now: what divides the coming times from the past ones.
 * @returns The coming times, soonest first, and the past ones, latest first.
 */
export async function searchOccurrences(
  db: Database,
  q: string,
  identity: Identity,
  now: Date,
): Promise<CalendarSearchResult> {
  const settings = await readCalendarSettings(db);
  const pattern = `%${likeLiteral(q)}%`;
  const found = await db
    .select({ event: events, modelName: models.name })
    .from(events)
    .leftJoin(models, eq(models.id, events.modelId))
    .where(
      or(ilike(events.title, pattern), ilike(events.notes, pattern), ilike(models.name, pattern)),
    )
    .orderBy(asc(events.title))
    .limit(200);

  if (found.length === 0) {
    return { comingUp: [], past: [] };
  }

  const rows = found.map((each) => each.event);
  const today = wallOf(now.getTime(), settings.zone).day;
  const range: OccurrenceRange = {
    from: addDays(today, -SEARCH_SPAN_DAYS),
    to: addDays(today, SEARCH_SPAN_DAYS),
    identity,
  };
  const calendars = await readCalendarRecords(db, [...new Set(rows.map((row) => row.calendarId))]);
  const replaced = await replacedDays(
    db,
    rows.filter((row) => row.repeat !== null).map((row) => row.id),
  );
  const needle = q.toLowerCase();
  const matchedOf = new Map(
    found.map(({ event, modelName }) => [
      event.id,
      event.title.toLowerCase().includes(needle)
        ? ('title' as const)
        : (event.notes ?? '').toLowerCase().includes(needle)
          ? ('notes' as const)
          : modelName === null
            ? ('title' as const)
            : ('model' as const),
    ]),
  );
  const occurrences = inOrder(
    expandEvents(rows, range, settings.zone, replaced, calendars),
    settings.zone,
  ).map((occurrence): CalendarSearchMatch => ({
    ...occurrence,
    matched: matchedOf.get(occurrence.eventId ?? '') ?? 'title',
  }));
  /**
   * Whether a time has not ended yet.
   *
   * @param occurrence - The time.
   * @returns True when it ends now or later.
   */
  const isComing = (occurrence: CalendarOccurrence): boolean =>
    occurrence.isAllDay
      ? (occurrence.endsOn ?? '') >= today
      : Date.parse(occurrence.endsAt ?? '') >= now.getTime();
  /**
   * Keeps the first few times of each event, and no more than the limit in all.
   *
   * @param list - The times, in the order they are listed.
   * @returns The ones kept.
   */
  const fewOfEach = (list: CalendarSearchMatch[]): CalendarSearchMatch[] => {
    const counted = new Map<string, number>();

    return list
      .filter((occurrence) => {
        const seen = counted.get(occurrence.eventId ?? '') ?? 0;

        counted.set(occurrence.eventId ?? '', seen + 1);

        return seen < SEARCH_TIMES_PER_EVENT;
      })
      .slice(0, SEARCH_LIMIT);
  };

  return {
    comingUp: fewOfEach(occurrences.filter(isComing)),
    past: fewOfEach(occurrences.filter((occurrence) => !isComing(occurrence)).toReversed()),
  };
}

/**
 * Lists the holidays of a year for the Holidays settings: the computed ones, hidden ones
 * included and marked, and the ones added by hand (events of the Holidays calendar).
 *
 * @param db - The database.
 * @param year - The year.
 * @returns The holidays, by date.
 */
export async function listHolidays(db: Database, year: number): Promise<CalendarHoliday[]> {
  const settings = await readCalendarSettings(db);
  const computed: CalendarHoliday[] =
    settings.place === null
      ? []
      : holidaysOf(year, settings.place, settings.language, settings.patron).map((holiday) => ({
          ...holiday,
          isHidden: settings.hiddenHolidays.has(holiday.key),
          eventId: null,
        }));
  const [holidays] = await db
    .select({ id: schema.registry.calendars.id })
    .from(schema.registry.calendars)
    .where(eq(schema.registry.calendars.kind, 'holidays'));
  const manual =
    holidays === undefined
      ? []
      : (
          await readOccurrences(
            db,
            {
              from: `${String(year)}-01-01`,
              to: `${String(year)}-12-31`,
              calendarIds: [holidays.id],
              identity: null,
            },
            settings,
          )
        )
          .filter(
            (occurrence) =>
              occurrence.kind === 'event' &&
              (occurrence.startsOn ?? String(year)).startsWith(String(year)),
          )
          .map((occurrence): CalendarHoliday => {
            const key = `manual.${occurrence.eventId ?? ''}`;

            return {
              key,
              date:
                occurrence.startsOn ??
                wallOf(Date.parse(occurrence.startsAt ?? ''), settings.zone).day,
              name: occurrence.title,
              kind: 'manual',
              isHidden: settings.hiddenHolidays.has(key),
              eventId: occurrence.eventId,
            };
          });

  return [...computed, ...manual].toSorted((left, right) => left.date.localeCompare(right.date));
}
