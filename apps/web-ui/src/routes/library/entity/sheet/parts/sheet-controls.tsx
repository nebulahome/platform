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

import { useCauseNames } from '@/library/use-cause-names';
import { clockText } from '@/routes/library/entity/sheet/history';
import type { SheetHistory } from '@/routes/library/entity/sheet/sheet-types';
import {
  TONE_BAR,
  TONE_CHOSEN,
  TONE_FILL,
  TONE_REACHED,
  TONE_TEXT,
  type SheetTone,
} from '@/routes/library/entity/sheet/tones';

/**
 * The line under a big value: since when the state is what it is, and what made it so.
 *
 * @param entity - The entity, for when it last changed.
 * @param history - Its history, for what caused the last change.
 * @returns "Since 21:48 · by Evening lights", or "Since 21:48" when the cause is not known.
 */
export function useSinceLine(entity: EntityView, history: SheetHistory): string {
  const { t } = useTranslation();
  const nameOf = useCauseNames();
  const changed = entity.lastChanged?.getTime();
  const last = history.states.at(-1);

  if (changed === undefined) {
    return '';
  }

  const since = t('entity.sheet.since', 'Since {{time}}', { time: clockText(changed) });

  if (last?.context === undefined) {
    return since;
  }

  const named = nameOf(last.context).label;
  // Without a name, the cause is already a phrase of its own: "By an automation".
  const phrase = nameOf({ type: last.context.type }).label;

  return named === phrase
    ? t('entity.sheet.sinceCause', '{{since}} · {{cause}}', {
        since,
        cause: phrase.charAt(0).toLowerCase() + phrase.slice(1),
      })
    : t('entity.sheet.sinceBy', '{{since}} · by {{cause}}', { since, cause: named });
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
};

/**
 * The round target a thing that only switches is turned on and off with: 176 px, glowing in its
 * colour while on.
 *
 * @param props - See {@link PowerTargetProps}.
 * @returns The target.
 */
export function PowerTarget(props: PowerTargetProps) {
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
        'transition-[background,box-shadow,color,border-color] duration-320 disabled:cursor-not-allowed',
        isOn
          ? cn(
              TONE_TEXT[tone],
              'border-current/50 bg-[radial-gradient(circle_at_50%_38%,color-mix(in_oklab,currentColor_34%,transparent),color-mix(in_oklab,currentColor_8%,transparent)_72%)]',
              'shadow-[0_0_70px_color-mix(in_oklab,currentColor_28%,transparent),inset_0_1px_0_rgb(255_255_255/0.08)]',
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
      <AppIcon id={props.icon ?? 'power'} size={48} strokeWidth={1.6} />
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
    <div className="entity-slider relative h-18 overflow-hidden rounded-[22px] border border-border-strong bg-surface-raised">
      <div
        className={cn(
          'entity-track absolute inset-y-0 left-0',
          isOn ? (colour === undefined ? TONE_BAR[tone] : '') : TONE_BAR.muted,
        )}
        // eslint-disable-next-line react/forbid-dom-props -- the fill is the level, and a lamp's colour its own
        style={{
          width: `${String(value)}%`,
          ...(isOn && colour !== undefined
            ? {
                background: `linear-gradient(90deg, color-mix(in oklab, ${colour} 30%, transparent), color-mix(in oklab, ${colour} 85%, transparent))`,
              }
            : {}),
        }}
      />
      <span
        className={cn(
          'pointer-events-none absolute top-1/2 left-5.5 flex -translate-y-1/2',
          isOn ? 'text-canvas' : 'text-foreground-subtle',
        )}
      >
        <AppIcon id={props.icon ?? 'sun'} size={22} />
      </span>
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
        className="absolute inset-0 m-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
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
            'press h-9 cursor-pointer rounded-tile border text-ui-sm font-medium tabular',
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
  const { title, levels, value, onPick, tone, unit = '', disabled = false } = props;
  const chosen = levels.findIndex((level) => level.value === value);

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
        <span className={cn('font-mono text-mono-caption tabular', TONE_TEXT[tone])}>
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
              'transition-colors duration-300 disabled:cursor-not-allowed',
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
        'press-scale flex shrink-0 cursor-pointer items-center justify-center rounded-full border border-border-strong bg-surface-raised p-0 text-foreground',
        'hover:border-foreground-subtle disabled:cursor-not-allowed disabled:opacity-50',
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
          className="absolute inset-0 m-0 size-full cursor-pointer opacity-0"
        />
      </div>
      <div className="flex justify-between font-mono text-[10px] text-foreground-subtle">
        <span>{t('entity.sheet.percent', '{{value}}%', { value: 0 })}</span>
        <span>{t('entity.sheet.percent', '{{value}}%', { value: 100 })}</span>
      </div>
    </div>
  );
}
