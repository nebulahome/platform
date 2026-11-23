/**
 * Deleting an event, with Undo (CAL-Rights, D9): a one-off event goes at once and the toast offers
 * it back; a repeating one asks first - this time alone, or this and every one after it, the past
 * ones staying - and its toast offers that back too. Undo is the inverse request, sent from the
 * browser: the event made again, or its rule given back its old end.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  addDays,
  wallOf,
  type CalendarEvent,
  type CalendarEventWrite,
  type CalendarOccurrence,
} from '@nebulahome/contracts';
import { toast } from '@nebulahome/ui';

import { toMessage } from '@/lib/error-message';
import { signalled } from '@/lib/signalled';

import { CALENDAR_QUERY_KEYS, createEvent, deleteEvent, fetchEvent, updateEvent } from './api';
import { dayWords, firstDayOf } from './calendar-time';
import type { SeriesChoice } from './dialogs/series-dialog';
import type { CalendarBook } from './use-calendars';

/**
 * An occurrence as an event of its own: what "only this one" is made again as.
 *
 * @param occurrence - The occurrence.
 * @returns What making it again takes.
 */
function eventOf(occurrence: CalendarOccurrence): CalendarEventWrite {
  return {
    calendarId: occurrence.calendarId,
    modelId: occurrence.modelId,
    title: occurrence.title,
    icon: occurrence.icon,
    notes: occurrence.notes,
    isAllDay: occurrence.isAllDay,
    startsOn: occurrence.startsOn,
    endsOn: occurrence.endsOn,
    startsAt: occurrence.startsAt,
    endsAt: occurrence.endsAt,
    repeat: null,
  };
}

/**
 * A kept event, as what making it again takes.
 *
 * @param event - The event.
 * @returns Its fields.
 */
function writeOf(event: CalendarEvent): CalendarEventWrite {
  return {
    calendarId: event.calendarId,
    modelId: event.modelId,
    title: event.title,
    icon: event.icon,
    notes: event.notes,
    isAllDay: event.isAllDay,
    startsOn: event.startsOn,
    endsOn: event.endsOn,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    repeat: event.repeat,
  };
}

/** What deleting needs of the page, and what it hands back to draw. */
export type EventDeletion = {
  /** The repeating occurrence waiting for its answer; null when nothing asks. */
  readonly pending: CalendarOccurrence | null;

  /** Its series, once read: its rule. */
  readonly series: CalendarEvent | undefined;
  readonly isBusy: boolean;

  /** Deletes an occurrence, or asks which times first when it repeats. */
  readonly start: (occurrence: CalendarOccurrence) => void;

  /** Deletes the times chosen. */
  readonly confirm: (choice: SeriesChoice) => void;
  readonly cancel: () => void;
};

/**
 * Deletes events, with Undo.
 *
 * @param book - The page's book.
 * @returns See {@link EventDeletion}.
 */
export function useDeleteEvent(book: CalendarBook): EventDeletion {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<CalendarOccurrence | null>(null);
  const seriesId = pending === null ? null : (pending.seriesId ?? pending.eventId);
  const series = useQuery({
    queryKey: [...CALENDAR_QUERY_KEYS.event, seriesId ?? ''],
    queryFn: signalled(async (signal) => fetchEvent(seriesId ?? '', signal)),
    enabled: seriesId !== null,
    retry: false,
  });

  /** Reads the page again. */
  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: CALENDAR_QUERY_KEYS.all });
  };

  const removing = useMutation({
    /**
     * Deletes the times chosen, and works out how to give them back.
     *
     * @param input - The occurrence and the times.
     * @param input.occurrence - The occurrence.
     * @param input.choice - Which times; null for a one-off event.
     * @returns What Undo sends.
     */
    mutationFn: async (input: {
      occurrence: CalendarOccurrence;
      choice: SeriesChoice | null;
    }): Promise<() => Promise<unknown>> => {
      const { occurrence, choice } = input;
      const eventId = occurrence.eventId ?? '';

      if (choice === null) {
        await deleteEvent(eventId);

        return async () => createEvent(eventOf(occurrence));
      }

      const id = occurrence.seriesId ?? eventId;
      const day = occurrence.occurrenceOn ?? firstDayOf(occurrence, book.zone);

      const kept = series.data ?? (await fetchEvent(id));

      if (choice === 'one') {
        await deleteEvent(id, { scope: 'one', occurrenceOn: day });

        // The series' deleted days as they were: the time is one of the series again.
        return async () => updateEvent(id, { skippedOn: kept.skippedOn });
      }

      const first = kept.isAllDay
        ? (kept.startsOn ?? day)
        : wallOf(Date.parse(kept.startsAt ?? ''), book.zone).day;

      if (kept.repeat === null || day <= first) {
        await deleteEvent(id);

        return async () => createEvent(writeOf(kept));
      }

      await updateEvent(id, {
        repeat: { ...kept.repeat, ends: { kind: 'on', day: addDays(day, -1) } },
      });

      return async () => updateEvent(id, { repeat: kept.repeat });
    },
    /**
     * Reads the page again, and offers the times back.
     *
     * @param undo - What gives them back.
     * @param input - What was deleted.
     * @param input.occurrence - The occurrence.
     */
    onSuccess: async (undo, { occurrence }) => {
      setPending(null);
      await refresh();
      toast.success({
        title: t('calendar.delete.deleted', '{{title}} deleted', { title: occurrence.title }),
        message: [
          book.byId.get(occurrence.calendarId)?.name,
          dayWords(occurrence.occurrenceOn ?? firstDayOf(occurrence, book.zone)),
        ]
          .filter((part) => part !== undefined)
          .join(' · '),
        action: {
          label: t('calendar.delete.undo', 'Undo'),
          /** Sends the inverse request, and reads the page again. */
          onSelect: () => {
            void undo()
              .then(refresh)
              .catch((error: unknown) => {
                toast.error({
                  title: t('calendar.delete.notUndone', 'It could not be put back'),
                  message: toMessage(error),
                });
              });
          },
        },
      });
    },
    /**
     * Says why it could not be deleted.
     *
     * @param error - What went wrong.
     */
    onError: (error: unknown) => {
      toast.error({
        title: t('calendar.delete.notDeleted', 'The event could not be deleted'),
        message: toMessage(error),
      });
    },
  });

  return {
    pending,
    series: series.data,
    isBusy: removing.isPending,
    /**
     * Deletes a one-off event; asks first for a repeating one.
     *
     * @param occurrence - The occurrence.
     */
    start: (occurrence) => {
      if (occurrence.isRepeating) {
        setPending(occurrence);
      } else {
        removing.mutate({ occurrence, choice: null });
      }
    },
    /**
     * Deletes the times chosen.
     *
     * @param choice - Which times.
     */
    confirm: (choice) => {
      if (pending !== null) {
        removing.mutate({ occurrence: pending, choice });
      }
    },
    /** Asks no more. */
    cancel: () => {
      setPending(null);
    },
  };
}
