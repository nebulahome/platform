/**
 * The calendar settings' answers in the calendar lab (`?page=settings`): the boards' house - Bobby
 * the owner, Giulia and Luca members, Elena a guest - its calendars with their editors, sources and
 * entities, Milan's place, the share links, and what deleting School would take. `?ics=` picks the
 * School URL's state (`ok`, `unreachable`, `not_found`, `not_calendar`, `needs_sign_in`); `?file=1`
 * gives Waste a loaded file; `?place=none` a house with no place and no position.
 */
import type { CalendarIcsErrorCode, CalendarView } from '@nebulahome/contracts';

import { SAMPLE_OWNER } from '@/testing/backup-samples';
import { sampleCalendars } from '@/testing/calendar-samples';

/** The people of the boards' house. */
const PEOPLE = [
  { id: SAMPLE_OWNER.id, username: 'bobby', displayName: 'Bobby', role: 'owner' },
  {
    id: '00000000-0000-4000-8000-0000000000b2',
    username: 'giulia',
    displayName: 'Giulia',
    role: 'member',
  },
  {
    id: '00000000-0000-4000-8000-0000000000b3',
    username: 'luca',
    displayName: 'Luca',
    role: 'member',
  },
  {
    id: '00000000-0000-4000-8000-0000000000b4',
    username: 'elena',
    displayName: 'Elena',
    role: 'guest',
  },
] as const;

/** The day and time of the sample's last reads. */
const READ_AT = new Date('2026-12-03T17:30:00Z');

/**
 * A user as `/users` lists them.
 *
 * @param person - Who.
 * @returns The user.
 */
function userOf(person: (typeof PEOPLE)[number]): object {
  return {
    ...person,
    email: null,
    locale: null,
    timezone: 'Europe/Rome',
    isActive: true,
    isTwoFactorEnabled: false,
    mustChangePassword: false,
    avatarUrl: null,
    lastLoginAt: null,
    lockedUntil: null,
    createdAt: '2026-01-01T00:00:00Z',
  };
}

/**
 * The calendars as the settings read them: with owners, editors, sources and entities.
 *
 * @param query - The lab's address query.
 * @returns The calendars.
 */
function calendars(query: URLSearchParams): CalendarView[] {
  const [bobby, giulia, luca] = PEOPLE;
  const error = query.get('ics');
  const owners: Record<string, string> = { Bobby: bobby.id, Giulia: giulia.id, Luca: luca.id };
  const editors: Record<string, readonly string[]> = {
    House: [giulia.id, luca.id],
    Waste: [giulia.id],
    Giulia: [bobby.id],
    Luca: [giulia.id, bobby.id],
  };
  const counts: Record<string, number> = {
    House: 86,
    Waste: 5,
    Bobby: 41,
    Giulia: 57,
    Luca: 33,
    'School · Liceo Volta': 48,
  };
  const slugs: Record<string, string> = {
    House: 'calendar.house',
    Holidays: 'calendar.holidays',
    Waste: 'calendar.waste',
    Bobby: 'calendar.bobby',
    Giulia: 'calendar.giulia',
    Luca: 'calendar.luca',
    'School · Liceo Volta': 'calendar.school_liceo_volta',
  };

  return sampleCalendars(true).map((calendar) => ({
    ...calendar,
    canEdit: calendar.kind !== 'holidays',
    ownerUserId: owners[calendar.name] ?? null,
    editorIds: [...(editors[calendar.name] ?? [])],
    eventCount: counts[calendar.name] ?? 0,
    entityId: (slugs[calendar.name] ?? null) as CalendarView['entityId'],
    ...(calendar.icsUrl === null
      ? calendar.name === 'Waste' && query.get('file') === '1'
        ? {
            icsFile: {
              name: 'waste-milan-2027.ics',
              size: 14_336,
              uploadedAt: new Date('2026-12-03T17:40:00Z'),
              uploadedBy: bobby.id,
            },
            icsState: {
              lastAttemptAt: READ_AT,
              lastSuccessAt: READ_AT,
              etag: null,
              lastModified: null,
              error: null,
              eventCount: 52,
              rangeFrom: '2027-01-01',
              rangeTo: '2027-12-31',
              matchedModels: 48,
            },
          }
        : {}
      : {
          icsUrl: 'https://www.liceovolta.edu.it/agenda/classe-4b.ics',
          icsState: {
            lastAttemptAt: READ_AT,
            lastSuccessAt:
              error === null || error === 'ok' ? READ_AT : new Date('2026-12-03T14:30:00Z'),
            etag: null,
            lastModified: null,
            error:
              error === null || error === 'ok'
                ? null
                : {
                    code: error as CalendarIcsErrorCode,
                    detail:
                      error === 'unreachable'
                        ? 'Timed out after 20 s'
                        : error === 'not_found'
                          ? 'HTTP 404 Not Found'
                          : error === 'needs_sign_in'
                            ? 'HTTP 401 Unauthorized'
                            : 'HTTP 200 · text/html',
                  },
            eventCount: 46,
            rangeFrom: '2026-09-01',
            rangeTo: '2027-06-30',
            matchedModels: 0,
          },
        }),
  }));
}

/**
 * Answers a call of the settings page, by its path.
 *
 * @param path - The path below `/api/v1`, with its query.
 * @param query - The lab's address query.
 * @returns The body, or undefined for a call the page agent's sample answers.
 */
export function settingsAnswer(path: string, query: URLSearchParams): unknown {
  const url = new URL(path, 'http://lab');
  const at = url.pathname;
  const isPlaced = query.get('place') !== 'none';

  if (at === '/calendars') {
    return { items: calendars(query) };
  }

  if (at === '/users') {
    return { items: PEOPLE.map(userOf) };
  }

  if (at === '/settings') {
    const values: Record<string, unknown> = {
      'calendar.country': isPlaced ? 'IT' : null,
      'calendar.region': isPlaced ? 'LOM' : null,
      'calendar.town': isPlaced ? 'Milano' : null,
      'calendar.patron': null,
      'calendar.weekend_days': [5, 6],
      'calendar.hidden_holidays': [],
    };

    return {
      items: Object.entries(values).map(([key, value]) => ({
        key,
        value,
        defaultValue: null,
        description: '',
        updatedAt: '2026-12-01T00:00:00Z',
        updatedBy: null,
      })),
    };
  }

  if (at === '/automations/house' && !isPlaced) {
    return { timeZone: 'Europe/Rome', position: null };
  }

  if (at === '/calendar/places/suggest') {
    return { place: isPlaced ? { country: 'IT', region: 'LOM', town: 'Milano' } : null };
  }

  if (at === '/calendar/places') {
    return {
      countries: [
        { code: 'FR', name: 'France' },
        { code: 'DE', name: 'Germany' },
        { code: 'IT', name: 'Italy' },
      ],
      regions: url.searchParams.has('country')
        ? [
            { code: 'LAZ', name: 'Lazio' },
            { code: 'LOM', name: 'Lombardy' },
            { code: 'PIE', name: 'Piedmont' },
          ]
        : [],
      towns: url.searchParams.has('region')
        ? [
            {
              town: 'Milano',
              name: 'Milan',
              province: 'MI',
              patronName: 'Sant’Ambrogio',
              isCapital: true,
            },
            { town: 'Rho', name: 'Rho', province: 'MI', patronName: null, isCapital: false },
          ]
        : [],
    };
  }

  if (at === '/calendar/feeds') {
    const ids = calendars(query).map((calendar) => calendar.id);
    /**
     * A sample share link.
     *
     * @param n - Its number, for its id and how long ago it was read.
     * @param name - Its name.
     * @param token - Its token.
     * @param picked - Its calendars.
     * @param agent - The app that read it last, or null for never.
     * @returns The link.
     */
    const feed = (
      n: number,
      name: string,
      token: string,
      picked: readonly string[],
      agent: string | null,
    ) => ({
      id: `00000000-0000-4000-8000-0000000000f${String(n)}`,
      name,
      token,
      calendarIds: [...picked],
      createdAt: '2026-11-01T00:00:00Z',
      lastReadAt:
        agent === null ? null : new Date(Date.now() - (n === 1 ? 12 : 120) * 60_000).toISOString(),
      lastReadAgent: agent,
    });

    return {
      items: [
        feed(
          1,
          'Giulia’s iPhone',
          '7f3a9c2e5b1d4e88a06c3f21d9b47e15',
          [ids[0] ?? '', ids[4] ?? '', ids[5] ?? '', ids[6] ?? ''],
          'iPhone Calendar',
        ),
        feed(
          2,
          'Study Mac',
          'c41d09a7e2f84b10e93a5c7d2f6b8a04',
          [ids[0] ?? '', ids[1] ?? '', ids[3] ?? ''],
          'Macintosh CalendarAgent',
        ),
        feed(3, 'Kitchen tablet', '9be2077d1a3c5f62b8e41d0a7c39f5e6', ids, null),
      ],
    };
  }

  if (/^\/calendars\/[^/]+\/usage$/u.test(at)) {
    return {
      automations: [
        { id: '00000000-0000-4000-8000-0000000000a9', name: 'School holidays: heating on eco' },
      ],
      feeds: [{ id: '00000000-0000-4000-8000-0000000000f1', name: 'Giulia’s iPhone' }],
      eventCount: 2,
      icsEventCount: 46,
    };
  }

  return undefined;
}
