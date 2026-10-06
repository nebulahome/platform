/**
 * The tag palette, laid out to pick from: twelve round swatches, one chosen.
 *
 * A radio group, like {@link Segmented}, and for the same reasons: the arrow keys move between
 * the swatches, the whole row is one tab stop, and a screen reader hears "Colour, teal, 7 of
 * 12" rather than twelve unrelated buttons. Each swatch is a native radio input hidden under
 * a painted label, so none of that has to be reimplemented.
 *
 * The chosen swatch carries a tick and a ring, not only a larger size: a bigger circle among
 * small ones is a difference nobody is sure they are seeing, and the palette's two blues are
 * close enough that the ring is what says "this one".
 */
import { useId } from 'react';

import { TAG_COLORS, type TagColor } from '@nebulahome/contracts';

import { cn } from '../lib/cn.js';
import { TAG_FILL_CLASSES } from '../lib/tag-colors.js';

import { AppIcon } from './app-icon.js';

/** What the swatches need. */
export type ColorSwatchesProps = {
  /** What the choice is for; announced, and drawn unless hidden. */
  readonly label: string;

  /** Whether the label is drawn, or only announced. */
  readonly isLabelHidden?: boolean;

  /** Which colour is chosen, or null for none yet. */
  readonly value: TagColor | null;

  /** Called with the colour chosen. */
  readonly onChange: (color: TagColor) => void;

  /** Whether the choice can be made at all. */
  readonly disabled?: boolean;

  /** Anything extra for the group. */
  readonly className?: string;
};

/**
 * Renders the palette.
 *
 * @param props - See {@link ColorSwatchesProps}.
 * @returns The radio group.
 */
export function ColorSwatches(props: ColorSwatchesProps) {
  const { label, isLabelHidden = false, value, onChange, disabled = false, className } = props;
  const name = useId();
  const labelId = `${name}-label`;

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <span
        id={labelId}
        className={cn(
          'font-mono text-label text-foreground-subtle uppercase',
          isLabelHidden && 'sr-only',
        )}
      >
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={labelId} className="flex flex-wrap gap-2">
        {TAG_COLORS.map((color) => {
          const isChosen = color === value;

          return (
            <label
              key={color}
              title={color}
              className={cn(
                'relative flex size-7 cursor-pointer items-center justify-center rounded-full transition-transform',
                'has-focus-visible:ring-3 has-focus-visible:ring-primary/35',
                isChosen
                  ? 'ring-2 ring-foreground/70 ring-offset-2 ring-offset-surface'
                  : 'hover:scale-110',
                disabled && 'cursor-not-allowed opacity-50 hover:scale-100',
                TAG_FILL_CLASSES[color],
              )}
            >
              <input
                type="radio"
                name={name}
                value={color}
                aria-label={color}
                checked={isChosen}
                disabled={disabled}
                onChange={() => {
                  onChange(color);
                }}
                className="sr-only"
              />
              {isChosen ? (
                <AppIcon id="check" size={14} strokeWidth={3} className="text-surface" />
              ) : null}
            </label>
          );
        })}
      </div>
    </div>
  );
}
