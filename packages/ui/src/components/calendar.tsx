/**
 * A month of days to pick one from: the grid a date field opens, and a calendar on its own.
 *
 * A day is a plain `2026-06-21` - no time and no zone, the form a native date input speaks - so
 * nothing here can slip a day across a time zone: the arithmetic runs on UTC dates and only the
 * key is ever read back. Today is the browser's.
 *
 * The header steps a month at a time. In the grid the arrow keys move by a day and by a week,
 * across months; one day alone is in the tab order, so Tab leaves the grid instead of walking it.
 * Days outside `min` and `max` are drawn but cannot be picked or reached.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../lib/cn.js';

import { AppIcon } from './app-icon.js';
import { IconButton } from './icon-button.js';

/** What a day's key looks like. */
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/u;

/** How far each arrow key moves, in days. */
const STEPS: Readonly<Record<string, number>> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
};

/**
 * Writes a day's key, carrying what overflows: the 0th of a month is the last of the one before.
 *
 * @param year - The year.
 * @param month - The month, 1 to 12.
 * @param day - The day of the month.
 * @returns `2026-06-21`.
 */
export function dayKey(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

/**
 * Reads a day's key as the instant of its UTC midnight.
 *
 * @param key - `2026-06-21`.
 * @returns The instant.
 */
function utcOf(key: string): Date {
  return new Date(`${key}T00:00:00Z`);
}

/**
 * Moves a day by some days.
 *
 * @param key - `2026-06-21`.
 * @param days - How many, either way.
 * @returns The day that far from it.
 */
export function shiftDay(key: string, days: number): string {
  const from = utcOf(key);

  return dayKey(from.getUTCFullYear(), from.getUTCMonth() + 1, from.getUTCDate() + days);
}

/**
 * Today, where the browser is.
 *
 * @returns Its key.
 */
export function todayKey(): string {
  const now = new Date();

  return dayKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/**
 * Writes a day in words.
 *
 * @param key - `2026-06-21`.
 * @param locale - The language to write it in.
 * @param dateStyle - How long: `21 Jun 2026`, or `Sunday 21 June 2026`.
 * @returns The day, or the key as it came when it is not one.
 */
export function formatDay(
  key: string,
  locale: string,
  dateStyle: 'medium' | 'full' = 'medium',
): string {
  return DAY_KEY.test(key)
    ? new Intl.DateTimeFormat(locale, { dateStyle, timeZone: 'UTC' }).format(utcOf(key))
    : key;
}

/** A run of days, both ends included: `from` is never after `to`. */
export type DayRange = { readonly from: string; readonly to: string };

/**
 * Writes a run of days in words, saying what the two ends share once: `21–25 Jun 2026`.
 *
 * @param range - The run.
 * @param locale - The language to write it in.
 * @returns The run, or its keys as they came when they are not days.
 */
export function formatDayRange(range: DayRange, locale: string): string {
  return DAY_KEY.test(range.from) && DAY_KEY.test(range.to)
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).formatRange(
        utcOf(range.from),
        utcOf(range.to),
      )
    : `${range.from} – ${range.to}`;
}

/** What one day, or a run of days, is picked with. */
export type DayPick =
  | {
      /** One day; the default. */
      readonly mode?: 'single';

      /** The day picked, `2026-06-21`, or null for none yet. */
      readonly value: string | null;

      /** Called with the day picked. */
      readonly onChange: (day: string) => void;
    }
  | {
      /**
       * A run of days. The first day pressed is where it starts, and stays so: each press after it
       * moves the other end, and pressing it again lets it go.
       */
      readonly mode: 'range';

      /** The run picked, or null for none yet. */
      readonly value: DayRange | null;

      /** Called with the run at every press, or null once its starting day is let go. */
      readonly onChange: (range: DayRange | null) => void;

      /** The most days the run may hold, both ends counted; any when not said. */
      readonly maxDays?: number | undefined;
    };

/**
 * What a day of a month is marked with, when a calendar shows a year: whether it is a holiday or a
 * weekend day, a ring (the one day off that makes a long weekend), a band behind it (several days
 * of one event), a dot under it (something on that day). Bands and dots are classes, so the
 * caller paints them in a tag's colour.
 */
export type CalendarDayLook = {
  /** How the number is drawn: filled red for a holiday, dimmed for a weekend day. */
  readonly tone?: 'holiday' | 'weekend' | undefined;

  /** A ring round the number. */
  readonly mark?: 'ring' | undefined;

  /** The class that paints a band behind the day. */
  readonly band?: string | undefined;

  /** The class that paints a dot under the number. */
  readonly dot?: string | undefined;

  /** What the marks mean, on hover: the holiday's name. */
  readonly note?: string | undefined;
};

/** What a calendar needs. */
export type CalendarProps = DayPick & {
  /** The first day that may be picked. */
  readonly min?: string | undefined;

  /** The last day that may be picked. */
  readonly max?: string | undefined;

  /** Whether the day picked takes the focus when the calendar appears: for one in a popover. */
  readonly takesFocus?: boolean;

  /**
   * Whether it fills the width it is given, with round days: an entity's dialog draws it so. A
   * popover's is compact, 16 rem wide.
   */
  readonly isRoomy?: boolean;

  /**
   * How big it is drawn: as a picker (the default), or as one month of a year - the month's name
   * with no arrows, small round days.
   */
  readonly size?: 'medium' | 'mini';

  /** Whether the days are only shown: no day can be pressed, picked or reached with the keyboard. */
  readonly isReadOnly?: boolean;

  /** The month shown first, `2027-01`; the picked day's, else today's, when left out. */
  readonly month?: string | undefined;

  /** What each day is marked with; nothing when left out. */
  readonly renderDay?: ((day: string) => CalendarDayLook) | undefined;

  /**
   * One month of a year (`mini`): its name is a button, which hands this on - the calendar's year
   * opens the month.
   */
  readonly onMonthPress?: (() => void) | undefined;

  /**
   * Read only: each day is pressed for the mouse, which hands its day on - the calendar's year opens
   * its week. Out of the keyboard's way: a year's 365 days would be as many stops; the month's
   * name is the keyboard's way in.
   */
  readonly onDayPress?: ((day: string) => void) | undefined;

  /** Anything extra for the outer element. */
  readonly className?: string;
};

/**
 * Renders a month and what steps to the next.
 *
 * @param props - See {@link CalendarProps}.
 * @returns The calendar.
 */
export function Calendar(props: CalendarProps) {
  const { min, max, takesFocus = false, isRoomy = false, className } = props;
  const { size = 'medium', isReadOnly = false, renderDay, onMonthPress, onDayPress } = props;
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const today = todayKey();
  const grid = useRef<HTMLDivElement>(null);

  const range = props.mode === 'range' ? props.value : null;
  const maxDays = props.mode === 'range' ? props.maxDays : undefined;
  const ends = (
    props.mode === 'range' ? [range?.from ?? null, range?.to ?? null] : [props.value, null]
  ).map((day) => (day !== null && DAY_KEY.test(day) ? day : null));
  const picked = ends[0] ?? null;
  const last = ends[1] ?? picked;

  // Where a run starts: the first day pressed, kept until it is pressed again. A calendar opened
  // on a run starts it where the run does.
  const [anchor, setAnchor] = useState<string | null>(props.mode === 'range' ? picked : null);

  // The month shown, `2026-06`, and the day the keyboard is on.
  const [month, setMonth] = useState(props.month ?? (picked ?? today).slice(0, 7));
  const [focusOn, setFocusOn] = useState(takesFocus ? (picked ?? today) : null);

  useEffect(() => {
    if (focusOn !== null) {
      grid.current?.querySelector<HTMLElement>(`[data-day="${focusOn}"]`)?.focus();
    }
  }, [focusOn]);

  const year = Number(month.slice(0, 4));
  const monthOf = Number(month.slice(5, 7));
  const days = utcOf(dayKey(year, monthOf + 1, 0)).getUTCDate();

  // shortcut: Monday first everywhere, as the house's own calendars are; read the locale's first
  // day (`Intl.Locale#getWeekInfo`) when a Sunday-first house asks.
  const blanks = (utcOf(`${month}-01`).getUTCDay() + 6) % 7;
  const weekdays = [0, 1, 2, 3, 4, 5, 6].map((index) =>
    new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' }).format(
      Date.UTC(2026, 0, 5 + index),
    ),
  );
  const isMini = size === 'mini';
  const title = new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(utcOf(`${month}-01`));

  // One month of a year says only its name: the year is the page's.
  const name = isMini
    ? new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(
        utcOf(`${month}-01`),
      )
    : title;

  // The one day in the tab order: where the keyboard is, else the day picked, else today.
  const tabStop =
    [focusOn, picked, today].find((day) => day?.startsWith(month) ?? false) ?? `${month}-01`;

  /**
   * Says whether a day is outside what may be picked.
   *
   * @param day - Its key.
   * @returns True before `min` or after `max`, or too far from a run's first end.
   */
  const isOff = (day: string): boolean =>
    (min !== undefined && day < min) ||
    (max !== undefined && day > max) ||
    (anchor !== null &&
      maxDays !== undefined &&
      (day < shiftDay(anchor, 1 - maxDays) || day > shiftDay(anchor, maxDays - 1)));

  /**
   * Picks a day: the day itself, or one end of a run.
   *
   * @param day - Its key.
   */
  const pick = (day: string): void => {
    if (props.mode !== 'range') {
      props.onChange(day);
    } else if (anchor === day) {
      setAnchor(null);
      props.onChange(null);
    } else if (anchor === null) {
      setAnchor(day);
      props.onChange({ from: day, to: day });
    } else {
      props.onChange(day < anchor ? { from: day, to: anchor } : { from: anchor, to: day });
    }
  };

  /**
   * Moves the keyboard's day with the arrows, into the next month when it leaves this one.
   *
   * @param event - The key press.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const by = STEPS[event.key];
    const from = event.target instanceof HTMLElement ? event.target.dataset['day'] : undefined;

    if (by === undefined || from === undefined) {
      return;
    }

    event.preventDefault();

    const to = shiftDay(from, by);

    if (!isOff(to)) {
      setMonth(to.slice(0, 7));
      setFocusOn(to);
    }
  };

  return (
    <div
      className={cn(
        'flex flex-col',
        isMini ? 'gap-1.5' : 'gap-2',
        isRoomy || isMini ? 'w-full' : 'w-64',
        className,
      )}
    >
      {isMini && onMonthPress !== undefined ? (
        <button
          type="button"
          aria-label={title}
          onClick={onMonthPress}
          className="cursor-pointer self-start rounded-chip px-1.5 text-ui font-medium text-foreground transition-colors first-letter:uppercase hover:text-primary focus-visible:shadow-focus focus-visible:outline-none"
        >
          {name}
        </button>
      ) : isMini ? (
        <span className="pl-1.5 text-ui font-medium text-foreground first-letter:uppercase">
          {name}
        </span>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <IconButton
            label={t('ui.calendar.previousMonth', 'Previous month')}
            onClick={() => {
              setMonth(dayKey(year, monthOf - 1, 1).slice(0, 7));
            }}
          >
            <AppIcon id="chevron-left" size={16} />
          </IconButton>
          <span
            aria-live="polite"
            className="text-ui font-medium text-foreground first-letter:uppercase"
          >
            {title}
          </span>
          <IconButton
            label={t('ui.calendar.nextMonth', 'Next month')}
            onClick={() => {
              setMonth(dayKey(year, monthOf + 1, 1).slice(0, 7));
            }}
          >
            <AppIcon id="chevron-right" size={16} />
          </IconButton>
        </div>
      )}

      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the arrows are caught here for whichever day has the focus. */}
      <div
        ref={grid}
        role="group"
        aria-label={title}
        onKeyDown={onKeyDown}
        className={cn(
          'grid grid-cols-7 text-center',
          isMini ? 'text-caption' : isRoomy ? 'gap-y-1.5 text-ui' : 'gap-y-1 text-ui-sm',
        )}
      >
        {weekdays.map((weekday, index) => (
          // The days carry their weekday in their own names; these are for the eye.
          <span
            // eslint-disable-next-line react/no-array-index-key -- seven fixed columns: two weekdays share a narrow letter.
            key={index}
            aria-hidden="true"
            className={cn(
              'text-foreground-subtle',
              isMini ? 'py-1 font-mono text-label uppercase' : 'py-1 text-caption',
            )}
          >
            {weekday}
          </span>
        ))}
        {[...Array.from({ length: blanks }).keys()].map((index) => (
          <span key={`blank-${String(index)}`} />
        ))}
        {[...Array.from({ length: days }).keys()].map((index) => {
          const day = dayKey(year, monthOf, index + 1);
          const isPicked = day === picked || day === last;
          const isInside = picked !== null && last !== null && day > picked && day < last;
          const column = (blanks + index) % 7;

          // A run is one band, from end to end, broken only where a week does.
          const isBand = picked !== last && (isPicked || isInside);
          const band = isBand
            ? cn(
                'bg-primary/15',
                (day === picked || column === 0 || index === 0) && 'rounded-l-chip',
                (day === last || column === 6 || index === days - 1) && 'rounded-r-chip',
              )
            : undefined;

          if (isReadOnly) {
            const look = renderDay?.(day) ?? {};
            const box = cn(
              'relative flex items-center justify-center',
              isMini ? 'h-7.5' : 'h-8',
              onDayPress !== undefined && 'group cursor-pointer',
              look.band,
            );
            const face = (
              <>
                <span
                  className={cn(
                    'flex items-center justify-center rounded-full tabular transition-colors',
                    isMini ? 'size-6.5' : 'size-8',
                    onDayPress !== undefined &&
                      (look.tone === 'holiday'
                        ? 'group-hover:bg-tag-red/30'
                        : 'group-hover:bg-surface-high'),
                    look.tone === 'holiday'
                      ? 'bg-tag-red/18 font-semibold text-tag-red'
                      : look.tone === 'weekend'
                        ? 'text-foreground-subtle'
                        : 'text-foreground',
                    look.mark === 'ring' && 'ring-2 ring-tag-red/60 ring-inset',
                    day === today && look.tone === undefined && 'ring-1 ring-primary/60 ring-inset',
                  )}
                >
                  {index + 1}
                </span>
                {look.dot === undefined ? null : (
                  <span
                    aria-hidden="true"
                    className={cn(
                      'absolute bottom-px left-1/2 size-1 -translate-x-1/2 rounded-full',
                      look.dot,
                    )}
                  />
                )}
              </>
            );

            return onDayPress === undefined ? (
              <span key={day} title={look.note} className={box}>
                {face}
              </span>
            ) : (
              <button
                key={day}
                type="button"
                tabIndex={-1}
                title={look.note}
                aria-label={formatDay(day, locale, 'full')}
                onClick={() => {
                  onDayPress(day);
                }}
                className={box}
              >
                {face}
              </button>
            );
          }

          return (
            <span key={day} className={cn('flex px-0.5', isRoomy && 'justify-center', band)}>
              <button
                type="button"
                data-day={day}
                tabIndex={day === tabStop ? 0 : -1}
                disabled={isOff(day)}
                aria-label={formatDay(day, locale, 'full')}
                aria-pressed={isPicked || isInside}
                aria-current={day === today ? 'date' : undefined}
                onClick={() => {
                  pick(day);
                }}
                className={cn(
                  'cursor-pointer tabular transition-colors',
                  isRoomy ? 'size-10 rounded-full' : 'h-8 grow rounded-chip',
                  'focus-visible:shadow-focus focus-visible:outline-none',
                  'disabled:cursor-not-allowed disabled:text-foreground-subtle disabled:opacity-50',
                  isPicked
                    ? 'bg-primary font-medium text-primary-foreground'
                    : isInside
                      ? 'text-foreground enabled:hover:bg-primary/20'
                      : 'text-foreground enabled:hover:bg-surface-high',
                  day === today && !isPicked ? 'ring-1 ring-primary/60 ring-inset' : undefined,
                  // The day a run starts from, which a press lets go of.
                  day === anchor &&
                    picked !== last &&
                    'ring-2 ring-primary-foreground/50 ring-inset',
                )}
              >
                {index + 1}
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}
