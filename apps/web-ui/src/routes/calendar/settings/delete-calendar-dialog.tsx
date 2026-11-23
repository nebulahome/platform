/**
 * Deletes a calendar, saying first what goes with it (CAL-Calendar-Delete): its events, its entity
 * with its history, the automations whose trigger names it and the share links it drops out of.
 * The alias dialog's pattern: what uses it read before anything is pressed, then one request.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import type { CalendarView } from '@nebulahome/contracts';
import { AppIcon, Button, Modal, toast, type UiIconId } from '@nebulahome/ui';

import { toMessage } from '@/lib/error-message';
import { CALENDAR_QUERY_KEYS } from '@/routes/calendar/api';
import {
  CALENDAR_SETTINGS_KEYS,
  deleteCalendar,
  fetchCalendarUsage,
} from '@/routes/calendar/settings/settings-api';
import { AliasMark } from '@/routes/library/aliases/alias-new-dialog';
import { UsedByRows } from '@/routes/library/aliases/used-by-rows';

/** What the dialog needs. */
export type DeleteCalendarDialogProps = {
  readonly calendar: CalendarView;
  readonly onClose: () => void;
};

/**
 * One thing that goes, as a row of the list.
 *
 * @param props - Its glyph and words.
 * @param props.icon - The glyph.
 * @param props.title - What it is.
 * @param props.line - What happens to it.
 * @returns The row.
 */
function GoneRow(props: {
  readonly icon: UiIconId;
  readonly title: string;
  readonly line: string;
}) {
  return (
    <li className="flex items-center gap-3 border-t border-border px-3.5 py-2.5 first:border-t-0">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-chip bg-surface-raised text-foreground-muted">
        <AppIcon id={props.icon} size={13} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-ui-sm">{props.title}</span>
        <span className="truncate text-caption text-foreground-subtle">{props.line}</span>
      </span>
    </li>
  );
}

/**
 * Renders the dialog.
 *
 * @param props - See {@link DeleteCalendarDialogProps}.
 * @returns The dialog.
 */
export function DeleteCalendarDialog(props: DeleteCalendarDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [, setParams] = useSearchParams();
  const { calendar, onClose } = props;

  const usage = useQuery({
    queryKey: [...CALENDAR_SETTINGS_KEYS.usage, calendar.id],
    /**
     * Reads what goes with the calendar.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the read.
     * @returns Its automations, links and events.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchCalendarUsage(calendar.id, signal),
  });
  const remove = useMutation({
    /**
     * Deletes it.
     *
     * @returns When it is gone.
     */
    mutationFn: async () => deleteCalendar(calendar.id),

    /** Closes its row, reads the calendars again and says it is gone. */
    onSuccess: async () => {
      onClose();
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.delete('open');

          return next;
        },
        { replace: true },
      );
      await queryClient.invalidateQueries({ queryKey: CALENDAR_QUERY_KEYS.all });
      toast.success({
        title: t('calendar.deleteCalendar.deleted', '{{name}} deleted', { name: calendar.name }),
      });
    },

    /**
     * Says why it was not deleted.
     *
     * @param error - What the server answered.
     */
    onError: (error) => {
      toast.error({
        title: t('calendar.deleteCalendar.notDeleted', 'Not deleted'),
        message: toMessage(error),
      });
    },
  });
  const used = usage.data;
  const sourceWord =
    calendar.icsUrl !== null
      ? t('calendar.deleteCalendar.fromUrl', 'Calendar from a URL')
      : calendar.icsFile === null
        ? t('calendar.deleteCalendar.calendar', 'Calendar')
        : t('calendar.deleteCalendar.fromFile', 'Calendar from a file');

  return (
    <Modal
      isOpen
      size="brief"
      layout="card"
      lead={<AliasMark tone="danger" />}
      title={t('calendar.deleteCalendar.title', 'Delete {{name}}?', { name: calendar.name })}
      description={sourceWord}
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
              isBusy={remove.isPending}
              disabled={used === undefined}
              onClick={() => {
                remove.mutate();
              }}
            >
              {t('calendar.deleteCalendar.submit', 'Delete calendar')}
            </Button>
          </span>
        </>
      }
    >
      {used === undefined ? (
        <p className="text-ui-sm text-foreground-muted">
          {usage.isError ? toMessage(usage.error) : t('library.detail.reading', 'Reading…')}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <span className="text-ui-sm text-foreground-muted">
            {t('calendar.deleteCalendar.goes', 'This goes, and can’t be brought back:')}
          </span>
          <ul className="flex flex-col rounded-card border border-border">
            <GoneRow
              icon="calendar"
              title={t('calendar.deleteCalendar.events', {
                count: used.eventCount + used.icsEventCount,
                defaultValue_one: '{{count}} event',
                defaultValue_other: '{{count}} events',
              })}
              line={
                used.icsEventCount === 0
                  ? t('calendar.deleteCalendar.allYours', 'All added here')
                  : t(
                      'calendar.deleteCalendar.eventsSplit',
                      '{{ics}} from its source and {{own}} added here',
                      {
                        ics: used.icsEventCount,
                        own: used.eventCount,
                      },
                    )
              }
            />
            {calendar.entityId === null ? null : (
              <GoneRow
                icon="cpu"
                title={t('calendar.deleteCalendar.entity', 'The entity {{entityId}}', {
                  entityId: calendar.entityId,
                })}
                line={t('calendar.deleteCalendar.withHistory', 'With its history')}
              />
            )}
            <UsedByRows
              usedBy={{ automations: used.automations, scenes: [], dashboards: [], aliases: [] }}
            />
            {used.feeds.map((feed) => (
              <GoneRow
                key={feed.id}
                icon="link"
                title={feed.name}
                line={t(
                  'calendar.deleteCalendar.feedLine',
                  'Share link · this calendar drops out of it',
                )}
              />
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
