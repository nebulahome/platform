/**
 * The share links' dialogs (CAL-Share-New, CAL-Share-Ready, CAL-Share-States): a new link - its
 * name and its calendars - or one changed; the link ready, with its QR code and how each kind of
 * device subscribes; and revoking one.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CalendarFeed, CalendarView } from '@nebulahome/contracts';
import { AppIcon, Button, Checkbox, Modal, QrCode, TextField, toast } from '@nebulahome/ui';

import { toMessage } from '@/lib/error-message';
import { CalendarMark } from '@/routes/calendar/settings/calendar-mark';
import {
  CALENDAR_SETTINGS_KEYS,
  createFeed,
  deleteFeed,
  feedAddress,
  updateFeed,
} from '@/routes/calendar/settings/settings-api';
import { CopyButton } from '@/routes/library/broker-parts';
import { useCatalogueIcons } from '@/routes/library/device-icon';

/** A dialog's round mark: a glyph on its colour's ground. */
const MARKS = {
  primary: 'border-primary/40 bg-primary/12 text-primary',
  success: 'border-success/40 bg-success-soft text-success',
  danger: 'border-danger/40 bg-danger/12 text-danger',
} as const;

/**
 * A dialog's mark.
 *
 * @param props - The glyph and its colour.
 * @param props.icon - The glyph.
 * @param props.tone - Its colour.
 * @returns The mark.
 */
function DialogMark(props: {
  readonly icon: 'link' | 'circle-check' | 'ban';
  readonly tone: keyof typeof MARKS;
}) {
  return (
    <span
      className={`flex size-11 shrink-0 items-center justify-center rounded-tile border ${MARKS[props.tone]}`}
    >
      <AppIcon id={props.icon} size={20} />
    </span>
  );
}

/**
 * The calendars of a link, by name: "House, Holidays, Waste".
 *
 * @param feed - The link.
 * @param calendars - Every calendar.
 * @returns The names, in the calendars' order.
 */
export function feedCalendarNames(
  feed: Pick<CalendarFeed, 'calendarIds'>,
  calendars: readonly CalendarView[],
): string {
  return calendars
    .filter((calendar) => feed.calendarIds.includes(calendar.id))
    .map((calendar) => calendar.name)
    .join(', ');
}

/** What the link dialog needs. */
export type LinkDialogProps = {
  readonly calendars: readonly CalendarView[];

  /** The link to change; a new one when absent. */
  readonly feed?: CalendarFeed;
  readonly onClose: () => void;

  /** Called with a new link, to show it ready. */
  readonly onMade: (feed: CalendarFeed) => void;
};

/**
 * A new link, or one changed: its name and its calendars.
 *
 * @param props - See {@link LinkDialogProps}.
 * @returns The dialog.
 */
export function LinkDialog(props: LinkDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { calendars, feed, onClose, onMade } = props;
  const [name, setName] = useState(feed?.name ?? '');
  const [picked, setPicked] = useState<readonly string[]>(feed?.calendarIds ?? []);
  const icons = useCatalogueIcons(calendars.map((calendar) => calendar.icon));

  const save = useMutation({
    /**
     * Makes the link, or saves it.
     *
     * @returns The link.
     */
    mutationFn: async () => {
      const body = { name: name.trim(), calendarIds: [...picked] };

      return feed === undefined ? createFeed(body) : updateFeed(feed.id, body);
    },

    /**
     * Reads the links again; a new one is shown ready.
     *
     * @param made - The link.
     */
    onSuccess: async (made) => {
      await queryClient.invalidateQueries({ queryKey: CALENDAR_SETTINGS_KEYS.feeds });

      if (feed === undefined) {
        onMade(made);
      } else {
        onClose();
      }
    },

    /**
     * Says why it was not saved.
     *
     * @param error - What the server answered.
     */
    onError: (error) => {
      toast.error({ title: t('calendar.share.notSaved', 'Not saved'), message: toMessage(error) });
    },
  });

  return (
    <Modal
      isOpen
      size="brief"
      layout="card"
      lead={<DialogMark icon="link" tone="primary" />}
      title={feed === undefined ? t('calendar.share.newLink', 'New link') : feed.name}
      closeLabel={t('common.close', 'Close')}
      closesOnBackdrop={name === ''}
      onClose={onClose}
      footer={
        <>
          <span />
          <span className="flex items-center gap-2">
            <Button variant="bare" onClick={onClose}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              isBusy={save.isPending}
              disabled={name.trim() === '' || picked.length === 0}
              onClick={() => {
                save.mutate();
              }}
            >
              {feed === undefined
                ? t('calendar.share.createLink', 'Create link')
                : t('common.save', 'Save')}
            </Button>
          </span>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TextField
          label={t('calendar.settings.name', 'Name')}
          maxLength={40}
          hint={t('calendar.share.nameHint', 'So you remember where it is.')}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <div className="flex flex-col gap-2">
          <span className="flex items-center justify-between">
            <span className="text-caption font-medium text-foreground-muted">
              {t('calendar.share.calendars', 'Calendars')}
            </span>
            <span className="font-mono text-mono-caption text-foreground-subtle">
              {t('calendar.share.picked', '{{picked}} of {{count}}', {
                picked: picked.length,
                count: calendars.length,
              })}
            </span>
          </span>
          <ul className="flex flex-col rounded-inner border border-border bg-well">
            {calendars.map((calendar) => (
              <li key={calendar.id} className="border-t border-border px-3 py-2 first:border-t-0">
                <Checkbox
                  // Level with the mark beside it, not with a line of text: the box in the row's
                  // middle, without the pixel it drops to sit on a text's first line.
                  className="items-center [&>span:first-of-type]:mt-0"
                  label={
                    <span className="flex items-center gap-3">
                      <CalendarMark
                        calendar={calendar}
                        icon={icons.get(calendar.icon ?? '')}
                        size="small"
                      />
                      {calendar.name}
                    </span>
                  }
                  isChecked={picked.includes(calendar.id)}
                  onChange={(isChecked) => {
                    setPicked(
                      calendars
                        .map((one) => one.id)
                        .filter((id) => (id === calendar.id ? isChecked : picked.includes(id))),
                    );
                  }}
                />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
}

/** What the ready dialog needs. */
export type LinkReadyDialogProps = {
  readonly feed: CalendarFeed;
  readonly calendars: readonly CalendarView[];

  /** Whether the link was just made: "The link is ready". */
  readonly isNew: boolean;
  readonly onClose: () => void;
};

/**
 * A link ready to subscribe to: its QR code, how each kind of device subscribes, the address.
 *
 * @param props - See {@link LinkReadyDialogProps}.
 * @returns The dialog.
 */
export function LinkReadyDialog(props: LinkReadyDialogProps) {
  const { t } = useTranslation();
  const { feed, calendars, isNew, onClose } = props;
  const address = feedAddress(feed.token);
  const steps = [
    {
      title: t('calendar.share.iphone', 'iPhone and iPad'),
      line: t('calendar.share.iphoneLine', 'Point the Camera at the code and tap Subscribe.'),
    },
    {
      title: t('calendar.share.mac', 'Mac'),
      line: t(
        'calendar.share.macLine',
        'In the Calendar app, subscribe to a new calendar and paste the link.',
      ),
    },
    {
      title: t('calendar.share.android', 'Android'),
      line: t(
        'calendar.share.androidLine',
        'It needs an app that reads calendars from a URL, such as ICSx⁵.',
      ),
    },
  ];

  return (
    <Modal
      isOpen
      size="form"
      layout="card"
      lead={
        <DialogMark icon={isNew ? 'circle-check' : 'link'} tone={isNew ? 'success' : 'primary'} />
      }
      title={isNew ? t('calendar.share.ready', 'The link is ready') : feed.name}
      description={
        isNew
          ? `${feed.name} · ${feedCalendarNames(feed, calendars)}`
          : feedCalendarNames(feed, calendars)
      }
      closeLabel={t('common.close', 'Close')}
      onClose={onClose}
      footer={
        <>
          <span />
          <Button onClick={onClose}>{t('common.done', 'Done')}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-6">
          <QrCode value={address} label={t('calendar.share.qr', 'QR code of the link')} />
          <ol className="flex min-w-0 flex-1 basis-60 flex-col gap-4">
            {steps.map((step, index) => (
              <li key={step.title} className="flex gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-raised font-mono text-mono-caption text-foreground-muted">
                  {index + 1}
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-ui">{step.title}</span>
                  <span className="text-caption text-foreground-subtle">{step.line}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-foreground-muted">
            {t('calendar.share.link', 'Link')}
          </span>
          <span className="flex items-center gap-2">
            <span className="flex h-control min-w-0 grow items-center rounded-field border border-border-strong bg-surface-high px-3.5">
              <span translate="no" className="truncate font-mono text-mono-caption">
                {address}
              </span>
            </span>
            <CopyButton value={address} />
          </span>
        </div>
        <span className="flex items-center gap-2 text-caption text-foreground-subtle">
          <AppIcon id="wifi" size={14} className="shrink-0" />
          {t(
            'calendar.share.homeWifi',
            'The phone has to be on the home Wi-Fi to subscribe and to update.',
          )}
        </span>
      </div>
    </Modal>
  );
}

/** What the revoke dialog needs. */
export type RevokeLinkDialogProps = {
  readonly feed: CalendarFeed;
  readonly calendars: readonly CalendarView[];
  readonly onClose: () => void;
};

/**
 * Revokes a link: what was subscribed stops updating.
 *
 * @param props - See {@link RevokeLinkDialogProps}.
 * @returns The dialog.
 */
export function RevokeLinkDialog(props: RevokeLinkDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { feed, calendars, onClose } = props;
  const revoke = useMutation({
    /**
     * Deletes the link.
     *
     * @returns When it is gone.
     */
    mutationFn: async () => deleteFeed(feed.id),

    /** Reads the links again and says it is gone. */
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: CALENDAR_SETTINGS_KEYS.feeds });
      toast.success({
        title: t('calendar.share.revoked', '{{name}} revoked', { name: feed.name }),
      });
      onClose();
    },

    /**
     * Says why it was not revoked.
     *
     * @param error - What the server answered.
     */
    onError: (error) => {
      toast.error({
        title: t('calendar.share.notRevoked', 'Not revoked'),
        message: toMessage(error),
      });
    },
  });
  const isAll = calendars.every((calendar) => feed.calendarIds.includes(calendar.id));

  return (
    <Modal
      isOpen
      size="brief"
      layout="card"
      lead={<DialogMark icon="ban" tone="danger" />}
      title={t('calendar.share.revokeQuestion', 'Revoke {{name}}’s link?', { name: feed.name })}
      description={
        isAll
          ? t('calendar.share.allCalendars', 'All {{count}} calendars', { count: calendars.length })
          : t('calendar.share.someCalendars', {
              count: feed.calendarIds.length,
              defaultValue_one: '{{count}} calendar',
              defaultValue_other: '{{count}} calendars',
            })
      }
      closeLabel={t('common.close', 'Close')}
      onClose={onClose}
      footer={
        <>
          <span />
          <span className="flex items-center gap-2">
            <Button variant="bare" onClick={onClose}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              variant="danger"
              isBusy={revoke.isPending}
              onClick={() => {
                revoke.mutate();
              }}
            >
              {t('calendar.share.revoke', 'Revoke')}
            </Button>
          </span>
        </>
      }
    >
      <p className="text-ui text-foreground-muted">
        {t(
          'calendar.share.revokeText',
          'Whatever is subscribed to it stops updating. The events it already has stay there until someone removes the calendar on that device.',
        )}
      </p>
    </Modal>
  );
}
