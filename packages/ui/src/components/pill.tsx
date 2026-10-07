/**
 * A status in sentence case with a coloured dot: "Running", "Update ready", "Offline". Used in
 * tables and detail heads where a badge's capitals would shout.
 *
 * The dot carries the tone and is never the only carrier: the word stays. Success is on, running
 * or healthy; warning is off, waiting or needs you; danger is failed.
 *
 * As the boards draw it, the word takes the tone too, and the three states that matter - success,
 * warning, danger - sit on their soft ground; neutral is `foreground-muted`: idle, stopped.
 */
import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';

import { cn } from '../lib/cn.js';

const DOT_CLASSES = {
  neutral: 'bg-foreground-subtle',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  accent: 'bg-primary',
  cyan: 'bg-cyan',
} as const;

/** The word and its ground, for each tone. */
const WORD_CLASSES = {
  neutral: 'bg-foreground/4 text-foreground-muted',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  accent: 'bg-foreground/4 text-primary',
  cyan: 'bg-foreground/4 text-cyan',
} as const;

const pill = cva(
  'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-pill border border-border-strong ' +
    'px-2.5 text-caption font-medium whitespace-nowrap',
);

/** What a pill can say. */
export type PillTone = keyof typeof DOT_CLASSES;

/** What a pill needs. */
export type PillProps = VariantProps<typeof pill> & {
  /** What the dot says, beside the word. */
  readonly tone?: PillTone;

  /** The status, in words. */
  readonly children: ReactNode;

  /** Anything extra for the outer element. */
  readonly className?: string;
};

/**
 * Renders a status pill.
 *
 * @param props - See {@link PillProps}.
 * @returns The pill.
 */
export function Pill(props: PillProps) {
  const { tone = 'neutral', children, className } = props;

  return (
    <span className={cn(pill(), WORD_CLASSES[tone], className)}>
      <span
        aria-hidden="true"
        className={cn('size-1.5 shrink-0 rounded-full', DOT_CLASSES[tone])}
      />
      {children}
    </span>
  );
}
