/**
 * The Share tab (CAL-Set-Share, CAL-Share-States): the links that let a phone or a computer on the
 * house's network subscribe to some calendars - each with its address, its calendars, when it was
 * last read, Copy, its QR code and a menu (Rename, Change calendars, New address, Revoke).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CalendarFeed, CalendarView } from '@nebulahome/contracts';
import {
  AppIcon,
  Button,
  cn,
  EmptyState,
  IconButton,
  OverflowMenu,
  TAG_FILL_CLASSES,
  toast,
  type UiIconId,
} from '@nebulahome/ui';

import { toMessage } from '@/lib/error-message';
import { relativeTime } from '@/lib/format-time';
import {
  CALENDAR_SETTINGS_KEYS,
  feedAddress,
  updateFeed,
} from '@/routes/calendar/settings/settings-api';
import {
  LinkDialog,
  LinkReadyDialog,
  RevokeLinkDialog,
} from '@/routes/calendar/settings/share-dialogs';
import { CopyButton } from '@/routes/library/broker-parts';

/** What the tab needs. */
export type ShareTabProps = {
  readonly calendars: readonly CalendarView[];

  /** The links; undefined while they are read. */
  readonly feeds: readonly CalendarFeed[] | undefined;

  /** Whether the New link dialog is open: the page's header opens it too. */
  readonly isLinking: boolean;
  readonly onLink: (isLinking: boolean) => void;
};

/** What a dialog of the tab is doing. */
type Dialog =
  | { readonly at: 'ready'; readonly feed: CalendarFeed; readonly isNew: boolean }
  | { readonly at: 'edit'; readonly feed: CalendarFeed }
  | { readonly at: 'revoke'; readonly feed: CalendarFeed };

/** A column's heading. */
const HEAD = 'font-mono text-label text-foreground-subtle uppercase';

/** The columns of the table. */
const GRID =
  'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4.5 md:grid-cols-[minmax(0,1fr)_11.875rem_8.125rem_10.5rem]';

/**
 * The device a link is read by, guessed from the app that read it last.
 *
 * @param agent - Its user agent, or null when it was never read.
 * @returns A phone, a computer, a tablet; a link while nobody has read it.
 */
function deviceIcon(agent: string | null): UiIconId {
  if (agent === null) {
    return 'link';
  }

  return /ipad|tablet/iu.test(agent)
    ? 'tablet'
    : /iphone|android|mobile/iu.test(agent)
      ? 'smartphone'
      : 'laptop';
}

/**
 * Renders the tab.
 *
 * @param props - See {@link ShareTabProps}.
 * @returns The tab.
 */
export function ShareTab(props: ShareTabProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { calendars, feeds, isLinking, onLink } = props;
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const newAddress = useMutation({
    /**
     * Gives a link a new address; the old one stops working.
     *
     * @param feed - The link.
     * @returns The link, with its new token.
     */
    mutationFn: async (feed: CalendarFeed) => updateFeed(feed.id, { newToken: true }),

    /**
     * Shows the new address.
     *
     * @param feed - The link.
     */
    onSuccess: async (feed) => {
      await queryClient.invalidateQueries({ queryKey: CALENDAR_SETTINGS_KEYS.feeds });
      setDialog({ at: 'ready', feed, isNew: false });
    },

    /**
     * Says why it did not change.
     *
     * @param error - What the server answered.
     */
    onError: (error) => {
      toast.error({ title: t('calendar.share.notSaved', 'Not saved'), message: toMessage(error) });
    },
  });

  if (feeds === undefined) {
    return (
      <p className="text-ui-sm text-foreground-subtle">{t('library.detail.reading', 'Reading…')}</p>
    );
  }

  return (
    <>
      {feeds.length === 0 ? (
        <div className="relative min-h-80 overflow-hidden rounded-card border border-dashed border-border-strong">
          <EmptyState
            icon={<AppIcon id="link" size={32} />}
            title={t('calendar.share.none', 'No links yet')}
            description={t(
              'calendar.share.noneLine',
              'A link lets a phone or a computer at home subscribe to some of the calendars, in its own calendar app.',
            )}
            action={
              <Button
                onClick={() => {
                  onLink(true);
                }}
              >
                <AppIcon id="plus" size={15} />
                {t('calendar.settings.newLink', 'New link')}
              </Button>
            }
          />
        </div>
      ) : (
        <section className="rounded-card border border-border bg-surface shadow-edge">
          <div className={cn(GRID, 'border-b border-border py-3 pr-4 pl-5')} aria-hidden="true">
            <span className={HEAD}>{t('calendar.share.columnLink', 'Link')}</span>
            <span className={cn(HEAD, 'max-md:hidden')}>
              {t('calendar.share.columnCalendars', 'Calendars')}
            </span>
            <span className={cn(HEAD, 'max-md:hidden')}>
              {t('calendar.share.columnRead', 'Last read')}
            </span>
            <span />
          </div>
          {feeds.map((feed) => {
            const shown = calendars.filter((calendar) => feed.calendarIds.includes(calendar.id));
            const address = feedAddress(feed.token);

            return (
              <div
                key={feed.id}
                className={cn(GRID, 'border-t border-border py-3.5 pr-4 pl-5 first:border-t-0')}
              >
                <span className="flex min-w-0 items-center gap-3.5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-field bg-surface-raised text-foreground-muted">
                    <AppIcon id={deviceIcon(feed.lastReadAgent)} size={17} />
                  </span>
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="truncate text-ui font-medium">{feed.name}</span>
                    <span
                      translate="no"
                      className="truncate font-mono text-mono-caption text-foreground-subtle"
                    >
                      {address}
                    </span>
                  </span>
                </span>
                <span className="flex items-center gap-1 max-md:hidden">
                  {shown.map((calendar) => (
                    <span
                      key={calendar.id}
                      title={calendar.name}
                      className={cn(
                        'size-3',
                        calendar.kind === 'personal' ? 'rounded-full' : 'rounded-check',
                        TAG_FILL_CLASSES[calendar.color],
                      )}
                    />
                  ))}
                  <span className="ml-1.5 text-caption text-foreground-subtle">
                    {shown.length === calendars.length
                      ? t('calendar.share.all', 'all')
                      : t('calendar.share.calendarCount', {
                          count: shown.length,
                          defaultValue_one: '{{count}} calendar',
                          defaultValue_other: '{{count}} calendars',
                        })}
                  </span>
                </span>
                <span
                  className={cn(
                    'text-ui-sm max-md:hidden',
                    feed.lastReadAt === null ? 'text-foreground-subtle' : 'text-foreground-muted',
                  )}
                >
                  {feed.lastReadAt === null
                    ? t('calendar.share.neverRead', 'Never read')
                    : t('calendar.share.readAgo', 'Read {{when}}', {
                        when: relativeTime(new Date(feed.lastReadAt)),
                      })}
                </span>
                <span className="flex items-center justify-end gap-1.5">
                  <CopyButton value={address} />
                  <IconButton
                    label={t('calendar.share.qr', 'QR code of the link')}
                    variant="raised"
                    onClick={() => {
                      setDialog({ at: 'ready', feed, isNew: false });
                    }}
                  >
                    <AppIcon id="qr-code" size={15} />
                  </IconButton>
                  <OverflowMenu
                    items={[
                      {
                        label: t('calendar.share.rename', 'Rename'),
                        icon: 'pencil',
                        /** Opens the link's name and calendars. */
                        onSelect: () => {
                          setDialog({ at: 'edit', feed });
                        },
                      },
                      {
                        label: t('calendar.share.changeCalendars', 'Change calendars'),
                        icon: 'calendar-days',
                        /** Opens the link's name and calendars. */
                        onSelect: () => {
                          setDialog({ at: 'edit', feed });
                        },
                      },
                      {
                        label: t('calendar.share.newAddress', 'New address'),
                        icon: 'refresh-cw',
                        /** Gives the link a new address. */
                        onSelect: () => {
                          newAddress.mutate(feed);
                        },
                      },
                      {
                        label: t('calendar.share.revoke', 'Revoke'),
                        icon: 'ban',
                        tone: 'danger',
                        /** Asks before revoking the link. */
                        onSelect: () => {
                          setDialog({ at: 'revoke', feed });
                        },
                      },
                    ]}
                  />
                </span>
              </div>
            );
          })}
        </section>
      )}

      <span className="mt-1 flex items-center gap-2 px-1 text-caption text-foreground-subtle">
        <AppIcon id="lock" size={14} className="shrink-0" />
        {t(
          'calendar.share.likePassword',
          'Whoever has a link reads those calendars: keep it like a password. Revoke it from the row’s menu; a new link doesn’t change the old ones.',
        )}
      </span>

      {isLinking ? (
        <LinkDialog
          calendars={calendars}
          onClose={() => {
            onLink(false);
          }}
          onMade={(feed) => {
            onLink(false);
            setDialog({ at: 'ready', feed, isNew: true });
          }}
        />
      ) : null}
      {dialog?.at === 'ready' ? (
        <LinkReadyDialog
          feed={dialog.feed}
          calendars={calendars}
          isNew={dialog.isNew}
          onClose={() => {
            setDialog(null);
          }}
        />
      ) : null}
      {dialog?.at === 'edit' ? (
        <LinkDialog
          calendars={calendars}
          feed={dialog.feed}
          onClose={() => {
            setDialog(null);
          }}
          onMade={() => {
            setDialog(null);
          }}
        />
      ) : null}
      {dialog?.at === 'revoke' ? (
        <RevokeLinkDialog
          feed={dialog.feed}
          calendars={calendars}
          onClose={() => {
            setDialog(null);
          }}
        />
      ) : null}
    </>
  );
}
