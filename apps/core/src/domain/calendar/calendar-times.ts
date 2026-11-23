/**
 * The times things happen in the house's calendars, as `core` keeps them: what the calendar
 * entities and the working-day sensors say, and when a calendar trigger fires.
 *
 * Read the way the API reads them for the page (`apps/api/src/services/calendar-occurrences.ts`),
 * so the entity says what the page shows: events typed in the house expanded from their rule, the
 * days deleted one by one skipped and the ones changed one by one left to the rows that replace
 * them; events a source brought in, already one row a time; the holidays of the house's place,
 * hidden ones left out, in the Holidays calendar; and the value of each time or date entity shown
 * in a calendar. An all-day time runs from midnight to midnight in the house's zone.
 *
 * Pure: the rows and the entities' states come in, the clock is an argument.
 */
import type { z } from 'zod';

import {
  addDays,
  iconIdSchema,
  instantOf,
  isWorkingDay,
  occurrencesOf,
  secondsOfDay,
  wallOf,
  type calendarStateSchema,
  type CalendarPatron,
  type CalendarPlace,
  type DayKey,
  type RepeatingEvent,
} from '@nebulahome/contracts';
import { holidaysOf } from '@nebulahome/contracts/holidays';

/** What a calendar entity says. */
export type CalendarEntityState = z.output<typeof calendarStateSchema>;

/** A calendar, as the expansion needs it. */
export type CalendarInfo = {
  readonly id: string;
  readonly kind: string;

  /** Whether its events are days off (Holidays always is). */
  readonly isDayOff: boolean;
};

/** An event row, as the expansion reads it. */
export type CalendarEventInput = RepeatingEvent & {
  readonly id: string;
  readonly calendarId: string;
  readonly modelId: string | null;
  readonly title: string;
  readonly icon: string | null;
};

/** What the calendars read of the settings. */
export type CalendarSettings = {
  /** The house's language, for the holidays' names. */
  readonly language: string;

  /** Where the holidays come from; null until the owner says. */
  readonly place: CalendarPlace | null;
  readonly patron: CalendarPatron | null;

  /** The keys of the holidays the owner hid. */
  readonly hiddenHolidays: ReadonlySet<string>;

  /** The days of the week that are weekend, 0 for Monday. */
  readonly weekendDays: readonly number[];
};

/** A time or date entity shown in a calendar, with what it holds now. */
export type ShownEntity = {
  readonly entityId: string;
  readonly name: string;
  readonly icon: string | null;
  readonly calendarId: string;

  /** Its capabilities' state, as the registry holds it; undefined before it reports. */
  readonly state: Readonly<Record<string, unknown>> | undefined;
};

/** Everything the expansion reads. */
export type CalendarInputs = {
  readonly calendars: readonly CalendarInfo[];
  readonly events: readonly CalendarEventInput[];

  /** The days of each series a row of their own replaces. */
  readonly replaced: ReadonlyMap<string, ReadonlySet<DayKey>>;
  readonly settings: CalendarSettings;
  readonly entities: readonly ShownEntity[];
};

/** One time something happens in a calendar. */
export type CalendarTime = {
  readonly kind: 'event' | 'holiday' | 'entity';
  readonly calendarId: string;

  /** The event, for an event; null for a holiday or an entity's value. */
  readonly eventId: string | null;
  readonly modelId: string | null;
  readonly title: string;
  readonly icon: string | null;
  readonly isAllDay: boolean;
  readonly startsOn: DayKey | null;
  readonly endsOn: DayKey | null;
  readonly startsAt: string | null;
  readonly endsAt: string | null;

  /** When it starts and ends, an all-day one at midnight in the house's zone. */
  readonly start: number;
  readonly end: number;
};

/** What a calendar trigger asks of the calendars. */
export type CalendarEdgeQuery = {
  readonly calendarId: string;
  readonly edge: 'start' | 'end';

  /** Minutes before (negative) or after the edge. */
  readonly offsetMinutes: number;

  /** Only times of these models; every time when empty. */
  readonly modelIds: readonly string[];
};

/**
 * A time's start and end as instants.
 *
 * @param times - Its days, or its moments.
 * @param zone - The house's zone.
 * @returns Milliseconds since the epoch.
 */
function spanOf(
  times: Pick<CalendarTime, 'startsOn' | 'endsOn' | 'startsAt' | 'endsAt'>,
  zone: string,
): { start: number; end: number } {
  return times.startsAt === null
    ? {
        start: instantOf(times.startsOn ?? '1970-01-01', 0, zone),
        end: instantOf(addDays(times.endsOn ?? times.startsOn ?? '1970-01-01', 1), 0, zone),
      }
    : { start: Date.parse(times.startsAt), end: Date.parse(times.endsAt ?? times.startsAt) };
}

/**
 * The value of one capability of a state, when it is a string.
 *
 * @param state - The entity's state.
 * @param capability - Which.
 * @returns The value, or undefined.
 */
function valueOf(
  state: Readonly<Record<string, unknown>> | undefined,
  capability: string,
): string | undefined {
  const value = (state?.[capability] as { value?: unknown } | undefined)?.value;

  return typeof value === 'string' ? value : undefined;
}

/**
 * The times the values of the entities shown in calendars give inside a range: a date is that
 * whole day, a moment that instant, a time of day every day.
 *
 * @param entities - The entities and their states.
 * @param from - The first day.
 * @param to - The last day.
 * @param zone - The house's zone.
 * @returns The times, in no order.
 */
function entityTimes(
  entities: readonly ShownEntity[],
  from: DayKey,
  to: DayKey,
  zone: string,
): CalendarTime[] {
  return entities.flatMap((entity) => {
    const shared = {
      kind: 'entity' as const,
      calendarId: entity.calendarId,
      eventId: null,
      modelId: null,
      title: entity.name,
      icon: entity.icon,
    };
    const date = valueOf(entity.state, 'date');
    const moment = valueOf(entity.state, 'datetime');
    const clock = valueOf(entity.state, 'time_of_day');

    if (date !== undefined) {
      const days = { startsOn: date, endsOn: date, startsAt: null, endsAt: null };

      return date >= from && date <= to
        ? [{ ...shared, isAllDay: true, ...days, ...spanOf(days, zone) }]
        : [];
    }

    if (moment !== undefined) {
      const instant = Date.parse(moment);
      const day = Number.isNaN(instant) ? '' : wallOf(instant, zone).day;
      const at = Number.isNaN(instant) ? '' : new Date(instant).toISOString();

      return day >= from && day <= to
        ? [
            {
              ...shared,
              isAllDay: false,
              startsOn: null,
              endsOn: null,
              startsAt: at,
              endsAt: at,
              start: instant,
              end: instant,
            },
          ]
        : [];
    }

    if (clock === undefined) {
      return [];
    }

    const times: CalendarTime[] = [];

    for (let day = from; day <= to; day = addDays(day, 1)) {
      const instant = instantOf(day, secondsOfDay(clock), zone);
      const at = new Date(instant).toISOString();

      times.push({
        ...shared,
        isAllDay: false,
        startsOn: null,
        endsOn: null,
        startsAt: at,
        endsAt: at,
        start: instant,
        end: instant,
      });
    }

    return times;
  });
}

/**
 * Every time things happen in the calendars over a range of days, in order: by start, an
 * all-day one before a timed one at the same instant.
 *
 * @param inputs - The calendars, their events, the settings and the entities shown in them.
 * @param from - The first day, in the house's zone.
 * @param to - The last day, included.
 * @param zone - The house's zone.
 * @returns The times.
 */
export function expandCalendars(
  inputs: CalendarInputs,
  from: DayKey,
  to: DayKey,
  zone: string,
): CalendarTime[] {
  const known = new Set(inputs.calendars.map((calendar) => calendar.id));
  const events = inputs.events
    .filter((event) => known.has(event.calendarId))
    .flatMap((event) =>
      occurrencesOf(event, from, to, zone, inputs.replaced.get(event.id)).map((time) => {
        const times = time.isAllDay
          ? { startsOn: time.startsOn, endsOn: time.endsOn, startsAt: null, endsAt: null }
          : { startsOn: null, endsOn: null, startsAt: time.startsAt, endsAt: time.endsAt };

        return {
          kind: 'event' as const,
          calendarId: event.calendarId,
          eventId: event.id,
          modelId: event.modelId,
          title: event.title,
          icon: event.icon,
          isAllDay: time.isAllDay,
          ...times,
          ...spanOf(times, zone),
        };
      }),
    );
  const holidays = inputs.calendars.find((calendar) => calendar.kind === 'holidays');
  const { place, language, patron, hiddenHolidays } = inputs.settings;
  const holidayTimes: CalendarTime[] = [];

  if (holidays !== undefined && place !== null) {
    for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year += 1) {
      for (const holiday of holidaysOf(year, place, language, patron)) {
        if (holiday.date >= from && holiday.date <= to && !hiddenHolidays.has(holiday.key)) {
          const days = {
            startsOn: holiday.date,
            endsOn: holiday.date,
            startsAt: null,
            endsAt: null,
          };

          holidayTimes.push({
            kind: 'holiday',
            calendarId: holidays.id,
            eventId: null,
            modelId: null,
            title: holiday.name,
            icon: null,
            isAllDay: true,
            ...days,
            ...spanOf(days, zone),
          });
        }
      }
    }
  }

  return [
    ...events,
    ...holidayTimes,
    ...entityTimes(
      inputs.entities.filter((entity) => known.has(entity.calendarId)),
      from,
      to,
      zone,
    ),
  ].toSorted(
    (left, right) =>
      left.start - right.start ||
      Number(right.isAllDay) - Number(left.isAllDay) ||
      left.title.localeCompare(right.title),
  );
}

/**
 * A time as a calendar entity tells it.
 *
 * @param time - The time.
 * @returns Its title, icon, model and days or moments.
 */
function summaryOf(time: CalendarTime): NonNullable<CalendarEntityState['current']> {
  return {
    title: time.title.slice(0, 120),
    icon: iconIdSchema.safeParse(time.icon).success ? time.icon : null,
    modelId: time.modelId,
    isAllDay: time.isAllDay,
    startsOn: time.startsOn,
    endsOn: time.endsOn,
    startsAt: time.startsAt,
    endsAt: time.endsAt,
  };
}

/**
 * What a calendar's entity says at an instant: the time on now (the earliest of them), and the
 * next to start.
 *
 * @param times - Every calendar's times, in order.
 * @param calendarId - The calendar.
 * @param now - The instant.
 * @param isStale - Whether its source failed its last read.
 * @returns The entity's state.
 */
export function calendarStateOf(
  times: readonly CalendarTime[],
  calendarId: string,
  now: number,
  isStale: boolean,
): CalendarEntityState {
  const mine = times.filter((time) => time.calendarId === calendarId);
  const current = mine.find((time) => time.start <= now && now < time.end);
  const next = mine.find((time) => time.start > now);

  return {
    isActive: current !== undefined,
    current: current === undefined ? null : summaryOf(current),
    next: next === undefined ? null : summaryOf(next),
    isStale,
  };
}

/**
 * Whether a day is a working day: not a weekend day, not a holiday shown, not a day an all-day
 * event of a day-off calendar covers.
 *
 * @param day - The day.
 * @param times - Every calendar's times over a range holding the day.
 * @param calendars - The calendars, for which are days off.
 * @param weekendDays - The days of the week that are weekend, 0 for Monday.
 * @returns True on a working day.
 */
export function isWorkingOn(
  day: DayKey,
  times: readonly CalendarTime[],
  calendars: readonly CalendarInfo[],
  weekendDays: readonly number[],
): boolean {
  const off = new Set(calendars.filter((each) => each.isDayOff).map((each) => each.id));
  // A timed event of a day-off calendar (a closure from two to six) leaves the day a working one.
  const covering = times.filter(
    (time) =>
      time.isAllDay &&
      (time.startsOn ?? '') <= day &&
      day <= (time.endsOn ?? '') &&
      (time.kind === 'holiday' || off.has(time.calendarId)),
  );
  const holidays = new Set(covering.some((time) => time.kind === 'holiday') ? [day] : []);
  const daysOff = new Set(covering.some((time) => time.kind !== 'holiday') ? [day] : []);

  return isWorkingDay(day, weekendDays, holidays, daysOff);
}

/**
 * The next instant after now when something the entities say may change: a time starting or
 * ending, or midnight in the house's zone.
 *
 * @param times - Every calendar's times.
 * @param now - Now.
 * @param zone - The house's zone.
 * @returns Milliseconds since the epoch.
 */
export function nextChange(times: readonly CalendarTime[], now: number, zone: string): number {
  let next = instantOf(addDays(wallOf(now, zone).day, 1), 0, zone);

  for (const time of times) {
    for (const edge of [time.start, time.end]) {
      if (edge > now && edge < next) {
        next = edge;
      }
    }
  }

  return next;
}

/**
 * When a calendar trigger next fires after an instant, and for which times: every time of the
 * calendar (of the models asked for) whose edge, moved by the offset, falls at that moment.
 *
 * @param times - Every calendar's times, in order.
 * @param query - The calendar, the edge, the offset and the models.
 * @param after - The instant to look past; the answer is strictly later.
 * @returns The moment and its times, or null when none is coming.
 */
export function nextEdge(
  times: readonly CalendarTime[],
  query: CalendarEdgeQuery,
  after: number,
): { readonly at: number; readonly times: readonly CalendarTime[] } | null {
  const models = new Set(query.modelIds);
  const offsetMs = query.offsetMinutes * 60_000;
  const coming = times
    .filter(
      (time) =>
        time.calendarId === query.calendarId &&
        (models.size === 0 || (time.modelId !== null && models.has(time.modelId))),
    )
    .map((time) => ({ time, at: (query.edge === 'start' ? time.start : time.end) + offsetMs }))
    .filter((each) => each.at > after);
  const at = Math.min(...coming.map((each) => each.at));

  return coming.length === 0
    ? null
    : { at, times: coming.filter((each) => each.at === at).map((each) => each.time) };
}
