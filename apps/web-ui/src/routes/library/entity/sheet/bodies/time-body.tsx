/**
 * A time the house keeps, as the canvas draws it (`N-Entity-Time-Set`, `-More`, `N-Entity-Date-Set`,
 * `-More`, `N-Entity-DateTime-Set`, `-More`): a time of day in parts with arrows, a day on a
 * month's calendar, a moment as both - the field in use picks what is under them.
 *
 * A value in parts is sent whole: a change is a draft until Set. The changed part turns violet,
 * "Was …", Cancel and Set show under it, and nothing reaches the device before Set; Set then turns
 * into a spinner until the entity confirms. One the house may only read is its value, how far off
 * it is, and its last values. A value not known yet is dashes, never midnight or today.
 */
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { secondsOfDay, type EntityView } from '@nebulahome/contracts';
import { AppIcon, Button, Calendar, cn, type UiIconId } from '@nebulahome/ui';

import { dateTimeFormat } from '@/i18n/formatters';
import { paramsOf } from '@/library/entity-control';
import { durationText } from '@/library/history-stats';
import {
  clockOf,
  DAY_SECONDS,
  daysAwayText,
  formatClock,
  formatDayOf,
  formatMoment,
  momentOf,
  shownZone,
  timeCapabilityOf,
  untilClock,
  uses12Hours,
  wallOf,
  weekdayOf,
  type TimeCapability,
} from '@/library/time-values';
import { LastValues, RoundMark } from '@/routes/library/entity/sheet/bodies/sensor-body';
import { SendingSpinner } from '@/routes/library/entity/sheet/parts/sheet-parts';
import type { SheetBodyProps } from '@/routes/library/entity/sheet/sheet-types';
import { usePendingValue } from '@/routes/library/entity/use-pending-value';

/** The glyph of each. */
export const TIME_GLYPHS: Readonly<Record<TimeCapability, UiIconId>> = {
  time_of_day: 'clock',
  date: 'calendar',
  datetime: 'calendar-clock',
};

/** What a value in the making needs: the value shown, the one before, and how to change it. */
export type Draft = {
  /** The value shown: the draft, the one being sent, or the entity's. */
  readonly shown: string | null;

  /** The entity's value, or the one being sent: what the draft is compared with. */
  readonly base: string | null;

  /** Whether the draft differs from it. */
  readonly isChanged: boolean;

  /** Whether a value was sent and the entity has not confirmed it yet. */
  readonly isSending: boolean;

  /** The value before the last Set, for "Was …" while it is on its way. */
  readonly was: string | null;

  /** Changes the draft. */
  readonly change: (value: string) => void;

  /** Drops the draft. */
  readonly cancel: () => void;

  /** Sends the draft. */
  readonly set: () => void;
};

/**
 * Keeps a draft of one of the three values - or of a text - and sends it whole.
 *
 * @param props - The body's props.
 * @param capability - Which of the three, or `sensor_text`.
 * @returns See {@link Draft}.
 */
export function useDraft(props: SheetBodyProps, capability: TimeCapability | 'sensor_text'): Draft {
  const { state, reportedAt, commander } = props;
  const isSending = commander.busy.has(capability);
  const pending = usePendingValue<string | null>(
    state[capability]?.value ?? null,
    reportedAt,
    isSending,
  );
  const [draft, setDraft] = useState<string | null>(null);
  const [was, setWas] = useState<string | null>(null);

  return {
    shown: draft ?? pending.shown,
    base: pending.shown,
    isChanged: draft !== null && draft !== pending.shown,
    isSending,
    was,
    change: setDraft,
    /** Drops the draft. */
    cancel: () => {
      setDraft(null);
    },
    /** Sends the draft, and shows it while it is on its way. */
    set: () => {
      if (draft === null) {
        return;
      }

      setWas(pending.shown);
      pending.sent(draft);
      commander.send(capability, { command: 'set_value', value: draft });
      setDraft(null);
    },
  };
}

/**
 * "Was …", Cancel and Set under a changed value; "Was …" and a spinner while it is on its way.
 *
 * @param props - The draft, how its values are written, and whether it can be sent now.
 * @param props.draft - See {@link Draft}.
 * @param props.format - Writes a value.
 * @param props.disabled - Whether it cannot be sent now.
 * @returns The bar, or nothing when there is no change.
 */
export function SetBar(props: {
  draft: Draft;
  format: (value: string) => string;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const { draft, format } = props;
  const was = draft.isChanged ? draft.base : draft.isSending ? draft.was : null;

  if (!draft.isChanged && !draft.isSending) {
    return null;
  }

  return (
    <div className="flex min-h-9 animate-fade-in items-center justify-between gap-3">
      <span className="truncate text-ui-sm text-foreground-subtle">
        {was === null ? null : t('entity.sheet.time.was', 'Was {{value}}', { value: format(was) })}
      </span>
      {draft.isChanged ? (
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" onClick={draft.cancel}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button disabled={props.disabled} onClick={draft.set}>
            {t('entity.sheet.time.set', 'Set')}
          </Button>
        </div>
      ) : (
        <span className="inline-flex h-control w-14 items-center justify-center rounded-pill bg-primary/80 text-primary-foreground">
          <SendingSpinner tone="muted" size={18} />
        </span>
      )}
    </div>
  );
}

/**
 * The line under a value: how far off it is, its limits, or why a typed value was refused.
 *
 * @param props - The words, and whether they say a value was refused.
 * @param props.children - The words.
 * @param props.isRefused - Whether they say a typed value was refused.
 * @returns The line.
 */
function HintLine(props: { children: ReactNode; isRefused?: boolean }) {
  return (
    <div className="flex min-h-6 items-center justify-center">
      <span
        role={props.isRefused === true ? 'alert' : undefined}
        className={cn(
          'text-ui-sm',
          props.isRefused === true ? 'text-danger' : 'text-foreground-subtle',
        )}
      >
        {props.children}
      </span>
    </div>
  );
}

/**
 * The words for a pair of limits: "Between 06:00 and 22:00", "From Nov 8", "Until 22:00".
 *
 * @param min - The first, written; null when there is none.
 * @param max - The last, written; null when there is none.
 * @returns The words, or null with no limits.
 */
function useLimitsText(min: string | null, max: string | null): string | null {
  const { t } = useTranslation();

  if (min !== null && max !== null) {
    return t('entity.sheet.time.between', 'Between {{min}} and {{max}}', { min, max });
  }

  if (min !== null) {
    return t('entity.sheet.time.from', 'From {{min}}', { min });
  }

  return max === null ? null : t('entity.sheet.time.until', 'Until {{max}}', { max });
}

/** One part of a time of day: what one unit of it is, in seconds. */
type ClockPart = { readonly key: 'hours' | 'minutes' | 'seconds'; readonly unit: number };

/** What the parts of a time of day need. */
type ClockPartsProps = {
  /** The time shown, in seconds since midnight, or null when not known. */
  readonly seconds: number | null;

  /** The time before the draft, to mark the parts that changed. */
  readonly base: number | null;

  /** How far the smallest part's arrows move, in seconds; under 60 shows the seconds. */
  readonly step: number;

  /** The earliest, in seconds since midnight. */
  readonly min: number;

  /** The latest. */
  readonly max: number;

  /** Whether the limits are the device's: the arrows stop there rather than go round. */
  readonly isBounded: boolean;

  /** Whether nothing can be changed. */
  readonly disabled: boolean;

  /** The time now, in milliseconds since the epoch: where unknown parts start from. */
  readonly now: number;

  /** Called with a new time. */
  readonly onChange: (seconds: number) => void;

  /** Called when a typed time falls outside the limits, and when one is accepted again. */
  readonly onRefused: (isRefused: boolean) => void;
};

/**
 * The words of the two halves of the day in the user's language: "AM", "PM".
 *
 * @returns Both.
 */
function dayPeriods(): readonly [string, string] {
  const format = dateTimeFormat({ hour: 'numeric', hour12: true, timeZone: 'UTC' });
  /**
   * The word of the half an hour falls in.
   *
   * @param hour - The hour.
   * @returns The word.
   */
  const word = (hour: number): string =>
    format.formatToParts(hour * 3_600_000).find((part) => part.type === 'dayPeriod')?.value ??
    (hour < 12 ? 'AM' : 'PM');

  return [word(9), word(21)];
}

/**
 * A time of day as tiles - hours, minutes, seconds when the step is under a minute - each with
 * arrows above and below and typed into, and AM / PM beside them where the language says it.
 *
 * @param props - See {@link ClockPartsProps}.
 * @returns The parts.
 */
function ClockParts(props: ClockPartsProps) {
  const { t } = useTranslation();
  const { seconds, base, step, min, max, isBounded, disabled, now, onChange, onRefused } = props;
  const [typed, setTyped] = useState<{ key: ClockPart['key']; text: string } | null>(null);
  const is12 = uses12Hours();
  const parts: readonly ClockPart[] = [
    { key: 'hours', unit: 3600 },
    { key: 'minutes', unit: 60 },
    ...(step < 60 ? [{ key: 'seconds', unit: 1 } as const] : []),
  ];
  const names: Readonly<Record<ClockPart['key'], string>> = {
    hours: t('entity.sheet.time.hours', 'Hours'),
    minutes: t('entity.sheet.time.minutes', 'Minutes'),
    seconds: t('entity.sheet.time.seconds', 'Seconds'),
  };

  /**
   * A part's figure in a time.
   *
   * @param key - The part.
   * @param at - The time, in seconds since midnight.
   * @returns The figure, as the tile writes it.
   */
  const figureOf = (key: ClockPart['key'], at: number): number => {
    const hours = Math.floor(at / 3600);

    return key === 'hours'
      ? is12
        ? hours % 12 === 0
          ? 12
          : hours % 12
        : hours
      : key === 'minutes'
        ? Math.floor(at / 60) % 60
        : at % 60;
  };

  /**
   * Keeps a time on a step and within the limits - or round the clock when there are none.
   *
   * @param next - The time asked for.
   * @returns The time kept.
   */
  const kept = (next: number): number => {
    const stepped = Math.round(next / step) * step;

    return isBounded
      ? Math.min(max, Math.max(min, stepped))
      : ((stepped % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS;
  };

  /**
   * Where the arrows start from when the time is not known: the step nearest now.
   *
   * @returns The time, in seconds since midnight.
   */
  const start = (): number => kept(wallOf(now, shownZone()).seconds);

  /**
   * Moves a part by its arrows.
   *
   * @param part - The part.
   * @param direction - Up (1) or down (-1).
   */
  const move = (part: ClockPart, direction: 1 | -1): void => {
    onRefused(false);
    onChange(seconds === null ? start() : kept(seconds + direction * Math.max(part.unit, step)));
  };

  /**
   * Takes what was typed in a part.
   *
   * @param part - The part.
   * @param text - What was typed.
   */
  const commit = (part: ClockPart, text: string): void => {
    setTyped(null);

    const figure = Number.parseInt(text, 10);
    const now = seconds ?? start();
    const highest = part.key === 'hours' ? (is12 ? 12 : 23) : 59;

    if (
      Number.isNaN(figure) ||
      figure < (is12 && part.key === 'hours' ? 1 : 0) ||
      figure > highest
    ) {
      return;
    }

    const value =
      part.key === 'hours' && is12
        ? (figure % 12) + (Math.floor(now / 3600) >= 12 ? 12 : 0)
        : figure;
    const next = now - figureOf(part.key, now) * part.unit + value * part.unit;
    const stepped = Math.round(next / step) * step;

    if (isBounded && (stepped < min || stepped > max)) {
      onRefused(true);

      return;
    }

    onRefused(false);
    onChange(stepped);
  };

  const [am, pm] = dayPeriods();
  const isPm = seconds !== null && seconds >= 43_200;

  return (
    <div className="flex items-center justify-center gap-2">
      {parts.map((part, index) => {
        const figure = seconds === null ? null : figureOf(part.key, seconds);
        const isChanged = figure !== null && base !== null && figureOf(part.key, base) !== figure;

        return (
          <div key={part.key} className="flex items-center gap-2">
            {index === 0 ? null : (
              <span
                aria-hidden
                className="text-[32px] leading-none font-medium text-foreground-subtle"
              >
                :
              </span>
            )}
            <div className="flex flex-col items-center gap-1">
              <ArrowButton
                icon="chevron-up"
                label={t('entity.sheet.time.up', '{{part}} up', { part: names[part.key] })}
                disabled={disabled}
                onClick={() => {
                  move(part, 1);
                }}
              />
              <label
                className={cn(
                  'flex h-18 shrink-0 cursor-text items-center justify-center rounded-card border bg-surface-raised',
                  // Three tiles and AM / PM in one row: narrower, so the row fits the dialog.
                  parts.length > 2 ? 'w-18' : 'w-24',
                  'transition-colors duration-200 focus-within:border-primary/60',
                  isChanged ? 'border-violet/60' : 'border-border',
                )}
              >
                <input
                  aria-label={names[part.key]}
                  inputMode="numeric"
                  disabled={disabled}
                  value={
                    typed?.key === part.key
                      ? typed.text
                      : figure === null
                        ? '--'
                        : String(figure).padStart(2, '0')
                  }
                  onFocus={(event) => {
                    event.currentTarget.select();
                  }}
                  onChange={(event) => {
                    setTyped({ key: part.key, text: event.target.value.replaceAll(/\D/gu, '') });
                  }}
                  onBlur={() => {
                    if (typed?.key === part.key) {
                      commit(part, typed.text);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.currentTarget.blur();
                    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                      event.preventDefault();
                      move(part, event.key === 'ArrowUp' ? 1 : -1);
                    }
                  }}
                  className={cn(
                    'bg-transparent text-center text-[36px] leading-[1.3] font-medium tracking-[-0.03em] tabular outline-none',
                    parts.length > 2 ? 'w-16' : 'w-20',
                    isChanged ? 'text-violet' : 'text-foreground',
                  )}
                />
              </label>
              <ArrowButton
                icon="chevron-down"
                label={t('entity.sheet.time.down', '{{part}} down', { part: names[part.key] })}
                disabled={disabled}
                onClick={() => {
                  move(part, -1);
                }}
              />
            </div>
          </div>
        );
      })}
      {is12 ? (
        <div
          role="radiogroup"
          aria-label={t('entity.sheet.time.dayHalf', 'AM or PM')}
          className="ml-1 flex h-18 w-14 shrink-0 flex-col justify-between rounded-card border border-border bg-surface-raised p-0.75"
        >
          {[am, pm].map((word, half) => {
            const isChosen = seconds !== null && isPm === (half === 1);

            return (
              <button
                key={word}
                type="button"
                role="radio"
                aria-checked={isChosen}
                disabled={disabled || seconds === null}
                onClick={() => {
                  if (seconds !== null && !isChosen) {
                    const next = seconds + (half === 1 ? 43_200 : -43_200);

                    if (isBounded && (next < min || next > max)) {
                      onRefused(true);
                    } else {
                      onRefused(false);
                      onChange(next);
                    }
                  }
                }}
                className={cn(
                  'h-8 cursor-pointer rounded-inner border text-ui-sm font-medium transition-colors duration-200 disabled:cursor-not-allowed',
                  isChosen
                    ? 'border-primary/45 bg-primary/14 text-foreground'
                    : 'border-transparent text-foreground-subtle hover:text-foreground',
                )}
              >
                {word}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A small round arrow over or under a part.
 *
 * @param props - The glyph, what it does, and whether it can.
 * @param props.icon - Up or down.
 * @param props.label - What it does.
 * @param props.disabled - Whether it cannot be pressed.
 * @param props.onClick - Moves the part.
 * @returns The button.
 */
function ArrowButton(props: {
  icon: 'chevron-up' | 'chevron-down';
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
      className="press-scale inline-flex h-9 w-11 cursor-pointer items-center justify-center rounded-full text-foreground-muted transition-colors duration-200 hover:bg-surface-raised hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
    >
      <AppIcon id={props.icon} size={18} />
    </button>
  );
}

/**
 * A day written as the language writes it, the parts that changed in violet: "Nov 27, 2026".
 *
 * @param props - The day, the one before, and how big.
 * @param props.day - `YYYY-MM-DD`, or null when not known.
 * @param props.base - The day before the draft.
 * @returns The day.
 */
function DayText(props: { day: string | null; base: string | null }) {
  if (props.day === null) {
    return <span className="text-foreground-subtle">--</span>;
  }

  const format = dateTimeFormat({
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const before =
    props.base === null
      ? null
      : new Map(
          format.formatToParts(Date.parse(props.base)).map((part) => [part.type, part.value]),
        );

  return (
    // One inline run: in a flex box its parts would lose the spaces between them.
    <span>
      {format.formatToParts(Date.parse(props.day)).map((part, index) => (
        <span
          // eslint-disable-next-line react/no-array-index-key -- the parts of one date never move
          key={index}
          className={cn(
            part.type !== 'literal' && before !== null && before.get(part.type) !== part.value
              ? 'text-violet'
              : undefined,
          )}
        >
          {part.value}
        </span>
      ))}
    </span>
  );
}

/**
 * The body of a time of day that can be set.
 *
 * @param props - See {@link SheetBodyProps}.
 * @returns The body.
 */
function TimeOfDayEditor(props: SheetBodyProps) {
  const { t } = useTranslation();
  const { entity, disabled, now } = props;
  const params = paramsOf(entity, 'time_of_day');
  const draft = useDraft(props, 'time_of_day');
  const [isRefused, setRefused] = useState(false);
  const step = params?.step ?? 60;
  const limits = useLimitsText(
    params?.min === undefined ? null : formatClock(params.min),
    params?.max === undefined ? null : formatClock(params.max),
  );
  const zone = shownZone();

  return (
    <div className="flex grow flex-col gap-4">
      <div className="flex grow flex-col justify-center gap-4">
        <ClockParts
          seconds={draft.shown === null ? null : secondsOfDay(draft.shown)}
          base={draft.isChanged && draft.base !== null ? secondsOfDay(draft.base) : null}
          step={step}
          min={params?.min === undefined ? 0 : secondsOfDay(params.min)}
          max={params?.max === undefined ? DAY_SECONDS - step : secondsOfDay(params.max)}
          isBounded={params?.min !== undefined || params?.max !== undefined}
          disabled={disabled}
          now={now}
          onChange={(seconds) => {
            draft.change(clockOf(seconds, step < 60));
          }}
          onRefused={setRefused}
        />
        <HintLine isRefused={isRefused}>
          {isRefused
            ? limits
            : draft.shown === null
              ? limits
              : t('entity.sheet.sensor.inDuration', 'In {{duration}}', {
                  duration: durationText(untilClock(draft.shown, now, zone)),
                })}
        </HintLine>
      </div>
      <SetBar draft={draft} format={formatClock} disabled={disabled} />
    </div>
  );
}

/**
 * The body of a day that can be set.
 *
 * @param props - See {@link SheetBodyProps}.
 * @returns The body.
 */
function DateEditor(props: SheetBodyProps) {
  const { entity, disabled, now } = props;
  const params = paramsOf(entity, 'date');
  const draft = useDraft(props, 'date');
  const zone = shownZone();
  const limits = useLimitsText(
    params?.min === undefined ? null : formatDayOf(params.min),
    params?.max === undefined ? null : formatDayOf(params.max),
  );

  return (
    <div className="flex grow flex-col gap-4">
      <div
        className={cn(
          'flex h-16 items-center justify-center rounded-card border bg-surface-raised text-[36px] leading-none font-medium tracking-[-0.03em] tabular select-text',
          draft.isChanged ? 'border-violet/60' : 'border-border',
        )}
      >
        <DayText day={draft.shown} base={draft.isChanged ? draft.base : null} />
      </div>
      <HintLine>
        {limits ??
          (draft.shown === null
            ? null
            : `${daysAwayText(draft.shown, now, zone)} · ${weekdayOf(draft.shown)}`)}
      </HintLine>
      <Calendar
        isRoomy
        // A day typed elsewhere, or a reported one, shows its own month.
        key={(draft.shown ?? '').slice(0, 7)}
        value={draft.shown}
        min={params?.min}
        max={params?.max}
        onChange={(day) => {
          if (!disabled) {
            draft.change(day);
          }
        }}
      />
      <SetBar draft={draft} format={formatDayOf} disabled={disabled} />
    </div>
  );
}

/**
 * The body of a moment that can be set: a Date and a Time field, the one in use picking the
 * calendar or the parts under them.
 *
 * @param props - See {@link SheetBodyProps}.
 * @returns The body.
 */
function DateTimeEditor(props: SheetBodyProps) {
  const { t } = useTranslation();
  const { entity, disabled, now } = props;
  const params = paramsOf(entity, 'datetime');
  const draft = useDraft(props, 'datetime');
  const [inUse, setInUse] = useState<'date' | 'time'>('date');
  const [isRefused, setRefused] = useState(false);
  const zone = shownZone();
  const step = params?.step ?? 60;
  const at = draft.shown === null ? null : wallOf(Date.parse(draft.shown), zone);
  const before =
    draft.isChanged && draft.base !== null ? wallOf(Date.parse(draft.base), zone) : null;
  const first = params?.min === undefined ? null : wallOf(Date.parse(params.min), zone);
  const last = params?.max === undefined ? null : wallOf(Date.parse(params.max), zone);
  const limits = useLimitsText(
    params?.min === undefined ? null : formatMoment(params.min, now, zone),
    params?.max === undefined ? null : formatMoment(params.max, now, zone),
  );
  const startDay = at?.day ?? wallOf(now, zone).day;
  const away = draft.shown === null ? null : Date.parse(draft.shown) - now;

  /**
   * A field, Date or Time: its label above and its value in a box that picks what is under it.
   *
   * @param field - Which.
   * @param value - Its value, written.
   * @param isChanged - Whether the draft changed it.
   * @returns The field.
   */
  const field = (field: 'date' | 'time', value: ReactNode, isChanged: boolean): ReactNode => (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <span
        className={cn(
          'font-mono text-[10px] tracking-[0.08em] uppercase',
          inUse === field ? 'text-primary' : 'text-foreground-subtle',
        )}
      >
        {field === 'date'
          ? t('entity.sheet.time.dateField', 'Date')
          : t('entity.sheet.time.timeField', 'Time')}
      </span>
      <button
        type="button"
        aria-pressed={inUse === field}
        onClick={() => {
          setInUse(field);
        }}
        className={cn(
          'flex h-13 cursor-pointer items-center justify-center rounded-tile border bg-surface-raised text-[20px] font-medium tracking-[-0.01em] tabular transition-colors duration-200',
          inUse === field ? 'border-primary/60' : 'border-border hover:border-border-strong',
          isChanged && field === 'time' ? 'text-violet' : undefined,
        )}
      >
        {value}
      </button>
    </div>
  );

  return (
    <div className="flex grow flex-col gap-4">
      <div className="flex gap-2.5">
        {field(
          'date',
          <DayText day={at?.day ?? null} base={before?.day ?? null} />,
          before !== null && at !== null && before.day !== at.day,
        )}
        {field(
          'time',
          at === null ? '--' : formatClock(clockOf(at.seconds, step < 60)),
          before !== null && at !== null && before.seconds !== at.seconds,
        )}
      </div>
      <HintLine isRefused={isRefused}>
        {isRefused || away === null
          ? limits
          : Math.abs(away) < 2 * DAY_SECONDS * 1000
            ? away >= 0
              ? t('entity.sheet.sensor.inDuration', 'In {{duration}}', {
                  duration: durationText(away),
                })
              : t('entity.sheet.sensor.ago', '{{duration}} ago', {
                  duration: durationText(-away),
                })
            : daysAwayText(at?.day ?? startDay, now, zone)}
      </HintLine>
      {inUse === 'date' ? (
        <Calendar
          isRoomy
          key={startDay.slice(0, 7)}
          value={at?.day ?? null}
          min={first?.day}
          max={last?.day}
          onChange={(day) => {
            if (!disabled) {
              setRefused(false);
              draft.change(momentOf(day, at?.seconds ?? wallOf(now, zone).seconds, zone));
            }
          }}
        />
      ) : (
        <div className="flex grow items-center justify-center py-6">
          <ClockParts
            seconds={at?.seconds ?? null}
            base={before?.seconds ?? null}
            step={step}
            // The limits hold on their own days; any other day takes any time.
            min={first !== null && first.day === startDay ? first.seconds : 0}
            max={last !== null && last.day === startDay ? last.seconds : DAY_SECONDS - step}
            isBounded={
              (first !== null && first.day === startDay) || (last !== null && last.day === startDay)
            }
            disabled={disabled}
            now={now}
            onChange={(seconds) => {
              draft.change(momentOf(startDay, seconds, zone));
            }}
            onRefused={setRefused}
          />
        </div>
      )}
      <SetBar
        draft={draft}
        format={(value) => formatMoment(value, now, zone)}
        disabled={disabled}
      />
    </div>
  );
}

/**
 * A value the house may only read: big, how far off it is, and its last values.
 *
 * @param props - The body's props, and which of the three it is.
 * @param props.capability - Which.
 * @returns The body.
 */
function ReadOnlyTime(props: SheetBodyProps & { capability: TimeCapability }) {
  const { t } = useTranslation();
  const { entity, state, history, now, capability } = props;
  const value = state[capability]?.value ?? null;
  const zone = shownZone();

  /**
   * Writes one of the values, as history holds it.
   *
   * @param kept - The value.
   * @returns It, written.
   */
  const written = (kept: string): string =>
    capability === 'time_of_day'
      ? formatClock(kept)
      : capability === 'date'
        ? formatDayOf(kept)
        : formatMoment(kept, now, zone);

  /**
   * How far off a moment is: "In 2 days", "3 h ago".
   *
   * @param moment - The moment.
   * @returns The words.
   */
  const away = (moment: string): string => {
    const gap = Date.parse(moment) - now;

    return Math.abs(gap) >= 2 * DAY_SECONDS * 1000
      ? daysAwayText(wallOf(Date.parse(moment), zone).day, now, zone)
      : gap >= 0
        ? t('entity.sheet.sensor.inDuration', 'In {{duration}}', { duration: durationText(gap) })
        : t('entity.sheet.sensor.ago', '{{duration}} ago', { duration: durationText(-gap) });
  };

  const big = value === null ? '--' : capability === 'datetime' ? away(value) : written(value);
  const line =
    value === null
      ? null
      : capability === 'time_of_day'
        ? t('entity.sheet.sensor.inDuration', 'In {{duration}}', {
            duration: durationText(untilClock(value, now, zone)),
          })
        : capability === 'date'
          ? `${daysAwayText(value, now, zone)} · ${weekdayOf(value)}`
          : written(value);

  return (
    <div className="flex grow flex-col gap-4.5 pt-1">
      <div className="flex items-center gap-3.5">
        <RoundMark icon={TIME_GLYPHS[capability]} tone="primary" isStale={!entity.isAvailable} />
        <div className="flex flex-col gap-0.75">
          <span
            className={cn(
              'text-[30px] leading-[1.1] font-medium tracking-[-0.02em] select-text',
              entity.isAvailable ? undefined : 'text-foreground-subtle',
            )}
          >
            {big}
          </span>
          {line === null ? null : <span className="text-ui-sm text-foreground-subtle">{line}</span>}
        </div>
      </div>
      <LastValues
        points={history.states}
        now={now}
        current={value === null ? '—' : written(value)}
        readValue={(kept) => {
          const read = (kept as Partial<Record<TimeCapability, { value?: unknown }>> | null)?.[
            capability
          ]?.value;

          return typeof read === 'string' ? written(read) : '—';
        }}
      />
    </div>
  );
}

/**
 * Whether the house may set an entity's time: what picks the editor or the reading.
 *
 * @param entity - The entity.
 * @returns True when it may.
 */
export function canSetTime(entity: Pick<EntityView, 'capabilities'>): boolean {
  const capability = timeCapabilityOf(entity);

  return capability !== null && paramsOf(entity, capability)?.canSet === true;
}

/**
 * The body of a time, a day or a moment.
 *
 * @param props - See {@link SheetBodyProps}.
 * @returns The body.
 */
export function TimeBody(props: SheetBodyProps) {
  const capability = timeCapabilityOf(props.entity);

  if (capability === null) {
    return null;
  }

  if (!canSetTime(props.entity)) {
    return <ReadOnlyTime {...props} capability={capability} />;
  }

  return capability === 'time_of_day' ? (
    <TimeOfDayEditor {...props} />
  ) : capability === 'date' ? (
    <DateEditor {...props} />
  ) : (
    <DateTimeEditor {...props} />
  );
}
