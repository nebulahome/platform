/**
 * A status in sentence case with a coloured dot: "Running", "Update ready", "Offline". Used in
 * tables and detail heads where a badge's capitals would shout.
 *
 * The dot carries the tone and is never the only carrier: the word stays. Success is on, running
 * or healthy; warning is off, waiting or needs you; danger is failed.
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

const pill = cva(
  'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-pill border border-border-strong ' +
    'bg-foreground/4 px-2.5 text-caption font-medium whitespace-nowrap text-foreground',
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
    <span className={cn(pill(), className)}>
      <span
        aria-hidden="true"
        className={cn('size-1.5 shrink-0 rounded-full', DOT_CLASSES[tone])}
      />
      {children}
    </span>
  );
}
