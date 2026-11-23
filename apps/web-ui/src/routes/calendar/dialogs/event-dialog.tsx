/**
 * A new event, or a change to one (CAL-Event-New, CAL-Event-Waste): the calendar, its models as
 * chips - a tap fills the title and the icon - the title and icon, all day or times, Repeat and
 * the notes. An event that ends before it starts says so and cannot be saved (CAL-Repeat). A
 * change to a repeating event asks which times it is for (`series-dialog.tsx`).
 *
 * The calendar select lists only the calendars the reader may add to.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  addDays,
  daysBetween,
  wallOf,
  type CalendarEventPatch,
  type CalendarEventWrite,
  type CalendarOccurrence,
  type CalendarRepeat,
} from '@nebulahome/contracts';
import {
  AppIcon,
  Button,
  cn,
  DateField,
  Modal,
  SelectField,
  Switch,
  TextArea,
  TimeField,
  toast,
} from '@nebulahome/ui';

import { ChoiceChips } from '@/components/choice-chips';
import { toMessage } from '@/lib/error-message';
import { signalled } from '@/lib/signalled';
import { clockOf, momentOf, uses12Hours } from '@/library/time-values';
import { NameIconField } from '@/routes/library/name-icon-field';

import { CALENDAR_QUERY_KEYS, createEvent, fetchEvent, updateEvent } from '../api';
import { dayWords, firstDayOf, lastDayOf, repeatWords, timesText } from '../calendar-time';
import { CalendarMark, ModelToken } from '../model-token';
import type { CalendarBook } from '../use-calendars';

import { RepeatFields } from './repeat-fields';
import { SeriesDialog, type SeriesChoice } from './series-dialog';

/** What the dialog opens on: a new event's day and times, or an occurrence to change. */
export type EventSeed =
  | {
      readonly mode: 'new';
      readonly day: string;

      /** Minutes since midnight; all day when left out. */
      readonly start?: number | undefined;
      readonly end?: number | undefined;
      readonly calendarId?: string | undefined;
      readonly title?: string | undefined;
    }
  | { readonly mode: 'edit'; readonly occurrence: CalendarOccurrence };

/** What the dialog keeps while it is filled in. */
type Draft = {
  readonly calendarId: string;
  readonly modelId: string | null;
  readonly title: string;
  readonly icon: string | null;
  readonly isAllDay: boolean;
  readonly startDay: string;
  readonly startClock: string;
  readonly endDay: string;
  readonly endClock: string;
  readonly repeat: CalendarRepeat | null;
  readonly notes: string;
};

/**
 * Writes minutes since midnight as `HH:MM`.
 *
 * @param minutes - The minutes.
 * @returns The clock.
 */
function clockOfMinutes(minutes: number): string {
  return clockOf((((minutes % 1440) + 1440) % 1440) * 60, false);
}

/**
 * The minutes since midnight of a clock.
 *
 * @param clock - `HH:MM`.
 * @returns The minutes.
 */
function minutesOfClock(clock: string): number {
  return Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
}

/**
 * The draft a seed opens on.
 *
 * @param seed - The seed.
 * @param book - The page's book.
 * @param firstCalendar - The calendar a new event goes in when the seed names none.
 * @returns The draft.
 */
function draftOf(seed: EventSeed, book: CalendarBook, firstCalendar: string): Draft {
  if (seed.mode === 'new') {
    const start = seed.start ?? 9 * 60;
    const end = seed.end ?? start + 60;

    return {
      calendarId: seed.calendarId ?? firstCalendar,
      modelId: null,
      title: seed.title ?? '',
      icon: null,
      isAllDay: book.byId.get(seed.calendarId ?? firstCalendar)?.kind === 'waste',
      startDay: seed.day,
      startClock: clockOfMinutes(start),
      endDay: end >= 1440 ? addDays(seed.day, 1) : seed.day,
      endClock: clockOfMinutes(end),
      repeat: null,
      notes: '',
    };
  }

  const { occurrence } = seed;
  const { zone } = book;
  const startWall =
    occurrence.startsAt === null ? null : wallOf(Date.parse(occurrence.startsAt), zone);
  const endWall = occurrence.endsAt === null ? null : wallOf(Date.parse(occurrence.endsAt), zone);

  return {
    calendarId: occurrence.calendarId,
    modelId: occurrence.modelId,
    title: occurrence.title,
    icon: occurrence.icon,
    isAllDay: occurrence.isAllDay,
    startDay: firstDayOf(occurrence, zone),
    startClock: startWall === null ? '09:00' : clockOf(startWall.seconds, false),
    endDay: occurrence.isAllDay
      ? lastDayOf(occurrence, zone)
      : (endWall?.day ?? firstDayOf(occurrence, zone)),
    endClock: endWall === null ? '10:00' : clockOf(endWall.seconds, false),
    repeat: null,
    notes: occurrence.notes ?? '',
  };
}

/** What the dialog needs. */
export type EventDialogProps = {
  readonly book: CalendarBook;
  readonly seed: EventSeed;
  readonly onClose: () => void;
};

/**
 * Renders the event dialog. Mount it only while it is open.
 *
 * @param props - See {@link EventDialogProps}.
 * @returns The dialog.
 */
export function EventDialog(props: EventDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { book, seed, onClose } = props;
  const { zone } = book;
  const writable = book.calendars.filter((calendar) => calendar.canEdit);
  const [draft, setDraft] = useState<Draft>(() => draftOf(seed, book, writable[0]?.id ?? ''));
  const [isAsking, setAsking] = useState(false);
  const occurrence = seed.mode === 'edit' ? seed.occurrence : null;
  const seriesId =
    occurrence?.isRepeating === true ? (occurrence.seriesId ?? occurrence.eventId) : null;

  // A repeating event's rule is not in its occurrences: it is read, and put in the draft once.
  const series = useQuery({
    queryKey: [...CALENDAR_QUERY_KEYS.event, seriesId ?? ''],
    queryFn: signalled(async (signal) => fetchEvent(seriesId ?? '', signal)),
    enabled: seriesId !== null,
    retry: false,
  });
  const [hasRule, setHasRule] = useState(false);

  if (!hasRule && series.data !== undefined) {
    setHasRule(true);
    setDraft((current) => ({ ...current, repeat: series.data.repeat }));
  }

  const calendar = book.byId.get(draft.calendarId);
  const model = draft.modelId === null ? undefined : book.models.get(draft.modelId);

  /**
   * Changes part of the draft.
   *
   * @param changes - What changes.
   */
  const change = (changes: Partial<Draft>): void => {
    setDraft((current) => ({ ...current, ...changes }));
  };

  const startsAt = momentOf(draft.startDay, minutesOfClock(draft.startClock) * 60, zone);
  const endsAt = momentOf(draft.endDay, minutesOfClock(draft.endClock) * 60, zone);
  const endsTooSoon = draft.isAllDay
    ? draft.endDay < draft.startDay
    : Date.parse(endsAt) < Date.parse(startsAt);
  const isWaiting = seriesId !== null && !hasRule;
  const canSave =
    draft.title.trim() !== '' &&
    draft.calendarId !== '' &&
    !endsTooSoon &&
    !isWaiting &&
    series.error === null;

  /** The event's fields, as the API takes them. */
  // What one time of a series takes: everything but the rule, which is the series'.
  const once = {
    calendarId: draft.calendarId,
    modelId: draft.modelId,
    title: draft.title.trim(),
    icon: draft.icon,
    notes: draft.notes.trim() === '' ? null : draft.notes,
    isAllDay: draft.isAllDay,
    startsOn: draft.isAllDay ? draft.startDay : null,
    endsOn: draft.isAllDay ? draft.endDay : null,
    startsAt: draft.isAllDay ? null : startsAt,
    endsAt: draft.isAllDay ? null : endsAt,
  };
  const fields: CalendarEventWrite = { ...once, repeat: draft.repeat };

  const save = useMutation({
    /**
     * Makes the event, or changes it: this time alone, or the whole series from its first day.
     *
     * @param choice - Which times, for a repeating event.
     * @returns The event as kept.
     */
    mutationFn: async (choice: SeriesChoice | null) => {
      if (occurrence === null) {
        return createEvent(fields);
      }

      const eventId = occurrence.eventId ?? '';

      if (seriesId === null || series.data === undefined) {
        return updateEvent(eventId, fields);
      }

      if (choice === 'one') {
        return updateEvent(seriesId, once, {
          scope: 'one',
          occurrenceOn: occurrence.occurrenceOn ?? draft.startDay,
        });
      }

      // The whole series keeps its first day and takes the new times and length.
      const first = series.data.isAllDay
        ? (series.data.startsOn ?? draft.startDay)
        : wallOf(Date.parse(series.data.startsAt ?? startsAt), zone).day;
      const lengthDays = daysBetween(draft.startDay, draft.endDay);
      const patch: CalendarEventPatch = {
        ...fields,
        startsOn: draft.isAllDay ? first : null,
        endsOn: draft.isAllDay ? addDays(first, lengthDays) : null,
        startsAt: draft.isAllDay
          ? null
          : momentOf(first, minutesOfClock(draft.startClock) * 60, zone),
        endsAt: draft.isAllDay
          ? null
          : momentOf(addDays(first, lengthDays), minutesOfClock(draft.endClock) * 60, zone),
      };

      return updateEvent(seriesId, patch, { scope: 'all' });
    },
    /** Reads the page again, says so, and shuts. */
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: CALENDAR_QUERY_KEYS.all });
      toast.success({
        title: t('calendar.dialog.saved', '{{title}} saved', { title: draft.title.trim() }),
      });
      onClose();
    },
    /**
     * Says why it could not be saved.
     *
     * @param error - What went wrong.
     */
    onError: (error: unknown) => {
      setAsking(false);
      toast.error({
        title: t('calendar.dialog.notSaved', 'The event could not be saved'),
        message: toMessage(error),
      });
    },
  });

  if (isAsking && occurrence !== null) {
    const rule = series.data?.repeat ?? null;
    const first = occurrence.occurrenceOn ?? draft.startDay;

    return (
      <SeriesDialog
        purpose="change"
        title={draft.title.trim()}
        rule={rule === null ? null : repeatWords(rule, first)}
        onlyNote={t('calendar.dialog.onlyNote', '{{when}}. The others stay as they are.', {
          when: draft.isAllDay
            ? dayWords(first)
            : `${dayWords(first)}, ${timesText({ ...occurrence, startsAt, endsAt }, zone)}`,
        })}
        allNote={t('calendar.dialog.allNote', 'Every time it repeats.')}
        isBusy={save.isPending}
        onCancel={() => {
          setAsking(false);
        }}
        onConfirm={(choice) => {
          save.mutate(choice);
        }}
      />
    );
  }

  return (
    <Modal
      isOpen
      size="form"
      layout="card"
      closesOnBackdrop={false}
      onClose={onClose}
      lead={
        <span className="flex size-11 shrink-0 items-center justify-center rounded-tile border border-border-strong bg-surface-raised text-primary">
          <AppIcon id={occurrence === null ? 'calendar-plus' : 'pencil'} size={20} />
        </span>
      }
      title={
        occurrence === null
          ? t('calendar.dialog.newEvent', 'New event')
          : t('calendar.dialog.editEvent', 'Edit event')
      }
      description={
        calendar?.kind === 'waste'
          ? `${calendar.name} · ${dayWords(draft.startDay)}`
          : dayWords(draft.startDay)
      }
      footer={
        <>
          <Button variant="ghost" disabled={save.isPending} onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            isBusy={save.isPending}
            disabled={!canSave}
            onClick={() => {
              if (seriesId !== null) {
                setAsking(true);
              } else {
                save.mutate(null);
              }
            }}
          >
            {t('common.save', 'Save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4.5">
        <SelectField
          label={t('calendar.dialog.calendar', 'Calendar')}
          value={draft.calendarId}
          disabled={occurrence !== null && seriesId !== null}
          onChange={(calendarId) => {
            // A pickup has no time: the Waste calendar starts all day.
            change({
              calendarId,
              modelId: null,
              ...(book.byId.get(calendarId)?.kind === 'waste' ? { isAllDay: true } : {}),
            });
          }}
          options={writable.map((each) => ({
            value: each.id,
            label: each.name,
            leading: (
              <CalendarMark
                name={each.name}
                color={each.color}
                icon={each.icon === null ? undefined : book.icons.get(each.icon)}
                isPerson={each.kind === 'personal'}
              />
            ),
          }))}
        />

        {calendar === undefined || calendar.models.length === 0 ? null : (
          <div className="flex flex-col gap-2">
            <span className="text-caption font-medium text-foreground-muted">
              {t('calendar.dialog.model', 'Model')}
            </span>
            <ChoiceChips
              label={t('calendar.dialog.model', 'Model')}
              isSingle
              value={draft.modelId === null ? [] : [draft.modelId]}
              onChange={([modelId]) => {
                const picked = modelId === undefined ? undefined : book.models.get(modelId);
                const previous = model?.name ?? '';

                change({
                  modelId: picked?.id ?? null,
                  // A model fills the title and the icon, unless they were typed.
                  ...(draft.title === '' || draft.title === previous
                    ? { title: picked?.name ?? '' }
                    : {}),
                  ...(draft.icon === null || draft.icon === model?.icon
                    ? { icon: picked?.icon ?? null }
                    : {}),
                });
              }}
              options={calendar.models.map((each) => ({
                value: each.id,
                label: each.name,
                leading: (
                  <ModelToken icon={book.icons.get(each.icon)} color={each.color} size={24} />
                ),
              }))}
            />
          </div>
        )}

        <NameIconField
          label={t('calendar.dialog.title', 'Title')}
          placeholder={t('calendar.dialog.title', 'Title')}
          required
          value={draft.title}
          onChange={(title) => {
            change({ title });
          }}
          icon={draft.icon}
          fallback="calendar"
          onIconChange={(view) => {
            change({ icon: view.id });
          }}
        />

        <div className="flex items-center gap-4 rounded-inner border border-border bg-well px-4 py-3.25">
          <span className="flex min-w-0 grow flex-col gap-0.75">
            <span className="text-ui">{t('calendar.dialog.allDay', 'All day')}</span>
            {calendar?.kind === 'waste' ? (
              <span className="text-caption text-foreground-subtle">
                {t(
                  'calendar.dialog.pickupsNoTime',
                  'Pickups have no time: they show as tokens on the day.',
                )}
              </span>
            ) : null}
          </span>
          <Switch
            label={t('calendar.dialog.allDay', 'All day')}
            isOn={draft.isAllDay}
            onChange={(isAllDay) => {
              change({ isAllDay, ...(isAllDay ? {} : { endDay: draft.startDay }) });
            }}
          />
        </div>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <div className="flex gap-2 [&>*:first-child]:min-w-0 [&>*:first-child]:grow">
            <DateField
              label={t('calendar.dialog.starts', 'Starts')}
              value={draft.startDay}
              onChange={(startDay) => {
                // The end keeps its distance from the start.
                change({
                  startDay,
                  endDay: addDays(startDay, Math.max(0, daysBetween(draft.startDay, draft.endDay))),
                });
              }}
            />
            {draft.isAllDay ? null : (
              <TimeField
                label={t('calendar.dialog.startTime', 'Start time')}
                isLabelHidden
                className={cn('mt-6.5 shrink-0 self-start', uses12Hours() ? 'w-30' : 'w-26')}
                value={draft.startClock}
                onChange={(startClock) => {
                  const length = minutesOfClock(draft.endClock) - minutesOfClock(draft.startClock);
                  const end = minutesOfClock(startClock) + Math.max(0, length);

                  change({ startClock, endClock: clockOfMinutes(Math.min(end, 1439)) });
                }}
              />
            )}
          </div>
          <div className="flex gap-2 [&>*:first-child]:min-w-0 [&>*:first-child]:grow">
            <DateField
              label={t('calendar.dialog.ends', 'Ends')}
              value={draft.endDay}
              error={
                endsTooSoon
                  ? t(
                      'calendar.dialog.endsBefore',
                      'It ends before it starts. Save stays off until it’s fixed.',
                    )
                  : undefined
              }
              onChange={(endDay) => {
                change({ endDay });
              }}
            />
            {draft.isAllDay ? null : (
              <TimeField
                label={t('calendar.dialog.endTime', 'End time')}
                isLabelHidden
                className={cn('mt-6.5 shrink-0 self-start', uses12Hours() ? 'w-30' : 'w-26')}
                value={draft.endClock}
                error={endsTooSoon ? '' : undefined}
                onChange={(endClock) => {
                  change({ endClock });
                }}
              />
            )}
          </div>
        </div>

        {isWaiting ? (
          <span className="text-caption text-foreground-subtle">
            {t('common.loading', 'Loading…')}
          </span>
        ) : series.error === null ? (
          <RepeatFields
            start={draft.startDay}
            value={draft.repeat}
            onChange={(repeat) => {
              change({ repeat });
            }}
          />
        ) : (
          <span role="alert" className="text-caption text-danger">
            {t('calendar.dialog.ruleUnread', 'How it repeats could not be read: {{reason}}', {
              reason: toMessage(series.error),
            })}
          </span>
        )}

        <TextArea
          label={t('calendar.dialog.notes', 'Notes')}
          placeholder={t('calendar.dialog.notes', 'Notes')}
          rows={3}
          value={draft.notes}
          onChange={(event) => {
            change({ notes: event.target.value });
          }}
        />
      </div>
    </Modal>
  );
}
