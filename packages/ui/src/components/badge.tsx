/**
 * A small coloured label.
 *
 * The tone is a variant rather than a class the caller passes, so that the meanings the palette
 * carries stay countable: accent for a role, success for a protection that is on, warning for one
 * that is off, danger for a failure, neutral for a fact with no verdict attached. A badge that
 * could be any colour would eventually be every colour, and then it would mean nothing.
 *
 * Every tone carries a border as well as a fill. A translucent fill alone floats on whatever is
 * behind it, and these sit on cards, in table rows and over photographs - the edge is what keeps
 * the shape from dissolving into the third of those.
 */
import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';

import { cn } from '../lib/cn.js';

const badge = cva(
  'inline-flex shrink-0 items-center gap-1.5 rounded-full border font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-surface-raised text-foreground-muted',
        accent: 'border-primary/30 bg-primary/13 text-primary',
        success: 'border-success/30 bg-success/13 text-success',
        warning: 'border-warning/30 bg-warning/13 text-warning',
        danger: 'border-danger/30 bg-danger/13 text-danger',
      },
      size: {
        /** In a dense table row. */
        small: 'h-5 px-2 text-label tracking-normal normal-case',

        /** Everywhere else. */
        medium: 'h-6 px-2.5 text-caption',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'medium' },
  },
);

/** What a badge can mean. */
export type BadgeTone = NonNullable<VariantProps<typeof badge>['tone']>;

/** What a badge needs. */
export type BadgeProps = VariantProps<typeof badge> & {
  /** A glyph before the text. */
  readonly icon?: ReactNode;

  /** The text. Always words: colour is never the only carrier of meaning (RULES.md 15.4). */
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
  const { tone, size, icon, children, className } = props;

  return (
    <span className={cn(badge({ tone, size }), className)}>
      {icon}
      {children}
    </span>
  );
}
