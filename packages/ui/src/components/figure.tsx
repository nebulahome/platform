/**
 * A reading as a number and its unit: a card's main figure, or a smaller one beside it.
 */
import { cn } from '../lib/cn.js';

/** What a figure needs. */
export type FigureProps = {
  /** The number, already written. */
  readonly value: string;

  /** Its unit, drawn smaller beside it. */
  readonly unit?: string | null | undefined;

  /** How large: the card's main reading, or a smaller one. */
  readonly size?: 'large' | 'medium' | 'small';

  /** A colour for the number, when the thing it measures has one. */
  readonly color?: string | undefined;
};

/** The classes of each figure size. */
const FIGURE_SIZES = {
  large: 'text-reading',
  medium: 'text-reading-sm',
  small: 'text-headline-sm',
} as const;

/**
 * Renders a reading as a number and its unit.
 *
 * @param props - See {@link FigureProps}.
 * @returns The figure.
 */
export function Figure(props: FigureProps) {
  const { value, unit, size = 'large', color } = props;

  return (
    <span className="flex min-w-0 items-baseline gap-1">
      <span
        className={cn(FIGURE_SIZES[size], 'truncate leading-none font-medium tabular')}
        /* eslint-disable-next-line react/forbid-dom-props -- the figure takes the light's own colour,
        which the palette does not hold (RULES.md 15.3). */
        style={color === undefined ? undefined : { color }}
      >
        {value}
      </span>
      {unit === undefined || unit === null || unit === '' ? null : (
        <span className="shrink-0 text-subhead text-foreground-subtle">{unit}</span>
      )}
    </span>
  );
}
