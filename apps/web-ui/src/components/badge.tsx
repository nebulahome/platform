/**
 * A small coloured label.
 *
 * The tone is a prop rather than a class the caller passes, so that the four meanings the
 * palette carries stay four: accent for a role, success for a protection that is on, warning for
 * one that is off, neutral for a fact with no verdict attached. A badge that could be any colour
 * would eventually be every colour, and then it would mean nothing.
 */
import type { ReactNode } from 'react';

import { cn } from '@nebula-home/ui';

/** What a badge can mean. */
export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

/** The classes for each tone. */
const TONES: Readonly<Record<BadgeTone, string>> = {
  neutral: 'bg-surface-raised text-foreground-muted',
  accent: 'bg-primary/16 text-primary',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/15 text-danger',
};

/** What a badge needs. */
export type BadgeProps = {
  /** What it means. */
  readonly tone?: BadgeTone;

  /** A glyph before the text. */
  readonly icon?: ReactNode;

  /** The text. */
  readonly children: ReactNode;

  /** Anything extra for the outer element. */
  readonly className?: string;
};

/**
 * Renders a badge.
 *
 * @param props - See {@link BadgeProps}.
 * @returns The badge.
 */
export function Badge(props: BadgeProps) {
  const { tone = 'neutral', icon, children, className } = props;

  return (
    <span
      className={cn(
        'inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full px-2.5',
        'text-[11.5px] font-medium',
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
