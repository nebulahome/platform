/**
 * The calendar lab's house (`pnpm preview:calendar`): the boards' own sample - Milan, Thursday 3
 * December 2026 at 18:42, Bobby, Giulia and Luca - from `design/calendar/data.mjs`, as the API
 * would answer it, so the page can be laid beside CAL-Month, CAL-Week, CAL-Agenda and CAL-Year.
 */
import {
  addDays,
  DAYS_OF_WEEK,
  entityIdSchema,
  instantOf,
  weekdayOf,
  type CalendarModel,
  type CalendarOccurrence,
  type CalendarView,
  type IconView,
  type TagColor,
} from '@nebulahome/contracts';

/** The house's zone. */
export const SAMPLE_ZONE = 'Europe/Rome';

/** Now, in the sample: Thursday 3 December 2026, 18:42 in Milan. */
export const SAMPLE_NOW = Date.parse('2026-12-03T17:42:00Z');

/** The drawings of the icons the sample uses, as the catalogue serves them. */
const DRAWINGS = {
  house: {
    node: [
      ['path', { d: 'M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8' }],
      [
        'path',
        {
          d: 'M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
        },
      ],
    ],
    frame: { x: 0, y: 0, size: 24 },
  },
  flag: {
    node: [
      [
        'path',
        {
          d: 'M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528',
        },
      ],
    ],
    frame: { x: 0, y: 0, size: 24 },
  },
  recycle: {
    node: [
      [
        'path',
        { d: 'M7 19H4.815a1.83 1.83 0 0 1-1.57-.881 1.785 1.785 0 0 1-.004-1.784L7.196 9.5' },
      ],
      [
        'path',
        { d: 'M11 19h8.203a1.83 1.83 0 0 0 1.556-.89 1.784 1.784 0 0 0 0-1.775l-1.226-2.12' },
      ],
      ['path', { d: 'm14 16-3 3 3 3' }],
      ['path', { d: 'M8.293 13.596 7.196 9.5 3.1 10.598' }],
      [
        'path',
        {
          d: 'm9.344 5.811 1.093-1.892A1.83 1.83 0 0 1 11.985 3a1.784 1.784 0 0 1 1.546.888l3.943 6.843',
        },
      ],
      ['path', { d: 'm13.378 9.633 4.096 1.098 1.097-4.096' }],
    ],
    frame: { x: 0, y: 0, size: 24 },
  },
  apple: {
    node: [
      ['path', { d: 'M12 6.528V3a1 1 0 0 1 1-1h0' }],
      [
        'path',
        {
          d: 'M18.237 21A15 15 0 0 0 22 11a6 6 0 0 0-10-4.472A6 6 0 0 0 2 11a15.1 15.1 0 0 0 3.763 10 3 3 0 0 0 3.648.648 5.5 5.5 0 0 1 5.178 0A3 3 0 0 0 18.237 21',
        },
      ],
    ],
    frame: { x: 0, y: 0, size: 24 },
  },
  milk: {
    node: [
      ['path', { d: 'M8 2h8' }],
      [
        'path',
        {
          d: 'M9 2v2.789a4 4 0 0 1-.672 2.219l-.656.984A4 4 0 0 0 7 10.212V20a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-9.789a4 4 0 0 0-.672-2.219l-.656-.984A4 4 0 0 1 15 4.788V2',
        },
      ],
      ['path', { d: 'M7 15a6.472 6.472 0 0 1 5 0 6.47 6.47 0 0 0 5 0' }],
    ],
    frame: { x: 0, y: 0, size: 24 },
  },
  newspaper: {
    node: [
      ['path', { d: 'M15 18h-5' }],
      ['path', { d: 'M18 14h-8' }],
      [
        'path',
        {
          d: 'M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-4 0v-9a2 2 0 0 1 2-2h2',
        },
      ],
      ['rect', { width: '8', height: '4', x: '10', y: '6', rx: '1' }],
    ],
    frame: { x: 0, y: 0, size: 24 },
  },
  wine: {
    node: [
      ['path', { d: 'M8 22h8' }],
      ['path', { d: 'M7 10h10' }],
      ['path', { d: 'M12 15v7' }],
      ['path', { d: 'M12 15a5 5 0 0 0 5-5c0-2-.5-4-2-8H9c-1.5 4-2 6-2 8a5 5 0 0 0 5 5Z' }],
    ],
    frame: { x: 0, y: 0, size: 24 },
  },
  'trash-2': {
    node: [
      ['path', { d: 'M10 11v6' }],
      ['path', { d: 'M14 11v6' }],
      ['path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6' }],
      ['path', { d: 'M3 6h18' }],
      ['path', { d: 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }],
    ],
    frame: { x: 0, y: 0, size: 24 },
  },
  leaf: {
    node: [
      [
        'path',
        { d: 'M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z' },
      ],
      ['path', { d: 'M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12' }],
    ],
    frame: { x: 0, y: 0, size: 24 },
  },
  sofa: {
    node: [
      ['path', { d: 'M20 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v3' }],
      [
        'path',
        {
          d: 'M2 16a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v1.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5V11a2 2 0 0 0-4 0z',
        },
      ],
      ['path', { d: 'M4 18v2' }],
      ['path', { d: 'M20 18v2' }],
      ['path', { d: 'M12 4v9' }],
    ],
    frame: { x: 0, y: 0, size: 24 },
  },
  users: {
    node: [
      ['path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }],
      ['path', { d: 'M16 3.128a4 4 0 0 1 0 7.744' }],
      ['path', { d: 'M22 21v-2a4 4 0 0 0-3-3.87' }],
      ['circle', { cx: '9', cy: '7', r: '4' }],
    ],
    frame: { x: 0, y: 0, size: 24 },
  },
  cake: {
    node: [
      ['path', { d: 'M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8' }],
      ['path', { d: 'M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1' }],
      ['path', { d: 'M2 21h20' }],
      ['path', { d: 'M7 8v3' }],
      ['path', { d: 'M12 8v3' }],
      ['path', { d: 'M17 8v3' }],
      ['path', { d: 'M7 4h.01' }],
      ['path', { d: 'M12 4h.01' }],
      ['path', { d: 'M17 4h.01' }],
    ],
    frame: { x: 0, y: 0, size: 24 },
  },
  utensils: {
    node: [
      ['path', { d: 'M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2' }],
      ['path', { d: 'M7 2v20' }],
      ['path', { d: 'M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7' }],
    ],
    frame: { x: 0, y: 0, size: 24 },
  },
  wrench: {
    node: [
      [
        'path',
        {
          d: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z',
        },
      ],
    ],
    frame: { x: 0, y: 0, size: 24 },
  },
  'party-popper': {
    node: [
      ['path', { d: 'M5.8 11.3 2 22l10.7-3.79' }],
      ['path', { d: 'M4 3h.01' }],
      ['path', { d: 'M22 8h.01' }],
      ['path', { d: 'M15 2h.01' }],
      ['path', { d: 'M22 20h.01' }],
      [
        'path',
        {
          d: 'm22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10',
        },
      ],
      ['path', { d: 'm22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17' }],
      ['path', { d: 'm11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7' }],
      [
        'path',
        {
          d: 'M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z',
        },
      ],
    ],
    frame: { x: 0, y: 0, size: 24 },
  },
  link: {
    node: [
      ['path', { d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' }],
      ['path', { d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' }],
    ],
    frame: { x: 0, y: 0, size: 24 },
  },
} as unknown as Readonly<Record<string, Pick<IconView, 'node' | 'frame'>>>;

/** The sample's icons, as the catalogue would serve them. */
export const SAMPLE_ICONS: readonly IconView[] = Object.entries(DRAWINGS).map(([id, drawing]) => ({
  id,
  name: id,
  keywords: [],
  origin: 'builtin',
  isOverridden: false,
  ...drawing,
}));

/**
 * A sample id: a uuid with a number in it.
 *
 * @param n - The number.
 * @returns The uuid.
 */
function idOf(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

/** The calendars, by their key in the boards' data. */
const CALENDARS = {
  casa: { name: 'House', color: 'indigo', icon: 'house', kind: 'house' },
  feste: { name: 'Holidays', color: 'red', icon: 'flag', kind: 'holidays' },
  rifiuti: { name: 'Waste', color: 'green', icon: 'recycle', kind: 'waste' },
  bobby: { name: 'Bobby', color: 'amber', icon: null, kind: 'personal' },
  giulia: { name: 'Giulia', color: 'teal', icon: null, kind: 'personal' },
  luca: { name: 'Luca', color: 'pink', icon: null, kind: 'personal' },
  scuola: { name: 'School · Liceo Volta', color: 'blue', icon: 'link', kind: 'custom' },
} as const;

/** A calendar's key in the boards' data. */
type SampleCalendar = keyof typeof CALENDARS;

/** The models of Waste and of House: calendar, name, icon, colour. */
const MODELS: Readonly<Record<string, readonly [SampleCalendar, string, string, TagColor]>> = {
  umido: ['rifiuti', 'Organic', 'apple', 'orange'],
  plastica: ['rifiuti', 'Plastic and metal', 'milk', 'yellow'],
  carta: ['rifiuti', 'Paper and card', 'newspaper', 'blue'],
  vetro: ['rifiuti', 'Glass', 'wine', 'green'],
  secco: ['rifiuti', 'General waste', 'trash-2', 'violet'],
  verde: ['rifiuti', 'Garden waste', 'leaf', 'lime'],
  ingombranti: ['rifiuti', 'Bulky items', 'sofa', 'cyan'],
  guests: ['casa', 'Guests', 'users', 'indigo'],
  birthday: ['casa', 'Birthday', 'cake', 'pink'],
  dinner: ['casa', 'Dinner out', 'utensils', 'orange'],
  service: ['casa', 'Service', 'wrench', 'cyan'],
};

/** The calendars' ids. */
const CALENDAR_IDS = Object.fromEntries(
  Object.keys(CALENDARS).map((key, index) => [key, idOf(100 + index)]),
) as Record<SampleCalendar, string>;

/** The models' ids. */
const MODEL_IDS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.keys(MODELS).map((key, index) => [key, idOf(200 + index)]),
);

/**
 * The sample's calendars.
 *
 * @param canEdit - Whether the reader edits them: the owner does, a guest does not.
 * @returns The calendars.
 */
export function sampleCalendars(canEdit = true): CalendarView[] {
  return (Object.keys(CALENDARS) as SampleCalendar[]).map((key, position) => {
    const calendar = CALENDARS[key];
    const models: CalendarModel[] = Object.entries(MODELS)
      .filter(([, [owner]]) => owner === key)
      .map(([model, [, name, icon, color]], index) => ({
        id: MODEL_IDS[model] ?? '',
        calendarId: CALENDAR_IDS[key],
        name,
        icon,
        color,
        position: index,
      }));

    return {
      id: CALENDAR_IDS[key],
      kind: calendar.kind,
      name: calendar.name,
      color: calendar.color,
      icon: calendar.icon,
      ownerUserId: null,
      isDayOff: key === 'feste',
      position,
      icsUrl: key === 'scuola' ? 'https://liceovolta.edu.it/calendar.ics' : null,
      icsFile: null,
      icsState: null,
      models,
      editorIds: [],
      canEdit: canEdit && key !== 'scuola' && key !== 'feste',
      canManage: canEdit,
      entityId: null,
      eventCount: 0,
    };
  });
}

/** What making a sample occurrence takes. */
type Sample = {
  readonly calendar: SampleCalendar;
  readonly title: string;
  readonly day: string;
  readonly last?: string;
  readonly start?: string;
  readonly end?: string;
  readonly icon?: string;
  readonly model?: string;
  readonly source?: 'ics' | 'entity';
  readonly repeats?: boolean;
  readonly kind?: 'holiday';
};

/**
 * Seconds since midnight of a clock.
 *
 * @param clock - `HH:MM`.
 * @returns The seconds.
 */
function secondsOf(clock: string): number {
  return Number(clock.slice(0, 2)) * 3600 + Number(clock.slice(3, 5)) * 60;
}

/**
 * Builds a sample occurrence.
 *
 * @param sample - What it is.
 * @param index - Its number, for its key and id.
 * @param canEdit - Whether the reader edits its calendar.
 * @returns The occurrence.
 */
function occurrenceOf(sample: Sample, index: number, canEdit: boolean): CalendarOccurrence {
  const isAllDay = sample.start === undefined;
  const isHoliday = sample.kind === 'holiday';

  const occurrence: CalendarOccurrence = {
    key: isHoliday ? `holiday:it.${String(index)}:${sample.day}` : `${String(index)}:${sample.day}`,
    kind: isHoliday ? 'holiday' : sample.source === 'entity' ? 'entity' : 'event',
    eventId: isHoliday ? null : idOf(1000 + index),
    seriesId: null,
    calendarId: CALENDAR_IDS[sample.calendar],
    modelId: sample.model === undefined ? null : (MODEL_IDS[sample.model] ?? null),
    title: sample.title,
    icon: sample.icon ?? null,
    notes: null,
    isAllDay,
    startsOn: isAllDay ? sample.day : null,
    endsOn: isAllDay ? (sample.last ?? sample.day) : null,
    startsAt: isAllDay
      ? null
      : new Date(
          instantOf(sample.day, secondsOf(sample.start ?? '00:00'), SAMPLE_ZONE),
        ).toISOString(),
    endsAt: isAllDay
      ? null
      : new Date(
          instantOf(sample.day, secondsOf(sample.end ?? '23:59'), SAMPLE_ZONE),
        ).toISOString(),
    occurrenceOn: sample.repeats === true ? sample.day : null,
    isRepeating: sample.repeats === true,
    source: isHoliday ? 'holiday' : (sample.source ?? 'user'),
    entityId:
      sample.source === 'entity' ? entityIdSchema.parse('datetime.boiler_next_service') : null,
    canEdit: canEdit && sample.source === undefined && sample.calendar !== 'scuola' && !isHoliday,
    isStale: false,
    createdBy: null,
  };

  return occurrence;
}

/** The holidays of the sample, in Milan. */
const HOLIDAYS: readonly (readonly [string, string])[] = [
  ['2026-11-01', 'All Saints’ Day'],
  ['2026-12-07', 'Sant’Ambrogio'],
  ['2026-12-08', 'Immaculate Conception'],
  ['2026-12-25', 'Christmas Day'],
  ['2026-12-26', 'St Stephen’s Day'],
  ['2027-01-01', 'New Year’s Day'],
  ['2027-01-06', 'Epiphany'],
  ['2027-03-28', 'Easter Sunday'],
  ['2027-03-29', 'Easter Monday'],
  ['2027-04-25', 'Liberation Day'],
  ['2027-05-01', 'Labour Day'],
  ['2027-06-02', 'Republic Day'],
  ['2027-08-15', 'Ferragosto'],
  ['2027-11-01', 'All Saints’ Day'],
  ['2027-12-07', 'Sant’Ambrogio'],
  ['2027-12-08', 'Immaculate Conception'],
  ['2027-12-24', 'Office closed'],
  ['2027-12-25', 'Christmas Day'],
  ['2027-12-26', 'St Stephen’s Day'],
];

/** The one-off events of the boards. */
const EVENTS: readonly Sample[] = [
  { calendar: 'luca', title: 'English lesson', day: '2026-11-30', start: '15:00', end: '16:00' },
  { calendar: 'bobby', title: 'Dentist', day: '2026-12-01', start: '09:00', end: '10:00' },
  { calendar: 'giulia', title: 'Team meeting', day: '2026-12-01', start: '09:30', end: '11:00' },
  {
    calendar: 'scuola',
    title: 'Class council',
    day: '2026-12-01',
    start: '17:30',
    end: '19:00',
    source: 'ics',
  },
  { calendar: 'casa', title: 'Building meeting', day: '2026-12-02', start: '20:30', end: '22:00' },
  {
    calendar: 'bobby',
    title: 'Call with the architect',
    day: '2026-12-03',
    start: '11:00',
    end: '12:00',
  },
  {
    calendar: 'casa',
    title: 'Dinner with the Rossis',
    day: '2026-12-04',
    start: '20:30',
    end: '23:00',
    model: 'dinner',
    icon: 'utensils',
  },
  { calendar: 'casa', title: 'Christmas tree', day: '2026-12-05', start: '10:00', end: '12:00' },
  {
    calendar: 'luca',
    title: 'Matteo’s birthday party',
    day: '2026-12-05',
    start: '15:00',
    end: '18:00',
    icon: 'party-popper',
  },
  {
    calendar: 'casa',
    title: 'Lunch at grandma’s',
    day: '2026-12-06',
    start: '13:00',
    end: '16:00',
  },
  {
    calendar: 'casa',
    title: 'Next service',
    day: '2026-12-10',
    start: '09:00',
    end: '10:00',
    source: 'entity',
  },
  { calendar: 'luca', title: 'Piano recital', day: '2026-12-11', start: '18:00', end: '19:30' },
  { calendar: 'giulia', title: 'Sara’s birthday', day: '2026-12-12', icon: 'cake' },
  {
    calendar: 'scuola',
    title: 'Parent-teacher meetings',
    day: '2026-12-15',
    start: '16:00',
    end: '19:00',
    source: 'ics',
  },
  { calendar: 'casa', title: 'Bill due', day: '2026-12-16', source: 'entity' },
  {
    calendar: 'casa',
    title: 'Grandma’s birthday',
    day: '2026-12-17',
    model: 'birthday',
    icon: 'cake',
    repeats: true,
  },
  { calendar: 'giulia', title: 'Office dinner', day: '2026-12-18', start: '20:00', end: '23:30' },
  { calendar: 'casa', title: 'Christmas market', day: '2026-12-19', start: '16:00', end: '19:00' },
  {
    calendar: 'casa',
    title: 'Christmas Eve dinner',
    day: '2026-12-24',
    start: '20:00',
    end: '23:00',
  },
  {
    calendar: 'casa',
    title: 'Lunch at the Bianchis’',
    day: '2026-12-26',
    start: '12:30',
    end: '16:00',
  },
  {
    calendar: 'casa',
    title: 'New Year’s Eve at Marco’s',
    day: '2026-12-31',
    start: '21:00',
    end: '23:59',
  },
  {
    calendar: 'casa',
    title: 'Aunt Carla staying',
    day: '2026-12-02',
    last: '2026-12-05',
    model: 'guests',
    icon: 'users',
  },
  {
    calendar: 'scuola',
    title: 'Christmas holidays',
    day: '2026-12-23',
    last: '2027-01-06',
    source: 'ics',
  },
  { calendar: 'luca', title: 'Ski week', day: '2026-12-27', last: '2026-12-30' },
  { calendar: 'casa', title: 'Holiday in Puglia', day: '2027-08-07', last: '2027-08-22' },
  { calendar: 'luca', title: 'Luca’s birthday', day: '2027-03-03' },
  { calendar: 'giulia', title: 'Giulia’s birthday', day: '2027-05-21' },
  { calendar: 'bobby', title: 'Bobby’s birthday', day: '2027-08-09' },
  { calendar: 'scuola', title: 'Last day of school', day: '2027-06-08', source: 'ics' },
  { calendar: 'scuola', title: 'School starts', day: '2027-09-13', source: 'ics' },
];

/**
 * The repeating events of a day: the five-a-side, yoga, the gym and the pickups.
 *
 * @param day - The day.
 * @returns Its samples.
 */
function weeklyOn(day: string): Sample[] {
  const weekday = DAYS_OF_WEEK.indexOf(weekdayOf(day));
  const isGlassWeek =
    Math.round((Date.parse(day) - Date.parse('2026-12-04')) / 86_400_000 / 7) % 2 === 0;
  const bins = [
    ...(weekday === 0 || weekday === 3 ? ['umido'] : []),
    ...(weekday === 1 ? ['plastica'] : []),
    ...(weekday === 4 ? ['carta'] : []),
    ...(weekday === 4 && isGlassWeek ? ['vetro'] : []),
    ...(weekday === 5 ? ['secco'] : []),
  ];

  return [
    ...(weekday === 3
      ? [
          {
            calendar: 'luca',
            title: 'Five-a-side',
            day,
            start: '16:30',
            end: '18:00',
            repeats: true,
          } as const,
          {
            calendar: 'giulia',
            title: 'Yoga',
            day,
            start: '19:30',
            end: '20:45',
            repeats: true,
          } as const,
        ]
      : []),
    ...(weekday === 0 || weekday === 2
      ? [
          {
            calendar: 'bobby',
            title: 'Gym',
            day,
            start: '18:30',
            end: '19:30',
            repeats: true,
          } as const,
        ]
      : []),
    ...bins.map((bin) => {
      const [, title = '', icon = ''] = MODELS[bin] ?? [];

      return { calendar: 'rifiuti', title, day, model: bin, icon, repeats: true } as const;
    }),
  ];
}

/**
 * Every sample occurrence, from late November 2026 to the end of 2027.
 *
 * @param canEdit - Whether the reader edits the calendars.
 * @returns The occurrences.
 */
export function sampleOccurrences(canEdit = true): CalendarOccurrence[] {
  const weekly: Sample[] = [];

  for (let day = '2026-11-23'; day <= '2027-01-10'; day = addDays(day, 1)) {
    weekly.push(...weeklyOn(day));
  }

  return [
    ...weekly,
    ...EVENTS,
    ...HOLIDAYS.map(([day, title]): Sample => ({ calendar: 'feste', title, day, kind: 'holiday' })),
  ].map((sample, index) => occurrenceOf(sample, index, canEdit));
}
