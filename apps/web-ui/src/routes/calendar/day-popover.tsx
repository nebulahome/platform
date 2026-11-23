/**
 * A day whose lines did not fit, opened from its "+N more" (CAL-Day-More): the day, whether it is
 * a working day and how many things are on it, a button for a new event on it, and the day's list
 * - the agenda's, drawn narrow.
 */
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { isWorkingDay, type CalendarOccurrence } from '@nebulahome/contracts';
import { AppIcon, cn, IconButton, Popover } from '@nebulahome/ui';

import { dayWords, isOn } from './calendar-time';
import type { DaysOff } from './today-card';
import type { CalendarBook } from './use-calendars';
import { AgendaDay } from './views/agenda-view';

/** What the day's popover needs. */
export type DayPopoverProps = {
  readonly book: CalendarBook;

  /** The day; null while shut. */
  readonly day: string | null;
  readonly occurrences: readonly CalendarOccurrence[];
  readonly daysOff: DaysOff;
  readonly anchor: RefObject<HTMLElement | null>;
  readonly canAdd: boolean;
  readonly onClose: () => void;
  readonly onNewEvent: (day: string) => void;
  readonly onOpen: (occurrence: CalendarOccurrence, anchor: HTMLElement) => void;
  readonly onOpenPickups: (day: string, anchor: HTMLElement) => void;
};

/**
 * Renders a day's popover.
 *
 * @param props - See {@link DayPopoverProps}.
 * @returns The popover.
 */
export function DayPopover(props: DayPopoverProps) {
  const { t } = useTranslation();
  const { book, day, occurrences, daysOff, anchor, onClose } = props;
  const count =
    day === null
      ? 0
      : occurrences.filter(
          (occurrence) => occurrence.kind !== 'holiday' && isOn(occurrence, day, book.zone),
        ).length;
  const isWorking =
    day !== null && isWorkingDay(day, book.weekendDays, daysOff.holidays, daysOff.dayOff);

  return (
    <Popover
      anchor={anchor}
      isOpen={day !== null}
      onClose={onClose}
      side="beside"
      width={330}
      label={day === null ? '' : dayWords(day)}
      className="rounded-dialog"
    >
      {day === null ? null : (
        <div className="flex flex-col overflow-y-auto">
          <div className="flex items-center gap-3 pt-3.5 pr-2.5 pb-2.5 pl-4">
            <span
              className={cn(
                'inline-flex size-8.5 shrink-0 items-center justify-center rounded-full font-semibold tabular',
                day === book.today
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-surface-high text-foreground',
              )}
            >
              {Number(day.slice(8))}
            </span>
            <span className="flex min-w-0 grow flex-col gap-px">
              <span className="truncate text-title font-medium first-letter:uppercase">
                {dayWords(day)}
              </span>
              <span
                className={cn(
                  'text-caption',
                  isWorking ? 'text-success' : 'text-foreground-subtle',
                )}
              >
                {t('calendar.day.things', {
                  count,
                  kind: isWorking
                    ? t('calendar.today.workingDay', 'Working day')
                    : t('calendar.today.dayOff', 'Day off'),
                  defaultValue_one: '{{kind}} · {{count}} thing',
                  defaultValue_other: '{{kind}} · {{count}} things',
                })}
              </span>
            </span>
            {props.canAdd ? (
              <IconButton
                label={t('calendar.day.newOn', 'New event on this day')}
                onClick={() => {
                  onClose();
                  props.onNewEvent(day);
                }}
              >
                <AppIcon id="plus" size={16} />
              </IconButton>
            ) : null}
            <IconButton label={t('common.close', 'Close')} onClick={onClose}>
              <AppIcon id="x" size={16} />
            </IconButton>
          </div>
          <div className="border-t border-border">
            <AgendaDay
              book={book}
              day={day}
              occurrences={occurrences}
              daysOff={daysOff}
              onOpen={props.onOpen}
              onOpenPickups={props.onOpenPickups}
              isBare
              isCompact
            />
          </div>
        </div>
      )}
    </Popover>
  );
}
