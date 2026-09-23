/**
 * The square an entity is drawn in: its icon, tinted by what kind of thing it is.
 *
 * The same tile on the devices row, at the top of the entity's page and in the picker, so a lamp
 * is recognised by one shape wherever it is chosen or looked at. The tint says what family it is
 * - a light warm, a lock green - and it is lit only while the thing is on, open or playing: a row
 * of switched-off relays is a row of grey tiles, and the one that is on is found at a glance.
 * Colour is not the only carrier (RULES.md 15.5): every place a tile is drawn also says "On" or
 * "Off" in words.
 *
 * A sensor has no on and off, so its tile is always tinted; an entity that cannot be reached is
 * always grey.
 */
import type { IconView } from '@nebula-home/contracts';
import { AppIcon, CatalogueIcon, cn } from '@nebula-home/ui';

import type { EntityKind, EntityTone } from '@/library/entity-kind';

/** The lit classes of each family, spelled out so Tailwind can see every one. */
const LIT: Readonly<Record<EntityTone, string>> = {
  light: 'border-tag-amber/30 bg-tag-amber/13 text-tag-amber',
  power: 'border-tag-teal/30 bg-tag-teal/13 text-tag-teal',
  sensor: 'border-primary/30 bg-primary/13 text-primary',
  cover: 'border-primary/30 bg-primary/13 text-primary',
  climate: 'border-tag-orange/30 bg-tag-orange/13 text-tag-orange',
  secure: 'border-tag-green/30 bg-tag-green/13 text-tag-green',
  media: 'border-tag-violet/30 bg-tag-violet/13 text-tag-violet',
  camera: 'border-tag-blue/30 bg-tag-blue/13 text-tag-blue',
  derived: 'border-tag-cyan/30 bg-tag-cyan/13 text-tag-cyan',
};

/** How large a tile is drawn, and the glyph inside it. */
const SIZES = {
  tiny: { box: 'size-5 rounded-chip', glyph: 12 },
  small: { box: 'size-7 rounded-chip', glyph: 15 },
  medium: { box: 'size-8 rounded-chip', glyph: 17 },
  large: { box: 'size-12 rounded-tile', glyph: 24 },
} as const;

/** What a tile needs. */
export type EntityTileProps = {
  /** The entity's own icon from the catalogue; undefined for none, or while it is read. */
  readonly icon: IconView | undefined;

  /** What kind of thing it is. */
  readonly kind: EntityKind;

  /**
   * Whether it is on, open or playing: true lights the tile, false greys it, null - a sensor,
   * which is neither - keeps it tinted.
   */
  readonly isActive: boolean | null;

  /** Whether it can be reached; an unreachable entity is grey whatever it last said. */
  readonly isAvailable?: boolean;

  /** How large. */
  readonly size?: keyof typeof SIZES;

  /** Anything extra for the outer element. */
  readonly className?: string;
};

/**
 * Renders a tile.
 *
 * @param props - See {@link EntityTileProps}.
 * @returns The tile.
 */
export function EntityTile(props: EntityTileProps) {
  const { icon, kind, isActive, isAvailable = true, size = 'medium', className } = props;
  const { box, glyph } = SIZES[size];
  const isLit = isAvailable && isActive !== false;

  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center border transition-colors',
        box,
        isLit ? LIT[kind.tone] : 'border-border bg-surface-raised text-foreground-subtle',
        className,
      )}
    >
      {icon === undefined ? (
        <AppIcon id={kind.icon} size={glyph} />
      ) : (
        <CatalogueIcon node={icon.node} frame={icon.frame} size={glyph} />
      )}
    </span>
  );
}
