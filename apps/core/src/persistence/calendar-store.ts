/**
 * The calendar rows `core` reads and writes (docs/calendar.md 7).
 *
 * The API writes the calendars, their models and events; `core` reads them back on every
 * `sync_calendars` to keep the calendar entities and the triggers in step. The one thing `core`
 * writes is what a calendar's source brought in: one row per occurrence (`source = 'ics'`, keyed
 * by `source_uid`) and the source's `ics_state`. The calendar's own events stay as they are.
 */
import { and, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  addDays,
  calendarIcsStateSchema,
  calendarPatronSchema,
  calendarRepeatSchema,
  DAY_MS,
  instantOf,
  type CalendarIcsState,
  type DayKey,
} from '@nebulahome/contracts';
import { schema, type Database } from '@nebulahome/db';

import type {
  CalendarEventInput,
  CalendarInfo,
  CalendarSettings,
  ShownEntity,
} from '../domain/calendar/calendar-times.js';
import type { IcsInstance, IcsModel } from '../domain/calendar/ics-parse.js';

/** A calendar, as the entities and the expansion need it. */
export type CalendarRecord = CalendarInfo & {
  readonly name: string;
  readonly color: string;
  readonly icon: string | null;

  /** Whether its source failed its last read. */
  readonly isStale: boolean;
};

/** What the calendars hold over a range, as read from the rows. */
export type CalendarRows = {
  readonly calendars: readonly CalendarRecord[];
  readonly events: readonly CalendarEventInput[];
  readonly replaced: ReadonlyMap<string, ReadonlySet<DayKey>>;
  readonly settings: CalendarSettings;

  /** The time and date entities shown in a calendar; their states are the registry's. */
  readonly shown: readonly Omit<ShownEntity, 'state'>[];
};

/** A calendar that reads a source: an address, or a loaded file. */
export type IcsSource = {
  readonly calendarId: string;
  readonly url: string | null;
  readonly fileId: string | null;
  readonly state: CalendarIcsState;
  readonly models: readonly IcsModel[];
};

const calendars = schema.registry.calendars;
const events = schema.registry.calendarEvents;
const models = schema.registry.calendarModels;
const files = schema.registry.calendarIcsFiles;
const entities = schema.registry.entities;

/** The settings the calendars read. */
const SETTING_KEYS = [
  'house.locale',
  'calendar.country',
  'calendar.region',
  'calendar.town',
  'calendar.patron',
  'calendar.hidden_holidays',
  'calendar.weekend_days',
];

/** Saturday and Sunday, what a house has until it says otherwise. */
const weekendDaysSchema = z.array(z.int().min(0).max(6)).catch([5, 6]);

/** How many rows one statement writes, well inside Postgres' 65 535 parameters. */
const CHUNK = 500;

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
 * A source's state as kept, with the defaults of one never tried.
 *
 * @param value - The `ics_state` column.
 * @returns The state.
 */
export function icsStateOf(value: unknown): CalendarIcsState {
  const parsed = calendarIcsStateSchema.safeParse(value ?? {});

  return parsed.success ? parsed.data : calendarIcsStateSchema.parse({});
}

/**
 * Reads what the calendars need of the settings.
 *
 * @param db - The database.
 * @returns The language, the place, the patron, the hidden holidays and the weekend.
 */
async function readSettings(db: Database): Promise<CalendarSettings> {
  const rows = await db
    .select({ key: schema.system.settings.key, value: schema.system.settings.value })
    .from(schema.system.settings)
    .where(inArray(schema.system.settings.key, SETTING_KEYS));
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const country = textOf(values.get('calendar.country'));
  const hidden = values.get('calendar.hidden_holidays');

  return {
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
    weekendDays: weekendDaysSchema.parse(values.get('calendar.weekend_days') ?? [5, 6]),
  };
}

/**
 * Reads the calendars, the events that may touch a range of days, the settings and the entities
 * shown in a calendar.
 *
 * @param db - The database.
 * @param zone - The house's zone.
 * @param from - The range's first day.
 * @param to - Its last day, included.
 * @returns The rows.
 */
export async function readCalendarRows(
  db: Database,
  zone: string,
  from: DayKey,
  to: DayKey,
): Promise<CalendarRows> {
  // A day on either side, so no zone puts an event's edge outside what is read.
  const fromInstant = new Date(instantOf(from, 0, zone) - DAY_MS);
  const toInstant = new Date(instantOf(addDays(to, 1), 0, zone) + DAY_MS);
  const [calendarRows, eventRows, replacing, settings, shown] = await Promise.all([
    db
      .select({
        id: calendars.id,
        kind: calendars.kind,
        name: calendars.name,
        color: calendars.color,
        icon: calendars.icon,
        isDayOff: calendars.isDayOff,
        icsState: calendars.icsState,
      })
      .from(calendars)
      .orderBy(calendars.position, calendars.createdAt),
    db
      .select()
      .from(events)
      .where(
        or(
          and(
            eq(events.isAllDay, true),
            lte(events.startsOn, addDays(to, 1)),
            or(isNotNull(events.repeat), gte(events.endsOn, addDays(from, -1))),
          ),
          and(
            eq(events.isAllDay, false),
            lt(events.startsAt, toInstant),
            or(isNotNull(events.repeat), gte(events.endsAt, fromInstant)),
          ),
        ),
      ),
    db
      .select({ seriesId: events.seriesId, occurrenceOn: events.occurrenceOn })
      .from(events)
      .where(isNotNull(events.seriesId)),
    readSettings(db),
    db
      .select({
        entityId: entities.entityId,
        name: entities.name,
        icon: entities.icon,
        calendarId: entities.calendarId,
      })
      .from(entities)
      .where(
        and(
          isNotNull(entities.calendarId),
          ne(entities.domain, 'calendar'),
          eq(entities.isEnabled, true),
        ),
      ),
  ]);
  const replaced = new Map<string, Set<DayKey>>();

  for (const row of replacing) {
    if (row.seriesId !== null && row.occurrenceOn !== null) {
      replaced.set(row.seriesId, (replaced.get(row.seriesId) ?? new Set()).add(row.occurrenceOn));
    }
  }

  return {
    calendars: calendarRows.map((row) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      color: row.color,
      icon: row.icon,
      isDayOff: row.isDayOff,
      isStale: icsStateOf(row.icsState).error !== null,
    })),
    events: eventRows.map((row) => {
      const repeat = calendarRepeatSchema.safeParse(row.repeat);

      return {
        id: row.id,
        calendarId: row.calendarId,
        modelId: row.modelId,
        title: row.title,
        icon: row.icon,
        isAllDay: row.isAllDay,
        startsOn: row.startsOn,
        endsOn: row.endsOn,
        startsAt: row.startsAt?.toISOString() ?? null,
        endsAt: row.endsAt?.toISOString() ?? null,
        timeZone: row.timeZone,
        repeat: repeat.success ? repeat.data : null,
        skippedOn: row.skippedOn,
      };
    }),
    replaced,
    settings,
    shown: shown.flatMap((row) =>
      row.calendarId === null
        ? []
        : [{ entityId: row.entityId, name: row.name, icon: row.icon, calendarId: row.calendarId }],
    ),
  };
}

/**
 * Reads the calendars that read a source, with their models.
 *
 * @param db - The database.
 * @param calendarId - One calendar; every one with a source when left out.
 * @returns The sources.
 */
export async function readIcsSources(db: Database, calendarId?: string): Promise<IcsSource[]> {
  const rows = await db
    .select({
      calendarId: calendars.id,
      url: calendars.icsUrl,
      fileId: files.id,
      state: calendars.icsState,
    })
    .from(calendars)
    .leftJoin(files, eq(files.calendarId, calendars.id))
    .where(
      and(
        calendarId === undefined ? undefined : eq(calendars.id, calendarId),
        or(isNotNull(calendars.icsUrl), isNotNull(files.id)),
      ),
    );
  const modelRows =
    rows.length === 0
      ? []
      : await db
          .select({ id: models.id, name: models.name, calendarId: models.calendarId })
          .from(models)
          .where(
            inArray(
              models.calendarId,
              rows.map((row) => row.calendarId),
            ),
          );

  return rows.map((row) => ({
    calendarId: row.calendarId,
    url: row.url,
    fileId: row.fileId,
    state: icsStateOf(row.state),
    models: modelRows.filter((model) => model.calendarId === row.calendarId),
  }));
}

/**
 * Reads a calendar's models, to match a tested source's events against.
 *
 * @param db - The database.
 * @param calendarId - The calendar.
 * @returns Its models.
 */
export async function readCalendarModels(db: Database, calendarId: string): Promise<IcsModel[]> {
  return db
    .select({ id: models.id, name: models.name })
    .from(models)
    .where(eq(models.calendarId, calendarId));
}

/**
 * Reads a loaded file's text.
 *
 * @param db - The database.
 * @param fileId - The file.
 * @returns Its text, or null when there is no such file.
 */
export async function readIcsFile(db: Database, fileId: string): Promise<string | null> {
  const [row] = await db.select({ body: files.body }).from(files).where(eq(files.id, fileId));

  return row?.body ?? null;
}

/**
 * Writes what a read of a calendar's source came to: its occurrences, when it brought any, and
 * the source's state. The occurrences replace the ones the source brought before - kept by
 * `source_uid`, the ones no longer in it deleted - and the calendar's own events stay.
 *
 * Nothing is written when the calendar's source changed while it was read: the API dropped the
 * old source's events, and the read is of a source the calendar no longer has.
 *
 * @param db - The database.
 * @param source - The calendar and the source read.
 * @param state - The source's state after the read.
 * @param instances - The occurrences, or undefined to keep the ones there (a failure, a 304).
 * @returns Whether it was written.
 */
export async function writeIcsRead(
  db: Database,
  source: Pick<IcsSource, 'calendarId' | 'url' | 'fileId'>,
  state: CalendarIcsState,
  instances: readonly IcsInstance[] | undefined,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ url: calendars.icsUrl })
      .from(calendars)
      .where(eq(calendars.id, source.calendarId))
      .for('update');
    const [file] = await tx
      .select({ id: files.id })
      .from(files)
      .where(eq(files.calendarId, source.calendarId));

    if (row?.url !== source.url || (file?.id ?? null) !== source.fileId) {
      return false;
    }

    if (instances !== undefined) {
      const kept = new Set(instances.map((instance) => instance.sourceUid));
      const existing = await tx
        .select({ id: events.id, sourceUid: events.sourceUid })
        .from(events)
        .where(and(eq(events.calendarId, source.calendarId), eq(events.source, 'ics')));
      const gone = existing
        .filter((each) => each.sourceUid === null || !kept.has(each.sourceUid))
        .map((each) => each.id);

      for (let index = 0; index < gone.length; index += CHUNK) {
        // eslint-disable-next-line no-await-in-loop -- one transaction, one statement at a time
        await tx.delete(events).where(inArray(events.id, gone.slice(index, index + CHUNK)));
      }

      for (let index = 0; index < instances.length; index += CHUNK) {
        // eslint-disable-next-line no-await-in-loop -- one transaction, one statement at a time
        await tx
          .insert(events)
          .values(
            instances.slice(index, index + CHUNK).map((instance) => ({
              calendarId: source.calendarId,
              modelId: instance.modelId,
              title: instance.title,
              notes: instance.notes,
              isAllDay: instance.isAllDay,
              startsOn: instance.startsOn,
              endsOn: instance.endsOn,
              startsAt: instance.startsAt === null ? null : new Date(instance.startsAt),
              endsAt: instance.endsAt === null ? null : new Date(instance.endsAt),
              // One row a time and never repeated: UTC reads its instants back unchanged.
              timeZone: 'UTC',
              source: 'ics',
              sourceUid: instance.sourceUid,
            })),
          )
          .onConflictDoUpdate({
            target: [events.calendarId, events.sourceUid],
            set: {
              modelId: sql`excluded.model_id`,
              title: sql`excluded.title`,
              notes: sql`excluded.notes`,
              isAllDay: sql`excluded.is_all_day`,
              startsOn: sql`excluded.starts_on`,
              endsOn: sql`excluded.ends_on`,
              startsAt: sql`excluded.starts_at`,
              endsAt: sql`excluded.ends_at`,
            },
          });
      }
    }

    await tx
      .update(calendars)
      .set({
        icsState: {
          ...state,
          lastAttemptAt: state.lastAttemptAt?.toISOString() ?? null,
          lastSuccessAt: state.lastSuccessAt?.toISOString() ?? null,
        },
      })
      .where(eq(calendars.id, source.calendarId));

    return true;
  });
}

/**
 * Deletes the files tested and never attached to a calendar.
 *
 * @param db - The database.
 * @param before - Those loaded before this instant go.
 * @returns How many went.
 */
export async function sweepTestedFiles(db: Database, before: Date): Promise<number> {
  const gone = await db
    .delete(files)
    .where(and(isNull(files.calendarId), lt(files.createdAt, before)))
    .returning({ id: files.id });

  return gone.length;
}
