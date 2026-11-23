/**
 * A calendar's source in its open row (CAL-ICS-States, CAL-ICS-File): none, a URL or a loaded
 * `.ics` file, one at a time.
 *
 * Either is tested before it is attached: an address is downloaded by the hub, a file is read here
 * (`file.text()`, refused over 5 MB before it is sent) and kept by the hub. What the test found -
 * how many events, from when to when, the next one, how many took a model by name - says whether
 * to Connect or Load. Once attached, an address updates every hour and on Refresh now; when a read
 * fails, the error has a card of its own and the events already downloaded stay. A file never
 * updates by itself.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
  CALENDAR_ICS_MAXIMUM_BYTES,
  type CalendarIcsErrorCode,
  type CalendarIcsTestResult,
  type CalendarView,
} from '@nebulahome/contracts';
import {
  AppIcon,
  Button,
  HealthCard,
  HealthStrip,
  IconButton,
  Modal,
  Note,
  TextField,
  toast,
} from '@nebulahome/ui';

import { FileDrop } from '@/components/file-drop';
import { dateTimeFormat } from '@/i18n/formatters';
import { translate } from '@/i18n/messages';
import { toMessage } from '@/lib/error-message';
import { clockText, shortTime } from '@/lib/format-time';
import { CALENDAR_QUERY_KEYS } from '@/routes/calendar/api';
import { dayWords } from '@/routes/calendar/calendar-time';
import {
  refreshCalendarIcs,
  testIcsUrl,
  updateCalendar,
  uploadIcsFile,
  type CalendarPerson,
} from '@/routes/calendar/settings/settings-api';
import { WellRow } from '@/routes/calendar/settings/well-row';

/** What the block needs. */
export type IcsSourceProps = {
  readonly calendar: CalendarView;

  /** The people of the house, for who loaded a file. */
  readonly people: readonly CalendarPerson[];
};

/** A file taken to be tested: its name and size, and what the test found. */
type Picked = { readonly name: string; readonly size: number };

/** A source being added: an address being typed, or a file being chosen. */
type Adding = 'none' | 'url' | 'file';

/**
 * A file's size in words.
 *
 * @param bytes - Its size.
 * @returns "14 kB".
 */
export function sizeWords(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${String(Math.max(1, Math.round(bytes / 1024)))} kB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * The months two days are in, in words.
 *
 * @param from - The first day.
 * @param to - The last day.
 * @param isShort - "Jan to Dec 2027" rather than "January 2027 to December 2027".
 * @returns The words; empty when either is unknown.
 */
function monthsWords(from: string | null, to: string | null, isShort = false): string {
  if (from === null || to === null) {
    return '';
  }

  const month = dateTimeFormat({
    month: isShort ? 'short' : 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return translate('calendar.ics.monthsRange', '{{from}} to {{to}}', {
    from: month.format(Date.parse(`${from}T12:00:00Z`)),
    to: month.format(Date.parse(`${to}T12:00:00Z`)),
  });
}

/**
 * When something happened, as the strip says it: "Today at 18:30", "23 Nov, 18:30".
 *
 * @param at - The moment.
 * @returns The words.
 */
function whenText(at: Date | string): string {
  const date = new Date(at);

  return date.toDateString() === new Date().toDateString()
    ? translate('calendar.ics.todayAt', 'Today at {{time}}', { time: clockText(date) })
    : shortTime(date);
}

/**
 * The line under a test that worked: the months, and the next event.
 *
 * @param found - What it found.
 * @returns "From September 2026 to June 2027 · next: Parent-teacher meetings, Tue 15 Dec".
 */
function foundLine(found: Extract<CalendarIcsTestResult, { kind: 'ok' }>): string {
  const months = monthsWords(found.rangeFrom, found.rangeTo);
  const next = found.next;
  const day = next === null ? null : (next.startsOn ?? next.startsAt?.slice(0, 10) ?? null);

  return [
    months,
    next === null || day === null
      ? ''
      : translate('calendar.ics.next', 'next: {{title}}, {{day}}', {
          title: next.title,
          day: dayWords(day, 'short'),
        }),
  ]
    .filter((part) => part !== '')
    .join(' · ');
}

/** What an error card says: its title and what to do. */
type ErrorWords = { readonly title: string; readonly text: string };

/**
 * What a failed read says.
 *
 * @param code - Why it failed.
 * @param since - Since when the source has not been read, for "for 3 hours".
 * @returns The words.
 */
function errorWords(code: CalendarIcsErrorCode, since: Date | null): ErrorWords {
  switch (code) {
    case 'unreachable':
      return {
        title: translate('calendar.ics.unreachable', 'Can’t reach the address'),
        text:
          since === null
            ? translate('calendar.ics.triesAgain', 'It tries again every hour by itself.')
            : translate(
                'calendar.ics.unreachableText',
                'The events downloaded {{when}} stay, greyed. It tries again every hour by itself.',
                { when: whenText(since).toLowerCase() },
              ),
      };
    case 'not_found':
      return {
        title: translate('calendar.ics.notFound', 'The address is gone'),
        text: translate(
          'calendar.ics.notFoundText',
          'The calendar may have moved. Paste the new address; the old events stay until then.',
        ),
      };
    case 'not_calendar':
      return {
        title: translate('calendar.ics.notCalendar', 'This address is a web page, not a calendar'),
        text: translate(
          'calendar.ics.notCalendarText',
          'Look on that page for a link ending in .ics, or for “Subscribe” or “iCal”.',
        ),
      };
    case 'needs_sign_in':
      return {
        title: translate('calendar.ics.needsSignIn', 'This calendar needs a sign-in'),
        text: translate(
          'calendar.ics.needsSignInText',
          'The hub can’t sign in for you. On Google Calendar use the secret address in iCal format: it works without a login.',
        ),
      };
    case 'no_events':
      return {
        title: translate('calendar.ics.noEvents', 'There are no events in it'),
        text: '',
      };
    case 'too_big':
      return {
        title: translate('calendar.ics.tooBig', 'It is over 5 MB'),
        text: '',
      };
  }
}

/**
 * What a file that failed its test says: a file is a calendar or it is not.
 *
 * @param code - Why it failed.
 * @returns The words.
 */
function fileErrorWords(code: CalendarIcsErrorCode): ErrorWords {
  return code === 'not_calendar'
    ? {
        title: translate('calendar.ics.fileNotCalendar', 'This file isn’t a calendar'),
        text: translate(
          'calendar.ics.fileNotCalendarText',
          'Look on the town’s site for the .ics or iCal version, or for “Add to calendar”. A PDF or a picture of the calendar can’t be read.',
        ),
      }
    : errorWords(code, null);
}

/** What an error card needs. */
type ErrorCardProps = {
  readonly words: ErrorWords;

  /** What was seen: a status, an address. */
  readonly detail: string;
  readonly actions?: ReactNode;
};

/**
 * A failed read, in a card of its own.
 *
 * @param props - See {@link ErrorCardProps}.
 * @returns The card.
 */
function ErrorCard(props: ErrorCardProps) {
  const { words, detail, actions } = props;

  return (
    <Note tone="danger">
      <span className="flex flex-col gap-2">
        <span className="font-medium">{words.title}</span>
        {detail === '' ? null : (
          <span className="font-mono text-mono-caption break-all whitespace-pre-line text-foreground-muted">
            {detail}
          </span>
        )}
        {words.text === '' ? null : (
          <span className="text-ui-sm text-foreground-subtle">{words.text}</span>
        )}
        {actions === undefined ? null : <span className="flex gap-2">{actions}</span>}
      </span>
    </Note>
  );
}

/**
 * The head of the block while a source is shown or added.
 *
 * @param props - The line under the title.
 * @param props.line - What kind of source it is.
 * @returns The head.
 */
function Head(props: { readonly line: string }) {
  const { t } = useTranslation();

  return (
    <span className="flex flex-col gap-0.75">
      <span className="text-ui font-medium">{t('calendar.ics.title', 'ICS source')}</span>
      <span className="text-caption text-foreground-subtle">{props.line}</span>
    </span>
  );
}

/**
 * The address or the file, as a box with its glyph.
 *
 * @param props - What it says.
 * @param props.icon - A link or a file.
 * @param props.children - The address, or the name and size.
 * @returns The box.
 */
function SourceBox(props: { readonly icon: 'link' | 'file-text'; readonly children: ReactNode }) {
  return (
    <span className="flex h-control min-w-0 grow items-center gap-2.5 rounded-field border border-border-strong bg-surface-high px-3.5 font-mono text-mono-ui">
      <AppIcon id={props.icon} size={16} className="shrink-0 text-foreground-subtle" />
      <span className="truncate">{props.children}</span>
    </span>
  );
}

/**
 * Renders the block.
 *
 * @param props - See {@link IcsSourceProps}.
 * @returns The block.
 */
export function IcsSource(props: IcsSourceProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { calendar, people } = props;
  const [adding, setAdding] = useState<Adding>('none');
  const [url, setUrl] = useState('');
  const [picked, setPicked] = useState<Picked | null>(null);
  const [isRemoving, setRemoving] = useState(false);
  const canEdit = calendar.canManage;
  const state = calendar.icsState;
  const own = Math.max(0, calendar.eventCount - (state?.eventCount ?? 0));

  /**
   * Says why something did not work.
   *
   * @param error - What the server answered.
   */
  const failed = (error: unknown): void => {
    toast.error({ title: t('calendar.ics.failed', 'It did not work'), message: toMessage(error) });
  };

  /** Reads the calendars again. */
  const reread = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: CALENDAR_QUERY_KEYS.all });
  };

  const test = useMutation({
    /**
     * Has the hub download the address.
     *
     * @returns What it found.
     */
    mutationFn: async () => testIcsUrl(url.trim(), calendar.id),
    onError: failed,
  });
  const upload = useMutation({
    /**
     * Sends a file to be kept and tested.
     *
     * @param file - The file.
     * @returns What it holds.
     */
    mutationFn: async (file: File) => uploadIcsFile(file, calendar.id),
    onError: failed,
  });
  const attach = useMutation({
    /**
     * Makes the tested address or file the calendar's source, or removes the one there.
     *
     * @param body - The address, the file, or null for neither.
     * @returns The calendar.
     */
    mutationFn: async (body: { icsUrl: string | null } | { icsFileId: string | null }) =>
      updateCalendar(calendar.id, body),

    /** Puts the adding away and reads the calendars again. */
    onSuccess: async () => {
      setAdding('none');
      setPicked(null);
      setRemoving(false);
      test.reset();
      upload.reset();
      await reread();
    },
    onError: failed,
  });
  const refresh = useMutation({
    /**
     * Has the hub read the address now.
     *
     * @returns When it is read.
     */
    mutationFn: async () => refreshCalendarIcs(calendar.id),
    onSettled: reread,
    onError: failed,
  });

  /**
   * Takes a file: refused here over 5 MB, sent to be tested otherwise.
   *
   * @param file - The file dropped or chosen.
   */
  const take = (file: File): void => {
    setPicked({ name: file.name, size: file.size });
    upload.reset();

    if (file.size <= CALENDAR_ICS_MAXIMUM_BYTES) {
      upload.mutate(file);
    }
  };

  /** Stops adding a source. */
  const cancel = (): void => {
    setAdding('none');
    setPicked(null);
    test.reset();
    upload.reset();
  };

  const removeDialog = isRemoving ? (
    <Modal
      isOpen
      size="medium"
      layout="card"
      lead={
        <span className="flex size-9.5 items-center justify-center rounded-field bg-danger/12 text-danger">
          <AppIcon id={calendar.icsUrl === null ? 'file-text' : 'link'} size={18} />
        </span>
      }
      title={
        calendar.icsUrl === null
          ? t('calendar.ics.removeFileQuestion', 'Remove the file?')
          : t('calendar.ics.removeUrlQuestion', 'Remove the URL?')
      }
      description={
        calendar.icsFile === null ? calendar.name : `${calendar.name} · ${calendar.icsFile.name}`
      }
      closeLabel={t('common.close', 'Close')}
      onClose={() => {
        setRemoving(false);
      }}
      footer={
        <>
          <span />
          <span className="flex items-center gap-2">
            <Button
              variant="bare"
              onClick={() => {
                setRemoving(false);
              }}
            >
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              variant="danger"
              isBusy={attach.isPending}
              onClick={() => {
                attach.mutate(calendar.icsUrl === null ? { icsFileId: null } : { icsUrl: null });
              }}
            >
              {t('common.remove', 'Remove')}
            </Button>
          </span>
        </>
      }
    >
      <p className="text-ui text-foreground-muted">
        {t('calendar.ics.removeText', {
          count: state?.eventCount ?? 0,
          own,
          defaultValue_one:
            'The {{count}} event that came from it goes. The {{own}} you added stay, and the calendar stays.',
          defaultValue_other:
            'The {{count}} events that came from it go. The {{own}} you added stay, and the calendar stays.',
        })}
      </p>
    </Modal>
  ) : null;

  // A source being added: an address typed and tested, or a file dropped or chosen and tested.
  if (adding === 'url') {
    const found = test.data;

    return (
      <div className="flex flex-col gap-2.5">
        <Head
          line={t(
            'calendar.ics.urlLine',
            'The address of a published calendar: school, town, Google, Outlook, iCloud.',
          )}
        />
        <div className="flex items-start gap-2">
          <div className="min-w-0 grow">
            <TextField
              label={t('calendar.ics.url', 'URL')}
              isLabelHidden
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
            {test.isPending ? t('calendar.ics.testing', 'Testing') : t('calendar.ics.test', 'Test')}
          </Button>
          <IconButton label={t('common.cancel', 'Cancel')} size="large" onClick={cancel}>
            <AppIcon id="x" size={16} />
          </IconButton>
        </div>
        {test.isPending ? (
          <span className="text-caption text-foreground-subtle">
            {t('calendar.ics.downloading', 'Downloading the calendar to check it…')}
          </span>
        ) : found?.kind === 'ok' ? (
          <Note
            tone="success"
            action={
              <Button
                size="compact"
                isBusy={attach.isPending}
                onClick={() => {
                  attach.mutate({ icsUrl: url.trim() });
                }}
              >
                {t('calendar.ics.connect', 'Connect')}
              </Button>
            }
          >
            <span className="flex flex-col gap-0.5">
              <span>
                {t('calendar.ics.foundEvents', 'Found {{count}} events', {
                  count: found.eventCount,
                })}
              </span>
              <span className="text-caption text-foreground-subtle">{foundLine(found)}</span>
            </span>
          </Note>
        ) : found?.kind === 'error' ? (
          <ErrorCard words={errorWords(found.code, null)} detail={found.detail} />
        ) : null}
        {removeDialog}
      </div>
    );
  }

  if (adding === 'file') {
    const found = upload.data;
    const isTooBig = picked !== null && picked.size > CALENDAR_ICS_MAXIMUM_BYTES;
    const chooser = (
      <FileDrop
        accept=".ics,text/calendar"
        hint={t('calendar.ics.dropFile', 'Drop a .ics file here')}
        overHint={t('calendar.ics.dropToTest', 'Drop it to test it · .ics · up to 5 MB')}
        chosen={picked === null ? null : { name: picked.name, detail: sizeWords(picked.size) }}
        isBusy={upload.isPending}
        onFile={take}
        className="grow"
      />
    );

    return (
      <div className="flex flex-col gap-2.5">
        <Head
          line={t(
            'calendar.ics.fileLine',
            'A .ics file from your computer. It doesn’t update by itself.',
          )}
        />
        <div className="flex items-center gap-2">
          {chooser}
          <IconButton label={t('common.cancel', 'Cancel')} size="large" onClick={cancel}>
            <AppIcon id="x" size={16} />
          </IconButton>
        </div>
        {upload.isPending ? (
          <span className="text-caption text-foreground-subtle">
            {t('calendar.ics.reading', 'Reading the file to check it…')}
          </span>
        ) : isTooBig ? (
          <ErrorCard words={errorWords('too_big', null)} detail={picked.name} />
        ) : found?.kind === 'error' ? (
          <ErrorCard
            words={fileErrorWords(found.code)}
            detail={`${picked?.name ?? ''} · ${found.detail}`}
          />
        ) : found?.kind === 'ok' && found.fileId !== undefined ? (
          <>
            {found.allPast ? (
              <Note
                tone="warning"
                action={
                  <Button
                    variant="ghost"
                    size="compact"
                    isBusy={attach.isPending}
                    onClick={() => {
                      attach.mutate({ icsFileId: found.fileId ?? null });
                    }}
                  >
                    {t('calendar.ics.loadAnyway', 'Load it anyway')}
                  </Button>
                }
              >
                <span className="flex flex-col gap-0.5">
                  <span>
                    {t('calendar.ics.foundAllPast', 'Found {{count}} events, all in the past', {
                      count: found.eventCount,
                    })}
                  </span>
                  <span className="text-caption text-foreground-subtle">
                    {t(
                      'calendar.ics.allPastLine',
                      'Every one ended before today: it looks like an old year’s file.',
                    )}
                  </span>
                </span>
              </Note>
            ) : (
              <Note
                tone="success"
                action={
                  <Button
                    size="compact"
                    isBusy={attach.isPending}
                    onClick={() => {
                      attach.mutate({ icsFileId: found.fileId ?? null });
                    }}
                  >
                    {t('calendar.ics.load', 'Load')}
                  </Button>
                }
              >
                <span className="flex flex-col gap-0.5">
                  <span>
                    {t('calendar.ics.foundEvents', 'Found {{count}} events', {
                      count: found.eventCount,
                    })}
                  </span>
                  <span className="text-caption text-foreground-subtle">{foundLine(found)}</span>
                  {calendar.models.length === 0 ? null : (
                    <span className="text-caption text-foreground-muted">
                      {t(
                        'calendar.ics.matched',
                        '{{matched}} got a model by their name · {{without}} without',
                        {
                          matched: found.matchedModels,
                          without: found.eventCount - found.matchedModels,
                        },
                      )}
                    </span>
                  )}
                </span>
              </Note>
            )}
            {own === 0 ? null : (
              <span className="flex items-center gap-2 text-caption text-foreground-subtle">
                <AppIcon id="info" size={14} className="shrink-0" />
                {t(
                  'calendar.ics.ownStay',
                  'Your {{count}} events in {{calendar}} stay. Delete them if the file takes their place.',
                  { count: own, calendar: calendar.name },
                )}
              </span>
            )}
          </>
        ) : null}
        {removeDialog}
      </div>
    );
  }

  // An address, connected.
  if (calendar.icsUrl !== null) {
    const error = state?.error ?? null;
    const lastAttempt = state?.lastAttemptAt ?? null;

    return (
      <div className="flex flex-col gap-2.5">
        <Head
          line={t(
            'calendar.ics.urlLine',
            'The address of a published calendar: school, town, Google, Outlook, iCloud.',
          )}
        />
        <div className="flex items-center gap-2">
          <SourceBox icon="link">{calendar.icsUrl}</SourceBox>
          {calendar.canEdit ? (
            <Button
              variant="ghost"
              isBusy={refresh.isPending}
              onClick={() => {
                refresh.mutate();
              }}
            >
              {refresh.isPending ? null : <AppIcon id="refresh-cw" size={15} />}
              {refresh.isPending
                ? t('calendar.ics.refreshing', 'Refreshing')
                : t('calendar.ics.refreshNow', 'Refresh now')}
            </Button>
          ) : null}
          {canEdit ? (
            <IconButton
              label={t('calendar.ics.removeUrl', 'Remove the URL')}
              variant="raised"
              onClick={() => {
                setRemoving(true);
              }}
            >
              <AppIcon id="x" size={15} />
            </IconButton>
          ) : null}
        </div>
        {error === null ? (
          <HealthStrip className="lg:grid-flow-row lg:grid-cols-3">
            {refresh.isPending ? (
              <HealthCard
                label={t('calendar.ics.updatingNow', 'Updating now')}
                tone="info"
                value={t('calendar.ics.downloadingWord', 'Downloading')}
                detail={t('calendar.ics.startedNow', 'Started a moment ago')}
              />
            ) : (
              <HealthCard
                label={t('calendar.ics.lastUpdate', 'Last update')}
                tone="success"
                value={state?.lastSuccessAt == null ? '—' : whenText(state.lastSuccessAt)}
                detail={t('calendar.ics.worked', 'Worked')}
              />
            )}
            <HealthCard
              label={t('calendar.ics.eventsFromUrl', 'Events from the URL')}
              tone="neutral"
              value={String(state?.eventCount ?? 0)}
              detail={monthsWords(state?.rangeFrom ?? null, state?.rangeTo ?? null)}
            />
            <HealthCard
              label={t('calendar.ics.nextRead', 'Next')}
              tone="neutral"
              value={lastAttempt === null ? '—' : clockText(lastAttempt.getTime() + 3_600_000)}
              detail={t('calendar.ics.everyHour', 'Every hour, by itself')}
            />
          </HealthStrip>
        ) : (
          <ErrorCard
            words={errorWords(error.code, state?.lastSuccessAt ?? null)}
            detail={`${error.detail}\n${calendar.icsUrl}`}
            actions={
              calendar.canEdit ? (
                <>
                  <Button
                    variant="ghost"
                    size="compact"
                    isBusy={refresh.isPending}
                    onClick={() => {
                      refresh.mutate();
                    }}
                  >
                    <AppIcon id="refresh-cw" size={14} />
                    {t('calendar.ics.tryAgain', 'Try again')}
                  </Button>
                  {canEdit ? (
                    <Button
                      variant="ghost"
                      size="compact"
                      onClick={() => {
                        setUrl(calendar.icsUrl ?? '');
                        setAdding('url');
                      }}
                    >
                      {t('calendar.ics.changeUrl', 'Change the URL')}
                    </Button>
                  ) : null}
                </>
              ) : undefined
            }
          />
        )}
        {error !== null ? null : (
          <Note tone="accent">
            {t(
              'calendar.ics.urlEventsNote',
              'Events from the URL are changed at the source. You can still add your own events to this calendar: they stay when the URL updates.',
            )}
          </Note>
        )}
        {removeDialog}
      </div>
    );
  }

  // A file, loaded.
  if (calendar.icsFile !== null) {
    const file = calendar.icsFile;
    const uploader = people.find((person) => person.id === file.uploadedBy);

    return (
      <div className="flex flex-col gap-2.5">
        <Head
          line={t(
            'calendar.ics.fileLine',
            'A .ics file from your computer. It doesn’t update by itself.',
          )}
        />
        <div className="flex items-center gap-2">
          <SourceBox icon="file-text">
            {file.name}
            <span className="text-foreground-subtle"> · {sizeWords(file.size)}</span>
          </SourceBox>
          {canEdit ? (
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  setAdding('file');
                }}
              >
                <AppIcon id="file" size={15} />
                {t('calendar.ics.replace', 'Replace')}
              </Button>
              <IconButton
                label={t('calendar.ics.removeFile', 'Remove the file')}
                variant="raised"
                onClick={() => {
                  setRemoving(true);
                }}
              >
                <AppIcon id="x" size={15} />
              </IconButton>
            </>
          ) : null}
        </div>
        <HealthStrip className="lg:grid-flow-row lg:grid-cols-3">
          <HealthCard
            label={t('calendar.ics.loaded', 'Loaded')}
            tone="success"
            value={whenText(file.uploadedAt)}
            detail={
              uploader === undefined
                ? t('calendar.ics.eventCount', '{{count}} events', {
                    count: state?.eventCount ?? 0,
                  })
                : t('calendar.ics.loadedBy', 'By {{name}} · {{count}} events', {
                    name: uploader.username,
                    count: state?.eventCount ?? 0,
                  })
            }
          />
          <HealthCard
            label={t('calendar.ics.eventsFromFile', 'Events from the file')}
            tone="neutral"
            value={String(state?.eventCount ?? 0)}
            detail={monthsWords(state?.rangeFrom ?? null, state?.rangeTo ?? null, true)}
          />
          <HealthCard
            label={t('calendar.ics.withModel', 'With a model')}
            tone="neutral"
            value={t('calendar.ics.matchedOf', '{{matched}} of {{count}}', {
              matched: state?.matchedModels ?? 0,
              count: state?.eventCount ?? 0,
            })}
            detail={t('calendar.ics.matchedByTitle', 'Matched by title')}
          />
        </HealthStrip>
        {removeDialog}
      </div>
    );
  }

  // No source.
  return (
    <WellRow
      title={t('calendar.ics.title', 'ICS source')}
      line={t(
        'calendar.ics.none',
        'None: the events are yours. If the town or the school publishes a calendar, add its URL or load its .ics file.',
      )}
    >
      {canEdit ? (
        <span className="flex shrink-0 gap-2">
          <Button
            variant="ghost"
            size="compact"
            onClick={() => {
              setUrl('');
              setAdding('url');
            }}
          >
            <AppIcon id="link" size={14} />
            {t('calendar.ics.addUrl', 'Add a URL')}
          </Button>
          <Button
            variant="ghost"
            size="compact"
            onClick={() => {
              setAdding('file');
            }}
          >
            <AppIcon id="file" size={14} />
            {t('calendar.ics.loadFile', 'Load a file')}
          </Button>
        </span>
      ) : null}
    </WellRow>
  );
}
