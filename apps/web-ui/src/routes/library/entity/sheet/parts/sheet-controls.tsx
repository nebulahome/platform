/**
 * The controls the bodies of the entity dialog share, as the Nebula canvas draws them: the round
 * power target, the wide level bar with its quick levels, the levels bar of speeds and suctions,
 * the head of a block, the thin slider of a second level, the round buttons of an action, the
 * battery ring, and the line saying since when and because of whom.
 */
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { EntityView } from '@nebulahome/contracts';
import { AppIcon, cn, type UiIconId } from '@nebulahome/ui';

import { clockText } from '@/routes/library/entity/sheet/history';
import { usePicked } from '@/routes/library/entity/sheet/parts/option-list';
import {
  TILE_LIT,
  TONE_BAR,
  TONE_CHOSEN,
  TONE_FILL,
  TONE_REACHED,
  TONE_TEXT,
  type SheetTone,
} from '@/routes/library/entity/sheet/tones';

/**
 * The line under a big value: since when the state is what it is. Who or what changed it is not
 * said here: that belongs to the entity's activity.
 *
 * @param entity - The entity, for when it last changed.
 * @returns "Since 21:48", or nothing when it never changed.
 */
export function useSinceLine(entity: EntityView): string {
  const { t } = useTranslation();
  const changed = entity.lastChanged?.getTime();

  return changed === undefined
    ? ''
    : t('entity.sheet.since', 'Since {{time}}', { time: clockText(changed) });
}

/** What the power target needs. */
export type PowerTargetProps = {
  /** What it switches, to a screen reader. */
  readonly label: string;

  /** Whether the thing is on. */
  readonly isOn: boolean;

  /** Called with what it should become. */
  readonly onChange: (isOn: boolean) => void;

  /** Its colour when on. */
  readonly tone: SheetTone;

  /** Whether it cannot be used now. */
  readonly disabled?: boolean;

  /** Its glyph: power, or a plug for a socket. */
  readonly icon?: UiIconId;

  /** Whether a command is on its way: the glyph turns into a spinner, so no word moves. */
  readonly isSending?: boolean;
};

/**
 * The round target a thing that only switches is turned on and off with: 176 px, glowing in its
 * colour while on.
 *
 * @param props - See {@link PowerTargetProps}.
 * @returns The target.
 */
export function PowerTarget(props: PowerTargetProps) {
  const { t } = useTranslation();
  const { label, isOn, onChange, tone, disabled = false } = props;
  // Each switching on sends out one ring; its count keys it, so the next one plays again.
  const [rings, setRings] = useState(0);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isOn}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        if (!isOn) {
          setRings(rings + 1);
        }

        onChange(!isOn);
      }}
      className={cn(
        'press-scale relative flex size-44 shrink-0 cursor-pointer items-center justify-center self-center rounded-full border p-0',
        'entity-tint disabled:cursor-not-allowed',
        isOn
          ? cn(
              TONE_TEXT[tone],
              'border-current/50 bg-[radial-gradient(circle_at_50%_38%,color-mix(in_oklab,currentColor_34%,transparent),color-mix(in_oklab,currentColor_8%,transparent)_72%)]',
              'shadow-[0_0_44px_color-mix(in_oklab,currentColor_14%,transparent),inset_0_1px_0_rgb(255_255_255/0.08)]',
            )
          : 'border-border-strong bg-surface-raised text-foreground-subtle shadow-edge',
      )}
    >
      {rings === 0 ? null : (
        <span
          key={rings}
          aria-hidden="true"
          className={cn(
            'entity-ripple pointer-events-none absolute -inset-px rounded-full border-2',
            TONE_TEXT[tone],
            'border-current',
          )}
        />
      )}
      {props.isSending === true ? (
        <span
          role="status"
          aria-label={t('entity.sheet.sending', 'Sending')}
          className="entity-spin flex"
        >
          <AppIcon id="loader-circle" size={48} strokeWidth={1.6} />
        </span>
      ) : (
        <AppIcon id={props.icon ?? 'power'} size={48} strokeWidth={1.6} />
      )}
    </button>
  );
}

/** The knob's motion: it travels with a little overshoot, and turns colour as the rest does. */
const KNOB_MOTION =
  '[transition:translate_520ms_cubic-bezier(0.34,1.35,0.64,1),scale_160ms_ease-out,background-color_400ms_cubic-bezier(0.2,0.8,0.2,1),color_400ms_cubic-bezier(0.2,0.8,0.2,1),box-shadow_400ms_cubic-bezier(0.2,0.8,0.2,1)]';

/**
 * A switch drawn as a tall toggle: a rounded track, and a knob that slides to the top while on -
 * filled in the kind's colour, the power glyph on it - and to the bottom while off. The knob
 * overshoots a little as it lands, sinks under the finger, and turns its glyph into a spinner
 * while a command is on its way.
 *
 * @param props - See {@link PowerTargetProps}.
 * @returns The switch.
 */
export function RockerSwitch(props: PowerTargetProps) {
  const { t } = useTranslation();
  const { label, isOn, onChange, tone, disabled = false, isSending = false } = props;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isOn}
      aria-label={label}
      aria-busy={isSending}
      disabled={disabled}
      onClick={() => {
        onChange(!isOn);
      }}
      className={cn(
        'entity-tint group relative flex h-50 w-28 shrink-0 cursor-pointer flex-col self-center rounded-[36px] border p-1.5',
        'disabled:cursor-not-allowed disabled:opacity-60',
        isOn ? TILE_LIT[tone] : 'border-border-strong bg-surface-raised',
      )}
    >
      {/* A mark in each half, where the knob would rest; the knob covers its own. */}
      {(['top-1/4', 'top-3/4'] as const).map((place) => (
        <span
          key={place}
          aria-hidden="true"
          className={cn(
            'absolute left-1/2 size-1.5 -translate-1/2 rounded-full bg-foreground-disabled',
            place,
          )}
        />
      ))}
      <span
        className={cn(
          'relative flex h-1/2 w-full items-center justify-center rounded-[30px]',
          KNOB_MOTION,
          'group-active:scale-[0.96]',
          isOn
            ? cn(
                TONE_FILL[tone],
                'translate-y-0 shadow-[0_10px_26px_-10px_rgb(0_0_0/0.65),inset_0_1px_0_rgb(255_255_255/0.25)]',
              )
            : 'translate-y-full bg-surface-high text-foreground-muted shadow-[0_8px_20px_-8px_rgb(0_0_0/0.7),inset_0_1px_0_rgb(255_255_255/0.06)]',
        )}
      >
        {isSending ? (
          <span
            role="status"
            aria-label={t('entity.sheet.sending', 'Sending')}
            className="entity-spin flex"
          >
            <AppIcon id="loader-circle" size={26} />
          </span>
        ) : (
          <span key={String(isOn)} className="entity-pop flex">
            <AppIcon
              id={isOn ? (props.icon ?? 'power') : props.icon === 'plug' ? 'plug' : 'power-off'}
              size={26}
            />
          </span>
        )}
      </span>
    </button>
  );
}

/** What the level bar needs. */
export type LevelBarProps = {
  /** What it sets, to a screen reader: "Brightness". */
  readonly label: string;

  /** The level, 0 to 100. */
  readonly value: number;

  /** Called with a level as it is dragged. */
  readonly onChange: (value: number) => void;

  /** Called with the level let go at. */
  readonly onCommit: (value: number) => void;

  /** Whether the thing is on: off, the bar keeps the level greyed. */
  readonly isOn: boolean;

  /** Its colour. */
  readonly tone: SheetTone;

  /** A colour of its own instead, for a lamp showing one: `hsl(…)`. */
  readonly colour?: string;

  /** The glyph at its left. */
  readonly icon?: UiIconId;

  /** Whether it cannot be used now. */
  readonly disabled?: boolean;
};

/**
 * The wide bar a level is dragged on: filled to the level, a sun at its left. One height wherever
 * it is, 72 px, so a lamp that only dims and one with colours under it look the same.
 *
 * @param props - See {@link LevelBarProps}.
 * @returns The bar.
 */
export function LevelBar(props: LevelBarProps) {
  const { t } = useTranslation();
  const { label, value, onChange, onCommit, isOn, tone, colour } = props;

  return (
    <div
      className={cn(
        'entity-slider group relative h-18 overflow-hidden rounded-[22px] border border-border-strong bg-surface-raised',
      )}
    >
      <div
        className={cn(
          'entity-track absolute inset-y-0 left-0 transition-[filter] group-hover:brightness-110',
          isOn ? (colour === undefined ? TONE_BAR[tone] : '') : TONE_BAR.muted,
        )}
        // eslint-disable-next-line react/forbid-dom-props -- the fill is the level, and a lamp's colour its own
        style={{
          width: `${String(value)}%`,
          ...(isOn && colour !== undefined
            ? { backgroundColor: `color-mix(in oklab, ${colour} 82%, transparent)` }
            : {}),
        }}
      >
        {/* The shade over its start, so the fill brightens towards the level. */}
        <span className="absolute inset-0 bg-linear-to-r from-surface-raised/75 to-transparent" />
      </div>
      <span
        className={cn(
          'pointer-events-none absolute top-1/2 left-5.5 flex -translate-y-1/2',
          isOn ? 'text-canvas' : 'text-foreground-subtle',
        )}
      >
        <AppIcon id={props.icon ?? 'sun'} size={22} />
      </span>
      {/* The handle at the edge of the fill: it grows under the pointer and while held. */}
      <span
        aria-hidden="true"
        className={cn(
          'entity-track pointer-events-none absolute top-1/2 h-8 w-1.5 -translate-1/2 rounded-pill',
          'shadow-[0_0_0_1px_rgb(0_0_0/0.12),0_2px_10px_rgb(0_0_0/0.35)]',
          'group-hover:h-10 group-has-[input:active]:h-12 group-has-[input:active]:w-2',
          isOn ? 'bg-knob' : 'bg-foreground-subtle',
        )}
        // eslint-disable-next-line react/forbid-dom-props -- the handle rides the edge of the level, under the pointer
        style={{ left: `clamp(8px, ${String(value)}%, calc(100% - 8px))` }}
      />
      <input
        type="range"
        min={1}
        max={100}
        value={value}
        disabled={props.disabled}
        aria-label={label}
        aria-valuetext={t('entity.sheet.percent', '{{value}}%', { value })}
        onChange={(event) => {
          onChange(Number(event.target.value));
        }}
        onPointerUp={(event) => {
          onCommit(Number(event.currentTarget.value));
        }}
        onKeyUp={(event) => {
          onCommit(Number(event.currentTarget.value));
        }}
        className="entity-range absolute inset-0 m-0 size-full cursor-grab opacity-0 active:cursor-grabbing disabled:cursor-not-allowed"
      />
    </div>
  );
}

/** What the quick levels need. */
export type QuickPicksProps = {
  /** The levels, in percent. */
  readonly values: readonly number[];

  /** The level now, when the thing is on. */
  readonly value: number | null;

  /** Called with a level. */
  readonly onPick: (value: number) => void;

  /** Their colour when chosen. */
  readonly tone: SheetTone;

  /** Whether they cannot be used now. */
  readonly disabled?: boolean;
};

/**
 * The row of quick levels under a bar: 25, 50, 75, 100.
 *
 * @param props - See {@link QuickPicksProps}.
 * @returns The row.
 */
export function QuickPicks(props: QuickPicksProps) {
  const { t } = useTranslation();
  const { values, value, onPick, tone, disabled = false } = props;

  return (
    <div className="grid grid-cols-4 gap-2">
      {values.map((each) => (
        <button
          key={each}
          type="button"
          disabled={disabled}
          onClick={() => {
            onPick(each);
          }}
          className={cn(
            'press entity-tint h-9 cursor-pointer rounded-tile border text-ui-sm font-medium tabular',
            'disabled:cursor-not-allowed',
            value === each
              ? cn('entity-pop', TONE_CHOSEN[tone])
              : 'border-border-strong bg-surface-raised text-foreground',
          )}
        >
          {t('entity.sheet.percent', '{{value}}%', { value: each })}
        </button>
      ))}
    </div>
  );
}

/** What a block's head needs. */
export type BlockHeadProps = {
  /** What the block is: "Effect", "Fan". */
  readonly title: string;

  /** What it reads at the right: "4 from the light". */
  readonly aside?: ReactNode;
};

/**
 * The head of a block of controls: its name in small capitals, and what it reads.
 *
 * @param props - See {@link BlockHeadProps}.
 * @returns The head.
 */
export function BlockHead(props: BlockHeadProps) {
  return (
    <div className="flex h-4.5 items-center justify-between gap-3">
      <span className="font-mono text-label text-foreground-subtle uppercase">{props.title}</span>
      {props.aside === undefined ? null : (
        <span className="text-ui-sm text-foreground-muted">{props.aside}</span>
      )}
    </div>
  );
}

/** One level of a levels bar. */
export type Level = {
  readonly value: string;
  readonly label: string;
};

/** What the levels bar needs. */
export type LevelStepsProps = {
  /** What it sets: "Suction", "Fan". */
  readonly title: string;

  /** The levels, lowest first. */
  readonly levels: readonly Level[];

  /** The level now, or null for none of them (Auto). */
  readonly value: string | null;

  /** Called with a level. */
  readonly onPick: (value: string) => void;

  /** The colour of the levels reached. */
  readonly tone: SheetTone;

  /** Its unit, for a slider of more than ten levels. */
  readonly unit?: string;

  /** Whether it cannot be used now. */
  readonly disabled?: boolean;
};

/**
 * A bar of levels, by how many there are (canvas `N-Entity-Index-Fields`, "Levels"): up to five
 * named steps; six to ten numbered; more than ten a slider with the unit. The levels below the
 * chosen one are lit too, so the bar reads as how far up it is.
 *
 * @param props - See {@link LevelStepsProps}.
 * @returns The bar.
 */
export function LevelSteps(props: LevelStepsProps) {
  const { t } = useTranslation();
  const { title, levels, value: reported, onPick: send, tone, unit = '', disabled = false } = props;
  const [value, pick] = usePicked(reported);
  const chosen = levels.findIndex((level) => level.value === value);
  /**
   * Picks a level: shown at once, sent to the device.
   *
   * @param next - The level.
   */
  const onPick = (next: string): void => {
    pick(next);
    send(next);
  };

  if (levels.length > 10) {
    const index = Math.max(0, chosen);

    return (
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={levels.length - 1}
          value={index}
          disabled={disabled}
          aria-label={title}
          aria-valuetext={levels[index]?.label}
          onChange={(event) => {
            const level = levels[Number(event.target.value)];

            if (level !== undefined) {
              onPick(level.value);
            }
          }}
          className="min-w-0 grow accent-current"
        />
        <span className={cn('font-mono text-mono-caption tabular select-text', TONE_TEXT[tone])}>
          {levels[index]?.label ?? '—'}
          {unit}
        </span>
      </div>
    );
  }

  return (
    <div role="radiogroup" aria-label={title} className="flex grow gap-1">
      {levels.map((level, index) => {
        const isChosen = index === chosen;
        const isBelow = chosen >= 0 && index < chosen;

        return (
          <button
            key={level.value}
            type="button"
            role="radio"
            aria-checked={isChosen}
            aria-label={level.label}
            disabled={disabled}
            onClick={() => {
              onPick(level.value);
            }}
            className={cn(
              'press flex h-10 min-w-0 flex-1 cursor-pointer items-center justify-center rounded-tile px-1',
              'entity-tint disabled:cursor-not-allowed',
              isChosen
                ? cn('entity-pop', TONE_FILL[tone])
                : isBelow
                  ? TONE_REACHED[tone]
                  : 'bg-surface-high text-foreground-muted',
            )}
          >
            <span
              className={cn('truncate text-caption', isChosen ? 'font-semibold' : 'font-medium')}
            >
              {levels.length > 5
                ? t('entity.sheet.levelNumber', '{{n}}', { n: index + 1 })
                : level.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** What a round action button needs. */
export type RoundActionProps = {
  /** Its glyph. */
  readonly icon: UiIconId;

  /** What it does, to a screen reader and on hover. */
  readonly label: string;

  /** Called when pressed. */
  readonly onClick: () => void;

  /** Its size: 52 beside a main button, 44 in a row. */
  readonly size?: 'large' | 'medium';

  /** Whether it is lit in the interface's colour: Stop while a cover moves. */
  readonly isLit?: boolean;

  /** Whether it cannot be used now. */
  readonly disabled?: boolean;
};

/**
 * A round button with a glyph: Dock, Locate, Stop beside a main button.
 *
 * @param props - See {@link RoundActionProps}.
 * @returns The button.
 */
export function RoundAction(props: RoundActionProps) {
  const { icon, label, onClick, size = 'large', disabled = false } = props;

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'press-scale flex shrink-0 cursor-pointer items-center justify-center rounded-full border p-0',
        'transition-colors duration-300 hover:border-foreground-subtle disabled:cursor-not-allowed disabled:opacity-50',
        props.isLit === true
          ? 'border-primary/50 bg-primary/12 text-primary'
          : 'border-border-strong bg-surface-raised text-foreground',

        size === 'large' ? 'size-13' : 'size-11',
      )}
    >
      <AppIcon id={icon} size={20} />
    </button>
  );
}

/** What the battery ring needs. */
export type BatteryRingProps = {
  /** The charge, 0 to 100; null draws the kind's glyph in a plain ring instead. */
  readonly level: number | null;

  /** The kind's colour, for the plain ring. */
  readonly tone: SheetTone;

  /** The glyph inside the plain ring. */
  readonly icon: UiIconId;
};

/** The plain ring of a robot without a battery reading, in its colour. */
const PLAIN_RING: Readonly<Record<SheetTone, string>> = {
  lamp: 'border-lamp/45 bg-lamp/10 text-lamp',
  primary: 'border-primary/45 bg-primary/10 text-primary',
  success: 'border-success/45 bg-success/10 text-success',
  heat: 'border-heat/45 bg-heat/10 text-heat',
  cyan: 'border-cyan/45 bg-cyan/10 text-cyan',
  media: 'border-media/45 bg-media/10 text-media',
  violet: 'border-violet/45 bg-violet/10 text-violet',
  danger: 'border-danger/45 bg-danger/10 text-danger',
  muted: 'border-border-strong bg-surface-raised text-foreground-muted',
};

/**
 * The ring with a battery's charge, always green as a battery is; or, when the device says no
 * charge, the kind's glyph in a plain ring.
 *
 * @param props - See {@link BatteryRingProps}.
 * @returns The ring.
 */
export function BatteryRing(props: BatteryRingProps) {
  const { t } = useTranslation();
  const { level, tone, icon } = props;
  const circumference = 2 * Math.PI * 26;

  if (level === null) {
    return (
      <span
        className={cn(
          'flex size-15 shrink-0 items-center justify-center rounded-full border',
          PLAIN_RING[tone],
        )}
      >
        <AppIcon id={icon} size={24} />
      </span>
    );
  }

  return (
    <span className="relative size-15 shrink-0">
      <svg width={60} height={60} viewBox="0 0 60 60" aria-hidden="true">
        <circle
          cx={30}
          cy={30}
          r={26}
          fill="none"
          strokeWidth={4}
          className="stroke-surface-high"
        />
        <circle
          cx={30}
          cy={30}
          r={26}
          fill="none"
          strokeWidth={4}
          strokeLinecap="round"
          className="entity-track stroke-success"
          strokeDasharray={`${((circumference * level) / 100).toFixed(1)} ${circumference.toFixed(1)}`}
          transform="rotate(-90 30 30)"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-mono text-mono-caption text-foreground">
        {t('entity.sheet.percent', '{{value}}%', { value: Math.round(level) })}
      </span>
    </span>
  );
}

/** What the thin slider of a second level needs. */
export type ThinSliderProps = {
  /** What it sets. */
  readonly label: string;

  /** The level, 0 to 100. */
  readonly value: number;

  /** Called with a level as it moves. */
  readonly onChange: (value: number) => void;

  /** Called with the level let go at. */
  readonly onCommit: (value: number) => void;

  /** The colour of the track up to the knob: a class, `bg-…`. */
  readonly fill?: string;

  /** What its two ends say; 0% and 100% when not given. */
  readonly ends?: readonly [string, string];

  /** Whether it cannot be used now. */
  readonly disabled?: boolean;
};

/**
 * A thin slider for a second level - a lamp's white channel, a target humidity: a 6 px track, a
 * 22 px knob, and its ends under it.
 *
 * @param props - See {@link ThinSliderProps}.
 * @returns The slider.
 */
export function ThinSlider(props: ThinSliderProps) {
  const { t } = useTranslation();
  const { label, value, onChange, onCommit, fill = 'bg-[#e3e6ff]', disabled = false } = props;

  return (
    <div className="flex flex-col gap-2">
      <div className="entity-slider relative h-6">
        <span className="absolute inset-x-0 top-2.25 h-1.5 rounded-pill bg-surface-high" />
        <span
          className={cn('entity-track absolute top-2.25 left-0 h-1.5 rounded-pill', fill)}
          // eslint-disable-next-line react/forbid-dom-props -- the track is lit up to the level
          style={{ width: `${String(value)}%` }}
        />
        <span
          className="entity-track absolute top-px size-5.5 rounded-full bg-knob shadow-[0_2px_8px_rgb(0_0_0/0.5)]"
          // eslint-disable-next-line react/forbid-dom-props -- the knob sits at the level
          style={{ left: `calc(${String(value)}% - 11px)` }}
        />
        <input
          type="range"
          min={0}
          max={100}
          value={value}
          disabled={disabled}
          aria-label={label}
          onChange={(event) => {
            onChange(Number(event.target.value));
          }}
          onPointerUp={(event) => {
            onCommit(Number(event.currentTarget.value));
          }}
          onKeyUp={(event) => {
            onCommit(Number(event.currentTarget.value));
          }}
          className="entity-range absolute inset-0 m-0 size-full cursor-grab opacity-0 active:cursor-grabbing"
        />
      </div>
      <div className="flex justify-between font-mono text-[10px] text-foreground-subtle">
        <span>{props.ends?.[0] ?? t('entity.sheet.percent', '{{value}}%', { value: 0 })}</span>
        <span>{props.ends?.[1] ?? t('entity.sheet.percent', '{{value}}%', { value: 100 })}</span>
      </div>
    </div>
  );
}
