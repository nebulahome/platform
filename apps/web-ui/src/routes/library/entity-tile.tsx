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
import type { IconView } from '@nebulahome/contracts';
import { AppIcon, CatalogueIcon, cn } from '@nebulahome/ui';

import type { EntityKind, EntityTone } from '@/library/entity-kind';

/** The lit classes of each family, spelled out so Tailwind can see every one. */
const LIT: Readonly<Record<EntityTone, string>> = {
  light: 'bg-lamp/14 text-lamp',
  power: 'bg-primary/14 text-primary',
  sensor: 'bg-cyan/14 text-cyan',
  cover: 'bg-primary/14 text-primary',
  climate: 'bg-heat/14 text-heat',
  secure: 'bg-success/14 text-success',
  media: 'bg-violet/14 text-violet',
  camera: 'bg-cyan/14 text-cyan',
  garden: 'bg-tag-lime/14 text-tag-lime',
  derived: 'bg-violet/14 text-violet',
};

/** How large a tile is drawn, and the glyph inside it. */
const SIZES = {
  tiny: { box: 'size-5 rounded-chip', glyph: 12 },
  small: { box: 'size-7 rounded-chip', glyph: 15 },
  medium: { box: 'size-8 rounded-field', glyph: 16 },
  well: { box: 'size-9 rounded-field', glyph: 18 },
  large: { box: 'size-12 rounded-tile', glyph: 22 },
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

  /** Only the glyph lit, on the plain ground of a list row's well. */
  readonly isPlain?: boolean;

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
  const {
    icon,
    kind,
    isActive,
    isAvailable = true,
    size = 'medium',
    isPlain = false,
    className,
  } = props;
  const { box, glyph } = SIZES[size];
  const isLit = isAvailable && isActive !== false;
  const lit = isPlain
    ? `bg-surface-raised ${LIT[kind.tone]
        .split(' ')
        .filter((name) => name.startsWith('text-'))
        .join(' ')}`
    : LIT[kind.tone];

  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center transition-colors',
        box,
        isLit ? lit : 'bg-surface-raised text-foreground-subtle',
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
