/**
 * The parts the dashboard's cards are drawn with, measure for measure as the design boards draw
 * them (`K-All`): the head every card starts with, the reading in large figures, the 36 px bars
 * that are both a level and its slider, the swatches, the day in 24 blocks, the round power button.
 *
 * A card is composed of these and nothing else, so a light and a sensor side by side read as two
 * cards of one page, and the states every card shares - out of reach, view only, sending, no
 * answer - are drawn the same way on each.
 */
import { useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon, cn, Switch, type UiIconId } from '@nebulahome/ui';

import { translate } from '@/i18n/messages';
import { powerCommand } from '@/library/entity-control';
import { canUse, type EntityCardModel } from '@/routes/dashboard/cards/entity-model';
import type { CardCommand } from '@/routes/dashboard/cards/use-card-command';
import { usePendingValue } from '@/routes/library/entity/use-pending-value';
import { EntityTile } from '@/routes/library/entity-tile';

/** The sizes a reading is written at, and its unit beside it. */
const BIG = {
  22: { value: 'text-[22px]/none', unit: 'text-[13px]' },
  26: { value: 'text-[26px]/none', unit: 'text-[13px]' },
  30: { value: 'text-[30px]/none', unit: 'text-[14px]' },
  36: { value: 'text-[36px]/none', unit: 'text-[15px]' },
  40: { value: 'text-[40px]/none', unit: 'text-[17px]' },
} as const;

/** A size a reading is written at. */
export type BigSize = keyof typeof BIG;

/** What a reading needs. */
export type BigValueProps = {
  /** The figure or the word. */
  readonly value: string;

  /** Its unit, written smaller beside it. */
  readonly unit?: string | undefined;

  /** How large. */
  readonly size?: BigSize;

  /** A colour class for the figure: muted for off, a state's colour for a lock. */
  readonly className?: string | undefined;
};

/**
 * Renders a reading in large figures, with its unit small beside it.
 *
 * @param props - See {@link BigValueProps}.
 * @returns The reading.
 */
export function BigValue(props: BigValueProps) {
  const { value, unit, size = 26, className } = props;

  return (
    <span
      className={cn(
        'font-medium tracking-[-0.03em] whitespace-nowrap tabular-nums transition-colors duration-200',
        BIG[size].value,
        className ?? 'text-foreground',
      )}
    >
      {value}
      {unit === undefined || unit === '' ? null : (
        <span
          className={cn(
            'ml-[3px] font-normal tracking-normal text-foreground-subtle',
            BIG[size].unit,
          )}
        >
          {unit}
        </span>
      )}
    </span>
  );
}

/**
 * Renders a line of small text on a card: a time, a white, a count.
 *
 * @param props - The text and its colour.
 * @param props.children - The text.
 * @param props.className - A colour class, when not the quiet one.
 * @returns The line.
 */
export function Caption(props: { readonly children: ReactNode; readonly className?: string }) {
  const { children, className } = props;

  return (
    <span
      className={cn(
        'min-w-0 truncate text-caption leading-normal tabular-nums',
        className ?? 'text-foreground-subtle',
      )}
    >
      {children}
    </span>
  );
}

/** What a card's head needs. */
export type CardHeadProps = {
  /** The card. */
  readonly model: EntityCardModel;

  /** Whether the thing is on, open or playing: the chip takes its colour; null for a reading. */
  readonly isActive: boolean | null;

  /** What sits at the right: its switch, a badge. Left out when the card is out of reach. */
  readonly tail?: ReactNode;

  /** The chip's colour when the state calls for its own: a lock left open, one jammed. */
  readonly tone?: 'warning' | 'danger' | undefined;
};

/**
 * Renders the head every entity card starts with: the chip, the name and where it is, and at the
 * right what the card says first - its switch, or that it cannot be reached, or that it may only
 * be looked at.
 *
 * @param props - See {@link CardHeadProps}.
 * @returns The head.
 */
export function CardHead(props: CardHeadProps) {
  const { t } = useTranslation();

  const { model, isActive, tail, tone } = props;
  const { reading } = model;
  const isOffline = !reading.isAvailable;
  const end = isOffline ? (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-pill border border-border-strong px-2.5 text-caption font-medium text-foreground-muted">
      <AppIcon id="wifi-off" size={12} />
      {t('dashboard.cards.kit.offline', 'Offline')}
    </span>
  ) : model.canControl || tail === undefined ? (
    tail
  ) : (
    <span
      className="inline-flex text-foreground-subtle"
      title={t('dashboard.cards.kit.viewOnly', 'View only')}
    >
      <AppIcon id="eye" size={14} />
    </span>
  );

  return (
    <div className="flex h-8 shrink-0 items-center gap-2.5">
      <EntityTile
        icon={model.icon}
        kind={model.kind}
        isActive={isActive}
        isAvailable={!isOffline}
        className={
          isOffline || tone === undefined
            ? ''
            : tone === 'warning'
              ? 'bg-warning/14 text-warning'
              : 'bg-danger/14 text-danger'
        }
        size="medium"
      />
      <div className="flex min-w-0 grow flex-col">
        <span className="truncate text-ui leading-[18px] font-medium text-foreground">
          {model.title}
        </span>
        {model.subtitle === null || model.subtitle === '' ? null : (
          <span className="truncate text-caption leading-4 text-foreground-subtle">
            {model.subtitle}
          </span>
        )}
      </div>
      {end === undefined ? null : <div className="flex shrink-0 items-center gap-2">{end}</div>}
    </div>
  );
}

/** What a bar slider needs. */
export type BarSliderProps = {
  /** What it sets, written on it. */
  readonly label: string;

  /** The icon in front of the label; none on a gradient bar. */
  readonly icon?: UiIconId;

  /** Where it is. */
  readonly value: number;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;

  /** The value as written at the right end; nothing when absent. */
  readonly display?: string | undefined;

  /**
   * How it is drawn: a fill in a colour up to the value, on the sunk track; or a whole scale as a
   * gradient - a white, a hue - with a knob on it.
   */
  readonly look: { readonly fill: string } | { readonly gradient: string };

  /** Whether it can be moved. */
  readonly disabled?: boolean;

  /** While moved. */
  readonly onChange: (value: number) => void;

  /** When let go: the value to send. */
  readonly onCommit: (value: number) => void;
};

/**
 * Renders a 36 px bar that is a level and its slider at once: a brightness, a white, a speed.
 *
 * The bar is a native range input laid over the drawing, so the pointer, the keyboard and a
 * screen reader all work as they do on any slider; the value is sent once, when it is let go.
 *
 * @param props - See {@link BarSliderProps}.
 * @returns The slider.
 */
export function BarSlider(props: BarSliderProps) {
  const {
    label,
    icon,
    value,
    min = 0,
    max = 100,
    step = 1,
    display,
    look,
    disabled = false,
    onChange,
    onCommit,
  } = props;
  const latest = useRef(value);
  const percent = max === min ? 0 : Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
  const isGradient = 'gradient' in look;

  /** Sends what the bar was let go at. */
  const commit = (): void => {
    onCommit(latest.current);
  };

  return (
    <div
      className={cn(
        'relative h-9 shrink-0 overflow-hidden rounded-tile transition-opacity duration-200',
        'has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-primary',
        isGradient ? undefined : 'bg-surface-raised',
        disabled && 'opacity-40',
      )}
      /* eslint-disable-next-line react/forbid-dom-props -- a white's or a hue's own scale, worked
      out from the device's limits (RULES.md 15.3). */
      style={isGradient ? { background: look.gradient } : undefined}
    >
      {isGradient ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-1 w-2 rounded-[4px] bg-knob shadow-[0_0_0_2px_rgb(5_6_12/0.5)] transition-[left] duration-150 ease-out"
          /* eslint-disable-next-line react/forbid-dom-props -- the knob sits at the value. */
          style={{ left: `calc(${String(percent)}% - 4px)` }}
        />
      ) : (
        <>
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-0 transition-[width] duration-150 ease-out"
            /* eslint-disable-next-line react/forbid-dom-props -- filled up to the value, in the
            colour of what it sets. */
            style={{
              width: `${String(percent)}%`,
              background: `linear-gradient(90deg, color-mix(in srgb, ${look.fill} 35%, transparent), color-mix(in srgb, ${look.fill} 60%, transparent))`,
            }}
          />
          <span
            aria-hidden="true"
            className="absolute inset-y-2 w-[3px] rounded-[2px] bg-knob opacity-90 transition-[left] duration-150 ease-out"
            /* eslint-disable-next-line react/forbid-dom-props -- the tick sits at the value. */
            style={{ left: `calc(${String(percent)}% - 6px)` }}
          />
        </>
      )}
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-0 flex items-center justify-between px-3 text-caption',
          isGradient ? 'font-medium text-primary-foreground' : 'text-foreground',
        )}
      >
        <span className="flex items-center gap-1.5">
          {icon === undefined ? null : <AppIcon id={icon} size={14} />}
          {label}
        </span>
        {display === undefined ? null : <span className="tabular-nums">{display}</span>}
      </span>
      <input
        type="range"
        aria-label={label}
        aria-valuetext={display}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-default"
        onChange={(event) => {
          latest.current = Number(event.target.value);
          onChange(latest.current);
        }}
        onPointerUp={commit}
        onKeyUp={commit}
      />
    </div>
  );
}

/** One swatch: what it is called, its colour, and whether the light is making it. */
export type Swatch = {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly isChosen: boolean;
};

/**
 * Renders a light's presets as a row of round swatches; the one it is making is ringed.
 *
 * @param props - The swatches.
 * @param props.swatches - See {@link Swatch}.
 * @param props.size - Their size: 18 on a tall card, 20 on a square one.
 * @param props.disabled - Whether they can be chosen.
 * @param props.onChoose - When one is chosen.
 * @returns The row.
 */
export function Swatches(props: {
  readonly swatches: readonly Swatch[];
  readonly size?: 18 | 20;
  readonly disabled?: boolean;
  readonly onChoose: (id: string) => void;
}) {
  const { swatches, size = 18, disabled = false, onChoose } = props;

  return (
    <div className="flex gap-2">
      {swatches.map((swatch) => (
        <button
          key={swatch.id}
          type="button"
          aria-label={swatch.label}
          aria-pressed={swatch.isChosen}
          title={swatch.label}
          disabled={disabled}
          className={cn(
            'shrink-0 rounded-full transition-[box-shadow,transform] duration-150 ease-out',
            'focus-visible:outline-none hover:enabled:scale-110 disabled:opacity-40',
            size === 18 ? 'size-4.5' : 'size-5',
            swatch.isChosen
              ? 'shadow-[0_0_0_2px_var(--color-surface),0_0_0_4px_var(--color-foreground)]'
              : 'focus-visible:shadow-[0_0_0_2px_var(--color-surface),0_0_0_4px_var(--color-primary)]',
          )}
          /* eslint-disable-next-line react/forbid-dom-props -- each swatch is its own colour. */
          style={{ background: swatch.color }}
          onClick={() => {
            onChoose(swatch.id);
          }}
        />
      ))}
    </div>
  );
}

/**
 * Renders a day as 24 small blocks, one an hour, lit when the thing was on or open in it.
 *
 * @param props - The hours.
 * @param props.hours - Whether each hour of the last 24 had it on, oldest first.
 * @param props.color - What the lit blocks are drawn in, a CSS colour.
 * @param props.label - What they show, for a screen reader.
 * @returns The blocks.
 */
export function DayBlocks(props: {
  readonly hours: readonly boolean[];
  readonly color: string;
  readonly label: string;
}) {
  const { hours, color, label } = props;

  return (
    <div role="img" aria-label={label} className="flex gap-[3px]">
      {hours.map((isOn, index) => (
        <span
          // The hours keep their place: the index is the hour.
          // eslint-disable-next-line react/no-array-index-key
          key={index}
          className={cn('h-4 flex-1 rounded-[3px]', isOn ? undefined : 'bg-surface-raised')}
          /* eslint-disable-next-line react/forbid-dom-props -- lit in the colour of the thing. */
          style={isOn ? { background: color } : undefined}
        />
      ))}
    </div>
  );
}

/**
 * Renders the large round power button of a tall card for something that only switches.
 *
 * @param props - What it switches.
 * @param props.isOn - Whether it is on.
 * @param props.color - Its colour when on, a CSS colour.
 * @param props.label - What it is, for a screen reader.
 * @param props.disabled - Whether it can be pressed.
 * @param props.onPress - When pressed.
 * @returns The button.
 */
export function PowerButton(props: {
  readonly isOn: boolean;
  readonly color: string;
  readonly label: string;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}) {
  const { isOn, color, label, disabled = false, onPress } = props;

  return (
    <button
      type="button"
      aria-pressed={isOn}
      aria-label={label}
      disabled={disabled}
      className={cn(
        'press-scale flex size-19 shrink-0 items-center justify-center rounded-full border',
        'transition-[background,box-shadow,border-color,color] duration-300 ease-out disabled:opacity-40',
        isOn ? 'text-foreground' : 'border-border-strong bg-surface-raised text-foreground-subtle',
      )}
      /* eslint-disable-next-line react/forbid-dom-props -- lit in the colour of the thing. */
      style={
        isOn
          ? {
              borderColor: `color-mix(in srgb, ${color} 60%, transparent)`,
              background: `radial-gradient(circle at 50% 35%, color-mix(in srgb, ${color} 35%, transparent), color-mix(in srgb, ${color} 12%, transparent))`,
              boxShadow: `0 0 32px color-mix(in srgb, ${color} 35%, transparent)`,
            }
          : undefined
      }
      onClick={onPress}
    >
      <AppIcon id="power" size={28} />
    </button>
  );
}

/**
 * Renders a card's caption while nothing is out, or "Turning on…" with a spinner while a command
 * waits for its answer.
 *
 * @param props - The command and the words.
 * @param props.command - See {@link CardCommand}.
 * @param props.sending - What the card says while a command is out, "Turning on…".
 * @param props.children - The caption while nothing is out.
 * @returns The caption.
 */
export function CommandNote(props: {
  readonly command: CardCommand;
  readonly sending: string;
  readonly children?: ReactNode;
}) {
  const { command, sending, children } = props;

  if (command.sending === null) {
    return children ?? null;
  }

  return (
    <span className="inline-flex min-w-0 animate-fade-in items-center gap-1.5 text-caption text-cyan">
      <span className="inline-flex shrink-0 animate-spin">
        <AppIcon id="loader-circle" size={13} />
      </span>
      <span className="truncate">{sending}</span>
    </span>
  );
}

/**
 * Renders the row a card shows in place of its last one when a command went unanswered: what
 * happened, in the danger colour, and Try again. It leaves by itself (`NO_ANSWER_SHOWN_MS`). A
 * card of several members says how many did not answer, and Try again sends to those only.
 *
 * @param props - The command.
 * @param props.command - How to try again, and how many members did not answer, for a card of
 *   several (`TogetherCommand`).
 * @param props.what - What did not happen, when the card says more than "Did not answer".
 * @returns The row.
 */
export function NoAnswer(props: {
  readonly command: Pick<CardCommand, 'retry'> & { readonly unanswered?: number };
  readonly what?: string;
}) {
  const { t } = useTranslation();

  const { command, what } = props;
  const said =
    command.unanswered === undefined
      ? t('dashboard.cards.kit.didNotAnswer', 'Did not answer')
      : t('dashboard.cards.togetherCard.didNotAnswer', {
          count: command.unanswered,
          defaultValue_one: '{{count}} did not answer',
          defaultValue_other: '{{count}} did not answer',
        });

  return (
    <span className="flex min-w-0 animate-rise items-center justify-between gap-2.5">
      <span className="inline-flex min-w-0 items-center gap-1.5 text-ui-sm text-danger">
        <AppIcon id="triangle-alert" size={14} />
        <span className="truncate">
          {what === undefined
            ? said
            : t('dashboard.cards.kit.whatDidNotAnswer', '{{what}} · did not answer', { what })}
        </span>
      </span>
      <button
        type="button"
        className="press-scale relative z-10 inline-flex h-7.5 shrink-0 items-center rounded-pill border border-border-strong bg-surface-raised px-3.5 text-ui-sm font-medium text-foreground hover:bg-surface-high"
        onClick={command.retry}
      >
        {t('dashboard.cards.kit.tryAgain', 'Try again')}
      </button>
    </span>
  );
}

/**
 * Renders the switch at the right of a card's head, sending through the card's command: it moves
 * at once, waits for the device, and goes back when the device does not answer.
 *
 * @param props - The card.
 * @param props.model - See {@link EntityCardModel}.
 * @returns The switch.
 */
export function CardSwitch(props: { readonly model: EntityCardModel }) {
  const { model } = props;
  const isOn = model.state.on_off?.isOn ?? false;
  const power = usePendingValue(isOn, model.reportedAt);
  // A command that went unanswered leaves the device where it was: the switch says so.
  const shown = model.command.hasFailed ? isOn : power.shown;

  return (
    <span className="relative z-10 inline-flex items-center">
      <Switch
        label={model.title}
        size="medium"
        isOn={shown}
        isBusy={model.command.sending === 'on_off'}
        disabled={!canUse(model, 'on_off')}
        onChange={(next) => {
          power.sent(next);
          model.command.send('on_off', powerCommand(next));
        }}
      />
    </span>
  );
}

/**
 * Writes how long something has been as it is, as briefly as a card has room for.
 *
 * @param since - When it became so.
 * @param now - The moment it is measured to.
 * @returns "for 24 min", "for 2 h", "for 3 d".
 */
export function forHowLong(since: Date, now: number = Date.now()): string {
  const minutes = Math.max(1, Math.round((now - since.getTime()) / 60_000));
  const time =
    minutes < 60
      ? translate('dashboard.cards.kit.minutes', '{{count}} min', { count: minutes })
      : minutes < 48 * 60
        ? translate('dashboard.cards.kit.hours', '{{count}} h', {
            count: Math.round(minutes / 60),
          })
        : translate('dashboard.cards.kit.days', '{{count}} d', {
            count: Math.round(minutes / 1440),
          });

  return translate('dashboard.cards.kit.forTime', 'for {{time}}', { time });
}
