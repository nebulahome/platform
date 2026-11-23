/**
 * The calendar's shapes: what the API answers and takes, what `core` keeps as a calendar's ICS
 * state, and what the web UI draws (docs/calendar.md 5 and 6.1).
 *
 * A calendar is a filter of the page and a source of events: House, Holidays, Waste, one per
 * person, and any the owner makes. Everyone sees every calendar; who edits one is its Editors
 * list. Events are kept two ways - all day as days, timed as instants - and a repeating one keeps
 * its rule (`repeat.ts`), expanded into occurrences only when a range is read.
 */
import { z } from 'zod';

import { calendarDaySchema, momentSchema } from '../capabilities.js';
import { entityIdSchema } from '../entity-id.js';
import { iconIdSchema } from '../icons.js';
import { tagColorSchema } from '../tags.js';
import { timestampSchema } from '../timestamp.js';

import { calendarRepeatSchema } from './repeat.js';
import { daysBetween } from './zoned-time.js';

/** The kinds of calendar: the three every house has, one per person, and the owner's own. */
export const CALENDAR_KINDS = ['house', 'holidays', 'waste', 'personal', 'custom'] as const;

/** A kind of calendar. */
export type CalendarKind = (typeof CALENDAR_KINDS)[number];

/** How long a calendar's or a model's name may be. */
export const CALENDAR_NAME_MAXIMUM_LENGTH = 40;

/** The widest range of days one read of occurrences may span. */
export const CALENDAR_RANGE_MAXIMUM_DAYS = 400;

/** The largest `.ics` file kept, and the largest one fetched. */
export const CALENDAR_ICS_MAXIMUM_BYTES = 5 * 1024 * 1024;

/** A name, trimmed. */
const nameSchema = z.string().trim().min(1).max(CALENDAR_NAME_MAXIMUM_LENGTH);

/** Where a calendar's events may be read from: http(s), or `webcal`, which is https. */
const icsUrlSchema = z.url({ protocol: /^(https?|webcal)$/ }).max(2048);

/**
 * Refuses a body that changes nothing.
 *
 * @param body - The parsed body.
 * @returns True when it carries at least one field.
 */
function isNotEmpty(body: object): boolean {
  return Object.keys(body).length > 0;
}

/** A list of ids sent comma-separated in a query: `a,b,c`. */
const idListSchema = z
  .string()
  .max(4_000)
  .transform((value) => value.split(',').filter((id) => id !== ''))
  .pipe(z.array(z.uuid()).max(100));

// --- models ------------------------------------------------------------------------------

/** A kind of event a calendar offers - Organic, Glass - drawn with its icon and colour. */
export const calendarModelSchema = z.object({
  id: z.uuid(),
  calendarId: z.uuid(),
  name: z.string(),
  icon: iconIdSchema,
  color: tagColorSchema,

  /** Its place in the calendar's list, from 0. */
  position: z.int().min(0),
});

/** A kind of event a calendar offers. */
export type CalendarModel = z.output<typeof calendarModelSchema>;

/** What making a model takes. It goes last in its calendar's list. */
export const calendarModelCreateSchema = z.object({
  name: nameSchema,
  icon: iconIdSchema,
  color: tagColorSchema,
});

/** What making a model takes. */
export type CalendarModelCreate = z.output<typeof calendarModelCreateSchema>;

/** What changing a model takes: any of its fields, its place in the list among them. */
export const calendarModelUpdateSchema = z
  .object({
    name: nameSchema,
    icon: iconIdSchema,
    color: tagColorSchema,
    position: z.int().min(0),
  })
  .partial()
  .refine(isNotEmpty, { message: 'Nothing to change' });

/** What changing a model takes. */
export type CalendarModelUpdate = z.output<typeof calendarModelUpdateSchema>;

// --- ICS sources -------------------------------------------------------------------------

/**
 * Why a source could not be read: not reached, gone (404), a web page rather than a calendar,
 * behind a sign-in (401, 403), a calendar with no event in it, or over the size kept.
 */
export const CALENDAR_ICS_ERROR_CODES = [
  'unreachable',
  'not_found',
  'not_calendar',
  'needs_sign_in',
  'no_events',
  'too_big',
] as const;

/** Why a source could not be read. */
export type CalendarIcsErrorCode = (typeof CALENDAR_ICS_ERROR_CODES)[number];

/** Why a source could not be read, with what was seen (a status, a content type). */
export const calendarIcsErrorSchema = z.object({
  code: z.enum(CALENDAR_ICS_ERROR_CODES),
  detail: z.string().max(300),
});

/** Why a source could not be read. */
export type CalendarIcsError = z.output<typeof calendarIcsErrorSchema>;

/**
 * How a calendar's source went, kept by `core` in `registry.calendars.ics_state`. Every field has
 * a default, so the `{}` a calendar starts with reads as "never tried". On a failure the events
 * of the last success stay, and `error` says why they are old.
 */
export const calendarIcsStateSchema = z.object({
  lastAttemptAt: timestampSchema.nullable().default(null),
  lastSuccessAt: timestampSchema.nullable().default(null),

  /** What the server said of the last download, sent back to save the next. */
  etag: z.string().max(500).nullable().default(null),
  lastModified: z.string().max(100).nullable().default(null),
  error: calendarIcsErrorSchema.nullable().default(null),

  /** The occurrences the last success brought in, and the days they span. */
  eventCount: z.int().min(0).default(0),
  rangeFrom: calendarDaySchema.nullable().default(null),
  rangeTo: calendarDaySchema.nullable().default(null),

  /** How many of them took one of the calendar's models by name (D12). */
  matchedModels: z.int().min(0).default(0),
});

/** How a calendar's source went. */
export type CalendarIcsState = z.output<typeof calendarIcsStateSchema>;

/** A `.ics` file loaded from the computer as a calendar's source (D11). */
export const calendarIcsFileSchema = z.object({
  name: z.string(),

  /** Bytes. */
  size: z.int().min(0),
  uploadedAt: timestampSchema,
  uploadedBy: z.uuid().nullable(),
});

/** A `.ics` file loaded as a calendar's source. */
export type CalendarIcsFile = z.output<typeof calendarIcsFileSchema>;

/**
 * Asks whether an address is a calendar, before it becomes a source. With `calendarId`, its
 * events are matched against that calendar's models.
 */
export const calendarIcsTestSchema = z.object({
  url: icsUrlSchema,
  calendarId: z.uuid().optional(),
});

/** Asks whether an address is a calendar. */
export type CalendarIcsTest = z.output<typeof calendarIcsTestSchema>;

/**
 * A `.ics` file as the browser read it (`file.text()`). Bounded in characters: the route's body
 * limit is what bounds the bytes.
 */
export const calendarIcsFileUploadSchema = z.object({
  name: z.string().trim().min(1).max(255),
  text: z.string().min(1).max(CALENDAR_ICS_MAXIMUM_BYTES),

  /** The calendar it is meant for, whose models its events are matched against. */
  calendarId: z.uuid().optional(),
});

/** A `.ics` file as the browser read it. */
export type CalendarIcsFileUpload = z.output<typeof calendarIcsFileUploadSchema>;

/**
 * What a test of a source found: how many events, the days they span, the next one, how many
 * took a model by name, the name the calendar gives itself (`X-WR-CALNAME`); or why it failed.
 * `allPast` is a warning, not a failure: last year's waste calendar still loads.
 */
export const calendarIcsTestResultSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('ok'),

    /** The stored file, for a file: what `icsFileId` then names. */
    fileId: z.uuid().optional(),
    eventCount: z.int().min(0),
    rangeFrom: calendarDaySchema.nullable(),
    rangeTo: calendarDaySchema.nullable(),
    next: z
      .object({
        title: z.string(),
        startsAt: momentSchema.nullable(),
        startsOn: calendarDaySchema.nullable(),
      })
      .nullable(),
    matchedModels: z.int().min(0),
    calendarName: z.string().nullable(),
    allPast: z.boolean(),
  }),
  z.object({
    kind: z.literal('error'),
    code: z.enum(CALENDAR_ICS_ERROR_CODES),
    detail: z.string().max(300),
  }),
]);

/** What a test of a source found. */
export type CalendarIcsTestResult = z.output<typeof calendarIcsTestResultSchema>;

// --- calendars ---------------------------------------------------------------------------

/** A calendar, as the API tells it to someone: with what they may do to it. */
export const calendarViewSchema = z.object({
  id: z.uuid(),
  kind: z.enum(CALENDAR_KINDS),
  name: z.string(),
  color: tagColorSchema,
  icon: iconIdSchema.nullable(),

  /** The person a personal calendar belongs to. */
  ownerUserId: z.uuid().nullable(),

  /** Whether its events are days off: always for Holidays, the owner's choice for the rest. */
  isDayOff: z.boolean(),
  position: z.int().min(0),

  /** Its source, when it reads one: an address or a loaded file, never both. */
  icsUrl: z.string().nullable(),
  icsFile: calendarIcsFileSchema.nullable(),
  icsState: calendarIcsStateSchema.nullable(),
  models: z.array(calendarModelSchema),

  /** Who may edit its events besides the owner and admins. Empty for Holidays. */
  editorIds: z.array(z.uuid()),

  /** Whether the caller may add, change and delete its events. */
  canEdit: z.boolean(),

  /** Whether the caller may change its name, colour, source and editors. */
  canManage: z.boolean(),

  /** Its entity, `calendar.<slug>`, once `core` has made it. */
  entityId: entityIdSchema.nullable(),

  /** Its own events and the ones its source brought in, repeating ones counted once. */
  eventCount: z.int().min(0),
});

/** A calendar, as the API tells it. */
export type CalendarView = z.output<typeof calendarViewSchema>;

/** Where a new calendar's events come from: none yet, an address, or a file already tested. */
export const calendarSourceSchema = z.union([
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('url'), icsUrl: icsUrlSchema }),
  z.object({ kind: z.literal('file'), icsFileId: z.uuid() }),
]);

/** Where a new calendar's events come from. */
export type CalendarSource = z.output<typeof calendarSourceSchema>;

/** What making a calendar takes. It is a `custom` one; the maker becomes an editor. */
export const calendarCreateSchema = z.object({
  name: nameSchema,
  color: tagColorSchema,
  icon: iconIdSchema.optional(),
  isDayOff: z.boolean().default(false),
  source: calendarSourceSchema.default({ kind: 'none' }),
});

/** What making a calendar takes. */
export type CalendarCreate = z.output<typeof calendarCreateSchema>;

/**
 * What changing a calendar takes. `icsUrl` or `icsFileId` set a source in place of the one there;
 * null removes it and the events it brought in. Both at once is refused: one source a calendar.
 */
export const calendarUpdateSchema = z
  .object({
    name: nameSchema,
    color: tagColorSchema,
    icon: iconIdSchema.nullable(),
    isDayOff: z.boolean(),
    position: z.int().min(0),
    icsUrl: icsUrlSchema.nullable(),
    icsFileId: z.uuid().nullable(),
  })
  .partial()
  .refine(isNotEmpty, { message: 'Nothing to change' })
  .refine((body) => typeof body.icsUrl !== 'string' || typeof body.icsFileId !== 'string', {
    message: 'One source a calendar: an address or a file',
    path: ['icsFileId'],
  });

/** What changing a calendar takes. */
export type CalendarUpdate = z.output<typeof calendarUpdateSchema>;

/** A calendar's Editors, whole: each tick in the list sends the set again. */
export const calendarEditorsSchema = z.object({ userIds: z.array(z.uuid()).max(200) });

/** A calendar's Editors. */
export type CalendarEditors = z.output<typeof calendarEditorsSchema>;

/** What deleting a calendar takes with it, for the dialog that asks. */
export const calendarUsageSchema = z.object({
  /** Automations whose calendar trigger names it. */
  automations: z.array(z.object({ id: z.uuid(), name: z.string() })),

  /** Share links that include it. */
  feeds: z.array(z.object({ id: z.uuid(), name: z.string() })),

  /** Its own events, and the ones its source brought in. */
  eventCount: z.int().min(0),
  icsEventCount: z.int().min(0),
});

/** What deleting a calendar takes with it. */
export type CalendarUsage = z.output<typeof calendarUsageSchema>;

// --- events ------------------------------------------------------------------------------

/** Where an event came from: made in the house, or brought in by a source. */
export const CALENDAR_EVENT_SOURCES = ['user', 'ics'] as const;

/** Where an event came from. */
export type CalendarEventSource = (typeof CALENDAR_EVENT_SOURCES)[number];

/** The longest an event's title may be. */
export const CALENDAR_TITLE_MAXIMUM_LENGTH = 120;

/** The longest an event's notes may be. */
export const CALENDAR_NOTES_MAXIMUM_LENGTH = 2000;

/** An event as `registry.calendar_events` keeps it. */
export const calendarEventSchema = z.object({
  id: z.uuid(),
  calendarId: z.uuid(),
  modelId: z.uuid().nullable(),
  title: z.string().min(1).max(CALENDAR_TITLE_MAXIMUM_LENGTH),
  icon: iconIdSchema.nullable(),
  notes: z.string().max(CALENDAR_NOTES_MAXIMUM_LENGTH).nullable(),
  isAllDay: z.boolean(),

  /** All day: the first and the last day, both included. */
  startsOn: calendarDaySchema.nullable(),
  endsOn: calendarDaySchema.nullable(),

  /** Timed: when it starts and ends. */
  startsAt: momentSchema.nullable(),
  endsAt: momentSchema.nullable(),

  /** The house's zone when it was saved: the wall clock its repeats keep. */
  timeZone: z.string().min(1).max(64),
  repeat: calendarRepeatSchema.nullable(),

  /** Times of the series deleted one by one. */
  skippedOn: z.array(calendarDaySchema),

  /** On an event that replaces one time of a series: the series, and the day it replaces. */
  seriesId: z.uuid().nullable(),
  occurrenceOn: calendarDaySchema.nullable(),
  source: z.enum(CALENDAR_EVENT_SOURCES),
  createdBy: z.uuid().nullable(),
});

/** An event as it is kept. */
export type CalendarEvent = z.output<typeof calendarEventSchema>;

/** When an event happens, as a write gives it. */
export type CalendarEventTimes = {
  readonly isAllDay: boolean;
  readonly startsOn?: string | null | undefined;
  readonly endsOn?: string | null | undefined;
  readonly startsAt?: string | null | undefined;
  readonly endsAt?: string | null | undefined;
};

/**
 * What is wrong with an event's times, if anything: an all-day event has days and no instants, a
 * timed one instants and no days, and neither ends before it starts. Exported so the API checks
 * an event again once a change is merged into the row.
 *
 * @param event - The times.
 * @returns Why they do not hold, or null when they do.
 */
export function calendarEventTimeProblem(event: CalendarEventTimes): string | null {
  const { startsOn, endsOn, startsAt, endsAt } = event;

  if (event.isAllDay) {
    if (typeof startsOn !== 'string' || typeof endsOn !== 'string') {
      return 'An all-day event needs its first and last day';
    }

    if (typeof startsAt === 'string' || typeof endsAt === 'string') {
      return 'An all-day event has days, not times';
    }

    return endsOn < startsOn ? 'It cannot end before it starts' : null;
  }

  if (typeof startsAt !== 'string' || typeof endsAt !== 'string') {
    return 'A timed event needs its start and end';
  }

  if (typeof startsOn === 'string' || typeof endsOn === 'string') {
    return 'A timed event has times, not days';
  }

  return Date.parse(endsAt) < Date.parse(startsAt) ? 'It cannot end before it starts' : null;
}

/** The fields an event is written with. */
const eventWriteShape = {
  calendarId: z.uuid(),
  modelId: z.uuid().nullable().optional(),
  title: z.string().trim().min(1).max(CALENDAR_TITLE_MAXIMUM_LENGTH),
  icon: iconIdSchema.nullable().optional(),
  notes: z.string().max(CALENDAR_NOTES_MAXIMUM_LENGTH).nullable().optional(),
  isAllDay: z.boolean(),
  startsOn: calendarDaySchema.nullable().optional(),
  endsOn: calendarDaySchema.nullable().optional(),
  startsAt: momentSchema.nullable().optional(),
  endsAt: momentSchema.nullable().optional(),
  repeat: calendarRepeatSchema.nullable().optional(),
};

/** What making an event takes: days for an all-day one, instants for a timed one. */
export const calendarEventWriteSchema = z.object(eventWriteShape).superRefine((event, context) => {
  const problem = calendarEventTimeProblem(event);

  if (problem !== null) {
    context.addIssue({ code: 'custom', path: ['startsOn'], message: problem });
  }
});

/** What making an event takes. */
export type CalendarEventWrite = z.output<typeof calendarEventWriteSchema>;

/**
 * What changing an event takes: any of its fields. Its times are checked once merged into the row
 * ({@link calendarEventTimeProblem}): a change may move only the end.
 */
export const calendarEventPatchSchema = z
  .object({
    ...eventWriteShape,

    /** The times deleted one by one: the Undo of an "only this one" delete puts them back. */
    skippedOn: z.array(calendarDaySchema).max(1_000),
  })
  .partial()
  .refine(isNotEmpty, { message: 'Nothing to change' });

/** What changing an event takes. */
export type CalendarEventPatch = z.output<typeof calendarEventPatchSchema>;

/**
 * Which times of a repeating event a change or a delete is for: `all`, or `one` - the time of
 * `occurrenceOn` alone. An event that does not repeat is always `all`.
 */
export const calendarEventScopeQuerySchema = z
  .object({
    scope: z.enum(['one', 'all']).default('all'),
    occurrenceOn: calendarDaySchema.optional(),
  })
  .refine((query) => query.scope === 'all' || query.occurrenceOn !== undefined, {
    message: 'Which time: occurrenceOn',
    path: ['occurrenceOn'],
  });

/** Which times of a repeating event a change is for. */
export type CalendarEventScopeQuery = z.output<typeof calendarEventScopeQuerySchema>;

// --- occurrences -------------------------------------------------------------------------

/** What an occurrence is a time of: an event, a holiday, or a time/date entity's value. */
export const CALENDAR_OCCURRENCE_KINDS = ['event', 'holiday', 'entity'] as const;

/** Where an occurrence comes from. */
export const CALENDAR_OCCURRENCE_SOURCES = ['user', 'ics', 'holiday', 'entity'] as const;

/** One time something happens, as the page, the feed and the entities read it. */
export const calendarOccurrenceSchema = z.object({
  /** Stable across reads: the event and the day of the series, the holiday's key and date… */
  key: z.string().min(1).max(200),
  kind: z.enum(CALENDAR_OCCURRENCE_KINDS),
  eventId: z.uuid().nullable(),
  seriesId: z.uuid().nullable(),
  calendarId: z.uuid(),
  modelId: z.uuid().nullable(),
  title: z.string(),
  icon: iconIdSchema.nullable(),
  notes: z.string().nullable(),
  isAllDay: z.boolean(),
  startsOn: calendarDaySchema.nullable(),
  endsOn: calendarDaySchema.nullable(),
  startsAt: momentSchema.nullable(),
  endsAt: momentSchema.nullable(),

  /** The day of the series it is, for a repeating event. */
  occurrenceOn: calendarDaySchema.nullable(),
  isRepeating: z.boolean(),
  source: z.enum(CALENDAR_OCCURRENCE_SOURCES),

  /** The entity, for an entity's value. */
  entityId: entityIdSchema.nullable(),
  canEdit: z.boolean(),

  /** From a source that failed its last read: shown greyed. */
  isStale: z.boolean(),
  createdBy: z.uuid().nullable(),
});

/** One time something happens. */
export type CalendarOccurrence = z.output<typeof calendarOccurrenceSchema>;

/** The days to read occurrences of, both included, and the calendars (every one when absent). */
export const calendarOccurrencesQuerySchema = z
  .object({
    from: calendarDaySchema,
    to: calendarDaySchema,
    calendars: idListSchema.optional(),
  })
  .refine(
    (query) => {
      const span = daysBetween(query.from, query.to);

      return span >= 0 && span <= CALENDAR_RANGE_MAXIMUM_DAYS;
    },
    {
      message: `From before to, at most ${String(CALENDAR_RANGE_MAXIMUM_DAYS)} days`,
      path: ['to'],
    },
  );

/** The days to read occurrences of. */
export type CalendarOccurrencesQuery = z.output<typeof calendarOccurrencesQuerySchema>;

/** What a search looks for, in every calendar. */
export const calendarSearchQuerySchema = z.object({ q: z.string().trim().min(1).max(100) });

/** What a search looks for. */
export type CalendarSearchQuery = z.output<typeof calendarSearchQuerySchema>;

/** Where a search found its words. */
export const CALENDAR_SEARCH_FIELDS = ['title', 'notes', 'model'] as const;

/** One occurrence a search found, and where. */
export const calendarSearchMatchSchema = calendarOccurrenceSchema.extend({
  matched: z.enum(CALENDAR_SEARCH_FIELDS),
});

/** One occurrence a search found. */
export type CalendarSearchMatch = z.output<typeof calendarSearchMatchSchema>;

/** What a search found: the coming times, soonest first, and the past ones, latest first. */
export const calendarSearchResultSchema = z.object({
  comingUp: z.array(calendarSearchMatchSchema).max(100),
  past: z.array(calendarSearchMatchSchema).max(100),
});

/** What a search found. */
export type CalendarSearchResult = z.output<typeof calendarSearchResultSchema>;

// --- holidays ----------------------------------------------------------------------------

/**
 * Where a holiday comes from: the country, its region, the town's patron saint, or added by
 * hand (an event of the Holidays calendar).
 */
export const HOLIDAY_KINDS = ['national', 'regional', 'patron', 'manual'] as const;

/** Where a holiday comes from. */
export type HolidayKind = (typeof HOLIDAY_KINDS)[number];

/** A holiday of one year, as the Holidays settings list it. */
export const calendarHolidaySchema = z.object({
  /** Stable from year to year (`it.06_02`, `it-mi.patron`): what hiding one keeps. */
  key: z.string().min(1).max(120),
  date: calendarDaySchema,
  name: z.string(),
  kind: z.enum(HOLIDAY_KINDS),

  /** Hidden by the owner: a working day after all. */
  isHidden: z.boolean(),

  /** The event, for one added by hand. */
  eventId: z.uuid().nullable(),
});

/** A holiday of one year. */
export type CalendarHoliday = z.output<typeof calendarHolidaySchema>;

/** The year to list the holidays of. */
export const calendarHolidaysQuerySchema = z.object({
  year: z.coerce.number().int().min(1970).max(2200),
});

/** The year to list the holidays of. */
export type CalendarHolidaysQuery = z.output<typeof calendarHolidaysQuerySchema>;

// --- places ------------------------------------------------------------------------------

/**
 * Where the house keeps its holidays. `country` is ISO 3166-1 alpha-2; `region` the region as
 * `date-holidays` codes it (`regionsOf` in `@nebulahome/contracts/holidays`), or for an Italian
 * region it has no holidays of, GeoNames' code (`GET /calendar/places` lists both); `town`, in
 * Italy, the town's name (`Milano`, `Forlì`), its patron found through `ITALIAN_CAPITALS`, any
 * other town having no listed patron.
 */
export const calendarPlaceSchema = z.object({
  country: z.string().regex(/^[A-Z]{2}$/, 'Must be a country code'),
  region: z.string().min(1).max(16).nullable(),
  town: z.string().min(1).max(64).nullable(),
});

/** Where the house keeps its holidays. */
export type CalendarPlace = z.output<typeof calendarPlaceSchema>;

/** A patron saint typed by hand: a name and a day of the year. */
export const calendarPatronSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    month: z.int().min(1).max(12),
    day: z.int().min(1).max(31),
  })
  // 2024 is a leap year: 29 February is a day some year has.
  .refine(
    (patron) => new Date(Date.UTC(2024, patron.month - 1, patron.day)).getUTCDate() === patron.day,
    {
      message: 'No such day',
      path: ['day'],
    },
  );

/** A patron saint typed by hand. */
export type CalendarPatron = z.output<typeof calendarPatronSchema>;

/** A country or a region, for a select. */
export const calendarRegionOptionSchema = z.object({ code: z.string(), name: z.string() });

/** A country or a region, for a select. */
export type CalendarRegionOption = z.output<typeof calendarRegionOptionSchema>;

/** A town, for a select: what `calendar.town` keeps, what is shown, and its patron when listed. */
export const calendarTownOptionSchema = z.object({
  town: z.string(),
  name: z.string(),
  province: z.string().nullable(),
  patronName: z.string().nullable(),

  /** Whether it is a provincial capital. */
  isCapital: z.boolean().default(false),
});

/** A town, for a select. */
export type CalendarTownOption = z.output<typeof calendarTownOptionSchema>;

/**
 * What the place selects offer: every country, the regions of the one asked for, and in Italy its
 * towns - of the region asked for, matching the words typed, or the capitals when none are typed.
 */
export const calendarPlacesSchema = z.object({
  countries: z.array(calendarRegionOptionSchema).default([]),
  regions: z.array(calendarRegionOptionSchema),
  towns: z.array(calendarTownOptionSchema),
});

/** What the place selects offer. */
export type CalendarPlaces = z.output<typeof calendarPlacesSchema>;

/** Which country's regions, which region's towns, and the words a town is looked for by. */
export const calendarPlacesQuerySchema = z.object({
  country: calendarPlaceSchema.shape.country.optional(),
  region: z.string().min(1).max(16).optional(),
  q: z.string().trim().max(64).optional(),
});

/** Which places to offer. */
export type CalendarPlacesQuery = z.output<typeof calendarPlacesQuerySchema>;

/** The place the house's position suggests; null when the house has no position or none fits. */
export const calendarPlaceSuggestionSchema = z.object({ place: calendarPlaceSchema.nullable() });

/** The place the house's position suggests. */
export type CalendarPlaceSuggestion = z.output<typeof calendarPlaceSuggestionSchema>;

/**
 * Someone of the house, as a calendar's Editors list shows them: everyone who reads calendars
 * sees the list, so it carries no more than a name, a picture and the role's key.
 */
export const calendarPersonSchema = z.object({
  id: z.uuid(),
  username: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),

  /** The key of their role: `owner`, `admin`, `member`, `guest`, a custom role's. */
  role: z.string(),
});

/** Someone of the house, for the Editors list. */
export type CalendarPerson = z.output<typeof calendarPersonSchema>;

// --- share links -------------------------------------------------------------------------

/** A share link's token: 128 random bits in hexadecimal, the whole of its secret. */
export const calendarFeedTokenSchema = z
  .string()
  .regex(/^[0-9a-f]{32}$/u, 'Must be 32 hexadecimal digits');

/** A share link: an ICS feed of some calendars, read on the house's network only. */
export const calendarFeedSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  token: calendarFeedTokenSchema,
  calendarIds: z.array(z.uuid()),
  createdAt: timestampSchema,
  lastReadAt: timestampSchema.nullable(),

  /** The app that read it last, by its user agent. */
  lastReadAgent: z.string().nullable(),
});

/** A share link. */
export type CalendarFeed = z.output<typeof calendarFeedSchema>;

/** What making a share link takes. */
export const calendarFeedCreateSchema = z.object({
  name: nameSchema,
  calendarIds: z.array(z.uuid()).min(1).max(100),
});

/** What making a share link takes. */
export type CalendarFeedCreate = z.output<typeof calendarFeedCreateSchema>;

/** What changing a share link takes; `newToken` gives it a new address, the old one dead. */
export const calendarFeedUpdateSchema = z
  .object({
    name: nameSchema,
    calendarIds: z.array(z.uuid()).min(1).max(100),
    newToken: z.literal(true),
  })
  .partial()
  .refine(isNotEmpty, { message: 'Nothing to change' });

/** What changing a share link takes. */
export type CalendarFeedUpdate = z.output<typeof calendarFeedUpdateSchema>;
