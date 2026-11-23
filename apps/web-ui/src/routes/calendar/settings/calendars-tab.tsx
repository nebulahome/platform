/**
 * The Calendars tab (CAL-Set-Calendars): every calendar as a row of a table - its name and what it
 * is, who edits it, its kind and how many events - each opening in place. The open one is kept in
 * the address (`?open=`), so a link from elsewhere ("Open its settings") lands on it open.
 */
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import type { CalendarView } from '@nebulahome/contracts';
import { cn } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { signalled } from '@/lib/signalled';
import { CalendarRow, CALENDAR_ROW_GRID } from '@/routes/calendar/settings/calendar-row';
import {
  CALENDAR_SETTINGS_KEYS,
  fetchCalendarPeople,
} from '@/routes/calendar/settings/settings-api';

/** What the tab needs. */
export type CalendarsTabProps = {
  /** Every calendar, in its order. */
  readonly calendars: readonly CalendarView[];
};

/** A column's heading. */
const HEAD = 'font-mono text-label text-foreground-subtle uppercase';

/**
 * Renders the tab.
 *
 * @param props - See {@link CalendarsTabProps}.
 * @returns The tab.
 */
export function CalendarsTab(props: CalendarsTabProps) {
  const { t } = useTranslation();
  const { calendars } = props;
  const [params, setParams] = useSearchParams();
  const openId = params.get('open');

  const canReadPeople = useSession((state) => state.can)('user:read');
  const people = useQuery({
    queryKey: CALENDAR_SETTINGS_KEYS.people,
    queryFn: signalled(fetchCalendarPeople),
    enabled: canReadPeople,
  });

  return (
    <section className="overflow-hidden rounded-card border border-border bg-surface shadow-edge">
      <div className={cn(CALENDAR_ROW_GRID, 'px-5 py-3')} aria-hidden="true">
        <span className={HEAD}>{t('calendar.settings.columnCalendar', 'Calendar')}</span>
        <span className={cn(HEAD, 'max-md:hidden')}>
          {t('calendar.settings.columnEditors', 'Editors')}
        </span>
        <span className={cn(HEAD, 'max-md:hidden')}>
          {t('calendar.settings.columnKind', 'Kind')}
        </span>
        <span className={cn(HEAD, 'max-md:hidden')}>
          {t('calendar.settings.columnEvents', 'Events')}
        </span>
        <span />
      </div>
      {calendars.map((calendar) => (
        <CalendarRow
          key={calendar.id}
          calendar={calendar}
          people={people.data ?? []}
          isPeoplePending={canReadPeople && people.isPending}
          isOpen={openId === calendar.id}
          onToggle={() => {
            setParams(
              (current) => {
                const next = new URLSearchParams(current);

                if (openId === calendar.id) {
                  next.delete('open');
                } else {
                  next.set('open', calendar.id);
                }

                return next;
              },
              { replace: true },
            );
          }}
        />
      ))}
    </section>
  );
}
