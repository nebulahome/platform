/**
 * The pieces every dashboard card is built from.
 *
 * One frame, one heading, one way of writing a reading, so a light and a sensor side by side read
 * as two cards of one page. A card lit by the thing on it - a lamp that is on - takes that thing's
 * own colour at its edge and in a wash rising from one corner; everything else is the plain card
 * face every panel in the interface has.
 */
import type { CSSProperties, ReactNode } from 'react';

import type { IconView } from '@nebulahome/contracts';
import { AppIcon, CardHeading, cn } from '@nebulahome/ui';

import type { EntityKind } from '@/library/entity-kind';
import { EntityTile } from '@/routes/library/entity-tile';

/** How a card's face is drawn. */
export type CardTone = 'plain' | 'faint';

/** What a frame needs. */
export type CardFrameProps = {
  /** What the card is, for a screen reader. */
  readonly label: string;

  /** Plain, or faint for something that is not there to be read. */
  readonly tone?: CardTone;

  /** The colour of the light on it, when something on it is lit. */
  readonly glow?: string | undefined;

  /** Anything extra for the outer element. */
  readonly className?: string;

  readonly children: ReactNode;
};

/**
 * The wash a lit card is drawn with: its colour at the edge and rising from the lower left.
 *
 * `color-mix` keeps it a colour of the light itself rather than a tint chosen here, and the card's
 * own face is kept underneath, so the light theme's plain card stays plain where the wash fades.
 *
 * @param color - The light's colour, any CSS colour.
 * @returns The style.
 */
function glowStyle(color: string): CSSProperties {
  /**
   * The light's colour at a strength.
   *
   * @param percent - How much of it, the rest transparent.
   * @returns A CSS colour.
   */
  const mix = (percent: number): string =>
    `color-mix(in oklab, ${color} ${String(percent)}%, transparent)`;

  return {
    borderColor: mix(30),
    backgroundImage: `radial-gradient(135% 105% at 12% 118%, ${mix(22)} 0%, ${mix(5)} 46%, transparent 72%)`,
  };
}

/**
 * Renders a card's frame.
 *
 * @param props - See {@link CardFrameProps}.
 * @returns The frame.
 */
export function CardFrame(props: CardFrameProps) {
  const { label, tone = 'plain', glow, className, children } = props;

  return (
    <article
      aria-label={label}
      className={cn(
        'relative flex h-full min-w-0 flex-col overflow-hidden rounded-panel border p-4',
        tone === 'plain'
          ? 'border-border bg-surface'
          : 'border-dashed border-border-strong bg-surface-raised/60',
        className,
      )}
      /* eslint-disable-next-line react/forbid-dom-props -- the wash is the light's own colour, which
      the palette does not hold (RULES.md 15.3). */
      style={glow === undefined ? undefined : glowStyle(glow)}
    >
      {children}
    </article>
  );
}

/** What a groove needs. */
export type GrooveProps = {
  /** How full, from 0 to 100. */
  readonly percent: number;

  /** What the full part is drawn in: a CSS colour or gradient; the accent when absent. */
  readonly fill?: string | undefined;

  /** What it measures, for a screen reader. */
  readonly label: string;
};

/**
 * Renders a level as a sunk track with a lit fill: a brightness, a position, a print.
 *
 * @param props - See {@link GrooveProps}.
 * @returns The groove.
 */
export function Groove(props: GrooveProps) {
  const { percent, fill, label } = props;
  const clamped = Math.min(100, Math.max(0, percent));

  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      className="h-3.5 rounded-full border border-border bg-surface-raised p-0.5"
    >
      <div
        className={cn('h-full rounded-full', fill === undefined ? 'bg-primary' : undefined)}
        /* eslint-disable-next-line react/forbid-dom-props -- the fill is as long as the level, in the
        colour of what it measures - values, not styles (RULES.md 15.3). */
        style={{
          width: `${String(clamped)}%`,
          ...(fill === undefined ? {} : { background: fill }),
        }}
      />
    </div>
  );
}

/** What the compact row needs. */
export type TileRowProps = {
  /** The entity's icon, when it has one of its own. */
  readonly icon: IconView | undefined;

  /** What kind of thing it is, for the tile's glyph and tint. */
  readonly kind: EntityKind;

  /** Whether it is on, open or playing; null for a reading that is neither. */
  readonly isActive: boolean | null;

  /** Whether it can be reached. */
  readonly isAvailable: boolean;

  /** Its title. */
  readonly title: string;

  /** Where it is. */
  readonly subtitle?: string | null | undefined;

  /** What sits opposite: its reading, or a control. */
  readonly tail?: ReactNode;
};

/**
 * Renders the one-row card every kind has at its smallest: the tile, the name, and one thing.
 *
 * @param props - See {@link TileRowProps}.
 * @returns The row.
 */
export function TileRow(props: TileRowProps) {
  const { icon, kind, isActive, isAvailable, title, subtitle, tail } = props;

  return (
    <div className="flex h-full min-w-0 items-center gap-3">
      <EntityTile
        icon={icon}
        kind={kind}
        isActive={isActive}
        isAvailable={isAvailable}
        size="medium"
        className="size-10 rounded-tile"
      />
      <div className="min-w-0 grow">
        <CardHeading title={title} subtitle={subtitle} />
      </div>
      {tail === undefined ? null : <div className="flex shrink-0 items-center">{tail}</div>}
    </div>
  );
}

/** What a reading at the end of a row needs. */
export type EndReadingProps = {
  /** The reading, already written. */
  readonly value: string;

  /** A line under it. */
  readonly note?: string | null | undefined;

  /** A colour for the reading, when it has one. */
  readonly className?: string | undefined;
};

/**
 * Renders the reading a compact row ends on, with a note under it.
 *
 * @param props - See {@link EndReadingProps}.
 * @returns The reading.
 */
export function EndReading(props: EndReadingProps) {
  const { value, note, className } = props;

  return (
    <span className="flex max-w-32 flex-col items-end gap-0.5 text-right">
      <span className={cn('truncate text-headline leading-none font-semibold tabular', className)}>
        {value}
      </span>
      {note === undefined || note === null || note === '' ? null : (
        <span className="truncate text-label text-foreground-subtle">{note}</span>
      )}
    </span>
  );
}

/** What the unavailable note needs. */
export type UnavailableNoteProps = {
  /** What it last said, if anything. */
  readonly last?: string | undefined;

  /** Whether to say it in one line, for a card one row tall. */
  readonly isCompact?: boolean;
};

/**
 * Says a thing cannot be reached - with an icon and in words, never by colour alone (RULES 15.4).
 *
 * @param props - See {@link UnavailableNoteProps}.
 * @returns The note.
 */
export function UnavailableNote(props: UnavailableNoteProps) {
  const { last, isCompact = false } = props;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="flex items-center gap-2 text-warning">
        <AppIcon id="triangle-alert" size={isCompact ? 14 : 17} />
        <span className={cn('font-medium', isCompact ? 'text-ui' : 'text-subhead')}>
          Unavailable
        </span>
      </span>
      {isCompact || last === undefined ? null : (
        <span className="text-caption text-foreground-subtle">{last}</span>
      )}
    </div>
  );
}
