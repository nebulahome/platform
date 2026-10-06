/**
 * A thin bar for how far something has come: a download, a pull, a share of a whole.
 */
import { cn } from '../lib/cn.js';

/** What a bar needs. */
export type ProgressBarProps = {
  /** From 0 to 100; null when nothing says, which pulses the whole bar. */
  readonly percent: number | null;

  /** What it is, to a screen reader. */
  readonly label: string;
};

/**
 * Renders the bar.
 *
 * @param props - See {@link ProgressBarProps}.
 * @returns The bar.
 */
export function ProgressBar(props: ProgressBarProps) {
  const { percent, label } = props;

  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
      className="block h-1.5 w-full overflow-hidden rounded-pill bg-surface-high"
    >
      <span
        className={cn(
          'block h-full rounded-full bg-primary transition-[width] duration-500',
          percent === null ? 'w-full animate-pulse' : null,
        )}
        /* eslint-disable-next-line react/forbid-dom-props -- the width is the value itself. */
        style={percent === null ? undefined : { width: `${String(Math.max(4, percent))}%` }}
      />
    </span>
  );
}
