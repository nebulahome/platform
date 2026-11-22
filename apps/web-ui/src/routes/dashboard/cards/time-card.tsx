/**
 * A time the house keeps: a time of day, a day, a moment (`K-New`, Time · Date).
 *
 * The tile reads the value and how far away it is: "06:45 · in 16 h 43 min", "14 December · in
 * 27 days", "Tomorrow 06:30 · in 16 h". The strip of one the house may set edits it in place, as
 * the entity sheet does: the arrows change a draft, and one Set sends the whole value. The strip
 * of one it may only read lays the day, the time and how far away it is side by side.
 */
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { secondsOfDay } from '@nebulahome/contracts';
import { AppIcon, cn, useNow } from '@nebulahome/ui';

import { dateTimeFormat, relativeTimeFormat } from '@/i18n/formatters';
import { translate } from '@/i18n/messages';
import { paramsOf } from '@/library/entity-control';
import { durationText } from '@/library/history-stats';
import {
  clockOf,
  DAY_SECONDS,
  daysAwayText,
  formatClock,
  momentOf,
  shownZone,
  timeCapabilityOf,
  untilClock,
  wallOf,
  type TimeCapability,
} from '@/library/time-values';
import { BigValue, Caption, CardHead, NoAnswer } from '@/routes/dashboard/cards/card-kit';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import { RoundButton, StatCell } from '@/routes/dashboard/cards/control-parts';
import {
  canUse,
  cardTime,
  sizeKey,
  type EntityCardModel,
} from '@/routes/dashboard/cards/entity-model';
import { usePendingValue } from '@/routes/library/entity/use-pending-value';

/** An hour, in milliseconds. */
const HOUR_MS = 3_600_000;

/** A day, in milliseconds. */
const DAY_MS = DAY_SECONDS * 1000;

/** How far a moment's time moves at a press, at the least: a quarter of an hour. */
const MOMENT_NUDGE_SECONDS = 900;

/** How often the card reads the time: "in 16 h 43 min" counts down while it is open. */
export const MINUTE_MS = 60_000;

/**
 * How many days a day is from today on a zone's calendar.
 *
 * @param day - `YYYY-MM-DD`.
 * @param now - The time now.
 * @param zone - The zone whose today counts.
 * @returns The days, negative before today.
 */
function daysFrom(day: string, now: number, zone: string): number {
  return Math.round(
    (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${wallOf(now, zone).day}T00:00:00Z`)) / DAY_MS,
  );
}

/**
 * A day a number of days on.
 *
 * @param day - `YYYY-MM-DD`.
 * @param days - How many, back when negative.
 * @returns `YYYY-MM-DD`.
 */
function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** A value, written as the card shows it. */
type Written = {
  /** The figure on the tile: "06:45", "14 December", "Tomorrow 06:30". */
  readonly figure: string;

  /** How far away, on the tile: "in 16 h 43 min", "in 27 days", "3 h ago". */
  readonly away: string;

  /** The cells of the read-only strip: Date, Time, In. */
  readonly cells: readonly { readonly label: string; readonly value: string }[];
};

/**
 * Writes a value of one of the three.
 *
 * @param capability - Which.
 * @param value - The value, as the entity keeps it.
 * @param now - The time now.
 * @param zone - The zone moments are shown in.
 * @returns See {@link Written}.
 */
function written(capability: TimeCapability, value: string, now: number, zone: string): Written {
  const inLabel = translate('dashboard.cards.timeCard.in', 'In');

  if (capability === 'time_of_day') {
    const span = durationText(untilClock(value, now, zone));

    return {
      figure: formatClock(value),
      away: translate('dashboard.cards.timeCard.inSpan', 'in {{span}}', { span }),
      cells: [
        { label: translate('dashboard.cards.timeCard.time', 'Time'), value: formatClock(value) },
        { label: inLabel, value: span },
      ],
    };
  }

  if (capability === 'date') {
    const at = Date.parse(value);
    const isThisYear = value.slice(0, 4) === wallOf(now, zone).day.slice(0, 4);

    return {
      figure: dateTimeFormat({
        day: 'numeric',
        month: 'long',
        ...(isThisYear ? {} : { year: 'numeric' }),
        timeZone: 'UTC',
      }).format(at),
      away: relativeTimeFormat({ numeric: 'auto' }).format(daysFrom(value, now, zone), 'day'),
      cells: [
        {
          label: translate('dashboard.cards.timeCard.date', 'Date'),
          value: dateTimeFormat({
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            timeZone: 'UTC',
          }).format(at),
        },
        {
          label: translate('dashboard.cards.timeCard.when', 'When'),
          value: daysAwayText(value, now, zone),
        },
      ],
    };
  }

  const at = Date.parse(value);
  const gap = at - now;
  // Ten hours and more away, the minutes are noise: "in 16 h".
  const span = durationText(
    Math.abs(gap) >= 10 * HOUR_MS ? Math.round(Math.abs(gap) / HOUR_MS) * HOUR_MS : Math.abs(gap),
  );
  const time = dateTimeFormat({ hour: '2-digit', minute: '2-digit', timeZone: zone }).format(at);
  const day = wallOf(at, zone).day;

  return {
    // Near today, the day in a word; further, its date.
    figure:
      Math.abs(daysFrom(day, now, zone)) <= 1
        ? `${daysAwayText(day, now, zone)} ${time}`
        : dateTimeFormat({
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: zone,
          }).format(at),
    away:
      gap >= 0
        ? translate('dashboard.cards.timeCard.inSpan', 'in {{span}}', { span })
        : translate('dashboard.cards.timeCard.spanAgo', '{{span}} ago', { span }),
    cells: [
      {
        label: translate('dashboard.cards.timeCard.date', 'Date'),
        value: dateTimeFormat({
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          timeZone: zone,
        }).format(at),
      },
      { label: translate('dashboard.cards.timeCard.time', 'Time'), value: time },
      { label: gap >= 0 ? inLabel : translate('dashboard.cards.timeCard.ago', 'Ago'), value: span },
    ],
  };
}

/**
 * Renders one part of a value with an arrow either side: hours, minutes, a day.
 *
 * @param props - The part.
 * @param props.value - The part, written; `--` when not known.
 * @param props.name - What it is, for the arrows' labels.
 * @param props.width - Its width class: 104 px for two figures, more for a day or a time.
 * @param props.disabled - Whether it can be moved.
 * @param props.onStep - When an arrow is pressed, with its direction.
 * @returns The stepper.
 */
function PartStepper(props: {
  readonly value: string;
  readonly name: string;
  readonly width: 'w-[104px]' | 'w-[112px]' | 'w-[120px]' | 'w-[136px]';
  readonly disabled: boolean;
  readonly onStep: (direction: 1 | -1) => void;
}) {
  const { t } = useTranslation();

  const { value, name, width, disabled, onStep } = props;

  return (
    <div
      className={cn(
        'flex h-9 shrink-0 items-center justify-between gap-1 rounded-tile bg-surface-raised px-1',
        width,
      )}
    >
      <RoundButton
        size={24}
        icon="minus"
        label={t('dashboard.cards.timeCard.down', '{{part}} down', { part: name })}
        disabled={disabled}
        onPress={() => {
          onStep(-1);
        }}
      />
      <span className="truncate text-[17px] font-medium tracking-[-0.02em] tabular-nums">
        {value}
      </span>
      <RoundButton
        size={24}
        icon="plus"
        label={t('dashboard.cards.timeCard.up', '{{part}} up', { part: name })}
        disabled={disabled}
        onPress={() => {
          onStep(1);
        }}
      />
    </div>
  );
}

/**
 * Renders the strip of a time the house may set: its parts with arrows, and Set. A change is a
 * draft until Set sends the whole value.
 *
 * @param props - The card and which of the three it is.
 * @param props.model - See {@link EntityCardModel}.
 * @param props.capability - Which.
 * @param props.now - The time now.
 * @param props.zone - The zone moments are shown in.
 * @returns The controls.
 */
function TimeSetter(props: {
  readonly model: EntityCardModel;
  readonly capability: TimeCapability;
  readonly now: number;
  readonly zone: string;
}) {
  const { t } = useTranslation();

  const { model, capability, now, zone } = props;
  const { entity, state, reportedAt, command } = model;
  const pending = usePendingValue<string | null>(
    state[capability]?.value ?? null,
    reportedAt,
    command.sending === capability,
  );
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? pending.shown;
  const isChanged = draft !== null && draft !== pending.shown;
  const canSend = canUse(model, capability);

  /** Sends the draft whole, and shows it while it is on its way. */
  const set = (): void => {
    if (draft === null) {
      return;
    }

    pending.sent(draft);
    command.send(capability, { command: 'set_value', value: draft });
    setDraft(null);
  };

  /**
   * Renders a part of the value.
   *
   * @param value - The part, written.
   * @param name - What it is.
   * @param width - How wide.
   * @param onStep - Moves it.
   * @returns The stepper.
   */
  const part = (
    value: string,
    name: string,
    width: 'w-[104px]' | 'w-[112px]' | 'w-[120px]' | 'w-[136px]',
    onStep: (direction: 1 | -1) => void,
  ) => <PartStepper value={value} name={name} width={width} disabled={!canSend} onStep={onStep} />;

  let parts: ReactNode;

  if (capability === 'time_of_day') {
    const params = paramsOf(entity, 'time_of_day');
    const step = params?.step ?? 60;
    const min = params?.min === undefined ? null : secondsOfDay(params.min);
    const max = params?.max === undefined ? null : secondsOfDay(params.max);
    const seconds = shown === null ? null : secondsOfDay(shown);

    /**
     * Moves the time by a part's unit, kept on a step and within the limits, or round the clock.
     *
     * @param unit - The part's unit, in seconds.
     * @returns What moves the part.
     */
    const move =
      (unit: number) =>
      (direction: 1 | -1): void => {
        const from = seconds ?? wallOf(now, zone).seconds;
        const stepped = Math.round((from + direction * Math.max(unit, step)) / step) * step;
        const kept =
          min === null && max === null
            ? ((stepped % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS
            : Math.min(max ?? DAY_SECONDS - step, Math.max(min ?? 0, stepped));

        setDraft(clockOf(kept, step < 60));
      };

    // shortcut: hours on a 24-hour clock even where the language says AM / PM; the sheet has both.
    parts = (
      <>
        {part(
          seconds === null ? '--' : String(Math.floor(seconds / 3600)).padStart(2, '0'),
          t('dashboard.cards.timeCard.hours', 'Hours'),
          'w-[104px]',
          move(3600),
        )}
        <span aria-hidden="true" className="text-[17px] text-foreground-subtle">
          :
        </span>
        {part(
          seconds === null ? '--' : String(Math.floor(seconds / 60) % 60).padStart(2, '0'),
          t('dashboard.cards.timeCard.minutes', 'Minutes'),
          'w-[104px]',
          move(60),
        )}
      </>
    );
  } else if (capability === 'date') {
    const params = paramsOf(entity, 'date');

    parts = part(
      shown === null
        ? '--'
        : dateTimeFormat({ day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
            Date.parse(shown),
          ),
      t('dashboard.cards.timeCard.day', 'Day'),
      'w-[136px]',
      (direction) => {
        const next = shown === null ? wallOf(now, zone).day : addDays(shown, direction);
        const first = params?.min ?? next;
        const last = params?.max ?? next;

        setDraft(next < first ? first : next > last ? last : next);
      },
    );
  } else {
    const params = paramsOf(entity, 'datetime');
    const step = params?.step ?? 60;
    const at = shown === null ? null : Date.parse(shown);
    // A moment set a minute at a time would take an age: the time moves a quarter of an hour.
    const nudge = Math.ceil(MOMENT_NUDGE_SECONDS / step) * step;

    /**
     * Moves the moment, kept on a step and within the limits.
     *
     * @param ms - How far a press moves it.
     * @returns What moves the part.
     */
    const move =
      (ms: number) =>
      (direction: 1 | -1): void => {
        const wall = wallOf((at ?? now) + (at === null ? 0 : direction * ms), zone);
        const next = momentOf(
          wall.day,
          Math.min(Math.round(wall.seconds / step) * step, DAY_SECONDS - step),
          zone,
        );

        setDraft(
          params?.min !== undefined && Date.parse(next) < Date.parse(params.min)
            ? params.min
            : params?.max !== undefined && Date.parse(next) > Date.parse(params.max)
              ? params.max
              : next,
        );
      };

    parts = (
      <>
        {part(
          at === null
            ? '--'
            : dateTimeFormat({ day: 'numeric', month: 'short', timeZone: zone }).format(at),
          t('dashboard.cards.timeCard.day', 'Day'),
          'w-[120px]',
          move(DAY_MS),
        )}
        {part(
          at === null
            ? '--'
            : dateTimeFormat({
                hour: '2-digit',
                minute: '2-digit',
                hourCycle: 'h23',
                timeZone: zone,
              }).format(at),
          t('dashboard.cards.timeCard.time', 'Time'),
          'w-[112px]',
          move(nudge * 1000),
        )}
      </>
    );
  }

  if (command.hasFailed) {
    return (
      <div className="min-w-0 grow">
        <NoAnswer command={command} />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 grow items-center justify-end gap-2">
      {parts}
      <button
        type="button"
        disabled={!isChanged || !canSend}
        className={cn(
          'press-scale inline-flex h-9 shrink-0 items-center gap-2 rounded-pill bg-primary px-3.5 text-ui-sm font-medium whitespace-nowrap text-primary-foreground',
          'transition-[opacity,background-color] duration-200 hover:enabled:bg-primary/90 disabled:cursor-default',
          // On its way, Set stays lit with its spinner; with nothing to send, it is quiet.
          command.sending !== capability && (!isChanged || !canSend) && 'opacity-40',
        )}
        onClick={set}
      >
        {command.sending === capability ? (
          <span className="inline-flex animate-spin">
            <AppIcon id="loader-circle" size={14} />
          </span>
        ) : null}
        {t('dashboard.cards.timeCard.set', 'Set')}
      </button>
    </div>
  );
}

/**
 * Renders a time card at its size.
 *
 * @param props - The card, ready to draw.
 * @param props.model - See {@link EntityCardModel}.
 * @returns The card.
 */
export function TimeCard(props: { readonly model: EntityCardModel }) {
  const { t } = useTranslation();

  const { model } = props;
  const { entity, state, title } = model;
  const now = useNow(MINUTE_MS);
  const zone = shownZone();
  const capability = timeCapabilityOf(entity) ?? 'time_of_day';
  const value = state[capability]?.value ?? null;
  const canSet = paramsOf(entity, capability)?.canSet === true;
  const shown = value === null ? null : written(capability, value, now, zone);

  if (sizeKey(model.size) === '2x1') {
    const isSetting = canSet && model.canControl;

    return (
      <CardFrame label={title}>
        <div className={cn('flex h-full min-w-0 items-center', isSetting ? 'gap-4' : 'gap-5')}>
          <div className="w-[200px] shrink-0">
            <CardHead model={model} isActive={null} tail={canSet ? null : undefined} />
          </div>
          {isSetting ? (
            <TimeSetter model={model} capability={capability} now={now} zone={zone} />
          ) : (
            <div
              className={cn(
                'grid min-w-0 grow gap-3',
                capability === 'datetime' ? 'grid-cols-[1.2fr_0.8fr_0.8fr]' : 'grid-cols-2',
              )}
            >
              {(
                shown?.cells ?? [
                  { label: t('dashboard.cards.timeCard.value', 'Value'), value: '—' },
                ]
              ).map((cell) => (
                <StatCell key={cell.label} label={cell.label}>
                  {cell.value}
                </StatCell>
              ))}
            </div>
          )}
        </div>
      </CardFrame>
    );
  }

  const caption = model.isOffline
    ? model.changedAt === null
      ? t('dashboard.cards.kit.unreachable', 'Not reachable')
      : t('dashboard.cards.kit.lastSeen', 'last seen {{time}}', {
          time: cardTime(model.changedAt),
        })
    : (shown?.away ?? t('dashboard.cards.kit.waitingForDevice', 'Waiting for the device'));

  return (
    <CardFrame label={title}>
      <CardHead model={model} isActive={null} />
      <div className="grow" />
      <div className="flex min-w-0 items-end justify-between gap-2.5">
        <BigValue
          value={shown?.figure ?? '—'}
          size={shown !== null && capability === 'time_of_day' ? 26 : 22}
          className={model.isOffline || shown === null ? 'text-foreground-subtle' : undefined}
        />
        <Caption>{caption}</Caption>
      </div>
    </CardFrame>
  );
}
