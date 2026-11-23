/**
 * Reading an `.ics` calendar into the occurrences a calendar keeps of it (docs/calendar.md 7.2).
 *
 * `ical.js` (D1) parses the file and expands its repeats - RRULE, RDATE, EXDATE, and an occurrence
 * moved or changed by a RECURRENCE-ID of the same UID. Each occurrence from a year back to two
 * years on becomes one row, named by its UID and the time of the series it is: the next read of
 * the same file keeps its row, and one gone from the file loses it. An all-day occurrence stays
 * days (the last one included) and never becomes an instant; a timed one becomes UTC instants,
 * read in its TZID, in the file's VTIMEZONE when the zone has no IANA name, and in the house's
 * zone when it has neither (a "floating" time).
 *
 * Each occurrence takes the calendar's model whose name the event carries (D12): a CATEGORIES
 * value equal to the name first, else the name in the title as whole words, ignoring case and
 * accents; the longest name wins, so "Plastic and metal" beats "Plastic".
 */
import { createHash } from 'node:crypto';

import ICAL from 'ical.js';

import {
  addDays,
  CALENDAR_NOTES_MAXIMUM_LENGTH,
  CALENDAR_TITLE_MAXIMUM_LENGTH,
  instantOf,
  wallOf,
  type DayKey,
} from '@nebulahome/contracts';

/** A model of the calendar, as the matching needs it. */
export type IcsModel = { readonly id: string; readonly name: string };

/** One occurrence read from a file, as a row of the calendar keeps it. */
export type IcsInstance = {
  /** The UID, and the time of the series for a repeating one: stable across reads. */
  readonly sourceUid: string;
  readonly title: string;
  readonly notes: string | null;
  readonly modelId: string | null;
  readonly isAllDay: boolean;

  /** All day: the first and the last day, both included. */
  readonly startsOn: DayKey | null;
  readonly endsOn: DayKey | null;

  /** Timed: ISO 8601, UTC. */
  readonly startsAt: string | null;
  readonly endsAt: string | null;
};

/** What a file came to: its occurrences, or why it is not a calendar. */
export type IcsParsed =
  | {
      readonly kind: 'ok';

      /** The name the calendar gives itself (`X-WR-CALNAME`). */
      readonly calendarName: string | null;
      readonly instances: readonly IcsInstance[];

      /** Every event ended before today: last year's file. */
      readonly allPast: boolean;
    }
  | {
      readonly kind: 'error';
      readonly code: 'not_calendar' | 'no_events';
      readonly detail: string;
    };

/** What reading a file needs besides its text. */
export type IcsParseOptions = {
  /** Now: the window is a year back and two on from today. */
  readonly now: Date;

  /** The house's zone: what today is, and what a floating time is read in. */
  readonly zone: string;
  readonly models: readonly IcsModel[];
};

/** What the occurrences of a read come to, for the test card and the source's state. */
export type IcsSummary = {
  readonly eventCount: number;
  readonly rangeFrom: DayKey | null;
  readonly rangeTo: DayKey | null;
  readonly matchedModels: number;

  /** The first occurrence to start from now on. */
  readonly next: {
    readonly title: string;
    readonly startsAt: string | null;
    readonly startsOn: DayKey | null;
  } | null;
};

/** How many times of one series are walked at most: a guard against a rule that runs away. */
const MAX_STEPS_PER_EVENT = 50_000;

/** How many occurrences one file brings in at most. */
// shortcut: a file past this is cut at it (an hourly rule over three years), raise it if one is met.
const MAX_INSTANCES = 20_000;

/** The zones `Intl` knows, by name, as they are asked about. */
const KNOWN_ZONES = new Map<string, boolean>();

/**
 * Whether `Intl` knows a zone by that name.
 *
 * @param zone - The TZID.
 * @returns True for an IANA name.
 */
function isKnownZone(zone: string): boolean {
  let known = KNOWN_ZONES.get(zone);

  if (known === undefined) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: zone });
      known = true;
    } catch {
      known = false;
    }

    KNOWN_ZONES.set(zone, known);
  }

  return known;
}

/**
 * The same day some months on, or the last day of that month when it is shorter.
 *
 * @param day - The day.
 * @param months - How many months; negative goes back.
 * @returns The day.
 */
function shiftMonths(day: DayKey, months: number): DayKey {
  const [year = 1970, month = 1, date = 1] = day.split('-').map(Number);
  const last = new Date(Date.UTC(year, month - 1 + months + 1, 0)).getUTCDate();

  return new Date(Date.UTC(year, month - 1 + months, Math.min(date, last)))
    .toISOString()
    .slice(0, 10);
}

/**
 * A time's day.
 *
 * @param time - The time, as `ical.js` reads it.
 * @returns `YYYY-MM-DD`.
 */
function dayKeyOf(time: ICAL.Time): DayKey {
  return `${String(time.year).padStart(4, '0')}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`;
}

/**
 * The instant a timed value stands for.
 *
 * @param time - The value.
 * @param tzid - The TZID its property names, if any.
 * @param houseZone - Where a floating time is read.
 * @returns Milliseconds since the epoch.
 */
function instantOfTime(time: ICAL.Time, tzid: string | null, houseZone: string): number {
  const zone = time.zone.tzid;

  if (zone === 'UTC') {
    return time.toUnixTime() * 1000;
  }

  const named = tzid !== null && isKnownZone(tzid) ? tzid : null;

  // A zone the file defines but `Intl` does not name (Outlook's "W. Europe Standard Time").
  if (named === null && zone !== 'floating') {
    return time.toUnixTime() * 1000;
  }

  return instantOf(
    dayKeyOf(time),
    time.hour * 3600 + time.minute * 60 + time.second,
    named ?? houseZone,
  );
}

/**
 * Text folded for matching: no accents, lower case, words only.
 *
 * @param text - The text.
 * @returns Its words.
 */
function wordsOf(text: string): string[] {
  return text
    .normalize('NFD')
    .replaceAll(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '');
}

/**
 * The model an event takes by name (D12): a category equal to a model's name, else a model's
 * name in the title as whole words; the longest name wins either way.
 *
 * @param title - The event's title.
 * @param categories - Its CATEGORIES values.
 * @param models - The calendar's models.
 * @returns The model's id, or null when none is named.
 */
export function matchModel(
  title: string,
  categories: readonly string[],
  models: readonly IcsModel[],
): string | null {
  const named = models
    .map((model) => ({ id: model.id, words: wordsOf(model.name) }))
    .filter((model) => model.words.length > 0)
    .toSorted((left, right) => right.words.join(' ').length - left.words.join(' ').length);
  const wanted = new Set(categories.map((category) => wordsOf(category).join(' ')));
  const byCategory = named.find((model) => wanted.has(model.words.join(' ')));

  if (byCategory !== undefined) {
    return byCategory.id;
  }

  const titleWords = wordsOf(title);
  const inTitle = named.find((model) =>
    [...titleWords.keys()].some((start) =>
      model.words.every((word, offset) => titleWords[start + offset] === word),
    ),
  );

  return inTitle?.id ?? null;
}

/**
 * A text property's value, trimmed.
 *
 * @param component - The event.
 * @param name - The property.
 * @returns It, or an empty string.
 */
function textOf(component: ICAL.Component, name: string): string {
  const value = component.getFirstPropertyValue(name);

  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Whether an event was called off.
 *
 * @param component - The event.
 * @returns True for `STATUS:CANCELLED`.
 */
function isCancelled(component: ICAL.Component): boolean {
  return textOf(component, 'status').toUpperCase() === 'CANCELLED';
}

/**
 * The TZID of an event's start, when it names one.
 *
 * @param component - The event.
 * @returns The TZID, or null.
 */
function tzidOf(component: ICAL.Component): string | null {
  const tzid = component.getFirstProperty('dtstart')?.getParameter('tzid');

  return typeof tzid === 'string' && tzid !== '' ? tzid : null;
}

/**
 * An event's UID, or one made from what it is when the file gives none.
 *
 * @param component - The event.
 * @returns The UID.
 */
function uidOf(component: ICAL.Component): string {
  const uid = textOf(component, 'uid');

  return uid === ''
    ? `nouid-${createHash('sha1')
        .update(
          `${textOf(component, 'summary')}|${String(component.getFirstPropertyValue('dtstart'))}`,
        )
        .digest('hex')}`
    : uid;
}

/**
 * Reads the events of a calendar file, a year back and two years on.
 *
 * @param text - The file, as text.
 * @param options - Now, the house's zone and the calendar's models.
 * @returns The occurrences, or why it is not a calendar.
 */
export function parseIcs(text: string, options: IcsParseOptions): IcsParsed {
  let root: ICAL.Component;

  try {
    const parsed: unknown = ICAL.parse(text);
    // Several components side by side come back as a list of them.
    const first: unknown = Array.isArray(parsed) && Array.isArray(parsed[0]) ? parsed[0] : parsed;

    root = new ICAL.Component(first as unknown[]);
  } catch (error: unknown) {
    return {
      kind: 'error',
      code: 'not_calendar',
      detail: (error instanceof Error ? error.message : 'It cannot be read').slice(0, 300),
    };
  }

  if (root.name !== 'vcalendar') {
    return { kind: 'error', code: 'not_calendar', detail: `A ${root.name} file, not a calendar` };
  }

  const components = root
    .getAllSubcomponents('vevent')
    .filter((each) => each.hasProperty('dtstart'));

  if (components.length === 0) {
    return { kind: 'error', code: 'no_events', detail: 'The calendar holds no event' };
  }

  const today = wallOf(options.now.getTime(), options.zone).day;
  const from = shiftMonths(today, -12);
  const to = shiftMonths(today, 24);
  const exceptions = new Map<string, ICAL.Component[]>();
  const masters: ICAL.Component[] = [];

  for (const component of components) {
    if (component.hasProperty('recurrence-id')) {
      exceptions.set(uidOf(component), [...(exceptions.get(uidOf(component)) ?? []), component]);
    } else {
      masters.push(component);
    }
  }

  const masterUids = new Set(masters.map(uidOf));

  // A changed occurrence whose series is not in the file stands on its own.
  for (const [uid, list] of exceptions) {
    if (!masterUids.has(uid)) {
      masters.push(...list);
      exceptions.delete(uid);
    }
  }

  const instances: IcsInstance[] = [];
  const seen = new Set<string>();
  let hasLater = false;

  for (const master of masters) {
    if (isCancelled(master) || instances.length >= MAX_INSTANCES) {
      continue;
    }

    try {
      const uid = uidOf(master);
      const event = new ICAL.Event(master, {
        strictExceptions: true,
        exceptions: master.hasProperty('recurrence-id') ? [] : (exceptions.get(uid) ?? []),
      });
      const isSeries = event.isRecurring() || master.hasProperty('recurrence-id');
      const iterator = event.iterator();

      for (let step = 0; step < MAX_STEPS_PER_EVENT; step += 1) {
        const next = iterator.next() as ICAL.Time | null | undefined;

        if (next === null || next === undefined) {
          break;
        }

        if (dayKeyOf(next) > to) {
          hasLater = true;
          break;
        }

        // The library's typings name this shape through an import its linting cannot follow.
        const details = event.getOccurrenceDetails(next) as {
          readonly item: ICAL.Event;
          readonly startDate: ICAL.Time;
          readonly endDate: ICAL.Time;
          readonly recurrenceId: ICAL.Time;
        };
        const item = details.item.component;

        // A day of slack: the end's day is read in its own zone here, in the house's below.
        if (isCancelled(item) || dayKeyOf(details.endDate) < addDays(from, -1)) {
          continue;
        }

        const instance = instanceOf(
          item,
          details.startDate,
          details.endDate,
          options,
          isSeries ? `${uid}#${details.recurrenceId.toICALString()}` : uid,
        );
        const lastDay =
          instance.endsOn ?? wallOf(Date.parse(instance.endsAt ?? ''), options.zone).day;

        if (lastDay < from || seen.has(instance.sourceUid) || instances.length >= MAX_INSTANCES) {
          continue;
        }

        seen.add(instance.sourceUid);
        instances.push(instance);
      }
    } catch {
      // One event whose rule `ical.js` cannot follow costs that event, not the file.
      continue;
    }
  }

  return {
    kind: 'ok',
    calendarName: textOf(root, 'x-wr-calname') || null,
    instances,
    allPast:
      !hasLater &&
      instances.every(
        (instance) =>
          (instance.endsOn ?? wallOf(Date.parse(instance.endsAt ?? ''), options.zone).day) < today,
      ),
  };
}

/**
 * One occurrence as a row: its days or its instants, its title, notes and model.
 *
 * @param item - The event the occurrence is of (the series, or the one that changes it).
 * @param start - When it starts.
 * @param end - When it ends.
 * @param options - The house's zone and the calendar's models.
 * @param sourceUid - Its name across reads.
 * @returns The row.
 */
function instanceOf(
  item: ICAL.Component,
  start: ICAL.Time,
  end: ICAL.Time,
  options: IcsParseOptions,
  sourceUid: string,
): IcsInstance {
  const categories = item
    .getAllProperties('categories')
    .flatMap((property) => property.getValues() as unknown[])
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '');
  const summary = textOf(item, 'summary');
  const title = (summary === '' ? (categories[0]?.trim() ?? 'Event') : summary).slice(
    0,
    CALENDAR_TITLE_MAXIMUM_LENGTH,
  );
  const description = textOf(item, 'description').slice(0, CALENDAR_NOTES_MAXIMUM_LENGTH);
  const shared = {
    sourceUid,
    title,
    notes: description === '' ? null : description,
    modelId: matchModel(title, categories, options.models),
  };

  if (start.isDate) {
    const startsOn = dayKeyOf(start);
    // DTEND is the day after the last one; a value with a time on it is read as its day.
    const endsOn = end.isDate ? addDays(dayKeyOf(end), -1) : dayKeyOf(end);

    return {
      ...shared,
      isAllDay: true,
      startsOn,
      endsOn: endsOn < startsOn ? startsOn : endsOn,
      startsAt: null,
      endsAt: null,
    };
  }

  const tzid = tzidOf(item);
  const startMs = instantOfTime(start, tzid, options.zone);
  const endMs = Math.max(startMs, instantOfTime(end, tzid, options.zone));

  return {
    ...shared,
    isAllDay: false,
    startsOn: null,
    endsOn: null,
    startsAt: new Date(startMs).toISOString(),
    endsAt: new Date(endMs).toISOString(),
  };
}

/**
 * What a read's occurrences come to: how many, the days they span, how many took a model, and
 * the next one to start.
 *
 * @param instances - The occurrences.
 * @param now - Now.
 * @param zone - The house's zone, where an all-day occurrence starts at midnight.
 * @returns The summary.
 */
export function summarizeIcs(
  instances: readonly IcsInstance[],
  now: Date,
  zone: string,
): IcsSummary {
  const firsts: DayKey[] = [];
  const lasts: DayKey[] = [];
  let next: { instance: IcsInstance; start: number } | undefined;

  for (const instance of instances) {
    const start =
      instance.startsOn === null
        ? Date.parse(instance.startsAt ?? '')
        : instantOf(instance.startsOn, 0, zone);

    firsts.push(instance.startsOn ?? wallOf(start, zone).day);
    lasts.push(instance.endsOn ?? wallOf(Date.parse(instance.endsAt ?? ''), zone).day);

    if (start >= now.getTime() && (next === undefined || start < next.start)) {
      next = { instance, start };
    }
  }

  return {
    eventCount: instances.length,
    rangeFrom: firsts.toSorted()[0] ?? null,
    rangeTo: lasts.toSorted().at(-1) ?? null,
    matchedModels: instances.filter((instance) => instance.modelId !== null).length,
    next:
      next === undefined
        ? null
        : {
            title: next.instance.title,
            startsAt: next.instance.startsAt,
            startsOn: next.instance.startsOn,
          },
  };
}
