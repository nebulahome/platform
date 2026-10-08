/**
 * The catalogue card of integrations, packages and containers: a logo well, the marks of how it
 * talks, a name with its badges, a version, and - pinned to the bottom - its counts.
 *
 * One component where there were four copies of the same card, each with its own idea of the
 * padding and the name's size. The tile draws the parts and nothing else: the whole tile is the
 * link, and a link is the router's, so the caller renders it with {@link TILE_FRAME} and puts the
 * tile inside.
 *
 * `surface`, a 1px `border` that turns `border-strong` under the pointer, `radius-panel`, 18px in,
 * at least 164px tall, on a grid of `repeat(auto-fill, minmax(220px, 1fr))` with a 14px gap.
 *
 * As the boards draw a catalogue, the foot is parted by a line: the state as a Pill on the left,
 * the counts on the right. The last tile of a grid that can grow is a dashed {@link BrowseTile}.
 */
import type { ReactNode } from 'react';

import type { UiIconId } from '../icons/ui-set.js';
import { cn } from '../lib/cn.js';

import { AppIcon } from './app-icon.js';

/** The classes of the element a tile sits in: the link, or the card itself. */
export const TILE_FRAME =
  'flex h-full min-h-41 flex-col gap-3.5 rounded-panel border border-border bg-surface p-4.5 ' +
  'transition-colors hover:border-border-strong focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 focus-visible:outline-primary';

/** The grid tiles are laid out on. */
export const TILE_GRID = 'grid grid-tiles gap-3.5';

/** What a tile needs. */
export type TileProps = {
  /** The logo well: a 44px square, the logo or a monogram. */
  readonly logo: ReactNode;

  /** On the right of the top row: how it talks, what it needs. */
  readonly marks?: ReactNode;

  /** Its name. */
  readonly name: ReactNode;

  /** Beside the name: what needs attention, what was found. */
  readonly badges?: ReactNode;

  /** Under the name, in mono: its version, its image. */
  readonly version?: ReactNode;

  /** Pinned to the bottom: its counts, with mono numbers. */
  readonly stats?: ReactNode;

  /** Pinned to the bottom under a line: its state on the left, its counts on the right. */
  readonly footer?: ReactNode;
};

/**
 * Renders a tile's parts, for a {@link TILE_FRAME} to hold.
 *
 * @param props - See {@link TileProps}.
 * @returns The parts.
 */
export function Tile(props: TileProps) {
  const { logo, marks, name, badges, version, stats, footer } = props;

  return (
    <>
      <span className="flex items-start justify-between gap-1.5">
        {logo}
        {marks === undefined ? null : <span className="flex items-center gap-1.5">{marks}</span>}
      </span>

      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-title font-medium text-foreground">{name}</span>
          {badges}
        </span>
        {version === undefined ? null : (
          <span className="truncate font-mono text-mono-caption text-foreground-subtle tabular">
            {version}
          </span>
        )}
      </span>

      {stats === undefined ? null : (
        <span className="mt-auto flex flex-wrap items-baseline gap-x-1 text-ui-sm text-foreground-muted tabular">
          {stats}
        </span>
      )}

      {footer === undefined ? null : (
        <span className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-caption text-foreground-muted tabular">
          {footer}
        </span>
      )}
    </>
  );
}

/** What the browse tile needs. */
export type BrowseTileProps = {
  /** What it opens: "Browse the integration index". */
  readonly title: string;

  /** A line under it: what is there. */
  readonly note: string;

  /** The glyph in its dashed well. */
  readonly icon: UiIconId;

  /** Opens it. */
  readonly onClick: () => void;
};

/**
 * The last tile of a catalogue that can grow: a dashed card that opens where more come from.
 *
 * @param props - See {@link BrowseTileProps}.
 * @returns The tile, as a button.
 */
export function BrowseTile(props: BrowseTileProps) {
  const { title, note, icon, onClick } = props;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        TILE_FRAME,
        'border-dashed bg-transparent text-left text-foreground-subtle hover:text-foreground-muted',
      )}
    >
      <span className="flex size-11 items-center justify-center rounded-tile border border-dashed border-border-strong">
        <AppIcon id={icon} size={18} />
      </span>
      <span className="flex flex-col gap-1">
        <span className="text-title font-medium text-foreground-muted">{title}</span>
        <span className="text-ui-sm">{note}</span>
      </span>
      <span className="mt-auto flex justify-end">
        <AppIcon id="arrow-right" size={16} />
      </span>
    </button>
  );
}

/** What a tile's mark needs. */
export type TileMarkProps = {
  /** What it says, read out and shown on hover: the mark is a glyph. */
  readonly title: string;

  /** The glyph. */
  readonly children: ReactNode;

  /** A warning worth a colour - "needs the internet" - rather than a neutral fact. */
  readonly tone?: 'neutral' | 'warning';

  /** Anything extra for the mark. */
  readonly className?: string | undefined;
};

/**
 * One mark of a tile: a 26px circle on a `border-strong` edge with a glyph in it.
 *
 * @param props - See {@link TileMarkProps}.
 * @returns The mark.
 */
export function TileMark(props: TileMarkProps) {
  const { title, children, tone = 'neutral', className } = props;

  return (
    <span
      title={title}
      aria-label={title}
      role="img"
      className={cn(
        'inline-flex size-6.5 shrink-0 items-center justify-center rounded-full border border-border-strong',
        tone === 'warning' ? 'text-warning' : 'text-foreground-subtle',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** What a tile's figure needs. */
export type TileStatProps = {
  /** The number. */
  readonly value: ReactNode;

  /** What it counts. */
  readonly label: ReactNode;
};

/**
 * One count of a tile: the number in mono, then what it counts.
 *
 * @param props - See {@link TileStatProps}.
 * @returns The count.
 */
export function TileStat(props: TileStatProps) {
  const { value, label } = props;

  return (
    <span className="whitespace-nowrap">
      <b className="font-mono font-medium text-foreground">{value}</b> {label}
    </span>
  );
}
