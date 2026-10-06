/**
 * A round mark with a dot in it: a state at a glance - running, failing, waiting - with the word
 * in its tooltip and for a screen reader.
 */
import { cn } from '../lib/cn.js';

/** How a dot reads. */
export type StatusDotTone = 'success' | 'warning' | 'danger' | 'neutral' | 'accent';

/** The colour of each tone's dot. */
const DOT_CLASSES: Readonly<Record<StatusDotTone, string>> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  neutral: 'bg-foreground-subtle',
  accent: 'bg-primary',
};

/** What a dot needs. */
export type StatusDotProps = {
  /** Its colour. */
  readonly tone: StatusDotTone;

  /** What it means, for the tooltip and a screen reader. */
  readonly title: string;

  /** Whether it pulses: something is being done. */
  readonly isBusy?: boolean;
};

/**
 * Renders the mark.
 *
 * @param props - See {@link StatusDotProps}.
 * @returns The mark.
 */
export function StatusDot(props: StatusDotProps) {
  return (
    <span
      role="img"
      aria-label={props.title}
      title={props.title}
      className="inline-flex size-6.5 shrink-0 items-center justify-center rounded-full border border-border-strong"
    >
      <span
        className={cn(
          'size-2 rounded-full',
          DOT_CLASSES[props.tone],
          props.isBusy === true ? 'animate-pulse' : null,
        )}
      />
    </span>
  );
}
