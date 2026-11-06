/**
 * The small pieces every body of the entity dialog is built from, as the Nebula canvas draws them:
 * the round icon button of the header, the big value with its line underneath, the wide switch,
 * the spinner of a command on its way, the three figures under a chart and the pill of windows.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon, cn, type UiIconId } from '@nebulahome/ui';

import { TONE_FILL, TONE_TEXT, type SheetTone } from '@/routes/library/entity/sheet/tones';

/** What a round icon button needs. */
export type SheetIconButtonProps = {
  /** Its glyph. */
  readonly icon: UiIconId;

  /** What it does, to a screen reader and on hover. */
  readonly label: string;

  /** Called when pressed. */
  readonly onClick?: () => void;

  /** For a toggle: whether it is pressed in. */
  readonly isPressed?: boolean;

  /** The glyph's size; 17 in the header. */
  readonly size?: number;
};

/**
 * A 36 px round button with a glyph: the header's History, Settings and Close.
 *
 * @param props - See {@link SheetIconButtonProps}.
 * @returns The button.
 */
export function SheetIconButton(props: SheetIconButtonProps) {
  const { icon, label, onClick, isPressed, size = 17 } = props;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={isPressed}
      className={cn(
        'inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full',
        'transition-colors duration-200 hover:bg-surface-raised hover:text-foreground',
        isPressed === true ? 'bg-surface-high text-foreground' : 'text-foreground-muted',
      )}
    >
      <AppIcon id={icon} size={size} />
    </button>
  );
}

/** What the spinner of a command on its way needs. */
export type SendingSpinnerProps = {
  /** Its colour. */
  readonly tone: SheetTone;

  /** Its size; 22 beside a big value. */
  readonly size?: number;
};

/**
 * The spinner beside a value whose command has gone and has not been confirmed yet.
 *
 * @param props - See {@link SendingSpinnerProps}.
 * @returns The spinner.
 */
export function SendingSpinner(props: SendingSpinnerProps) {
  const { t } = useTranslation();

  return (
    <span
      role="status"
      aria-label={t('entity.sheet.sending', 'Sending')}
      className={cn('entity-spin inline-flex', TONE_TEXT[props.tone])}
    >
      <AppIcon id="loader-circle" size={props.size ?? 22} />
    </span>
  );
}

/** What the big value at the top of a body needs. */
export type ValueHeadProps = {
  /** The value: "40%", "21.4", "Locked". */
  readonly value: ReactNode;

  /** Its unit, at half size after it: "°C". */
  readonly unit?: ReactNode;

  /** The line under it: "Since 21:48 · by Evening lights". */
  readonly line?: ReactNode;

  /** How big: 56 for a reading, 48 for a level, 28 for a word. */
  readonly size?: 'reading' | 'level' | 'word';

  /** Whether it is greyed: a value read from a device that no longer answers. */
  readonly isStale?: boolean;

  /** Whether a command is on its way, and in which colour to say so. */
  readonly sending?: SheetTone | null;

  /** What stands at its right, level with its foot: the switch. */
  readonly trail?: ReactNode;
};

/**
 * The big value a body opens with, its line underneath, and what stands at its right.
 *
 * @param props - See {@link ValueHeadProps}.
 * @returns The head.
 */
export function ValueHead(props: ValueHeadProps) {
  const { value, unit, line, size = 'level', isStale = false, sending = null, trail } = props;

  return (
    <div className="flex items-end justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="flex items-center gap-3">
          <span className="flex items-baseline gap-1.5">
            <span
              className={cn(
                'leading-none font-medium tabular',
                size === 'reading' && 'text-[56px] tracking-[-0.04em]',
                size === 'level' && 'text-[48px] tracking-[-0.04em]',
                size === 'word' && 'text-[28px] tracking-[-0.02em]',
                isStale ? 'text-foreground-subtle' : 'text-foreground',
              )}
            >
              {value}
            </span>
            {unit === undefined ? null : (
              <span
                className={cn(
                  'text-foreground-muted',
                  size === 'reading' ? 'text-[22px]' : 'text-[20px]',
                )}
              >
                {unit}
              </span>
            )}
          </span>
          {sending === null ? null : <SendingSpinner tone={sending} />}
        </span>
        {line === undefined ? null : (
          <span className="text-ui-sm leading-[1.45] text-foreground-subtle">{line}</span>
        )}
      </div>
      {trail}
    </div>
  );
}

/** What the wide switch needs. */
export type BigSwitchProps = {
  /** What it switches, to a screen reader. */
  readonly label: string;

  /** Whether it is on. */
  readonly isOn: boolean;

  /** Called with what it should become. */
  readonly onChange: (isOn: boolean) => void;

  /** Its colour when on. */
  readonly tone: SheetTone;

  /** Whether it cannot be used now. */
  readonly disabled?: boolean;

  /** Its size: 52 by 30 beside a big value, 40 by 24 on a row of settings. */
  readonly size?: 'large' | 'small';
};

/**
 * The wide switch beside a big value: 52 by 30, filled in the kind's colour when on.
 *
 * @param props - See {@link BigSwitchProps}.
 * @returns The switch.
 */
export function BigSwitch(props: BigSwitchProps) {
  const { label, isOn, onChange, tone, disabled = false, size = 'large' } = props;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isOn}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        onChange(!isOn);
      }}
      className={cn(
        'relative shrink-0 cursor-pointer rounded-pill transition-colors duration-200',
        size === 'large' ? 'h-7.5 w-13' : 'h-6 w-10',
        'disabled:cursor-not-allowed disabled:opacity-50',
        isOn ? TONE_FILL[tone] : 'bg-border-strong',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-0.75 rounded-full transition-[left] duration-200',
          size === 'large' ? 'size-6' : 'size-4.5',
          isOn
            ? cn('bg-canvas', size === 'large' ? 'left-6.25' : 'left-4.75')
            : 'left-0.75 bg-foreground-muted',
        )}
      />
    </button>
  );
}

/** One figure under a chart. */
export type StatTile = {
  /** What it is: "On for". */
  readonly label: string;

  /** Its value: "5 h 40 min". */
  readonly value: string;
};

/** What the row of figures needs. */
export type StatTilesProps = {
  /** The figures, three of them. */
  readonly stats: readonly StatTile[];

  /** Whether each figure is boxed (under a drawer's chart) or bare (inside a chart's box). */
  readonly isBoxed?: boolean;
};

/**
 * The three figures under a chart: "On for · Turned on · Last on", "Lowest · Average · Highest".
 *
 * @param props - See {@link StatTilesProps}.
 * @returns The row.
 */
export function StatTiles(props: StatTilesProps) {
  const { stats, isBoxed = false } = props;

  return (
    <div className="grid grid-cols-3 gap-2">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className={cn(
            'flex min-w-0 flex-col gap-0.75',
            isBoxed && 'rounded-inner border border-border bg-well p-3',
          )}
        >
          <span className="truncate text-caption text-foreground-subtle">{stat.label}</span>
          <span className="truncate text-title font-medium tabular">{stat.value}</span>
        </div>
      ))}
    </div>
  );
}

/** One window of a range pill. */
export type RangeChoice<TValue extends string> = {
  readonly value: TValue;
  readonly label: string;
};

/** What the range pill needs. */
export type RangePillProps<TValue extends string> = {
  /** The windows. */
  readonly choices: readonly RangeChoice<TValue>[];

  /** The one chosen. */
  readonly value: TValue;

  /** Called with the window chosen. */
  readonly onChange: (value: TValue) => void;

  /** Its height: 24 inside a chart's box, 26 in a drawer's head. */
  readonly size?: 'small' | 'medium';

  /** What it sits on: the card's ground inside a chart's box, the well's in a drawer's head. */
  readonly ground?: 'surface' | 'well';
};

/**
 * The pill of windows a history is read over: 6h · 24h · 7d.
 *
 * @param props - See {@link RangePillProps}.
 * @returns The pill.
 */
export function RangePill<TValue extends string>(props: RangePillProps<TValue>) {
  const { t } = useTranslation();
  const { choices, value, onChange, size = 'small', ground = 'surface' } = props;

  return (
    <div
      role="radiogroup"
      aria-label={t('entity.sheet.range', 'Range')}
      className={cn(
        'inline-flex shrink-0 gap-0.5 rounded-pill border border-border-strong p-0.75',
        ground === 'well' ? 'bg-well' : 'bg-surface',
      )}
    >
      {choices.map((choice) => {
        const isChosen = choice.value === value;

        return (
          <button
            key={choice.value}
            type="button"
            role="radio"
            aria-checked={isChosen}
            onClick={() => {
              onChange(choice.value);
            }}
            className={cn(
              'cursor-pointer rounded-pill px-2.5 text-caption whitespace-nowrap transition-colors',
              size === 'small' ? 'h-6' : 'h-6.5',
              isChosen
                ? 'bg-surface-high font-medium text-foreground'
                : 'text-foreground-muted hover:text-foreground',
            )}
          >
            {choice.label}
          </button>
        );
      })}
    </div>
  );
}

/** What the mono caption over a block needs. */
export type MonoLabelProps = {
  /** The words, shown in capitals. */
  readonly children: ReactNode;
};

/**
 * The interface's raised voice over a block: "HISTORY".
 *
 * @param props - See {@link MonoLabelProps}.
 * @returns The label.
 */
export function MonoLabel(props: MonoLabelProps) {
  return (
    <span className="font-mono text-label text-foreground-subtle uppercase">{props.children}</span>
  );
}
