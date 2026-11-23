/**
 * The calendar lab (`pnpm preview:calendar`): the Calendar page on the boards' sample house -
 * Milan, Thursday 3 December 2026 at 18:42 - answered from memory, so it can be laid beside the
 * CAL-* boards without a hub. `?view=week|month|year|agenda`, `?date=2027-01-01`, `?lang=it`,
 * `?theme=light`, `?panel=closed`, `?role=guest` (nothing editable).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';

import type { CalendarOccurrence } from '@nebulahome/contracts';
import { Toaster } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { applyLanguage } from '@/i18n/language';
import { CalendarPage } from '@/routes/calendar/calendar-page';
import { CalendarSettingsPage } from '@/routes/calendar/settings/calendar-settings-page';
import { usePreferences } from '@/settings/preferences';
import { SAMPLE_OWNER } from '@/testing/backup-samples';
import {
  SAMPLE_ICONS,
  SAMPLE_NOW,
  SAMPLE_ZONE,
  sampleCalendars,
  sampleOccurrences,
} from '@/testing/calendar-samples';
import { settingsAnswer } from '@/testing/calendar-settings-samples';
import { LAB_ICONS } from '@/testing/entity-lab/lab-cache';

import './styles/globals.css';

const query = new URLSearchParams(window.location.search);
const isGuest = query.get('role') === 'guest';
const isSettings = query.get('page') === 'settings';
const occurrences = sampleOccurrences(!isGuest);
const icons = [...LAB_ICONS, ...SAMPLE_ICONS];

// The sample's now: the page reads the clock through Date.now.
const offset = SAMPLE_NOW - Date.now();
const realNow = Date.now.bind(Date);

/**
 * The sample's now.
 *
 * @returns Milliseconds since the epoch, the sample's evening.
 */
Date.now = () => realNow() + offset;

/**
 * Answers a call to the API from the sample, by its path.
 *
 * @param path - The path below `/api/v1`, with its query.
 * @returns The body, or undefined for a call the sample does not answer.
 */
function answer(path: string): unknown {
  // The settings page (`?page=settings`) reads its own samples first; both read the people.
  const settings =
    isSettings || path.startsWith('/calendar/people') ? settingsAnswer(path, query) : undefined;

  if (settings !== undefined) {
    return settings;
  }

  const url = new URL(path, 'http://lab');
  const at = url.pathname;
  const asked = url.searchParams;

  if (at === '/calendars') {
    return { items: sampleCalendars(!isGuest) };
  }

  if (at === '/calendar/occurrences') {
    const from = asked.get('from') ?? '';
    const to = asked.get('to') ?? '';

    return {
      items: occurrences.filter(
        (each) =>
          (each.endsOn ?? each.endsAt?.slice(0, 10) ?? '') >= from &&
          (each.startsOn ?? each.startsAt?.slice(0, 10) ?? '') <= to,
      ),
    };
  }

  if (at === '/calendar/search') {
    const words = (asked.get('q') ?? '').toLowerCase();
    const found = occurrences.filter(
      (each) => each.kind !== 'holiday' && each.title.toLowerCase().includes(words),
    );
    /**
     * The day an occurrence starts, roughly.
     *
     * @param each - The occurrence.
     * @returns Its day or instant, to compare.
     */
    const dayOf = (each: CalendarOccurrence): string => each.startsOn ?? each.startsAt ?? '';

    return {
      comingUp: found
        .filter((each) => dayOf(each) >= '2026-12-03')
        .slice(0, 5)
        .map((each) => ({ ...each, matched: 'title' })),
      past: found
        .filter((each) => dayOf(each) < '2026-12-03')
        .slice(-1)
        .map((each) => ({ ...each, matched: 'title' })),
    };
  }

  if (at === '/calendar/holidays') {
    return {
      items: occurrences
        .filter(
          (each) =>
            each.kind === 'holiday' && (each.startsOn ?? '').startsWith(asked.get('year') ?? ''),
        )
        .map((each) => ({
          key: each.key.split(':')[1],
          date: each.startsOn,
          name: each.title,
          kind: each.title === 'Sant’Ambrogio' ? 'patron' : 'national',
          isHidden: false,
          eventId: null,
        })),
    };
  }

  if (at.startsWith('/calendar/events/')) {
    const event = occurrences.find((each) => each.eventId === at.slice('/calendar/events/'.length));

    return event === undefined
      ? undefined
      : {
          ...event,
          timeZone: SAMPLE_ZONE,
          repeat: { every: 1, unit: 'week', ends: { kind: 'never' } },
          skippedOn: [],
          seriesId: null,
          occurrenceOn: null,
          source: 'user',
          startsOn: event.startsOn === null ? null : '2026-11-05',
          endsOn: event.endsOn === null ? null : '2026-11-05',
          startsAt: event.startsAt === null ? null : `2026-11-05T${event.startsAt.slice(11)}`,
          endsAt: event.endsAt === null ? null : `2026-11-05T${event.endsAt.slice(11)}`,
        };
  }

  if (at === '/icons') {
    const ids = new Set((asked.get('ids') ?? '').split(','));

    return { items: icons.filter((icon) => ids.has(icon.id)) };
  }

  if (at === '/automations/house') {
    return { timeZone: SAMPLE_ZONE, position: { latitude: 45.4642, longitude: 9.19 } };
  }

  return undefined;
}

// Every call to the API is answered from the sample; the rest fail as a hub that is not there.
const realFetch = globalThis.fetch.bind(globalThis);

/**
 * Answers the API from the sample, and hands anything else on.
 *
 * @param input - What is fetched.
 * @param init - How.
 * @returns The answer.
 */
globalThis.fetch = async (input, init) => {
  const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const below = path.replace(/^.*\/api\/v1/u, '');
  const body = path.includes('/api/v1') ? answer(below) : undefined;

  return body === undefined
    ? realFetch(input, init)
    : new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
};

const CACHE = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchInterval: false } },
});

useSession.setState({
  user: isGuest
    ? {
        ...SAMPLE_OWNER,
        permissions: SAMPLE_OWNER.permissions.filter((grant) => grant.key.endsWith(':read')),
      }
    : SAMPLE_OWNER,
});
usePreferences.setState({
  calendarPanel: query.get('panel') === 'closed' ? 'closed' : 'open',
  hiddenCalendars: [],
});
document.documentElement.setAttribute('data-theme', query.get('theme') ?? 'dark');
void applyLanguage(query.get('lang') === 'it' ? 'it' : 'en');

const root = document.querySelector('#root');

if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={CACHE}>
        <MemoryRouter
          initialEntries={[
            isSettings
              ? `/calendar/settings?${query.toString()}`
              : `/calendar?view=${query.get('view') ?? 'month'}&date=${query.get('date') ?? (query.get('view') === 'year' ? '2027-01-01' : '2026-12-03')}`,
          ]}
        >
          <main className="flex h-screen min-w-0 bg-canvas text-foreground">
            {isSettings ? <CalendarSettingsPage /> : <CalendarPage />}
          </main>
        </MemoryRouter>
      </QueryClientProvider>
      <Toaster />
    </StrictMode>,
  );
}
