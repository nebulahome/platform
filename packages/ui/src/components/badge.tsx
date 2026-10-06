/**
 * A short word or count in mono capitals, outlined in its colour: a status, a count of what was
 * found, a kind.
 *
 * The tone is a variant rather than a class the caller passes, so that the meanings the palette
 * carries stay countable: accent for found or new, success for running, warning for needs
 * attention, danger for failed, violet for computed, cyan for live, neutral for a fact with no
 * verdict attached. A badge that could be any colour would eventually be every colour, and then
 * it would mean nothing.
 *
 * No fill: the tone is the text and the edge together, and the word is the message - colour is
 * never its only carrier. A status in sentence case with a dot is a `Pill`.
 */
import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';

import { cn } from '../lib/cn.js';

const badge = cva(
  'inline-flex shrink-0 items-center gap-1.5 rounded-pill border border-current bg-transparent ' +
    'font-mono text-label tracking-wider whitespace-nowrap uppercase',
  {
    variants: {
      tone: {
        neutral: 'text-foreground-subtle',

        /** Found, or new for you. */
        accent: 'text-primary',

        /** Running, healthy, on. */
        success: 'text-success',

        /** Needs attention, waiting, off. */
        warning: 'text-warning',

        /** Failed. */
        danger: 'text-danger',

        /** Computed: an alias, a scene. */
        violet: 'text-violet',

        /** New, live. */
        cyan: 'text-cyan',
      },
      size: {
        /** In a dense table row. */
        small: 'h-5 px-2',

        /** Everywhere else. */
        medium: 'h-6 px-2.5',
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
