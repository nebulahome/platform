/**
 * A holiday added by hand (CAL-Holiday-Add): a name, a day of a month, every year or only in the
 * year on screen. It is an all-day event of the Holidays calendar, which is always a day off.
 * Opened on one added before, it changes it, or deletes it.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CalendarHoliday, CalendarRepeat } from '@nebulahome/contracts';
import {
  AppIcon,
  Button,
  Modal,
  SelectField,
  Switch,
  TAG_TINT_CLASSES,
  TextField,
  cn,
  toast,
} from '@nebulahome/ui';

import { dateTimeFormat } from '@/i18n/formatters';
import { toMessage } from '@/lib/error-message';
import {
  CALENDAR_QUERY_KEYS,
  createEvent,
  deleteEvent,
  fetchEvent,
  updateEvent,
} from '@/routes/calendar/api';
import { WellRow } from '@/routes/calendar/settings/well-row';
import { ConfirmRemoval } from '@/routes/library/confirm-removal';

/** What the dialog needs. */
export type AddHolidayDialogProps = {
  /** The Holidays calendar. */
  readonly calendarId: string;

  /** The year on screen: the one a holiday that does not repeat falls in. */
  readonly year: number;

  /** One added by hand before, to change; a new one when absent. */
  readonly holiday?: CalendarHoliday;
  readonly onClose: () => void;
};

/** Every year, from the day it starts. */
const YEARLY: CalendarRepeat = { every: 1, unit: 'year', ends: { kind: 'never' } };

/**
 * Writes a number in two digits.
 *
 * @param value - The number.
 * @returns "07".
 */
function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Renders the dialog.
 *
 * @param props - See {@link AddHolidayDialogProps}.
 * @returns The dialog.
 */
export function AddHolidayDialog(props: AddHolidayDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { calendarId, year, holiday, onClose } = props;
  const [name, setName] = useState(holiday?.name ?? '');
  const [day, setDay] = useState(
    holiday === undefined ? '' : String(Number(holiday.date.slice(8))),
  );
  const [month, setMonth] = useState(holiday === undefined ? 1 : Number(holiday.date.slice(5, 7)));
  const [isYearly, setYearly] = useState<boolean | null>(holiday === undefined ? true : null);
  const [isConfirming, setConfirming] = useState(false);
  const eventId = holiday?.eventId ?? null;

  const event = useQuery({
    queryKey: [...CALENDAR_QUERY_KEYS.event, eventId ?? ''],
    /**
     * Reads the holiday's event, for whether it repeats.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the read.
     * @returns The event.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchEvent(eventId ?? '', signal),
    enabled: eventId !== null,
  });
  const yearly = isYearly ?? (event.data === undefined ? true : event.data.repeat !== null);
  const first = `${String(year)}-${pad(month)}-${pad(Number(day))}`;
  const isDay =
    /^\d{1,2}$/u.test(day) &&
    new Date(Date.UTC(year, month - 1, Number(day))).getUTCDate() === Number(day);

  /** Reads the holidays again and closes. */
  const done = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: CALENDAR_QUERY_KEYS.all });
    onClose();
  };

  /**
   * Says why it was not saved.
   *
   * @param error - What the server answered.
   */
  const failed = (error: unknown): void => {
    toast.error({ title: t('calendar.holidays.notSaved', 'Not saved'), message: toMessage(error) });
  };

  const save = useMutation({
    /**
     * Adds the holiday, or saves it.
     *
     * @returns The event.
     */
    mutationFn: async () => {
      const fields = {
        title: name.trim(),
        isAllDay: true,
        startsOn: first,
        endsOn: first,
        repeat: yearly ? YEARLY : null,
      };

      return eventId === null
        ? createEvent({ calendarId, ...fields })
        : updateEvent(eventId, fields);
    },
    onSuccess: done,
    onError: failed,
  });
  const remove = useMutation({
    /**
     * Deletes the holiday.
     *
     * @returns When it is gone.
     */
    mutationFn: async () => (eventId === null ? undefined : deleteEvent(eventId)),
    onSuccess: done,
    onError: failed,
  });
  const months = Array.from({ length: 12 }, (unused, index) => ({
    value: String(index + 1),
    label: dateTimeFormat({ month: 'long', timeZone: 'UTC' }).format(Date.UTC(2026, index, 15)),
  }));

  return (
    <Modal
      isOpen
      size="small"
      layout="card"
      lead={
        <span
          className={cn(
            'flex size-11 shrink-0 items-center justify-center rounded-tile border',
            TAG_TINT_CLASSES.red,
          )}
        >
          <AppIcon id="flag" size={20} />
        </span>
      }
      title={
        holiday === undefined
          ? t('calendar.holidays.addTitle', 'Add a holiday')
          : t('calendar.holidays.editTitle', 'Change the holiday')
      }
      description={t('calendar.holidays.addedByHandLine', 'Holidays · added by hand')}
      closeLabel={t('common.close', 'Close')}
      closesOnBackdrop={name === ''}
      onClose={onClose}
      footer={
        isConfirming ? (
          <ConfirmRemoval
            question={t('calendar.holidays.deleteQuestion', 'Delete {{name}}?', {
              name: holiday?.name ?? '',
            })}
            label={t('common.delete', 'Delete')}
            isBusy={remove.isPending}
            onCancel={() => {
              setConfirming(false);
            }}
            onConfirm={() => {
              remove.mutate();
            }}
          />
        ) : (
          <>
            {holiday === undefined ? (
              <span />
            ) : (
              <Button
                variant="bare"
                className="text-danger"
                onClick={() => {
                  setConfirming(true);
                }}
              >
                {t('common.delete', 'Delete')}
              </Button>
            )}
            <span className="flex items-center gap-2">
              <Button variant="bare" onClick={onClose}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button
                isBusy={save.isPending}
                disabled={name.trim() === '' || !isDay}
                onClick={() => {
                  save.mutate();
                }}
              >
                {holiday === undefined ? t('common.add', 'Add') : t('common.save', 'Save')}
              </Button>
            </span>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <TextField
          label={t('calendar.settings.name', 'Name')}
          maxLength={120}
          value={name}
          onChange={(change) => {
            setName(change.target.value);
          }}
        />
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label={t('calendar.holidays.day', 'Day')}
            inputMode="numeric"
            className="font-mono"
            maxLength={2}
            value={day}
            error={
              day === '' || isDay ? undefined : t('calendar.holidays.noSuchDay', 'No such day')
            }
            onChange={(change) => {
              setDay(change.target.value.replaceAll(/\D/gu, ''));
            }}
          />
          <SelectField
            label={t('calendar.holidays.month', 'Month')}
            options={months}
            value={String(month)}
            onChange={(value) => {
              setMonth(Number(value));
            }}
          />
        </div>
        <WellRow
          title={t('calendar.holidays.everyYear', 'Every year')}
          line={t('calendar.holidays.onlyInYear', 'Off: only in {{year}}.', { year })}
        >
          <Switch
            label={t('calendar.holidays.everyYear', 'Every year')}
            isOn={yearly}
            onChange={setYearly}
          />
        </WellRow>
        <WellRow
          title={t('calendar.settings.dayOff', 'Day off')}
          line={t(
            'calendar.holidays.dayOffLine',
            'Working today and Working tomorrow say No on that day.',
          )}
        >
          <Switch
            label={t('calendar.settings.dayOff', 'Day off')}
            isOn
            disabled
            onChange={() => null}
          />
        </WellRow>
      </div>
    </Modal>
  );
}
