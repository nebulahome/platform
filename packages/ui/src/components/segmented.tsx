/**
 * A small, fixed set of choices, shown all at once.
 *
 * A segmented control rather than a dropdown wherever the options are few and short: the whole
 * choice is legible without opening anything, which is what makes a settings page scannable.
 * Past about four options it stops fitting, and a `SelectField` is the right control instead.
 *
 * It is a radio group, not a row of buttons. That is what makes the arrow keys move between the
 * options and the whole group a single tab stop, and it is what a screen reader announces as a
 * choice rather than as three unrelated controls.
 *
 * **One pill, and it travels.** Tinting whichever label is chosen says that every option has a
 * pill and all but one are switched off; a single pill that slides says there is one choice and
 * it moved, which is what the control actually means. It also gives the press somewhere to land:
 * before this, choosing an option changed two colours and nothing else, so the control looked the
 * same whether it had registered or not.
 *
 * The pill is measured rather than assumed, because the options are words and words are not the
 * same width. It is measured again whenever the track resizes - a narrower panel rewraps the
 * labels underneath a pill that would otherwise stay where it was.
 *
 * The track is as wide as its options (`w-fit`), wherever it sits: a column that stretches its
 * children would otherwise draw the border on past the last option, around nothing.
 */
import { cva, type VariantProps } from 'class-variance-authority';
import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';

import { cn } from '../lib/cn.js';

const track = cva(
  'relative isolate flex w-fit shrink-0 items-center rounded-pill border border-border-strong bg-surface',
  {
    variants: {
      size: {
        compact: 'gap-0.5 p-0.5',
        medium: 'gap-1 p-1',
      },
    },
    defaultVariants: { size: 'medium' },
  },
);

const option = cva(
  'relative z-10 flex cursor-pointer items-center rounded-pill whitespace-nowrap ' +
    'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 ' +
    'has-[:focus-visible]:outline-primary',
  {
    variants: {
      size: {
        compact: 'h-6 px-2.5 text-caption',
        medium: 'h-7 px-3.5 text-ui-sm',
      },
      isChosen: {
        true: 'font-medium text-foreground',
        false: 'text-foreground-muted hover:text-foreground',
      },
      isDisabled: {
        true: 'cursor-not-allowed opacity-50',
        false: '',
      },
    },
    defaultVariants: { size: 'medium', isChosen: false, isDisabled: false },
  },
);

/** The pill sits inside the track's own padding, which differs by size. */
const pillBox = cva('segment-pill absolute left-0 rounded-pill bg-surface-high', {
  variants: {
    size: {
      compact: 'top-0.5 bottom-0.5',
      medium: 'top-1 bottom-1',
    },
  },
  defaultVariants: { size: 'medium' },
});

/** One option. */
export type SegmentedOption<TValue extends string> = {
  /** What it is worth. */
  readonly value: TValue;

  /** What it is called. */
  readonly label: string;

  /** Whether this one cannot be chosen, while the others can. */
  readonly disabled?: boolean;
};

/** What the control needs. */
export type SegmentedProps<TValue extends string> = VariantProps<typeof track> & {
  /** What the group is for, announced to a screen reader. */
  readonly label: string;

  /** The options, in the order they should read. */
  readonly options: readonly SegmentedOption<TValue>[];

  /** Which one is chosen. */
  readonly value: TValue;

  /** Called with the new choice. */
  readonly onChange: (value: TValue) => void;

  /** Whether the choice can be made at all. */
  readonly disabled?: boolean;

  /** Anything extra for the outer element. */
  readonly className?: string;

  /** Across the whole width, the options sharing it equally: a choice in a form. */
  readonly isFilled?: boolean;
};

/** Where the pill sits inside the track. */
type PillBox = {
  /** How far along the track it starts. */
  readonly left: number;

  /** How wide the chosen label is. */
  readonly width: number;
};

/**
 * Renders a segmented control.
 *
 * @param props - See {@link SegmentedProps}.
 * @returns The control.
 */
export function Segmented<TValue extends string>(props: SegmentedProps<TValue>) {
  const {
    label,
    options,
    value,
    onChange,
    size,
    disabled = false,
    className,
    isFilled = false,
  } = props;

  const name = useId();
  const trackElement = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<PillBox | null>(null);
  const chosenIndex = options.findIndex((choice) => choice.value === value);

  // Found by position rather than held in a ref. One ref object shared between elements that
  // appear conditionally is at the mercy of the order React detaches and attaches them in: the
  // outgoing label can null the same ref the incoming one has just filled, and the pill then has
  // nothing to measure. The track knows its own labels.
  const measure = useCallback((): void => {
    const element = trackElement.current?.querySelectorAll('label')[chosenIndex];

    if (element instanceof HTMLElement) {
      setPill({ left: element.offsetLeft, width: element.offsetWidth });
    }
  }, [chosenIndex]);

  // Laid out before the browser paints, so the pill is never seen at the previous option's place
  // for a frame. `measure` changes with the chosen index, which is what moves it.
  useLayoutEffect(measure, [measure, options]);

  useLayoutEffect(() => {
    const element = trackElement.current;

    if (element === null || typeof globalThis.ResizeObserver !== 'function') {
      return undefined;
    }

    const observer = new globalThis.ResizeObserver(measure);

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [measure]);

  return (
    <div
      ref={trackElement}
      role="radiogroup"
      aria-label={label}
      className={cn(track({ size }), isFilled && 'w-full', className)}
    >
      <span
        aria-hidden="true"
        /* eslint-disable-next-line react/forbid-dom-props -- the pill's place is read off the
           chosen label, whose width is whatever its word happens to measure. It is the case
           RULES.md 15.3 names as the exception: a value no class can carry, because it is not
           known until the layout is read. */
        style={
          pill === null
            ? { opacity: 0 }
            : { transform: `translateX(${String(pill.left)}px)`, width: pill.width }
        }
        className={pillBox({ size })}
      />

      {options.map((choice, index) => {
        const isChosen = index === chosenIndex;
        const isDisabled = disabled || choice.disabled === true;

        return (
          <label
            key={choice.value}
            className={cn(
              option({ size, isChosen, isDisabled }),
              isFilled && 'grow basis-0 justify-center',
            )}
          >
            <input
              type="radio"
              name={name}
              value={choice.value}
              checked={isChosen}
              disabled={isDisabled}
              onChange={() => {
                onChange(choice.value);
              }}
              className="sr-only"
            />
            {choice.label}
          </label>
        );
      })}
    </div>
  );
}
