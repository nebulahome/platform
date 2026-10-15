/**
 * A number moved a step at a time: a minus, the figure, a plus.
 *
 * For a value a person nudges rather than sweeps - a thermostat's target, which is set half a
 * degree at a time and never dragged from 7 to 30. The figure is large because it is the thing
 * being set, and the buttons stop at the ends of the range rather than wrapping or refusing
 * after the fact.
 *
 * The group is a `spinbutton` to a screen reader, which is what it is: arrow keys on the figure
 * step it too, and the reader hears "21.5 °C" rather than "21.5".
 */
import type { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../lib/cn.js';

import { AppIcon } from './app-icon.js';

/** What a stepper needs. */
export type StepperProps = {
  /** What it sets. */
  readonly label: string;

  /** Where it stands. */
  readonly value: number;

  /** The lowest value. */
  readonly min: number;

  /** The highest value. */
  readonly max: number;

  /** How far one press moves it. */
  readonly step: number;

  /** The value as a person reads it: `21.5 °C`. */
  readonly format: (value: number) => string;

  /** Called with the next value. */
  readonly onChange: (value: number) => void;

  /** Whether it can be moved at all. */
  readonly disabled?: boolean;

  /** Anything extra for the outer element. */
  readonly className?: string;
};

/**
 * Moves a value one step, held inside its range and on its grid.
 *
 * Rounded to the step so that 0.1 + 0.2 never shows as 0.30000000000000004 after a few presses.
 *
 * @param value - Where it stands.
 * @param direction - `1` up, `-1` down.
 * @param bounds - The range and the step.
 * @param bounds.min - The lowest value.
 * @param bounds.max - The highest value.
 * @param bounds.step - How far one press moves it.
 * @returns The next value.
 */
export function stepValue(
  value: number,
  direction: 1 | -1,
  bounds: { readonly min: number; readonly max: number; readonly step: number },
): number {
  const next = Math.round((value + direction * bounds.step) / bounds.step) * bounds.step;
  const decimals = (String(bounds.step).split('.')[1] ?? '').length;

  return Number(Math.min(bounds.max, Math.max(bounds.min, next)).toFixed(decimals));
}

/** The classes of the two round buttons. */
const BUTTON =
  'press-scale flex size-control shrink-0 items-center justify-center rounded-pill border ' +
  'border-border-strong bg-surface-raised text-foreground hover:enabled:bg-surface-high ' +
  'disabled:cursor-not-allowed disabled:opacity-45';

/**
 * Renders a stepper.
 *
 * @param props - See {@link StepperProps}.
 * @returns The stepper.
 */
export function Stepper(props: StepperProps) {
  const { t } = useTranslation();
  const { label, value, min, max, step, format, onChange, disabled = false, className } = props;
  const bounds = { min, max, step };

  /**
   * Steps the value from the keyboard, as a spinbutton does.
   *
   * @param event - The key.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (disabled) {
      return;
    }

    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      event.preventDefault();
      onChange(stepValue(value, 1, bounds));
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      event.preventDefault();
      onChange(stepValue(value, -1, bounds));
    } else if (event.key === 'Home') {
      event.preventDefault();
      onChange(min);
    } else if (event.key === 'End') {
      event.preventDefault();
      onChange(max);
    }
  };

  return (
    <div className={cn('flex items-center gap-4', className)}>
      <button
        type="button"
        aria-label={t('ui.stepper.lower', 'Lower {{label}}', { label })}
        title={t('ui.stepper.lower', 'Lower {{label}}', { label })}
        className={BUTTON}
        disabled={disabled || value <= min}
        onClick={() => {
          onChange(stepValue(value, -1, bounds));
        }}
      >
        <AppIcon id="minus" size={16} />
      </button>
      <div
        role="spinbutton"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={format(value)}
        aria-disabled={disabled || undefined}
        className="min-w-24 rounded-chip text-center font-mono text-reading text-foreground tabular focus-visible:shadow-focus focus-visible:outline-none"
        onKeyDown={onKeyDown}
      >
        {format(value)}
      </div>
      <button
        type="button"
        aria-label={t('ui.stepper.raise', 'Raise {{label}}', { label })}
        title={t('ui.stepper.raise', 'Raise {{label}}', { label })}
        className={BUTTON}
        disabled={disabled || value >= max}
        onClick={() => {
          onChange(stepValue(value, 1, bounds));
        }}
      >
        <AppIcon id="plus" size={16} />
      </button>
    </div>
  );
}
