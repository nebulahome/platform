/**
 * Sample cards of the calendar (CAL-Cards): the Agenda, and the calendar entity's card - Giulia's
 * next event, House with a guest on now, Waste's pickup tomorrow, Luca with nothing planned. The
 * times are set from the moment the page opens, so "in 48 min" stays true. The calendars and their
 * coming times are read from {@link CALENDAR_SOURCE}, which the sample source hands to the cards.
 */
import type {
  CalendarModel,
  CalendarOccurrence,
  CalendarView,
  DashboardLeafCard,
  EntityView,
  TagColor,
} from '@nebulahome/contracts';

import { can, sampleEntity } from '@/routes/dashboard/samples/sample-entity';

/** A minute, and a day, in milliseconds. */
const MINUTE = 60_000;
const DAY = 1440 * MINUTE;

/** When the page opened: the samples' now. */
const OPENED = Date.now();

/**
 * A day some days from the page's today, in the browser's zone (the samples' zone).
 *
 * @param days - How many days on.
 * @returns `YYYY-MM-DD`.
 */
function dayIn(days: number): string {
  const at = new Date(OPENED + days * DAY);

  return `${String(at.getFullYear())}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
}

/**
 * A moment some days on, at a time of day, in the browser's zone.
 *
 * @param days - How many days on.
 * @param hours - The hour.
 * @param minutes - The minutes.
 * @returns ISO 8601.
 */
function momentIn(days: number, hours: number, minutes = 0): string {
  const at = new Date(OPENED + days * DAY);
  at.setHours(hours, minutes, 0, 0);

  return at.toISOString();
}

/** The sample calendars' ids. */
const HOUSE = '00000000-0000-4000-8000-00000000c001';
const WASTE = '00000000-0000-4000-8000-00000000c002';
const GIULIA = '00000000-0000-4000-8000-00000000c003';
const LUCA = '00000000-0000-4000-8000-00000000c004';

/** Waste's models used by the samples. */
const PAPER = '00000000-0000-4000-8000-00000000c0a1';
const GLASS = '00000000-0000-4000-8000-00000000c0a2';

/**
 * A sample model of Waste.
 *
 * @param id - Its id.
 * @param name - Its name.
 * @param icon - Its icon.
 * @param color - Its colour.
 * @param position - Its place.
 * @returns The model.
 */
function model(
  id: string,
  name: string,
  icon: string,
  color: TagColor,
  position: number,
): CalendarModel {
  return { id, calendarId: WASTE, name, icon, color, position };
}

/**
 * A sample calendar.
 *
 * @param id - Its id.
 * @param kind - Its kind.
 * @param name - Its name.
 * @param color - Its colour.
 * @param models - Its models.
 * @returns The calendar.
 */
function calendar(
  id: string,
  kind: CalendarView['kind'],
  name: string,
  color: TagColor,
  models: readonly CalendarModel[] = [],
): CalendarView {
  return {
    id,
    kind,
    name,
    color,
    icon: kind === 'house' ? 'house' : null,
    ownerUserId: null,
    isDayOff: false,
    position: 0,
    icsUrl: null,
    icsFile: null,
    icsState: null,
    models: [...models],
    editorIds: [],
    canEdit: false,
    canManage: false,
    entityId: null,
    eventCount: 0,
  };
}

/**
 * A sample time of an event.
 *
 * @param key - Its key.
 * @param calendarId - Its calendar.
 * @param title - Its title.
 * @param times - All day, or timed.
 * @param modelId - Its model.
 * @returns The occurrence.
 */
function occurrence(
  key: string,
  calendarId: string,
  title: string,
  times:
    | { readonly startsOn: string; readonly endsOn: string }
    | { readonly startsAt: string; readonly endsAt: string },
  modelId: string | null = null,
): CalendarOccurrence {
  const isAllDay = 'startsOn' in times;

  return {
    key,
    kind: 'event',
    eventId: null,
    seriesId: null,
    calendarId,
    modelId,
    title,
    icon: null,
    notes: null,
    isAllDay,
    startsOn: isAllDay ? times.startsOn : null,
    endsOn: isAllDay ? times.endsOn : null,
    startsAt: isAllDay ? null : times.startsAt,
    endsAt: isAllDay ? null : times.endsAt,
    occurrenceOn: null,
    isRepeating: false,
    source: 'user',
    entityId: null,
    canEdit: false,
    isStale: false,
    createdBy: null,
  };
}

/** The next event: Yoga in 48 minutes. */
const YOGA = {
  startsAt: new Date(OPENED + 48 * MINUTE).toISOString(),
  endsAt: new Date(OPENED + 123 * MINUTE).toISOString(),
};

/** On now: a guest for four days, the second of them today. */
const GUEST = { startsOn: dayIn(-1), endsOn: dayIn(2) };

/** Calendars and coming times the sample cards read. */
export const CALENDAR_SOURCE: {
  readonly calendars: readonly CalendarView[];
  readonly occurrences: readonly CalendarOccurrence[];
} = {
  calendars: [
    calendar(HOUSE, 'house', 'House', 'indigo'),
    calendar(WASTE, 'waste', 'Waste', 'green', [
      model(PAPER, 'Paper and card', 'newspaper', 'blue', 0),
      model(GLASS, 'Glass', 'wine', 'green', 1),
    ]),
    calendar(GIULIA, 'personal', 'Giulia', 'teal'),
    calendar(LUCA, 'personal', 'Luca', 'pink'),
  ],
  occurrences: [
    occurrence('guest', HOUSE, 'Aunt Carla staying', GUEST),
    occurrence('yoga', GIULIA, 'Yoga', YOGA),
    occurrence('paper', WASTE, 'Paper', { startsOn: dayIn(1), endsOn: dayIn(1) }, PAPER),
    occurrence('glass', WASTE, 'Glass', { startsOn: dayIn(1), endsOn: dayIn(1) }, GLASS),
    occurrence('dinner', HOUSE, 'Dinner with the Rossis', {
      startsAt: momentIn(1, 20, 30),
      endsAt: momentIn(1, 23),
    }),
    occurrence('tree', HOUSE, 'Christmas tree', {
      startsAt: momentIn(2, 10),
      endsAt: momentIn(2, 12),
    }),
    occurrence('party', LUCA, 'Matteo’s birthday party', {
      startsAt: momentIn(2, 15),
      endsAt: momentIn(2, 18),
    }),
  ],
};

/**
 * A calendar's entity, as core makes it.
 *
 * @param entityId - Its address.
 * @param name - Its calendar's name.
 * @param calendarId - Its calendar.
 * @param color - Its colour.
 * @param state - What is on now and next.
 * @returns The entity.
 */
function calendarEntity(
  entityId: string,
  name: string,
  calendarId: string,
  color: TagColor,
  state: object,
): EntityView {
  return sampleEntity(entityId, {
    name,
    area: null,
    capabilities: [can('calendar', { calendarId, color })],
    state: { calendar: { isActive: false, current: null, next: null, isStale: false, ...state } },
  });
}

/**
 * An event as the entity tells it.
 *
 * @param title - Its title.
 * @param times - All day, or timed.
 * @param modelId - Its model.
 * @returns The summary.
 */
function told(
  title: string,
  times:
    | { readonly startsOn: string; readonly endsOn: string }
    | { readonly startsAt: string; readonly endsAt: string },
  modelId: string | null = null,
): object {
  const isAllDay = 'startsOn' in times;

  return {
    title,
    icon: null,
    modelId,
    isAllDay,
    startsOn: isAllDay ? times.startsOn : null,
    endsOn: isAllDay ? times.endsOn : null,
    startsAt: isAllDay ? null : times.startsAt,
    endsAt: isAllDay ? null : times.endsAt,
  };
}

/** The calendars' entities the sample cards show. */
export const CALENDAR_ENTITIES: readonly EntityView[] = [
  calendarEntity('calendar.giulia', 'Giulia', GIULIA, 'teal', { next: told('Yoga', YOGA) }),
  calendarEntity('calendar.house', 'House', HOUSE, 'indigo', {
    isActive: true,
    current: told('Aunt Carla staying', GUEST),
  }),
  calendarEntity('calendar.waste', 'Waste', WASTE, 'green', {
    next: told('Paper and card', { startsOn: dayIn(1), endsOn: dayIn(1) }, PAPER),
  }),
  calendarEntity('calendar.luca', 'Luca', LUCA, 'pink', {}),
];

/** The sample Agenda, every calendar. */
export const CALENDAR_CARDS: readonly DashboardLeafCard[] = [
  { type: 'agenda', id: 'sampleagenda1', x: 0, y: 0, w: 1, h: 2, calendarIds: [], title: null },
];
