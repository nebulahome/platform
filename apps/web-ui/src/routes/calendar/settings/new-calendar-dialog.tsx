/**
 * Making a calendar (CAL-Calendar-New, CAL-Calendar-File): empty, from a URL or from a `.ics`
 * file, picked as cards. A URL or a file is tested before the calendar is made, and its name -
 * the one the calendar gives itself - fills Name while Name is empty.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import {
  CALENDAR_ICS_MAXIMUM_BYTES,
  type CalendarIcsTestResult,
  type CalendarSource,
  type TagColor,
} from '@nebulahome/contracts';
import {
  AppIcon,
  Button,
  ColorSwatches,
  Modal,
  Note,
  RadioGroup,
  TextField,
  toast,
} from '@nebulahome/ui';

import { FileDrop } from '@/components/file-drop';
import { translate } from '@/i18n/messages';
import { toMessage } from '@/lib/error-message';
import { CALENDAR_QUERY_KEYS } from '@/routes/calendar/api';
import { dayWords } from '@/routes/calendar/calendar-time';
import { sizeWords } from '@/routes/calendar/settings/ics-source';
import { createCalendar, testIcsUrl, uploadIcsFile } from '@/routes/calendar/settings/settings-api';

/** What the dialog needs. */
export type NewCalendarDialogProps = {
  readonly onClose: () => void;
};

/** Where the new calendar's events come from. */
type Way = 'none' | 'url' | 'file';

/**
 * The line of a test that worked: "Next: Budget review, Fri 4 Dec".
 *
 * @param found - What the test found.
 * @returns The line.
 */
function nextLine(found: Extract<CalendarIcsTestResult, { kind: 'ok' }>): string {
  const day = found.next?.startsOn ?? found.next?.startsAt?.slice(0, 10) ?? null;

  return found.next === null || day === null
    ? ''
    : translate('calendar.new.next', 'Next: {{title}}, {{day}}', {
        title: found.next.title,
        day: dayWords(day, 'long'),
      });
}

/**
 * Renders the dialog.
 *
 * @param props - See {@link NewCalendarDialogProps}.
 * @returns The dialog.
 */
export function NewCalendarDialog(props: NewCalendarDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [, setParams] = useSearchParams();
  const { onClose } = props;
  const [way, setWay] = useState<Way>('none');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<{ readonly name: string; readonly size: number } | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState<TagColor>('cyan');

  /**
   * Fills Name with the name a source gives itself, while Name is empty.
   *
   * @param result - What the test found.
   */
  const named = (result: CalendarIcsTestResult): void => {
    if (result.kind === 'ok' && result.calendarName !== null && name.trim() === '') {
      setName(result.calendarName);
    }
  };

  const test = useMutation({
    /**
     * Has the hub download the address.
     *
     * @returns What it found.
     */
    mutationFn: async () => testIcsUrl(url.trim()),
    onSuccess: named,
  });
  const upload = useMutation({
    /**
     * Sends the file to be kept and tested.
     *
     * @param chosen - The file.
     * @returns What it holds.
     */
    mutationFn: async (chosen: File) => uploadIcsFile(chosen),
    onSuccess: named,
  });
  const found = way === 'url' ? test.data : way === 'file' ? upload.data : undefined;
  const source: CalendarSource | null =
    way === 'none'
      ? { kind: 'none' }
      : found?.kind !== 'ok'
        ? null
        : way === 'url'
          ? { kind: 'url', icsUrl: url.trim() }
          : found.fileId === undefined
            ? null
            : { kind: 'file', icsFileId: found.fileId };

  const create = useMutation({
    /**
     * Makes the calendar.
     *
     * @returns The calendar.
     */
    mutationFn: async () =>
      createCalendar({
        name: name.trim(),
        color,
        isDayOff: false,
        source: source ?? { kind: 'none' },
      }),

    /**
     * Opens its row, and says it is made.
     *
     * @param calendar - The calendar.
     */
    onSuccess: async (calendar) => {
      await queryClient.invalidateQueries({ queryKey: CALENDAR_QUERY_KEYS.all });
      setParams({ open: calendar.id }, { replace: true });
      toast.success({ title: t('calendar.new.created', '{{name}} made', { name: calendar.name }) });
      onClose();
    },

    /**
     * Says why it was not made.
     *
     * @param error - What the server answered.
     */
    onError: (error) => {
      toast.error({ title: t('calendar.new.notCreated', 'Not made'), message: toMessage(error) });
    },
  });
  const failure = way === 'url' ? test.error : way === 'file' ? upload.error : null;
  const isTooBig = way === 'file' && file !== null && file.size > CALENDAR_ICS_MAXIMUM_BYTES;

  return (
    <Modal
      isOpen
      size="form"
      layout="card"
      lead={
        <span className="flex size-11 shrink-0 items-center justify-center rounded-tile border border-primary/40 bg-primary/12 text-primary">
          <AppIcon id="calendar-plus" size={20} />
        </span>
      }
      title={t('calendar.new.title', 'New calendar')}
      closeLabel={t('common.close', 'Close')}
      closesOnBackdrop={url === '' && file === null && name === ''}
      onClose={onClose}
      footer={
        <>
          <span />
          <span className="flex items-center gap-2">
            <Button variant="bare" onClick={onClose}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              isBusy={create.isPending}
              disabled={name.trim() === '' || source === null}
              onClick={() => {
                create.mutate();
              }}
            >
              {t('calendar.new.create', 'Create calendar')}
            </Button>
          </span>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <RadioGroup<Way>
          label={t('calendar.new.source', 'Where its events come from')}
          isLabelHidden
          look="cards"
          className="grid gap-2.5 sm:grid-cols-3"
          value={way}
          onChange={setWay}
          options={[
            {
              value: 'none',
              label: t('calendar.new.empty', 'Empty'),
              note: t('calendar.new.emptyNote', 'You add the events.'),
            },
            {
              value: 'url',
              label: t('calendar.new.fromUrl', 'From a URL'),
              note: t('calendar.new.fromUrlNote', 'Updates every hour by itself.'),
            },
            {
              value: 'file',
              label: t('calendar.new.fromFile', 'From a file'),
              note: t('calendar.new.fromFileNote', 'A .ics file from your computer.'),
            },
          ]}
        />

        {way === 'url' ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-end gap-2">
              <div className="min-w-0 grow">
                <TextField
                  label={t('calendar.new.url', 'URL')}
                  type="url"
                  className="font-mono"
                  value={url}
                  onChange={(event) => {
                    setUrl(event.target.value);
                    test.reset();
                  }}
                />
              </div>
              <Button
                variant="ghost"
                isBusy={test.isPending}
                disabled={url.trim() === ''}
                onClick={() => {
                  test.mutate();
                }}
              >
                {t('calendar.ics.test', 'Test')}
              </Button>
            </div>
            <span className="text-caption text-foreground-subtle">
              {t(
                'calendar.new.urlHint',
                'On Google Calendar: Settings › the calendar › Secret address in iCal format.',
              )}
            </span>
          </div>
        ) : null}

        {way === 'file' ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-caption font-medium text-foreground-muted">
              {t('calendar.new.file', 'File')}
            </span>
            <FileDrop
              accept=".ics,text/calendar"
              hint={t('calendar.ics.dropFile', 'Drop a .ics file here')}
              overHint={t('calendar.ics.dropToTest', 'Drop it to test it · .ics · up to 5 MB')}
              chosen={file === null ? null : { name: file.name, detail: sizeWords(file.size) }}
              isBusy={upload.isPending}
              onFile={(chosen) => {
                setFile({ name: chosen.name, size: chosen.size });
                upload.reset();

                if (chosen.size <= CALENDAR_ICS_MAXIMUM_BYTES) {
                  upload.mutate(chosen);
                }
              }}
            />
            <span className="text-caption text-foreground-subtle">
              {t(
                'calendar.new.fileHint',
                'From the club’s site or an email: look for “Add to calendar”, iCal or .ics.',
              )}
            </span>
          </div>
        ) : null}

        {isTooBig ? (
          <Note tone="danger">{t('calendar.ics.tooBig', 'It is over 5 MB')}</Note>
        ) : found?.kind === 'ok' ? (
          <Note tone="success">
            <span className="flex flex-col gap-0.5">
              <span>
                {t('calendar.ics.foundEvents', 'Found {{count}} events', {
                  count: found.eventCount,
                })}
              </span>
              <span className="text-caption text-foreground-subtle">{nextLine(found)}</span>
            </span>
          </Note>
        ) : found?.kind === 'error' ? (
          <Note tone="danger">
            <span className="flex flex-col gap-0.5">
              <span>
                {way === 'file' && found.code === 'not_calendar'
                  ? t('calendar.ics.fileNotCalendar', 'This file isn’t a calendar')
                  : t('calendar.new.notCalendar', 'Not a calendar this hub can read')}
              </span>
              <span className="font-mono text-mono-caption text-foreground-subtle">
                {found.detail}
              </span>
            </span>
          </Note>
        ) : failure === null ? null : (
          <Note tone="danger">{toMessage(failure)}</Note>
        )}

        <TextField
          label={t('calendar.settings.name', 'Name')}
          value={name}
          maxLength={40}
          hint={
            way === 'file' && found?.kind === 'ok' && found.calendarName !== null
              ? t(
                  'calendar.new.nameFromFile',
                  'The name the file gives itself; change it if you like.',
                )
              : undefined
          }
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <ColorSwatches
          label={t('calendar.settings.colour', 'Colour')}
          value={color}
          onChange={setColor}
        />
        <span className="flex items-center gap-2 text-caption text-foreground-subtle">
          <AppIcon id={way === 'file' ? 'file' : 'users'} size={14} className="shrink-0" />
          {way === 'file'
            ? t(
                'calendar.new.fileNote',
                'A file doesn’t update: when a newer one is published, load it in its row.',
              )
            : t(
                'calendar.new.everyoneSees',
                'Everyone sees it. The owner and admins edit it; tick others in its Editors.',
              )}
        </span>
      </div>
    </Modal>
  );
}
