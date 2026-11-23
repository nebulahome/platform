/**
 * The calendar's settings (`/calendar/settings`, CAL-Set-*): the calendars, each opening in place
 * into its name, colour, models, source, Day off and editors; the holidays at the house's place;
 * and the links that share some calendars with the apps on the house's network.
 *
 * Laid out as the broker pages are - the way back, the title and its line, the one primary action
 * of the open tab, then the tabs - since no settings page has tabs of its own.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon, Button, DetailHero, TabPanel, Tabs } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { signalled } from '@/lib/signalled';
import { useTab } from '@/lib/use-tab';
import { CALENDAR_QUERY_KEYS, fetchCalendars } from '@/routes/calendar/api';
import { CalendarsTab } from '@/routes/calendar/settings/calendars-tab';
import { HolidaysTab } from '@/routes/calendar/settings/holidays-tab';
import { NewCalendarDialog } from '@/routes/calendar/settings/new-calendar-dialog';
import { CALENDAR_SETTINGS_KEYS, fetchFeeds } from '@/routes/calendar/settings/settings-api';
import { ShareTab } from '@/routes/calendar/settings/share-tab';
import { BackLink, DetailFrame } from '@/routes/library/detail-page';

/** The tabs of the page; the first is the page itself. */
const TABS = ['calendars', 'holidays', 'share'] as const;

/** One tab. */
type SettingsTab = (typeof TABS)[number];

/**
 * Renders the calendar's settings.
 *
 * @returns The page.
 */
export function CalendarSettingsPage() {
  const { t } = useTranslation();
  const can = useSession((state) => state.can);
  const canManage = can('calendar:manage');
  const [tab, setTab] = useTab<SettingsTab>(TABS);
  const [isCreating, setCreating] = useState(false);
  const [isLinking, setLinking] = useState(false);

  const calendars = useQuery({
    queryKey: CALENDAR_QUERY_KEYS.calendars,
    queryFn: signalled(fetchCalendars),
  });
  const feeds = useQuery({
    queryKey: CALENDAR_SETTINGS_KEYS.feeds,
    queryFn: signalled(fetchFeeds),
    enabled: canManage,
  });
  const list = calendars.data ?? [];

  return (
    <DetailFrame
      isPending={calendars.isPending}
      error={calendars.error}
      hero={
        <DetailHero
          back={<BackLink to="/calendar">{t('calendar.settings.back', 'Calendar')}</BackLink>}
          title={t('calendar.settings.title', 'Calendar settings')}
          description={t(
            'calendar.settings.description',
            'Everyone sees every calendar. Here you decide how they are made and who changes them.',
          )}
          actions={
            !canManage ? undefined : tab === 'calendars' ? (
              <Button
                onClick={() => {
                  setCreating(true);
                }}
              >
                <AppIcon id="plus" size={15} />
                {t('calendar.settings.newCalendar', 'New calendar')}
              </Button>
            ) : tab === 'share' && (feeds.data?.length ?? 0) > 0 ? (
              <Button
                onClick={() => {
                  setLinking(true);
                }}
              >
                <AppIcon id="plus" size={15} />
                {t('calendar.settings.newLink', 'New link')}
              </Button>
            ) : undefined
          }
          tabs={
            <Tabs
              label={t('calendar.settings.title', 'Calendar settings')}
              idPrefix="calendar-settings"
              value={tab}
              onChange={setTab}
              items={[
                {
                  id: 'calendars',
                  label: t('calendar.settings.calendars', 'Calendars'),
                  count: list.length,
                },
                { id: 'holidays', label: t('calendar.settings.holidays', 'Holidays') },
                // Share links are the owner's and the admins': nobody else sees the tab.
                ...(canManage
                  ? [
                      {
                        id: 'share' as const,
                        label: t('calendar.settings.share', 'Share'),
                        ...(feeds.data === undefined ? {} : { count: feeds.data.length }),
                      },
                    ]
                  : []),
              ]}
            />
          }
        />
      }
    >
      <div className="flex flex-col gap-5">
        {tab === 'calendars' ? (
          <TabPanel idPrefix="calendar-settings" id="calendars">
            <CalendarsTab calendars={list} />
          </TabPanel>
        ) : null}

        {tab === 'holidays' ? (
          <TabPanel idPrefix="calendar-settings" id="holidays">
            <HolidaysTab
              calendars={list}
              onOpenCalendars={() => {
                setTab('calendars');
              }}
            />
          </TabPanel>
        ) : null}

        {tab === 'share' && canManage ? (
          <TabPanel idPrefix="calendar-settings" id="share">
            <ShareTab
              calendars={list}
              feeds={feeds.data}
              isLinking={isLinking}
              onLink={setLinking}
            />
          </TabPanel>
        ) : null}
      </div>

      {isCreating ? (
        <NewCalendarDialog
          onClose={() => {
            setCreating(false);
          }}
        />
      ) : null}
    </DetailFrame>
  );
}
