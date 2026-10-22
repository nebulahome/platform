/**
 * A value along a range, with what it reads written beside its name.
 *
 * A native range input, drawn by the theme's `.range-slider` rules, because that is what a
 * keyboard, a screen reader and a finger already know how to move: arrows and Page keys step it,
 * Home and End jump to the ends, and `aria-valuetext` says "60%" rather than "60".
 *
 * **Two callbacks, because a slider says two things.** `onChange` follows the knob, so the figure
 * beside the name keeps up with the finger; `onCommit` fires when the knob is let go, and once per
 * key step. A lamp is commanded on the second - a command per pixel of travel would queue a
 * hundred fades the lamp then plays one after another.
 *
 * The groove is either filled up to the knob, for an amount - brightness, a position, a volume -
 * or painted as a whole scale the knob points into, for colour temperature, hue and saturation,
 * where the colour under the knob is the answer.
 *
 * **Two looks.** `groove` is the thin track with a round knob and the reading above it, for a
 * device's own controls. `bar` is the automation and scene editors' (N-Blocks-Actions): a 36px
 * bar the label and the reading sit inside, filled to the value or painted as the scale, with a
 * thin mark at the value. The native input lies over the bar, unseen, so it still moves the same.
 */
import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react';

import { cn } from '../lib/cn.js';

/** What a slider needs. */
export type SliderProps = {
  /** What it sets, as its label. */
  readonly label: string;

  /** Whether the label is read to a screen reader only. */
  readonly isLabelHidden?: boolean;

  /** Where it stands. */
  readonly value: number;

  /** The lowest value. */
  readonly min: number;

  /** The highest value. */
  readonly max: number;

  /** How far one step moves it; 1 unless said otherwise. */
  readonly step?: number;

  /** The value as a person reads it - `60%`, `2700 K` - beside the label and to a reader. */
  readonly display: string;

  /** Called as the knob moves. */
  readonly onChange: (value: number) => void;

  /** Called once the knob is let go, and on each step a key takes. */
  readonly onCommit?: ((value: number) => void) | undefined;

  /**
   * A whole scale for the groove, as a CSS gradient running left to right.
   *
   * Absent, the groove fills up to the knob.
   */
  readonly gradient?: string | undefined;

  /**
   * What the filled part of the groove is drawn in: the accent, warm for a light's level, violet
   * for a colour light's level, a saturation or a volume, cyan for a cover.
   */
  readonly fill?: 'accent' | 'warm' | 'violet' | 'cyan';

  /** The thin groove, or the editors' bar. */
  readonly look?: 'groove' | 'bar';

  /** A glyph before the label, inside the bar. */
  readonly icon?: ReactNode;

  /**
   * The bar's caption above it, when it differs from the label inside: "Colour temperature"
   * over a bar that says "White". The label, unless said otherwise.
   */
  readonly caption?: string;

  /** Whether it can be moved at all. */
  readonly disabled?: boolean;

  /** Anything extra for the outer element. */
  readonly className?: string;
};

/** The token each fill is drawn in. */
const FILL_COLOUR: Readonly<Record<NonNullable<SliderProps['fill']>, string>> = {
  accent: 'var(--color-primary)',
  warm: 'var(--color-lamp)',
  violet: 'var(--color-violet)',
  cyan: 'var(--color-cyan)',
};

/**
 * Says how far along its range a value is.
 *
 * @param value - The value.
 * @param min - The lowest value.
 * @param max - The highest value.
 * @returns A percentage from 0 to 100; 0 for a range with no width.
 */
export function sliderPercent(value: number, min: number, max: number): number {
  if (max <= min) {
    return 0;
  }

  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
}

/**
 * Renders a slider.
 *
 * @param props - See {@link SliderProps}.
 * @returns The slider.
 */
export function Slider(props: SliderProps) {
  const {
    label,
    isLabelHidden = false,
    value,
    min,
    max,
    step = 1,
    display,
    onChange,
    onCommit,
    gradient,
    fill = 'accent',
    look = 'groove',
    icon,
    caption = label,
    disabled = false,
    className,
  } = props;
  const id = useId();
  const input = useRef<HTMLInputElement>(null);

  // The browser's own `change` event is the end of a move: it fires when the knob is let go,
  // wherever the pointer is by then, and once per key step. React's `onChange` is `input`, which
  // fires all the way along - so the end is listened for on the element itself.
  useEffect(() => {
    const element = input.current;

    if (element === null || onCommit === undefined) {
      return undefined;
    }

    /** Hands the value the knob was left at to the caller. */
    const onNativeChange = (): void => {
      onCommit(Number(element.value));
    };

    element.addEventListener('change', onNativeChange);

    return () => {
      element.removeEventListener('change', onNativeChange);
    };
  }, [onCommit]);

  // The groove is drawn from two numbers the stylesheet cannot know: how far along the value is,
  // and - for a scale - the colours of this device's own range. RULES.md 15.3 names exactly this,
  // a computed gradient for a colour picker, as the exception to inline styles.
  const groove: CSSProperties & Record<`--${string}`, string> = {
    '--slider-at': `${String(sliderPercent(value, min, max))}%`,
    ...(fill === 'accent' ? {} : { '--slider-fill': FILL_COLOUR[fill] }),
    ...(gradient === undefined ? {} : { '--slider-track': gradient }),
  };
  const field = (
    <input
      ref={input}
      id={id}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      aria-valuetext={display}
      className={look === 'bar' ? undefined : 'range-slider'}
      /* eslint-disable-next-line react/forbid-dom-props -- see the note on `groove` above. */
      style={look === 'bar' ? undefined : groove}
      onChange={(event) => {
        onChange(Number(event.target.value));
      }}
    />
  );

  if (look === 'bar') {
    return (
      <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
        <span aria-hidden="true" className="text-caption font-medium text-foreground-muted">
          {caption}
        </span>
        <div
          className={cn('range-bar', gradient !== undefined && 'range-bar--scale')}
          /* eslint-disable-next-line react/forbid-dom-props -- see the note on `groove` above. */
          style={groove}
        >
          {gradient === undefined ? <span aria-hidden="true" className="range-bar__fill" /> : null}
          <span aria-hidden="true" className="range-bar__mark" />
          <span className="range-bar__text">
            <label htmlFor={id} className="flex items-center gap-1.5">
              {icon}
              {label}
            </label>
            <span aria-hidden="true" className="tabular">
              {display}
            </span>
          </span>
          {field}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className={cn('flex items-baseline justify-between gap-3', isLabelHidden && 'sr-only')}>
        <label htmlFor={id} className="text-caption font-medium text-foreground-muted">
          {label}
        </label>
        <span aria-hidden="true" className="font-mono text-mono-ui text-foreground tabular">
          {display}
        </span>
      </div>
      {field}
    </div>
  );
}
