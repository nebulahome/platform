/**
 * The health strip: the first thing under a detail page's tabs, one card per check, always in the
 * same order for a kind - a device's Connection, Signal, Firmware, Integration; an integration's
 * Runtime, Connection, Devices, Updates.
 *
 * Each card says the state in a word, one line of detail, and the one action that fixes it. A
 * problem is tinted: `warning` or `danger` behind the card, its word in that colour, its glyph
 * saying which - colour is never the only carrier. Four across on a wide window, two on a narrow
 * one, one on a phone; the lines between them are the strip's background showing through a 1px
 * gap, so they hold whatever the layout.
 */
import type { ReactNode } from 'react';

import type { UiIconId } from '../icons/ui-set.js';
import { cn } from '../lib/cn.js';

import { AppIcon } from './app-icon.js';

/** How a check stands. */
export type HealthTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

/** The glyph and colours of each standing. */
const TONES: Record<
  HealthTone,
  {
    readonly icon: UiIconId;
    readonly glyph: string;
    readonly ground: string;
    readonly word: string;
  }
> = {
  success: { icon: 'circle-check', glyph: 'text-success', ground: '', word: 'text-foreground' },
  info: { icon: 'circle-arrow-up', glyph: 'text-primary', ground: '', word: 'text-foreground' },
  warning: {
    icon: 'triangle-alert',
    glyph: 'text-warning',
    ground: 'bg-warning-soft',
    word: 'text-warning',
  },
  danger: { icon: 'circle-x', glyph: 'text-danger', ground: 'bg-danger-soft', word: 'text-danger' },
  neutral: {
    icon: 'circle-dot',
    glyph: 'text-foreground-subtle',
    ground: '',
    word: 'text-foreground',
  },
};

/** What the strip needs. */
export type HealthStripProps = {
  /** The cards: {@link HealthCard}s, in the kind's order. */
  readonly children: ReactNode;

  /** Anything extra for the outer element. */
  readonly className?: string;
};

/**
 * Renders the strip the cards sit in.
 *
 * @param props - See {@link HealthStripProps}.
 * @returns The strip.
 */
export function HealthStrip(props: HealthStripProps) {
  const { children, className } = props;

  return (
    <section
      aria-label="Health"
      className={cn(
        'grid gap-px overflow-hidden rounded-inner border border-border bg-border sm:grid-cols-2 lg:auto-cols-fr lg:grid-flow-col lg:grid-cols-none',
        className,
      )}
    >
      {children}
    </section>
  );
}

/** What one card needs. */
export type HealthCardProps = {
  /** What is checked: "Runtime". */
  readonly label: string;

  /** How it stands. */
  readonly tone: HealthTone;

  /** The state in a word or two: "Running", "2 of 2 reporting". */
  readonly value: ReactNode;

  /** One line of detail: "Up 3 days", "5 more found on the network". */
  readonly detail?: ReactNode;

  /** The one action that fixes it: a compact ghost button, a link. */
  readonly action?: ReactNode;
};

/**
 * Renders one check.
 *
 * @param props - See {@link HealthCardProps}.
 * @returns The card.
 */
export function HealthCard(props: HealthCardProps) {
  const { label, tone, value, detail, action } = props;
  const look = TONES[tone];

  return (
    <div className="min-w-0 bg-surface">
      <div className={cn('flex h-full flex-col gap-1 px-4.5 pt-3.5 pb-4', look.ground)}>
        <span className="flex items-center gap-2 text-caption whitespace-nowrap text-foreground-muted">
          <AppIcon id={look.icon} size={14} className={look.glyph} />
          {label}
        </span>
        <span className={cn('mt-1 truncate text-subhead font-medium', look.word)}>{value}</span>
        {detail === undefined ? null : (
          <span className="text-caption text-foreground-subtle">{detail}</span>
        )}
        {action === undefined ? null : <div className="mt-auto pt-2.5">{action}</div>}
      </div>
    </div>
  );
}
