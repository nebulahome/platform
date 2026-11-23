/**
 * What pressing an occurrence shows, beside it (CAL-Event-Kinds): its calendar, the pencil and
 * the bin when it can be changed, its title and when, and what it is - how it repeats, its notes,
 * its model, who added it; where an event from a source or an entity comes from, and that it is
 * changed there; a holiday's kind and the long weekend it makes. Someone who cannot change it is
 * told who can (CAL-Rights).
 *
 * A day's pickups have their own: the day, and each bin with its pencil.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode, RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import {
  addDays,
  isWorkingDay,
  longWeekendsOf,
  wallOf,
  type CalendarOccurrence,
} from '@nebulahome/contracts';
import { AppIcon, Button, IconButton, Popover, TagChip, cn, toast } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { toMessage } from '@/lib/error-message';
import { signalled } from '@/lib/signalled';
import { ENTITY_PARAM } from '@/routes/library/entity/entity-path';
import { fetchServerSettings, SETTINGS_QUERY_KEYS, updateServerSettings } from '@/settings/api';

import { CALENDAR_QUERY_KEYS, fetchEvent, fetchHolidays } from './api';
import {
  dayWords,
  firstDayOf,
  isOn,
  repeatWords,
  untilWords,
  weekdayWords,
  whenWords,
} from './calendar-time';
import { CalendarMark, ModelToken } from './model-token';
import type { DaysOff } from './today-card';
import { isPickup, lookOf, usePeopleNames, type CalendarBook } from './use-calendars';

/** The popover's width, as the boards draw it. */
const WIDTH = 340;

/**
 * A line of the popover: an icon and what it says.
 *
 * @param props - The icon and the words.
 * @param props.icon - The icon.
 * @param props.children - The words.
 * @returns The line.
 */
function Line(props: {
  readonly icon: 'repeat' | 'text-align-start' | 'user-round' | 'link' | 'info' | 'calendar';
  readonly children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 text-ui-sm text-foreground-muted">
      <AppIcon id={props.icon} size={16} className="mt-0.5 shrink-0 text-foreground-subtle" />
      <span className="min-w-0">{props.children}</span>
    </div>
  );
}

/**
 * A note at the foot: why it cannot be changed here, and where it can.
 *
 * @param props - The icon and the words.
 * @param props.icon - The icon.
 * @param props.children - The words.
 * @returns The note.
 */
function FootNote(props: { readonly icon: 'info' | 'lock'; readonly children: ReactNode }) {
  return (
    <div className="flex gap-2.5 rounded-tile border border-border bg-well px-3 py-2.75 text-caption text-foreground-subtle">
      <AppIcon id={props.icon} size={15} className="mt-px shrink-0" />
      <span>{props.children}</span>
    </div>
  );
}

/** What the popover needs. */
export type EventPopoverProps = {
  readonly book: CalendarBook;

  /** The occurrence shown; null while shut. */
  readonly occurrence: CalendarOccurrence | null;

  /** What it hangs off: the occurrence pressed. */
  readonly anchor: RefObject<HTMLElement | null>;
  readonly daysOff: DaysOff;
  readonly onClose: () => void;
  readonly onEdit: (occurrence: CalendarOccurrence) => void;
  readonly onDelete: (occurrence: CalendarOccurrence) => void;
};

/**
 * Renders what an occurrence is.
 *
 * @param props - See {@link EventPopoverProps}.
 * @returns The popover, or nothing while shut.
 */
export function EventPopover(props: EventPopoverProps) {
  const { t } = useTranslation();
  const { occurrence, anchor, onClose } = props;

  return (
    <Popover
      anchor={anchor}
      isOpen={occurrence !== null}
      onClose={onClose}
      side="beside"
      width={WIDTH}
      label={occurrence?.title ?? t('calendar.popover.event', 'Event')}
      className="rounded-dialog"
    >
      {occurrence === null ? null : <EventDetails {...props} occurrence={occurrence} />}
    </Popover>
  );
}

/**
 * The popover's content.
 *
 * @param props - See {@link EventPopoverProps}, with an occurrence.
 * @returns The content.
 */
function EventDetails(props: EventPopoverProps & { readonly occurrence: CalendarOccurrence }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [, setParams] = useSearchParams();
  const can = useSession((state) => state.can);
  const people = usePeopleNames();
  const { book, occurrence, daysOff, onClose } = props;
  const { zone, now } = book;
  const look = lookOf(occurrence, book);
  const calendar = look.calendar;
  const first = firstDayOf(occurrence, zone);
  const isHoliday = occurrence.kind === 'holiday';
  const isOwn = occurrence.source === 'user';
  const startsAt = occurrence.startsAt === null ? null : Date.parse(occurrence.startsAt);

  const event = useQuery({
    queryKey: [...CALENDAR_QUERY_KEYS.event, occurrence.seriesId ?? occurrence.eventId ?? ''],
    queryFn: signalled(async (signal) =>
      fetchEvent(occurrence.seriesId ?? occurrence.eventId ?? '', signal),
    ),
    enabled:
      occurrence.isRepeating && isOwn && (occurrence.seriesId ?? occurrence.eventId) !== null,
    retry: false,
  });
  const holidays = useQuery({
    queryKey: [...CALENDAR_QUERY_KEYS.holidays, Number(first.slice(0, 4))],
    queryFn: signalled(async (signal) => fetchHolidays(Number(first.slice(0, 4)), signal)),
    enabled: isHoliday,
  });

  // The series' first day, on the house's clock: what its rule counts from.
  const seriesFirst =
    event.data === undefined
      ? undefined
      : event.data.isAllDay || event.data.startsAt === null
        ? (event.data.startsOn ?? undefined)
        : wallOf(Date.parse(event.data.startsAt), zone).day;

  // `holiday:<key>:<date>`: the key is what hiding keeps.
  const holidayKey = isHoliday ? occurrence.key.slice('holiday:'.length, -(first.length + 1)) : '';
  const holiday = holidays.data?.find((each) => each.key === holidayKey && each.date === first);
  const canHide = isHoliday && can('calendar:manage') && can('settings:read');

  const hiding = useMutation({
    /**
     * Adds the holiday to the hidden ones: a working day after all.
     *
     * @returns The settings as they now stand.
     */
    mutationFn: async () => {
      const settings = await fetchServerSettings();
      const hidden = settings.items.find((item) => item.key === 'calendar.hidden_holidays')?.value;

      return updateServerSettings({
        'calendar.hidden_holidays': [
          ...(Array.isArray(hidden) ? hidden.filter((key) => key !== holidayKey) : []),
          holidayKey,
        ],
      });
    },
    /** Shuts the popover, reads the page again and says so. */
    onSuccess: async () => {
      onClose();
      await queryClient.invalidateQueries({ queryKey: CALENDAR_QUERY_KEYS.all });
      await queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEYS.server });
      toast.success({
        title: t('calendar.popover.hidden', '{{name}} hidden', { name: occurrence.title }),
      });
    },
    /**
     * Says why it could not be hidden.
     *
     * @param error - What went wrong.
     */
    onError: (error: unknown) => {
      toast.error({
        title: t('calendar.popover.notHidden', 'The holiday could not be hidden'),
        message: toMessage(error),
      });
    },
  });

  // The long weekend the holiday is part of, if any.
  const weekend = isHoliday
    ? longWeekendsOf(
        addDays(first, -10),
        addDays(first, 10),
        book.weekendDays,
        daysOff.holidays,
      ).longWeekends.find((each) => each.from <= first && each.to >= first)
    : undefined;
  const others = weekend?.holidays
    .filter((each) => each !== first)
    .map((each) => daysOff.names.get(each))
    .filter((name) => name !== undefined && name !== occurrence.title);

  const editors = (calendar?.editorIds ?? [])
    .map((id) => people.get(id))
    .filter((name) => name !== undefined);
  const source =
    calendar?.icsUrl !== null && calendar?.icsUrl !== undefined
      ? (() => {
          try {
            return new URL(calendar.icsUrl.replace(/^webcal:/u, 'https:')).host;
          } catch {
            return calendar.icsUrl;
          }
        })()
      : (calendar?.icsFile?.name ?? null);

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2.5 pt-3 pr-2.5 pl-4.5">
        {calendar === undefined ? null : (
          <CalendarMark
            name={calendar.name}
            color={calendar.color}
            icon={calendar.icon === null ? undefined : book.icons.get(calendar.icon)}
            isPerson={calendar.kind === 'personal'}
            size={22}
          />
        )}
        <span className="min-w-0 grow truncate text-ui-sm text-foreground-muted">
          {calendar?.name}
        </span>
        {!occurrence.canEdit && (occurrence.source === 'ics' || occurrence.source === 'entity') ? (
          <span className="mr-1 inline-flex h-6 items-center gap-1.25 rounded-pill bg-surface-raised px-2.25 text-label whitespace-nowrap text-foreground-muted">
            <AppIcon id="lock" size={11} />
            {t('calendar.popover.readOnly', 'Read only')}
          </span>
        ) : null}
        {occurrence.canEdit ? (
          <>
            <IconButton
              label={t('common.edit', 'Edit')}
              onClick={() => {
                props.onEdit(occurrence);
              }}
            >
              <AppIcon id="pencil" size={16} />
            </IconButton>
            <IconButton
              label={t('common.delete', 'Delete')}
              onClick={() => {
                props.onDelete(occurrence);
              }}
            >
              <AppIcon id="trash-2" size={16} />
            </IconButton>
          </>
        ) : null}
        <IconButton label={t('common.close', 'Close')} onClick={onClose}>
          <AppIcon id="x" size={16} />
        </IconButton>
      </div>

      <div className="flex flex-col gap-3.5 px-4.5 pt-2 pb-4.5">
        <div className="flex flex-col gap-1.5">
          <span className="flex items-center gap-2 text-headline leading-tight font-medium">
            {look.model === undefined || look.icon === undefined ? null : (
              <ModelToken
                icon={look.icon}
                color={look.tokenColor}
                size={24}
                className="bg-transparent shadow-none"
              />
            )}
            {occurrence.title}
          </span>
          <span className="flex flex-wrap items-center gap-2 text-ui-sm text-foreground-muted">
            {whenWords(occurrence, zone)}
            {startsAt !== null && startsAt > now && isOn(occurrence, book.today, zone) ? (
              <span className="inline-flex h-5.5 items-center rounded-pill bg-primary/14 px-2 font-mono text-label text-primary">
                {untilWords(startsAt, now)}
              </span>
            ) : null}
          </span>
        </div>

        {isHoliday ? (
          <div className="flex flex-wrap gap-1.5">
            {holiday === undefined ? null : (
              <span className="inline-flex h-6 items-center gap-1.5 rounded-pill border border-border-strong bg-foreground/4 px-2.5 text-caption font-medium text-tag-red">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
                {holiday.kind === 'national'
                  ? t('calendar.popover.national', 'National')
                  : holiday.kind === 'regional'
                    ? t('calendar.popover.regional', 'Regional')
                    : holiday.kind === 'patron'
                      ? t('calendar.popover.patron', 'Patron saint')
                      : t('calendar.popover.byHand', 'Added by hand')}
              </span>
            )}
            <span className="inline-flex h-6 items-center rounded-pill border border-border-strong bg-foreground/4 px-2.5 text-caption font-medium text-foreground-muted">
              {isWorkingDay(first, book.weekendDays, new Set(), new Set())
                ? t('calendar.popover.dayOff', 'Day off')
                : t('calendar.popover.onWeekend', 'On a weekend')}
            </span>
          </div>
        ) : null}

        {weekend === undefined ? null : (
          <Line icon="calendar">
            {others !== undefined && others.length > 0
              ? t(
                  'calendar.popover.weekendWith',
                  'With {{others}} it makes a {{count}}-day weekend: {{from}} to {{to}}.',
                  {
                    others: others.join(', '),
                    count: weekend.days,
                    from: dayWords(weekend.from, 'weekday'),
                    to: dayWords(weekend.to, 'weekday'),
                  },
                )
              : t(
                  'calendar.popover.weekend',
                  'It makes a {{count}}-day weekend: {{from}} to {{to}}.',
                  {
                    count: weekend.days,
                    from: dayWords(weekend.from, 'weekday'),
                    to: dayWords(weekend.to, 'weekday'),
                  },
                )}
          </Line>
        )}

        {event.data?.repeat === null || event.data?.repeat === undefined ? null : (
          <Line icon="repeat">
            {t('calendar.popover.since', '{{rule}}, since {{day}}', {
              rule: repeatWords(event.data.repeat, seriesFirst ?? first),
              day: dayWords(seriesFirst ?? first, 'date'),
            })}
          </Line>
        )}

        {source === null || occurrence.source !== 'ics' ? null : (
          <Line icon="link">
            {calendar?.icsUrl === null
              ? t('calendar.popover.fromFile', 'From the file {{name}}', { name: source })
              : t('calendar.popover.fromUrl', 'From {{host}} · updated every hour', {
                  host: source,
                })}
          </Line>
        )}

        {occurrence.notes === null || occurrence.notes === '' ? null : (
          <Line icon="text-align-start">{occurrence.notes}</Line>
        )}

        {look.model === undefined ? null : (
          <div className="flex gap-1.5">
            <TagChip
              color={look.model.color}
              icon={
                look.icon === undefined
                  ? undefined
                  : { node: look.icon.node, frame: look.icon.frame }
              }
            >
              {look.model.name}
            </TagChip>
          </div>
        )}

        {occurrence.createdBy === null || !people.has(occurrence.createdBy) ? null : (
          <Line icon="user-round">
            {t('calendar.popover.addedBy', 'Added by {{name}}', {
              name: people.get(occurrence.createdBy),
            })}
          </Line>
        )}

        {occurrence.source === 'ics' ? (
          <FootNote icon="info">
            {t(
              'calendar.popover.fromSource',
              'It comes from another calendar: change it there and it updates here.',
            )}
          </FootNote>
        ) : null}

        {occurrence.source === 'entity' && occurrence.entityId !== null ? (
          <>
            <button
              type="button"
              onClick={() => {
                setParams((params) => {
                  params.set(ENTITY_PARAM, occurrence.entityId ?? '');

                  return params;
                });
              }}
              className="flex cursor-pointer items-center gap-3 rounded-inner border border-border bg-well px-3 py-2.5 text-left hover:bg-surface-raised focus-visible:shadow-focus focus-visible:outline-none"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-field bg-surface-raised text-[var(--lane)]">
                <AppIcon id="calendar-clock" size={18} />
              </span>
              <span className="flex min-w-0 grow flex-col gap-0.5">
                <span className="truncate text-ui font-medium">{occurrence.title}</span>
                <span className="truncate font-mono text-caption text-foreground-subtle">
                  {occurrence.entityId}
                </span>
              </span>
              <AppIcon id="chevron-right" size={15} className="shrink-0 text-foreground-subtle" />
            </button>
            <Line icon="info">
              {t(
                'calendar.popover.movesByItself',
                'It moves by itself when the entity’s value changes.',
              )}
            </Line>
          </>
        ) : null}

        {isOwn && !occurrence.canEdit && calendar !== undefined ? (
          <FootNote icon="lock">
            {editors.length > 0
              ? t(
                  'calendar.popover.onlyEditors',
                  'Only {{names}} can edit {{calendar}}. Ask one of them, or the owner.',
                  {
                    names: editors.join(', '),
                    calendar: calendar.name,
                  },
                )
              : t(
                  'calendar.popover.cannotEdit',
                  'You can’t change {{calendar}}. Ask one of its editors, or the owner.',
                  {
                    calendar: calendar.name,
                  },
                )}
          </FootNote>
        ) : null}
      </div>

      {occurrence.source === 'entity' || canHide ? (
        <div className="flex items-center justify-end gap-2 border-t border-border px-3.5 py-3">
          {occurrence.source === 'entity' ? (
            <Button
              variant="ghost"
              size="compact"
              onClick={() => {
                setParams((params) => {
                  params.set(ENTITY_PARAM, occurrence.entityId ?? '');

                  return params;
                });
              }}
            >
              {t('calendar.popover.openEntity', 'Open the entity')}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="compact"
              isBusy={hiding.isPending}
              onClick={() => {
                hiding.mutate();
              }}
            >
              <AppIcon id="eye-off" size={14} />
              {t('calendar.popover.hideHoliday', 'Hide this holiday')}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** What the pickups' popover needs. */
export type PickupsPopoverProps = {
  readonly book: CalendarBook;

  /** The day whose pickups are shown; null while shut. */
  readonly day: string | null;
  readonly occurrences: readonly CalendarOccurrence[];
  readonly anchor: RefObject<HTMLElement | null>;
  readonly onClose: () => void;
  readonly onEdit: (occurrence: CalendarOccurrence) => void;
};

/**
 * Renders a day's pickups (CAL-Event-Kinds, Waste): the day, when they are collected and when to
 * put them out, and each bin.
 *
 * @param props - See {@link PickupsPopoverProps}.
 * @returns The popover.
 */
export function PickupsPopover(props: PickupsPopoverProps) {
  const { t } = useTranslation();
  const { book, day, occurrences, anchor, onClose } = props;
  const waste = book.calendars.find((calendar) => calendar.kind === 'waste');
  const bins =
    day === null
      ? []
      : occurrences.filter(
          (occurrence) => isPickup(occurrence, book) && isOn(occurrence, day, book.zone),
        );

  return (
    <Popover
      anchor={anchor}
      isOpen={day !== null}
      onClose={onClose}
      side="beside"
      width={WIDTH}
      label={day === null ? '' : dayWords(day)}
      className="rounded-dialog"
    >
      {day === null ? null : (
        <div className="flex flex-col">
          <div className="flex items-center gap-2.5 pt-3 pr-2.5 pl-4.5">
            {waste === undefined ? null : (
              <CalendarMark
                name={waste.name}
                color={waste.color}
                icon={waste.icon === null ? undefined : book.icons.get(waste.icon)}
                isPerson={false}
                size={22}
              />
            )}
            <span className="min-w-0 grow truncate text-ui-sm text-foreground-muted">
              {waste?.name}
            </span>
            <IconButton label={t('common.close', 'Close')} onClick={onClose}>
              <AppIcon id="x" size={16} />
            </IconButton>
          </div>
          <div className="flex flex-col gap-3.5 px-4.5 pt-2 pb-4.5">
            <div className="flex flex-col gap-1.5">
              <span className="text-headline leading-tight font-medium first-letter:uppercase">
                {dayWords(day)}
              </span>
              <span className="text-ui-sm text-foreground-muted">
                {t('calendar.pickups.when', 'collected in the morning · out on {{day}} evening', {
                  day: weekdayWords(addDays(day, -1)),
                })}
              </span>
            </div>
            <div className="flex flex-col rounded-inner border border-border bg-well">
              {bins.map((occurrence, index) => {
                const look = lookOf(occurrence, book);

                return (
                  <div
                    key={occurrence.key}
                    className={cn(
                      'flex items-center gap-3 py-2.5 pr-1.5 pl-3',
                      index > 0 && 'border-t border-border',
                    )}
                  >
                    <ModelToken icon={look.icon} color={look.tokenColor} size={34} />
                    <span className="flex min-w-0 grow flex-col gap-0.5">
                      <span className="truncate text-ui font-medium">{occurrence.title}</span>
                      {occurrence.isRepeating ? (
                        <span className="flex items-center gap-1.25 text-caption text-foreground-subtle">
                          <AppIcon id="repeat" size={12} />
                          {t('calendar.pickups.repeats', 'Repeats')}
                        </span>
                      ) : null}
                    </span>
                    {occurrence.canEdit ? (
                      <IconButton
                        label={t('common.edit', 'Edit')}
                        onClick={() => {
                          props.onEdit(occurrence);
                        }}
                      >
                        <AppIcon id="pencil" size={16} />
                      </IconButton>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </Popover>
  );
}
