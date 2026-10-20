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
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
  const { children, className } = props;

  return (
    <section
      aria-label={t('ui.healthStrip.label', 'Health')}
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

  /**
   * The one action that fixes it, as an icon in the card's top right corner, so no card grows
   * taller than the others.
   */
  readonly action?: HealthAction | undefined;
};

/** A card's one action. */
export type HealthAction = {
  readonly icon: UiIconId;

  /** What it does, in a word: "Install", "Review", "See it". */
  readonly verb: string;
  readonly onSelect: () => void;
  readonly isBusy?: boolean;

  /** Drawn in the primary colour: something ready to do, like a firmware to install. */
  readonly isPrimary?: boolean;
};

/**
 * Renders one check.
 *
 * @param props - See {@link HealthCardProps}.
 * @returns The card.
 */
export function HealthCard(props: HealthCardProps) {
  const { t } = useTranslation();
  const { label, tone, value, detail, action } = props;
  const look = TONES[tone];

  // What the corner says it does: "Install: firmware, 1.5.0 ready".
  const named =
    action === undefined
      ? ''
      : typeof value === 'string'
        ? t('ui.healthStrip.actionOn', '{{verb}}: {{what}}, {{value}}', {
            verb: action.verb,
            what: label.toLocaleLowerCase(),
            value,
          })
        : t('ui.healthStrip.action', '{{verb}}: {{what}}', {
            verb: action.verb,
            what: label.toLocaleLowerCase(),
          });

  return (
    <div className="relative min-w-0 bg-surface">
      <div className={cn('flex h-full flex-col gap-1 px-4.5 pt-3.5 pb-4', look.ground)}>
        <span
          className={cn(
            'flex items-center gap-2 text-caption whitespace-nowrap text-foreground-muted',
            action !== undefined && 'pr-7.5',
          )}
        >
          <AppIcon id={look.icon} size={16} className={look.glyph} />
          {label}
        </span>
        <span className={cn('mt-1 truncate text-subhead font-medium', look.word)}>{value}</span>
        {detail === undefined ? null : (
          <span className="text-caption text-foreground-subtle">{detail}</span>
        )}
      </div>
      {action === undefined ? null : (
        <button
          type="button"
          aria-label={named}
          title={named}
          aria-busy={action.isBusy === true ? true : undefined}
          disabled={action.isBusy === true}
          onClick={action.onSelect}
          className={cn(
            'absolute top-2.5 right-2.5 flex size-7.5 items-center justify-center rounded-pill border transition-colors focus-visible:ring-3 focus-visible:ring-primary/25 focus-visible:outline-none disabled:opacity-60',
            action.isPrimary === true
              ? 'border-primary/45 bg-primary/14 text-primary hover:bg-primary/25'
              : 'border-border-strong bg-surface-raised text-foreground-muted hover:bg-surface-high hover:text-foreground',
          )}
        >
          <AppIcon id={action.isBusy === true ? 'loader-circle' : action.icon} size={15} />
        </button>
      )}
    </div>
  );
}
