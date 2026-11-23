/**
 * The week (CAL-Week): seven days, Monday first, on the house's clock. Over the hours, the all-day
 * lane - bars for what runs over days, chips, the pickups - and in the hours each timed event as a
 * block, side by side where they overlap. Night is shaded from the sun's own times where the house
 * is, with a dashed line at sunrise and sunset; a line marks now.
 *
 * The pointer does the rest: dragging on an empty hour draws a new event and asks its title
 * beside it (`QuickAdd`), dragging a block moves it, dragging its foot moves its end. A block that
 * cannot be changed - from a source, from an entity, of a calendar the reader does not edit - turns
 * red and says why, and goes back where it was. Escape drops any drag.
 */
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { useTranslation } from 'react-i18next';

import {
  addDays,
  DAYS_OF_WEEK,
  sunTimes,
  weekdayOf,
  type CalendarOccurrence,
} from '@nebulahome/contracts';
import {
  AppIcon,
  Button,
  CatalogueIcon,
  cn,
  Popover,
  SelectField,
  TextField,
} from '@nebulahome/ui';

import { clockOf, formatClock, momentOf } from '@/library/time-values';

import {
  clockText,
  dayWords,
  firstDayOf,
  isOn,
  lastDayOf,
  lengthInDays,
  minutesOf,
  rangeOf,
  timesText,
  weekdayWords,
} from '../calendar-time';
import { EventBar, EventChip, SourceMark } from '../event-chip';
import { CalendarMark, LANE_CLASSES, ModelToken } from '../model-token';
import type { DaysOff } from '../today-card';
import { isPickup, lookOf, type CalendarBook } from '../use-calendars';

/** An hour's height, in pixels. */
const HOUR = 44;

/** The step a drag snaps to, in minutes. */
const SNAP = 15;

/** How far the pointer moves before a press becomes a drag, in pixels. */
const THRESHOLD = 4;

/** The hour the grid opens scrolled to. */
const FIRST_HOUR = 7;

/** A day's minutes. */
const DAY_MINUTES = 24 * 60;

/** A new event drawn, or an event being moved: its day in the week and its minutes. */
export type WeekSlot = {
  readonly dayIndex: number;
  readonly start: number;
  readonly end: number;
};

/** What a drag is doing. */
type Drag = {
  readonly kind: 'create' | 'move' | 'resize';
  readonly occurrence: CalendarOccurrence | null;
  readonly from: {
    readonly x: number;
    readonly y: number;
    readonly dayIndex: number;
    readonly minute: number;
  };
  readonly origin: WeekSlot;
  readonly slot: WeekSlot;
  readonly hasMoved: boolean;
};

/** What the week needs. */
export type WeekViewProps = {
  readonly book: CalendarBook;
  readonly day: string;
  readonly occurrences: readonly CalendarOccurrence[];
  readonly daysOff: DaysOff;
  readonly canAdd: boolean;
  readonly onOpen: (occurrence: CalendarOccurrence, anchor: HTMLElement) => void;
  readonly onOpenPickups: (day: string, anchor: HTMLElement) => void;

  /** Called with a new event drawn: its day and minutes. */
  readonly onDrawn: (day: string, start: number, end: number) => void;

  /** Called with an event moved or stretched: its new start and end. */
  readonly onMoved: (occurrence: CalendarOccurrence, startsAt: string, endsAt: string) => void;

  /** The new event being titled, drawn as a dashed block until it is saved or dropped. */
  readonly drawn: { readonly day: string; readonly start: number; readonly end: number } | null;

  /** The dashed block, for the title's popover to sit beside. */
  readonly ghostRef: RefObject<HTMLDivElement | null>;
};

/**
 * Snaps minutes to the drag's step.
 *
 * @param minutes - The minutes.
 * @returns The nearest step, inside the day.
 */
function snap(minutes: number): number {
  return Math.max(0, Math.min(DAY_MINUTES, Math.round(minutes / SNAP) * SNAP));
}

/**
 * Writes minutes since midnight as a time.
 *
 * @param minutes - The minutes.
 * @returns "15:00", "3:00 PM".
 */
function minuteText(minutes: number): string {
  return formatClock(clockOf((minutes % DAY_MINUTES) * 60, false));
}

/** A block laid out: which of the overlapping columns it takes, and how many there are. */
type Placed = {
  readonly occurrence: CalendarOccurrence;
  readonly start: number;
  readonly end: number;
  readonly column: number;
  readonly columns: number;
};

/**
 * Lays a day's timed events out side by side where they overlap.
 *
 * @param timed - The day's timed occurrences, earliest first.
 * @param day - The day.
 * @param zone - The house's zone.
 * @returns The blocks.
 */
function placeDay(timed: readonly CalendarOccurrence[], day: string, zone: string): Placed[] {
  const spans = timed.map((occurrence) => ({
    occurrence,
    start: firstDayOf(occurrence, zone) < day ? 0 : minutesOf(occurrence.startsAt ?? '', zone),
    end:
      lastDayOf(occurrence, zone) > day
        ? DAY_MINUTES
        : Math.max(
            minutesOf(occurrence.startsAt ?? '', zone) + SNAP,
            minutesOf(occurrence.endsAt ?? '', zone) || DAY_MINUTES,
          ),
  }));
  const columns: number[] = [];

  for (const [index, span] of spans.entries()) {
    let column = 0;

    while (
      spans
        .slice(0, index)
        .some(
          (other, at) =>
            columns[at] === column && !(span.end <= other.start || span.start >= other.end),
        )
    ) {
      column += 1;
    }

    columns.push(column);
  }

  return spans.map((span, index) => {
    const overlapping = spans
      .map((other, at) => ({ other, at }))
      .filter(({ other }) => !(other.end <= span.start || other.start >= span.end));

    return {
      ...span,
      column: columns[index] ?? 0,
      columns: Math.max(...overlapping.map(({ at }) => (columns[at] ?? 0) + 1)),
    };
  });
}

/**
 * Renders the week.
 *
 * @param props - See {@link WeekViewProps}.
 * @returns The grid.
 */
export function WeekView(props: WeekViewProps) {
  const { t } = useTranslation();
  const { book, day, occurrences, daysOff, canAdd, drawn, ghostRef, onOpen, onOpenPickups } = props;
  const { zone, today, now } = book;
  const days = Array.from({ length: 7 }, (unused, index) =>
    addDays(rangeOf('week', day).from, index),
  );
  const scroller = useRef<HTMLDivElement>(null);
  const columnsBox = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  // The hours open at seven in the morning, once.
  useEffect(() => {
    if (scroller.current !== null) {
      scroller.current.scrollTop = FIRST_HOUR * HOUR;
    }
  }, []);

  // Escape drops a drag where it started.
  useEffect(() => {
    if (drag === null) {
      return undefined;
    }

    /**
     * Drops the drag.
     *
     * @param event - The key press.
     */
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setDrag(null);
      }
    };

    globalThis.document.addEventListener('keydown', onKey);

    return () => {
      globalThis.document.removeEventListener('keydown', onKey);
    };
  }, [drag]);

  /**
   * Whether a day is a weekend day of the house.
   *
   * @param each - The day.
   * @returns True on a weekend.
   */
  const isWeekend = (each: string): boolean =>
    book.weekendDays.includes(DAYS_OF_WEEK.indexOf(weekdayOf(each)));
  const visible = occurrences.filter((occurrence) => occurrence.kind !== 'holiday');
  const spans = visible.filter(
    (occurrence) =>
      occurrence.isAllDay && !isPickup(occurrence, book) && lengthInDays(occurrence, zone) > 1,
  );

  /**
   * Where the pointer is in the hours: the day under it and the minute.
   *
   * @param event - The pointer.
   * @param event.clientX - Where it is across.
   * @param event.clientY - Where it is down.
   * @returns Its day's index and minute, unsnapped.
   */
  const pointAt = (event: {
    clientX: number;
    clientY: number;
  }): { dayIndex: number; minute: number } => {
    const box = columnsBox.current?.getBoundingClientRect();

    if (box === undefined) {
      return { dayIndex: 0, minute: 0 };
    }

    return {
      dayIndex: Math.max(0, Math.min(6, Math.floor(((event.clientX - box.left) / box.width) * 7))),
      minute: ((event.clientY - box.top) / HOUR) * 60,
    };
  };

  /**
   * Starts a drag: drawing a new event, moving a block or moving its end.
   *
   * @param event - The press.
   * @param kind - What the drag does.
   * @param placed - The block pressed, for a move or a stretch.
   */
  const begin = (
    event: ReactPointerEvent<HTMLElement>,
    kind: Drag['kind'],
    placed: Placed | null,
  ): void => {
    if (event.button !== 0) {
      return;
    }

    event.stopPropagation();
    columnsBox.current?.setPointerCapture(event.pointerId);

    const point = pointAt(event);
    const minute = snap(point.minute - (kind === 'create' ? SNAP / 2 : 0));
    const origin =
      placed === null
        ? { dayIndex: point.dayIndex, start: minute, end: Math.min(DAY_MINUTES, minute + 60) }
        : { dayIndex: point.dayIndex, start: placed.start, end: placed.end };

    setDrag({
      kind,
      occurrence: placed?.occurrence ?? null,
      from: { x: event.clientX, y: event.clientY, dayIndex: point.dayIndex, minute: point.minute },
      origin,
      slot: origin,
      hasMoved: false,
    });
  };

  /**
   * Follows the pointer.
   *
   * @param event - The move.
   */
  const follow = (event: ReactPointerEvent<HTMLElement>): void => {
    if (drag === null) {
      return;
    }

    const hasMoved =
      drag.hasMoved ||
      Math.hypot(event.clientX - drag.from.x, event.clientY - drag.from.y) >= THRESHOLD;

    if (!hasMoved) {
      return;
    }

    const point = pointAt(event);
    const { origin } = drag;
    let slot: WeekSlot;

    if (drag.kind === 'create') {
      const at = snap(point.minute);
      const anchor = snap(drag.from.minute - SNAP / 2);

      slot = {
        dayIndex: origin.dayIndex,
        start: Math.min(anchor, at),
        end: Math.max(Math.min(anchor, at) + SNAP, Math.max(anchor, at)),
      };
    } else if (drag.kind === 'resize') {
      slot = { ...origin, end: Math.max(origin.start + SNAP, snap(point.minute)) };
    } else {
      const shift = snap(point.minute - drag.from.minute);
      const length = origin.end - origin.start;
      const start = Math.max(0, Math.min(DAY_MINUTES - length, origin.start + shift));

      slot = { dayIndex: point.dayIndex, start, end: start + length };
    }

    // Near the edge of the hours, they scroll under the pointer.
    const box = scroller.current?.getBoundingClientRect();

    if (box !== undefined && scroller.current !== null) {
      if (event.clientY < box.top + 40) {
        scroller.current.scrollTop -= 14;
      } else if (event.clientY > box.bottom - 40) {
        scroller.current.scrollTop += 14;
      }
    }

    setDrag({ ...drag, slot, hasMoved: true });
  };

  /**
   * Ends a drag: a press opens the event, a drawn slot asks its title, a moved block is saved.
   *
   * @param event - The release.
   */
  const end = (event: ReactPointerEvent<HTMLElement>): void => {
    if (drag === null) {
      return;
    }

    const { kind, occurrence, slot, hasMoved } = drag;
    const target =
      event.target instanceof HTMLElement
        ? event.target.closest<HTMLElement>('[data-block]')
        : null;

    setDrag(null);

    // A press without a drag draws the hour under it.
    if (kind === 'create') {
      props.onDrawn(days[slot.dayIndex] ?? '', slot.start, slot.end);

      return;
    }

    if (occurrence === null) {
      return;
    }

    if (!hasMoved) {
      if (target !== null) {
        onOpen(occurrence, target);
      }

      return;
    }

    if (!occurrence.canEdit) {
      return;
    }

    const day = days[slot.dayIndex] ?? '';

    props.onMoved(
      occurrence,
      momentOf(day, slot.start * 60, zone),
      slot.end >= DAY_MINUTES
        ? momentOf(addDays(day, 1), 0, zone)
        : momentOf(day, slot.end * 60, zone),
    );
  };

  const nowMinute = minutesOf(new Date(now).toISOString(), zone);
  const todayIndex = days.indexOf(today);
  const sunDays = days.map((each) => {
    if (book.position === null) {
      return null;
    }

    const sun = sunTimes(new Date(Date.parse(`${each}T12:00:00Z`)), book.position);

    return {
      rise: sun.sunrise === null ? null : minutesOf(sun.sunrise.toISOString(), zone),
      set: sun.sunset === null ? null : minutesOf(sun.sunset.toISOString(), zone),
    };
  });
  const sun = sunDays[Math.max(0, todayIndex)] ?? null;

  return (
    <section
      aria-label={t('calendar.views.week', 'Week')}
      className="flex min-w-0 grow flex-col overflow-hidden rounded-panel border border-border bg-surface"
    >
      <div className="grid grid-cols-[58px_repeat(7,minmax(0,1fr))] border-b border-border">
        <span />
        {days.map((each) => {
          const isToday = each === today;
          const holiday = daysOff.names.get(each);
          const isOff = holiday !== undefined || isWeekend(each);

          return (
            <div
              key={each}
              className="flex min-w-0 flex-col gap-0.75 border-l border-border px-2.5 pt-2.5 pb-2.25"
            >
              <span
                className={cn(
                  'font-mono text-label uppercase',
                  isToday
                    ? 'text-primary'
                    : isOff
                      ? 'text-foreground-disabled'
                      : 'text-foreground-subtle',
                )}
              >
                {weekdayWords(each, 'short')}
              </span>
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className={cn(
                    'inline-flex h-8 items-center justify-center text-headline-sm tabular',
                    isToday
                      ? 'w-8 rounded-full bg-primary font-semibold text-primary-foreground'
                      : holiday === undefined
                        ? isOff
                          ? 'text-foreground-muted'
                          : 'text-foreground'
                        : 'text-tag-red',
                  )}
                >
                  {Number(each.slice(8))}
                </span>
                {holiday === undefined ? null : (
                  <span className="min-w-0 truncate text-label text-tag-red">{holiday}</span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      <div className="relative grid grid-cols-[58px_repeat(7,minmax(0,1fr))] gap-y-1.25 border-b border-border py-2">
        <span className="row-span-2 pt-1 pl-2.5 font-mono text-label leading-tight text-foreground-disabled uppercase">
          {t('calendar.week.allDay', 'All day')}
        </span>
        {spans.map((occurrence) => {
          const start = firstDayOf(occurrence, zone);
          const last = lastDayOf(occurrence, zone);

          if (last < (days[0] ?? '') || start > (days[6] ?? '')) {
            return null;
          }

          const from = start < (days[0] ?? '') ? 0 : days.indexOf(start);
          const to = last > (days[6] ?? '') ? 6 : days.indexOf(last);

          return (
            <EventBar
              key={occurrence.key}
              occurrence={occurrence}
              book={book}
              startsBefore={false}
              endsAfter={false}
              onOpen={onOpen}

              style={{
                gridColumn: `${String(from + 2)} / span ${String(to - from + 1)}`,
                gridRow: 1,
              }}
            />
          );
        })}
        {days.map((each, index) => {
          const chips = visible.filter(
            (occurrence) =>
              occurrence.isAllDay &&
              !isPickup(occurrence, book) &&
              lengthInDays(occurrence, zone) === 1 &&
              isOn(occurrence, each, zone),
          );
          const bins = visible.filter(
            (occurrence) => isPickup(occurrence, book) && isOn(occurrence, each, zone),
          );

          return (
            <div
              key={each}
              className="flex min-w-0 flex-col gap-0.75 px-1.5"
              /* eslint-disable-next-line react/forbid-dom-props -- the day's column in the lane. */
              style={{ gridColumn: index + 2, gridRow: 2 }}
            >
              {chips.map((occurrence) => (
                <EventChip
                  key={occurrence.key}
                  occurrence={occurrence}
                  book={book}
                  onOpen={onOpen}
                />
              ))}
              {bins.length === 0 ? (
                <span className="h-5" />
              ) : (
                <button
                  type="button"
                  aria-label={t('calendar.month.pickups', 'Pickups of {{day}}', { day: each })}
                  onClick={(event) => {
                    onOpenPickups(each, event.currentTarget);
                  }}
                  className="flex w-fit cursor-pointer gap-0.75 rounded-full px-0.5 py-px focus-visible:shadow-focus focus-visible:outline-none"
                >
                  {bins.map((occurrence) => {
                    const look = lookOf(occurrence, book);

                    return (
                      <ModelToken
                        key={occurrence.key}
                        icon={look.icon}
                        color={look.tokenColor}
                        size={20}
                      />
                    );
                  })}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div ref={scroller} className="relative h-176 overflow-y-auto">
        <div className="relative grid h-264 grid-cols-[58px_repeat(7,minmax(0,1fr))]">
          <div aria-hidden="true" className="relative">
            {Array.from({ length: 24 }, (unused, hour) =>
              hour === 0 || (todayIndex >= 0 && Math.abs(hour * 60 - nowMinute) < 22) ? null : (
                <span
                  key={hour}
                  className="absolute left-0 w-12 -translate-y-1/2 text-right font-mono text-label text-foreground-subtle"
                  /* eslint-disable-next-line react/forbid-dom-props -- the hour's height in the grid. */
                  style={{ top: hour * HOUR }}
                >
                  {minuteText(hour * 60)}
                </span>
              ),
            )}
            {sun?.rise === null || sun === null ? null : (
              <span
                title={t('calendar.week.sunrise', 'Sunrise {{time}}', {
                  time: minuteText(sun.rise),
                })}
                className="absolute left-0.75 -translate-y-1/2 text-warning"
                /* eslint-disable-next-line react/forbid-dom-props -- sunrise, from where the house is. */
                style={{ top: (sun.rise / 60) * HOUR }}
              >
                <AppIcon id="sunrise" size={12} />
              </span>
            )}
            {sun?.set === null || sun === null ? null : (
              <span
                title={t('calendar.week.sunset', 'Sunset {{time}}', { time: minuteText(sun.set) })}
                className="absolute left-0.75 -translate-y-1/2 text-tag-orange"
                /* eslint-disable-next-line react/forbid-dom-props -- sunset, from where the house is. */
                style={{ top: (sun.set / 60) * HOUR }}
              >
                <AppIcon id="sunset" size={12} />
              </span>
            )}
          </div>

          <div
            ref={columnsBox}
            role="presentation"
            className="relative col-span-7 grid grid-cols-7"
            onPointerMove={follow}
            onPointerUp={end}
            onPointerCancel={() => {
              setDrag(null);
            }}
          >
            {days.map((each, index) => {
              const timed = visible.filter(
                (occurrence) =>
                  !occurrence.isAllDay &&
                  occurrence.startsAt !== null &&
                  isOn(occurrence, each, zone),
              );
              const sunOf = sunDays[index];
              const isOff = daysOff.names.has(each) || isWeekend(each);

              return (
                <div
                  key={each}
                  className={cn(
                    'relative border-l border-border',
                    each === today ? 'bg-primary/5' : isOff ? 'bg-well' : undefined,
                  )}
                  onPointerDown={
                    canAdd
                      ? (event) => {
                          begin(event, 'create', null);
                        }
                      : undefined
                  }
                >
                  {sunOf?.rise == null ? null : (
                    <span
                      aria-hidden="true"
                      className={cn(
                        'absolute inset-x-0 top-0 border-b border-dashed border-warning/30',
                        isOff ? 'bg-rail' : 'bg-well',
                      )}
                      /* eslint-disable-next-line react/forbid-dom-props -- the night before sunrise. */
                      style={{ height: (sunOf.rise / 60) * HOUR }}
                    />
                  )}
                  {sunOf?.set == null ? null : (
                    <span
                      aria-hidden="true"
                      className={cn(
                        'absolute inset-x-0 bottom-0 border-t border-dashed border-tag-orange/30',
                        isOff ? 'bg-rail' : 'bg-well',
                      )}
                      /* eslint-disable-next-line react/forbid-dom-props -- the night after sunset. */
                      style={{ top: (sunOf.set / 60) * HOUR }}
                    />
                  )}
                  {Array.from({ length: 23 }, (unused, hour) => (
                    <span
                      key={hour}
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-x-0 h-px bg-border/70"
                      /* eslint-disable-next-line react/forbid-dom-props -- an hour's line. */
                      style={{ top: (hour + 1) * HOUR }}
                    />
                  ))}

                  {placeDay(timed, each, zone).map((placed) => {
                    const { occurrence } = placed;
                    const look = lookOf(occurrence, book);
                    const isMoving = drag?.occurrence?.key === occurrence.key && drag.hasMoved;
                    const height = Math.max(22, ((placed.end - placed.start) / 60) * HOUR - 2);
                    const isOver = Date.parse(occurrence.endsAt ?? '') <= now;

                    return (
                      <div
                        key={occurrence.key}
                        data-block=""
                        role="button"
                        tabIndex={0}
                        aria-label={`${occurrence.title}, ${timesText(occurrence, zone)}`}
                        onPointerDown={(event) => {
                          begin(event, 'move', placed);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            onOpen(occurrence, event.currentTarget);
                          }
                        }}
                        className={cn(
                          'absolute flex cursor-pointer touch-none flex-col gap-px overflow-hidden rounded-field border text-left select-none',
                          'focus-visible:shadow-focus focus-visible:outline-none',
                          height < 34 ? 'px-2 py-0.75' : 'px-2 py-1.5',
                          isOver
                            ? 'border-[color-mix(in_srgb,var(--lane)_18%,transparent)] bg-[color-mix(in_srgb,var(--lane)_9%,transparent)]'
                            : 'border-[color-mix(in_srgb,var(--lane)_38%,transparent)] bg-[color-mix(in_srgb,var(--lane)_16%,transparent)]',
                          (isMoving || occurrence.isStale) && 'opacity-35',
                          LANE_CLASSES[look.color],
                        )}
                        /* eslint-disable-next-line react/forbid-dom-props -- where the block sits:
                           its start, length and column among the ones it overlaps (RULES.md 15.3). */
                        style={{
                          top: (placed.start / 60) * HOUR + 1,
                          height,
                          left: `calc(${String((placed.column * 100) / placed.columns)}% + 3px)`,
                          width: `calc(${String(100 / placed.columns)}% - 6px)`,
                        }}
                      >
                        <span
                          className={cn(
                            'flex items-center gap-1.25 truncate text-caption font-medium',
                            isOver ? 'text-foreground-muted' : 'text-foreground',
                          )}
                        >
                          {look.icon === undefined ? null : (
                            <CatalogueIcon
                              node={look.icon.node}
                              frame={look.icon.frame}
                              size={12}
                              className="shrink-0 text-[var(--lane)]"
                            />
                          )}
                          <span className="truncate">{occurrence.title}</span>
                          <SourceMark occurrence={occurrence} className="text-[var(--lane)]" />
                        </span>
                        {height >= 34 ? (
                          <span
                            className={cn(
                              'truncate font-mono text-label',
                              isOver ? 'text-foreground-subtle' : 'text-[var(--lane)]',
                            )}
                          >
                            {timesText(occurrence, zone)}
                          </span>
                        ) : null}
                        {occurrence.canEdit ? (
                          <span
                            aria-hidden="true"
                            className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
                            onPointerDown={(event) => {
                              begin(event, 'resize', placed);
                            }}
                          />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {drag?.hasMoved === true && drag.occurrence !== null ? (
              <MovingBlock drag={drag} book={book} />
            ) : null}

            {(drag?.kind === 'create' && drag.hasMoved) || drawn !== null ? (
              <div
                ref={ghostRef}
                className="pointer-events-none absolute z-2 flex flex-col gap-px rounded-field border-2 border-dashed border-primary bg-primary/16 px-2 py-1.5"
                /* eslint-disable-next-line react/forbid-dom-props -- the slot being drawn. */
                style={ghostStyle(
                  drag?.kind === 'create' && drag.hasMoved
                    ? drag.slot
                    : {
                        dayIndex: days.indexOf(drawn?.day ?? ''),
                        start: drawn?.start ?? 0,
                        end: drawn?.end ?? 0,
                      },
                )}
              >
                <span className="text-caption font-medium">
                  {t('calendar.week.newEvent', 'New event')}
                </span>
                <span className="font-mono text-label text-primary">
                  {drag?.kind === 'create' && drag.hasMoved
                    ? `${minuteText(drag.slot.start)} – ${minuteText(drag.slot.end)}`
                    : `${minuteText(drawn?.start ?? 0)} – ${minuteText(drawn?.end ?? 0)}`}
                </span>
              </div>
            ) : null}
          </div>

          {todayIndex < 0 ? null : (
            <>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute right-0 left-14.5 z-4 h-px bg-primary/35"
                /* eslint-disable-next-line react/forbid-dom-props -- now, on the house's clock. */
                style={{ top: (nowMinute / 60) * HOUR }}
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute z-4 h-0.5 bg-primary"
                /* eslint-disable-next-line react/forbid-dom-props -- now, across today's column. */
                style={{
                  top: (nowMinute / 60) * HOUR - 1,
                  left: `calc(58px + (100% - 58px) * ${String(todayIndex)} / 7)`,
                  width: 'calc((100% - 58px) / 7)',
                }}
              />
              <span
                className="pointer-events-none absolute left-1.5 z-4 inline-flex h-5 -translate-y-1/2 items-center rounded-check bg-primary px-1.5 font-mono text-label font-medium text-primary-foreground"
                /* eslint-disable-next-line react/forbid-dom-props -- now, in the hours' gutter. */
                style={{ top: (nowMinute / 60) * HOUR }}
              >
                {clockText(new Date(now).toISOString(), zone)}
              </span>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Where a slot of the week is drawn.
 *
 * @param slot - The slot.
 * @returns Its top, height and column, as a style.
 */
function ghostStyle(slot: WeekSlot) {
  return {
    top: (slot.start / 60) * HOUR + 1,
    height: Math.max(22, ((slot.end - slot.start) / 60) * HOUR - 2),
    left: `calc(100% * ${String(slot.dayIndex)} / 7 + 3px)`,
    width: 'calc(100% / 7 - 6px)',
  };
}

/**
 * The block being dragged, where it would land: red and dashed, with why, when it cannot move.
 *
 * @param props - The drag and the book.
 * @param props.drag - The drag.
 * @param props.book - The page's book.
 * @returns The block.
 */
function MovingBlock(props: { readonly drag: Drag; readonly book: CalendarBook }) {
  const { t } = useTranslation();
  const { drag, book } = props;
  const occurrence = drag.occurrence;

  if (occurrence === null) {
    return null;
  }

  const look = lookOf(occurrence, book);
  const isBlocked = !occurrence.canEdit;
  const reason =
    occurrence.source === 'ics'
      ? t('calendar.week.fromUrl', 'From a URL: change it at the source')
      : occurrence.source === 'entity'
        ? t('calendar.week.fromEntity', 'From an entity: change its value')
        : t('calendar.week.cannotEdit', 'You can’t change {{calendar}}', {
            calendar: look.calendar?.name ?? '',
          });

  return (
    <div
      className={cn(
        'pointer-events-none absolute z-3 flex flex-col gap-px rounded-field border-2 bg-[color-mix(in_srgb,var(--lane)_22%,transparent)] px-2 py-1.5 shadow-float',
        isBlocked ? 'border-dashed border-danger' : 'border-solid border-[var(--lane)]',
        LANE_CLASSES[look.color],
      )}
      /* eslint-disable-next-line react/forbid-dom-props -- where the dragged block would land. */
      style={ghostStyle(drag.slot)}
    >
      <span className="truncate text-caption font-medium">{occurrence.title}</span>
      <span
        className={cn('font-mono text-label', isBlocked ? 'text-danger' : 'text-[var(--lane)]')}
      >
        {`${minuteText(drag.slot.start)} – ${minuteText(drag.slot.end)}`}
      </span>
      {isBlocked ? (
        <span className="mt-1 inline-flex w-fit items-center gap-2 rounded-field border border-border-strong bg-surface-raised px-2.5 py-1 text-caption whitespace-nowrap text-foreground shadow-float">
          <AppIcon id="ban" size={13} className="text-danger" />
          {reason}
        </span>
      ) : null}
    </div>
  );
}

/** What the quick add needs. */
export type QuickAddProps = {
  readonly book: CalendarBook;

  /** The slot drawn; null while shut. */
  readonly drawn: { readonly day: string; readonly start: number; readonly end: number } | null;
  readonly anchor: RefObject<HTMLDivElement | null>;
  readonly isBusy: boolean;
  readonly onClose: () => void;

  /** Called with the title and the calendar, to make the event. */
  readonly onSave: (title: string, calendarId: string) => void;

  /** Called to go on in the full dialog with what is typed. */
  readonly onMore: (title: string, calendarId: string) => void;
};

/**
 * The title of an event just drawn, asked beside it (CAL-Week): the title, when, the calendar,
 * and More options for the whole dialog.
 *
 * @param props - See {@link QuickAddProps}.
 * @returns The popover.
 */
export function QuickAdd(props: QuickAddProps) {
  const { t } = useTranslation();
  const { book, drawn, anchor, isBusy, onClose } = props;
  const writable = book.calendars.filter((calendar) => calendar.canEdit);
  const [title, setTitle] = useState('');
  const [calendarId, setCalendarId] = useState(writable[0]?.id ?? '');

  return (
    <Popover
      anchor={anchor}
      isOpen={drawn !== null}
      onClose={onClose}
      side="beside"
      width={300}
      label={t('calendar.week.newEvent', 'New event')}
      className="rounded-panel"
    >
      {drawn === null ? null : (
        <form
          className="flex flex-col gap-3 p-3.5"
          onSubmit={(event) => {
            event.preventDefault();

            if (title.trim() !== '' && calendarId !== '') {
              props.onSave(title.trim(), calendarId);
            }
          }}
        >
          <TextField
            label={t('calendar.week.title', 'Title')}
            isLabelHidden
            // eslint-disable-next-line jsx-a11y/no-autofocus -- the popover opens to be typed in.
            autoFocus
            size="large"
            placeholder={t('calendar.week.addTitle', 'Add a title')}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
          />
          <div className="flex flex-col gap-2 px-0.5">
            <span className="flex items-center gap-2.5 text-ui-sm text-foreground-muted">
              <AppIcon id="clock" size={15} className="text-foreground-subtle" />
              {`${dayWords(drawn.day)} · ${minuteText(drawn.start)} – ${minuteText(drawn.end)}`}
            </span>
            <SelectField
              label={t('calendar.dialog.calendar', 'Calendar')}
              isLabelHidden
              size="compact"
              value={calendarId}
              onChange={setCalendarId}
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
          </div>
          <div className="flex items-center justify-between border-t border-border pt-2.5">
            <Button
              variant="ghost"
              size="compact"
              onClick={() => {
                props.onMore(title.trim(), calendarId);
              }}
            >
              {t('calendar.week.moreOptions', 'More options')}
            </Button>
            <Button type="submit" size="compact" isBusy={isBusy} disabled={title.trim() === ''}>
              {t('common.save', 'Save')}
            </Button>
          </div>
        </form>
      )}
    </Popover>
  );
}
